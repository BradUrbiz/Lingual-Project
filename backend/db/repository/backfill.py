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

import datetime
from typing import Any

from sqlalchemy import delete, select

from backend.db.models.migration import MigrationImportRun
from backend.db.models.org import (
    Class,
    ClassJoinCode,
    ClassTeacher,
    Enrollment,
    Membership,
    Organization,
)
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


# Statuses covered by the partial-unique index memberships_org_uid_active_idx.
_ACTIVE_INVITED_STATUSES = ('active', 'invited')


def _merge_roles(existing: Any, incoming: Any) -> list[str]:
    """Union two role lists, preserving order (existing first), de-duplicated.

    Firestore stores a user who holds several roles in one org as SEPARATE
    single-role membership docs — different write paths use different doc-ids
    (the school-approve flow auto-ids; the join-code flow uses {org}_{uid}). But
    Postgres models ONE membership per (org,uid) with a roles[] array plus a
    partial-unique index over active/invited. So roles ACCUMULATE by union here.

    We union on the legacy-id UPDATE branch too (not just the cross-doc merge),
    so a backfill re-run cannot clobber a merged role back out regardless of which
    sibling doc it happens to process first — the result is order-independent and
    convergent. Role REMOVAL within a doc is intentionally NOT mirrored: no live
    write path removes a role (roles are set only at create_membership time; a
    role is "added" by creating another doc), so supporting removal would need a
    dedicated shadow rather than this additive upsert.
    """
    merged: list[str] = []
    for role in list(existing or []) + list(incoming or []):
        if role not in merged:
            merged.append(role)
    return merged


