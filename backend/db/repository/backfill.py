"""Enrollment-chain backfill (slice 2a): Firestore docs -> Postgres rows.

Scope is strictly the tenancy/roster chain — organizations, memberships,
classes, enrollments — per docs/school-integration/POSTGRES_SCHEMA.md
("Backfill Normalization And ID Resolution"). Assignments, compliance, Canvas,
LTI, practice, and learning events are out of scope and untouched here.

This is OFFLINE backfill tooling. Nothing here is wired into a live route or
`deps.db`; the caller owns the engine, the Session, and the
commit/rollback decision.

Design:
- Each `upsert_*` is idempotent by `legacy_firestore_id` (the Firestore doc id):
  it SELECTs the existing row first and UPDATEs in place, else INSERTs. After
  add/update it calls `session.flush()` so the row's UUID `id` is available for
  children to resolve via `resolution.resolve_legacy_id`.
- Foreign references are Firestore string ids; they resolve to Postgres UUIDs
  through each parent's unique `legacy_firestore_id` index. A missing parent is
  a hard error (the run must process PARENT-FIRST so the parent already exists).
- `run_backfill` processes organizations -> memberships -> classes ->
  enrollments. In `dry_run` mode it performs NO writes/flushes: it runs the pure
  transforms + a resolution dry pass, counts would-be inserts/updates, and
  reports unresolved parents. The caller must roll back after a dry run.

Value remaps and field coercions are delegated to the pure transforms in
`normalization.py` (already written) — this module does not reimplement them.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository.normalization import (
    coerce_str_list,
    normalize_enrollment_status,
    normalize_join_source,
    normalize_membership_status,
    normalize_org_status,
    parse_firestore_timestamp,
)
from backend.db.repository.resolution import resolve_legacy_id


class UnresolvedParentError(Exception):
    """A foreign reference's parent has no migrated Postgres row.

    Raised by the membership/class/enrollment upserts when a parent Firestore id
    does not resolve via `legacy_firestore_id`. Because the backfill runs
    parent-first, this means the parent doc was missing from the input set (or
    was itself skipped/errored) — it is a data-integrity signal, not a retry.
    """


# --- Per-entity upserts ------------------------------------------------------
#
# Each takes an injected Session, is idempotent by legacy_firestore_id, flushes
# after add/update, and returns the ORM row.


def _existing(session: Any, model: Any, legacy_firestore_id: str | None):
    """Return the existing row for this Firestore doc id, or None."""
    if not legacy_firestore_id:
        return None
    stmt = select(model).where(model.legacy_firestore_id == legacy_firestore_id)
    return session.execute(stmt).scalar_one_or_none()


def _resolvable(session: Any, model: Any, firestore_id: str | None, pending: dict) -> bool:
    """True if a parent Firestore id is already migrated OR would be written
    earlier in this same DRY run (tracked in `pending`).

    Dry-run writes nothing, so a child cannot resolve a parent via the DB alone;
    `pending` records the would-be-written parent ids per model so the chain
    resolves without persisting anything.
    """
    if not firestore_id:
        return False
    if firestore_id in pending[model]:
        return True
    return resolve_legacy_id(session, model, firestore_id) is not None


def upsert_organization(
    session: Any, doc: dict[str, Any], *, warnings: list[Any] | None = None
) -> Organization:
    """Upsert one organization. Idempotent by legacy_firestore_id (org doc id).

    Field renames per POSTGRES_SCHEMA.md:
      suspended_by_uid -> suspended_by_firebase_uid
      restored_by_uid  -> restored_by_firebase_uid
    `status` is normalized (legacy 'inactive' -> 'archived'). `school_admin_uids`
    is intentionally NOT a column (derived from memberships) and is skipped.
    """
    legacy_id = doc.get('id')
    name = doc.get('name') or ''
    fields = {
        'name': name,
        # name_lower is a required, NOT-NULL search index; recompute defensively
        # from name if the Firestore doc omitted it.
        'name_lower': doc.get('name_lower') or name.strip().lower(),
        'type': doc.get('type') or 'school',
        'status': normalize_org_status(doc.get('status')),
        'pilot_stage': doc.get('pilot_stage'),
        'lms_capabilities': coerce_str_list(doc.get('lms_capabilities')),
        'default_modality_policy': doc.get('default_modality_policy') or 'hybrid',
        'default_retention_policy': doc.get('default_retention_policy') or 'standard_school',
        'school_type': doc.get('school_type'),
        'country': doc.get('country'),
        'state': doc.get('state'),
        'county': doc.get('county'),
        'city': doc.get('city'),
        'website_url': doc.get('website_url'),
        'public_or_private': doc.get('public_or_private'),
        'grade_size': doc.get('grade_size'),
        'teacher_invite_code': doc.get('teacher_invite_code'),
        'teacher_invite_code_active': bool(doc.get('teacher_invite_code_active', False)),
        'teacher_invite_code_generated_at': parse_firestore_timestamp(
            doc.get('teacher_invite_code_generated_at')
        ),
        'last_activity_at': parse_firestore_timestamp(doc.get('last_activity_at')),
        'suspended_at': parse_firestore_timestamp(doc.get('suspended_at')),
        # Renamed: Firestore suspended_by_uid -> suspended_by_firebase_uid.
        'suspended_by_firebase_uid': doc.get('suspended_by_uid'),
        'suspend_reason': doc.get('suspend_reason'),
        'suspended_until': parse_firestore_timestamp(doc.get('suspended_until')),
        'restored_at': parse_firestore_timestamp(doc.get('restored_at')),
        # Renamed: Firestore restored_by_uid -> restored_by_firebase_uid.
        'restored_by_firebase_uid': doc.get('restored_by_uid'),
    }

    row = _existing(session, Organization, legacy_id)
    if row is None:
        row = Organization(legacy_firestore_id=legacy_id, **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    session.flush()  # make row.id available to child resolution
    return row


def upsert_membership(
    session: Any, doc: dict[str, Any], *, warnings: list[Any] | None = None
) -> Membership:
    """Upsert one membership. Idempotent by legacy_firestore_id ({org_id}_{uid}).

    Resolves org_id: the Firestore membership.org_id is an org DOC ID; resolve
    it to organizations.id via legacy_firestore_id. Raises UnresolvedParentError
    if unresolved (the org must be backfilled first).

    Field renames: uid -> firebase_uid, removed_by_uid -> removed_by_firebase_uid.

    primary_class_ids is DEFERRED to [] for v1. It is a denormalized convenience
    array of class doc-ids, but classes are migrated AFTER memberships in
    dependency order, so the UUIDs are not resolvable here. The authoritative
    membership->class linkage is class_teachers / enrollments; enrollment reads
    (this slice's purpose) do not need primary_class_ids. Resolving and
    backfilling it is a later slice (see POSTGRES_SCHEMA.md open decision).
    """
    legacy_id = doc.get('id')
    org_firestore_id = doc.get('org_id')
    org_uuid = resolve_legacy_id(session, Organization, org_firestore_id)
    if org_uuid is None:
        raise UnresolvedParentError(
            f'membership {legacy_id!r}: organization {org_firestore_id!r} has no '
            'migrated row (organizations must be backfilled first)'
        )

    fields = {
        'org_id': org_uuid,
        # Renamed: Firestore uid -> firebase_uid.
        'firebase_uid': doc.get('uid'),
        'roles': coerce_str_list(doc.get('roles')),
        'status': normalize_membership_status(doc.get('status')),
        # Deferred denormalized array (see docstring). Always [] in v1.
        'primary_class_ids': [],
        'removed_at': parse_firestore_timestamp(doc.get('removed_at')),
        # Renamed: Firestore removed_by_uid -> removed_by_firebase_uid.
        'removed_by_firebase_uid': doc.get('removed_by_uid'),
    }

    row = _existing(session, Membership, legacy_id)
    if row is None:
        row = Membership(legacy_firestore_id=legacy_id, **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    session.flush()
    return row


def upsert_class(
    session: Any, doc: dict[str, Any], *, warnings: list[Any] | None = None
) -> Class:
    """Upsert one class. Idempotent by legacy_firestore_id (class doc id).

    Resolves org_id via legacy_firestore_id (RAISE if unresolved). Join codes
    (class_join_codes) and teacher links (class_teachers) are OUT OF SCOPE for
    this slice — they are synthesized/resolved in a later slice, not here.
    """
    legacy_id = doc.get('id')
    org_firestore_id = doc.get('org_id')
    org_uuid = resolve_legacy_id(session, Organization, org_firestore_id)
    if org_uuid is None:
        raise UnresolvedParentError(
            f'class {legacy_id!r}: organization {org_firestore_id!r} has no '
            'migrated row (organizations must be backfilled first)'
        )

    fields = {
        'org_id': org_uuid,
        'name': doc.get('name') or '',
        'term': doc.get('term'),
        'subject': doc.get('subject'),
        'learning_locale': doc.get('learning_locale') or 'ko-KR',
        'grade_band': doc.get('grade_band'),
        'status': doc.get('status') or 'active',
        'canvas_course_id': doc.get('canvas_course_id') or None,
    }

    row = _existing(session, Class, legacy_id)
    if row is None:
        row = Class(legacy_firestore_id=legacy_id, **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    session.flush()
    return row


def upsert_enrollment(
    session: Any, doc: dict[str, Any], *, warnings: list[Any] | None = None
) -> Enrollment:
    """Upsert one enrollment. Idempotent by legacy_firestore_id.

    The Firestore enrollment doc id is the composite '{class_id}_{student_uid}';
    it is carried verbatim into legacy_firestore_id.

    Resolves class_id via legacy_firestore_id (RAISE if unresolved). Resolves
    student_membership_id via legacy_firestore_id ONLY when present (else None;
    it is an optional nullable FK with ON DELETE SET NULL).

    student_uid -> student_firebase_uid is a RENAME, not a resolution: it is a
    Firebase UID, stable across both stores. status and join_source are
    normalized (pending_sync -> inactive, canvas -> canvas_legacy).
    """
    legacy_id = doc.get('id')
    class_firestore_id = doc.get('class_id')
    class_uuid = resolve_legacy_id(session, Class, class_firestore_id)
    if class_uuid is None:
        raise UnresolvedParentError(
            f'enrollment {legacy_id!r}: class {class_firestore_id!r} has no '
            'migrated row (classes must be backfilled first)'
        )

    # Optional FK: resolve only if the Firestore doc carries a membership id.
    membership_firestore_id = doc.get('student_membership_id')
    membership_uuid = None
    if membership_firestore_id:
        membership_uuid = resolve_legacy_id(session, Membership, membership_firestore_id)
        if membership_uuid is None and warnings is not None:
            # Present but unresolved -> FK left NULL. Surface it (vs a genuinely
            # absent membership) so the downgrade is auditable instead of silent.
            warnings.append({
                'id': legacy_id,
                'warning': (
                    f'student_membership_id {membership_firestore_id!r} did not '
                    'resolve; foreign key left NULL'
                ),
            })

    fields = {
        'class_id': class_uuid,
        # Renamed (not resolved): Firestore student_uid -> student_firebase_uid.
        'student_firebase_uid': doc.get('student_uid'),
        'student_membership_id': membership_uuid,
        'status': normalize_enrollment_status(doc.get('status')),
        'join_source': normalize_join_source(doc.get('join_source')),
        'student_number': doc.get('student_number') or None,
        'guardian_contact_required': bool(doc.get('guardian_contact_required', False)),
        'canvas_user_id': doc.get('canvas_user_id') or None,
        'canvas_email': doc.get('canvas_email') or None,
        'canvas_name': doc.get('canvas_name') or None,
    }

    row = _existing(session, Enrollment, legacy_id)
    if row is None:
        row = Enrollment(legacy_firestore_id=legacy_id, **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    session.flush()
    return row


# --- Orchestration -----------------------------------------------------------

# Parent-first order (POSTGRES_SCHEMA.md "ID resolution"): a child can only
# resolve its parent's UUID once the parent row exists.
_PIPELINE = (
    ('organizations', Organization, upsert_organization),
    ('memberships', Membership, upsert_membership),
    ('classes', Class, upsert_class),
    ('enrollments', Enrollment, upsert_enrollment),
)


def _empty_stats() -> dict[str, Any]:
    return {'inserted': 0, 'updated': 0, 'skipped': 0, 'errors': [], 'warnings': []}


def run_backfill(
    session: Any,
    *,
    organizations: Any = (),
    memberships: Any = (),
    classes: Any = (),
    enrollments: Any = (),
    dry_run: bool = False,
) -> dict[str, dict[str, Any]]:
    """Backfill the enrollment chain, parent-first.

    Processes organizations -> memberships -> classes -> enrollments. Each
    entity's docs are an iterable of Firestore-shaped dicts (each carrying its
    doc 'id' as the legacy_firestore_id source).

    Returns per-entity stats: {entity: {inserted, updated, skipped, errors, warnings}}.
    Each row's upsert runs inside a SAVEPOINT (session.begin_nested), so a row
    that fails at flush (NOT NULL, CHECK, unique) rolls back ONLY that row and is
    reported under `errors` — it never poisons the outer transaction or aborts the
    later docs/entities. A doc missing its Firestore `id` is rejected as an error
    (a NULL legacy_firestore_id can't be deduplicated). `warnings` records
    non-fatal data downgrades (e.g. an enrollment whose student_membership_id did
    not resolve and was left NULL).

    PRECONDITION: the caller MUST have run the pre-backfill uniqueness scans
    (POSTGRES_SCHEMA.md "Pre-backfill uniqueness scans") and aborted on violation.
    Two membership docs normalizing to the same active (org_id, firebase_uid)
    would each fail the partial-unique index; the SAVEPOINT keeps that to one
    per-row error instead of an aborted run, but it does not substitute for the
    scan.

    dry_run=True performs NO writes or flushes. It runs the pure transforms and a
    resolution DRY PASS (SELECT-only) to classify each doc as a would-be insert
    vs. update, surface unresolved required parents (errors), and flag would-be
    NULL-FK downgrades (warnings). The CALLER must roll back after a dry run; this
    function never commits.
    """
    inputs = {
        'organizations': organizations,
        'memberships': memberships,
        'classes': classes,
        'enrollments': enrollments,
    }
    stats = {name: _empty_stats() for name, _model, _fn in _PIPELINE}
    # Dry-run only: per-model set of would-be-written legacy ids, so a child can
    # resolve a parent that this same dry pass "would" create (see _resolvable).
    pending = {model: set() for _n, model, _f in _PIPELINE} if dry_run else None

    for name, model, upsert_fn in _PIPELINE:
        entity_stats = stats[name]
        for doc in inputs[name]:
            legacy_id = doc.get('id')
            # C1: a backfill row MUST carry its Firestore doc id. A NULL
            # legacy_firestore_id can't be deduplicated (Postgres treats NULLs as
            # distinct under UNIQUE) -> re-runs would insert duplicates, and no
            # child could resolve it. Reject before any write.
            if not legacy_id:
                entity_stats['errors'].append(
                    {'id': None, 'error': f'{name} doc is missing its Firestore id'}
                )
                continue
            try:
                if dry_run:
                    _dry_run_one(session, name, model, doc, entity_stats, pending)
                    # Reached only if no parent was unresolved: this row would be
                    # written, so its children can now resolve it.
                    pending[model].add(legacy_id)
                else:
                    existed = _existing(session, model, legacy_id) is not None
                    # C2: SAVEPOINT per row. A DB-level failure rolls back only
                    # this row (reported under errors) without poisoning the
                    # outer transaction and aborting every later doc/entity.
                    with session.begin_nested():
                        upsert_fn(session, doc, warnings=entity_stats['warnings'])
                    if existed:
                        entity_stats['updated'] += 1
                    else:
                        entity_stats['inserted'] += 1
            except Exception as exc:  # noqa: BLE001 — report, don't abort the run
                entity_stats['errors'].append({'id': legacy_id, 'error': str(exc)})

    return stats


def _dry_run_one(
    session: Any,
    name: str,
    model: Any,
    doc: dict[str, Any],
    entity_stats: dict[str, Any],
    pending: dict,
) -> None:
    """Classify one doc WITHOUT writing: would-be insert/update, or unresolved.

    Resolves required parents against the DB OR the `pending` set of would-be-
    written ids from earlier in this same dry pass, so the chain resolves without
    persisting anything. Unresolved required parents are raised (counted as
    errors); a present-but-unresolvable optional membership FK is a warning.
    """
    legacy_id = doc.get('id')

    # Parent-resolution dry pass — mirrors each upsert's RAISE conditions.
    if name == 'memberships':
        if not _resolvable(session, Organization, doc.get('org_id'), pending):
            raise UnresolvedParentError(
                f'membership {legacy_id!r}: organization {doc.get("org_id")!r} unresolved'
            )
    elif name == 'classes':
        if not _resolvable(session, Organization, doc.get('org_id'), pending):
            raise UnresolvedParentError(
                f'class {legacy_id!r}: organization {doc.get("org_id")!r} unresolved'
            )
    elif name == 'enrollments':
        if not _resolvable(session, Class, doc.get('class_id'), pending):
            raise UnresolvedParentError(
                f'enrollment {legacy_id!r}: class {doc.get("class_id")!r} unresolved'
            )
        # H2: surface the silent NULL-FK downgrade the real run would do, so the
        # operator's pre-flight is not blind to it.
        mem_fid = doc.get('student_membership_id')
        if mem_fid and not _resolvable(session, Membership, mem_fid, pending):
            entity_stats['warnings'].append({
                'id': legacy_id,
                'warning': (
                    f'student_membership_id {mem_fid!r} would not resolve; '
                    'foreign key would be left NULL'
                ),
            })

    existing = _existing(session, model, legacy_id)
    if existing is None:
        entity_stats['inserted'] += 1
    else:
        entity_stats['updated'] += 1