def _active_membership(session: Any, org_uuid: Any, firebase_uid: str | None):
    """The existing active/invited membership row for (org,uid), or None.

    Mirrors the partial-unique index `memberships_org_uid_active_idx` (unique on
    (org_id, firebase_uid) WHERE status in active/invited), which guarantees at
    most one such row, so a single SELECT is sufficient.
    """
    if not firebase_uid:
        return None
    stmt = select(Membership).where(
        Membership.org_id == org_uuid,
        Membership.firebase_uid == firebase_uid,
        Membership.status.in_(_ACTIVE_INVITED_STATUSES),
    )
    return session.execute(stmt).scalar_one_or_none()


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

    firebase_uid = doc.get('uid')
    incoming_roles = coerce_str_list(doc.get('roles'))
    incoming_status = normalize_membership_status(doc.get('status'))
    fields = {
        'org_id': org_uuid,
        # Renamed: Firestore uid -> firebase_uid.
        'firebase_uid': firebase_uid,
        'roles': incoming_roles,
        'status': incoming_status,
        # Deferred denormalized array (see docstring). Always [] in v1.
        'primary_class_ids': [],
        'removed_at': parse_firestore_timestamp(doc.get('removed_at')),
        # Renamed: Firestore removed_by_uid -> removed_by_firebase_uid.
        'removed_by_firebase_uid': doc.get('removed_by_uid'),
    }

    row = _existing(session, Membership, legacy_id)
    if row is None:
        # Multi-role identity merge: if this active/invited doc's (org,uid) already
        # has an active/invited row (a sibling single-role doc migrated earlier),
        # UNION roles into it rather than INSERT a row the partial-unique index
        # would reject. This is the faithful relational representation of a user
        # who is e.g. both teacher and student in one org. See _merge_roles.
        if incoming_status in _ACTIVE_INVITED_STATUSES:
            sibling = _active_membership(session, org_uuid, firebase_uid)
            if sibling is not None:
                sibling.roles = _merge_roles(sibling.roles, incoming_roles)
                if warnings is not None:
                    warnings.append({
                        'id': legacy_id,
                        'warning': (
                            f'multi-role user: merged roles {incoming_roles} into '
                            f'existing active (org,uid) membership '
                            f'{sibling.legacy_firestore_id!r}; no new row inserted'
                        ),
                    })
                session.flush()
                return sibling
        row = Membership(legacy_firestore_id=legacy_id, **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            # primary_class_ids is deferred to [] on INSERT, but on UPDATE it must
            # NOT be clobbered: the live-path shadow (slice 2c-3 shadow_add/remove_
            # primary_class) writes real class UUIDs into it, and a backfill re-run
            # must preserve those rather than zero them back to [].
            if key == 'primary_class_ids':
                continue
            # roles are ADDITIVE (union, never overwrite): a re-run must not clobber
            # a role a sibling doc merged in. Order-independent + convergent.
            if key == 'roles':
                value = _merge_roles(row.roles, incoming_roles)
            setattr(row, key, value)
    session.flush()
    return row


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def reconcile_class_teachers(
    session: Any,
    class_uuid: Any,
    teacher_membership_ids: Any,
    *,
    class_legacy_id: Any = None,
    warnings: list[Any] | None = None,
) -> None:
    """Converge class_teachers for a class to the resolved set of Firestore
    teacher_membership_ids[]. Each membership doc-id resolves to a UUID
    (legacy_firestore_id); unresolved ids are skipped + warned (the membership
    must be backfilled first). Idempotent + convergent: inserts links that are
    missing, removes links no longer present (a teacher dropped from the class).
    """
    desired: set = set()
    for legacy in coerce_str_list(teacher_membership_ids):
        muuid = resolve_legacy_id(session, Membership, legacy)
        if muuid is None:
            if warnings is not None:
                warnings.append({
                    'id': class_legacy_id,
                    'warning': f'class_teacher: membership {legacy!r} unresolved; link skipped',
                })
            continue
        desired.add(muuid)

    existing = set(session.execute(
        select(ClassTeacher.membership_id).where(ClassTeacher.class_id == class_uuid)
    ).scalars())

    for muuid in desired - existing:
        session.add(ClassTeacher(class_id=class_uuid, membership_id=muuid))
    stale = existing - desired
    if stale:
        session.execute(
            delete(ClassTeacher)
            .where(ClassTeacher.class_id == class_uuid)
            .where(ClassTeacher.membership_id.in_(stale))
        )
    session.flush()


def reconcile_class_join_code(
    session: Any,
    class_uuid: Any,
    *,
    code: str | None,
    active: bool,
    generated_at: datetime.datetime | None,
) -> None:
    """Converge class_join_codes to the Firestore class doc's denormalized
    current code. Firestore keeps only the CURRENT code + active flag (no
    history), so PG holds at most one ACTIVE row per class (the partial-unique
    one_active_per_class index). Shared by the backfill and the live
    generate/deactivate shadows so both write byte-identical rows.

      code + active   -> ensure exactly one active row (this code).
      code + inactive -> keep the (now inactive) code row, no active row.
      no code         -> no active row.

    Deactivate-then-flush BEFORE activating the target: the unique-active index
    is checked per-statement, and the UoW emits INSERTs before UPDATEs, so the
    old active row must be cleared first or the new one collides.
    """
    rows = session.execute(
        select(ClassJoinCode).where(ClassJoinCode.class_id == class_uuid)
    ).scalars().all()

    keep_active_code = code if (code and active) else None
    for r in rows:
        if r.active and r.code != keep_active_code:
            r.active = False
            r.deactivated_at = r.deactivated_at or _utcnow()
    session.flush()  # free the one-active-per-class slot before (re)activating

    if not code:
        return
    target = next((r for r in rows if r.code == code), None)
    if target is None:
        session.add(ClassJoinCode(
            class_id=class_uuid,
            code=code,
            active=bool(active),
            generated_at=generated_at or _utcnow(),
            deactivated_at=None if active else _utcnow(),
        ))
    else:
        target.active = bool(active)
        if generated_at is not None:
            target.generated_at = generated_at
        target.deactivated_at = None if active else (target.deactivated_at or _utcnow())
    session.flush()


def upsert_class(
    session: Any, doc: dict[str, Any], *, warnings: list[Any] | None = None
) -> Class:
    """Upsert one class + its junctions. Idempotent by legacy_firestore_id.

    Resolves org_id via legacy_firestore_id (RAISE if unresolved). Then
    reconciles the two junctions from the denormalized Firestore fields:
    class_teachers (from teacher_membership_ids[]) and class_join_codes (from
    join_code / join_code_active / join_code_generated_at). Because
    shadow_create_class delegates here, the live class-create path mirrors
    teachers for free; the live generate/deactivate-join-code shadows reuse the
    reconcile helpers directly.
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

    reconcile_class_teachers(
        session, row.id, doc.get('teacher_membership_ids'),
        class_legacy_id=legacy_id, warnings=warnings,
    )
    reconcile_class_join_code(
        session, row.id,
        code=doc.get('join_code') or None,
        active=bool(doc.get('join_code_active')),
        generated_at=parse_firestore_timestamp(doc.get('join_code_generated_at')),
    )
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
    # Dry-run only: would-be-active (org_firestore_id, uid) pairs, so a 2nd active
    # membership doc for the same (org,uid) is predicted as a multi-role MERGE
    # (update) rather than a phantom insert (mirrors upsert_membership).
    pending_active: set | None = set() if dry_run else None

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
                    _dry_run_one(
                        session, name, model, doc, entity_stats, pending, pending_active
                    )
                    # Reached only if no parent was unresolved: this row would be
                    # written, so its children can now resolve it.
                    pending[model].add(legacy_id)
                else:
                    existed = _existing(session, model, legacy_id) is not None
                    # C2: SAVEPOINT per row. A DB-level failure rolls back only
                    # this row (reported under errors) without poisoning the
                    # outer transaction and aborting every later doc/entity.
                    with session.begin_nested():
                        result_row = upsert_fn(
                            session, doc, warnings=entity_stats['warnings']
                        )
                    if existed:
                        entity_stats['updated'] += 1
                    elif (
                        result_row is not None
                        and getattr(result_row, 'legacy_firestore_id', legacy_id)
                        != legacy_id
                    ):
                        # Merged into a SIBLING row (multi-role membership): an
                        # existing row was updated with an added role, not inserted.
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
    pending_active: set | None = None,
) -> None:
    """Classify one doc WITHOUT writing: would-be insert/update/merge, or unresolved.

    Resolves required parents against the DB OR the `pending` set of would-be-
    written ids from earlier in this same dry pass, so the chain resolves without
    persisting anything. Unresolved required parents are raised (counted as
    errors); a present-but-unresolvable optional membership FK is a warning.

    `pending_active` tracks would-be-active (org,uid) membership pairs so a 2nd
    active doc for the same (org,uid) is predicted as a multi-role MERGE (counted
    as an update + warning) rather than a phantom insert — mirroring the real
    upsert_membership, so the pre-flight does not over-report inserts.
    """
    legacy_id = doc.get('id')

    # Parent-resolution dry pass — mirrors each upsert's RAISE conditions.
    if name == 'memberships':
        if not _resolvable(session, Organization, doc.get('org_id'), pending):
            raise UnresolvedParentError(
                f'membership {legacy_id!r}: organization {doc.get("org_id")!r} unresolved'
            )
        # Predict the multi-role merge (mirrors upsert_membership): a 2nd active/
        # invited doc for an (org,uid) that already has an active/invited row —
        # either earlier in this dry pass or already in the DB — merges rather
        # than inserts. _existing(legacy_id) below stays None for it, so without
        # this branch it would be miscounted as an insert.
        uid = doc.get('uid')
        if normalize_membership_status(doc.get('status')) in _ACTIVE_INVITED_STATUSES and uid:
            key = (doc.get('org_id'), uid)
            in_pass = pending_active is not None and key in pending_active
            in_db = False
            if not in_pass:
                org_uuid = resolve_legacy_id(session, Organization, doc.get('org_id'))
                in_db = org_uuid is not None and _active_membership(session, org_uuid, uid) is not None
            if (in_pass or in_db) and _existing(session, model, legacy_id) is None:
                entity_stats['updated'] += 1
                entity_stats['warnings'].append({
                    'id': legacy_id,
                    'warning': (
                        f'multi-role user: would merge roles into existing active '
                        f'(org,uid) membership for uid {uid!r}; no new row'
                    ),
                })
                return
            if pending_active is not None:
                pending_active.add(key)
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


# --- Import-run ledger -------------------------------------------------------

def _summarize_stats(stats: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """Compact per-entity counts (for the ledger `counts` jsonb) + a flat list of
    'entity:id error' strings (for `error_summary` text[])."""
    counts: dict[str, Any] = {}
    error_summary: list[str] = []
    for name, est in stats.items():
        counts[name] = {
            'inserted': est['inserted'],
            'updated': est['updated'],
            'skipped': est['skipped'],
            'errors': len(est['errors']),
            'warnings': len(est['warnings']),
        }
        for err in est['errors']:
            error_summary.append(f"{name}:{err.get('id')!r} {err.get('error')}")
    return counts, error_summary


def start_import_run(session: Any, source: str) -> MigrationImportRun:
    """Open a ledger row (status='running') before the backfill begins, so a
    crashed run leaves a visible 'running' record. Returns the row."""
    run = MigrationImportRun(source=source, status='running')
    session.add(run)
    session.flush()
    return run


def finish_import_run(
    session: Any,
    run: MigrationImportRun,
    stats: dict[str, dict[str, Any]],
    *,
    finished_at: Any,
    status: str | None = None,
) -> MigrationImportRun:
    """Close a ledger row with the run summary. `status` defaults to 'completed',
    or 'completed_with_errors' if any entity reported errors. `finished_at` is
    passed by the caller (a timezone-aware datetime)."""
    counts, error_summary = _summarize_stats(stats)
    run.counts = counts
    run.error_summary = error_summary
    run.finished_at = finished_at
    run.status = status or ('completed_with_errors' if error_summary else 'completed')
    session.flush()
    return run


# --- Parity report -----------------------------------------------------------

def parity_report(
    session: Any,
    *,
    organizations: Any = (),
    memberships: Any = (),
    classes: Any = (),
    enrollments: Any = (),
) -> dict[str, dict[str, Any]]:
    """Compare the Firestore source id-set against migrated Postgres rows.

    For each entity, reports firestore vs postgres counts and the symmetric
    difference of legacy_firestore_id sets (capped samples). A clean cutover has
    matching counts and empty diffs. Read-only.
    """
    inputs = {
        'organizations': (Organization, organizations),
        'memberships': (Membership, memberships),
        'classes': (Class, classes),
        'enrollments': (Enrollment, enrollments),
    }
    report: dict[str, dict[str, Any]] = {}
    for name, (model, docs) in inputs.items():
        fs_ids = {d.get('id') for d in docs if d.get('id')}
        pg_ids = {
            r
            for r in session.execute(select(model.legacy_firestore_id)).scalars().all()
            if r is not None
        }
        missing = sorted(fs_ids - pg_ids)
        extra = sorted(pg_ids - fs_ids)
        report[name] = {
            'firestore_count': len(fs_ids),
            'postgres_count': len(pg_ids),
            'in_sync': not missing and not extra,
            'missing_in_postgres': missing[:50],
            'extra_in_postgres': extra[:50],
        }
    return report
