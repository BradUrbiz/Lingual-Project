"""Flag-gated Postgres read-cutover router (school-domain migration, read phase).

Wraps the Firestore `database` module on `deps.db`. Overrides ONLY the read
methods being cut over; every other attribute (writes, not-yet-cut readers,
module constants) passes through to Firestore via ``__getattr__`` — so routes
never change and the cutover is a localized, env-flag-driven flip.

Per-entity flags (``READ_PG_*``, read on every call, default OFF) gate each
entity FAMILY, 3-state:

  ``''`` / ``'0'``  -> Firestore only (today's behavior).
  ``'shadow'``      -> Firestore authoritative + the PG read compared for parity
                       (logged + counted, never surfaced). The safe pre-flip gate.
  ``'1'``           -> PG authoritative, FAIL-OPEN to Firestore on any error /
                       no engine / unresolved id.

Firestore stays the system of record until a flag flips to ``'1'``. Reuses the
dual-write engine resolver and the same short-lived, latency-bounded Session, so
a hung or broken Postgres can never break — nor unboundedly slow — a read (the
shadow compare runs synchronously before the Firestore result is returned).

See docs/school-integration/READ_CUTOVER.md.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

from backend.db.dual_write import _resolve_engine  # shared provider -> engine|None

_log = logging.getLogger(__name__)

# Bound a hung shadow/cutover read so it can't inflate the request. Shadow mode
# runs the PG read synchronously before returning Firestore, so this matters
# even though Firestore is authoritative. Pairs with sql.py's pool_timeout=3.
_READ_STATEMENT_TIMEOUT_MS = 5_000

# Per-process shadow-parity counters (flag -> [compared, mismatched]). A soak
# SIGNAL, not exact metrics — benign races under Cloud Run threading are fine.
# Logged at WARNING (the only level visible in prod — no logging handler is
# configured, so module INFO/DEBUG never surface) on the FIRST compare per
# process and every _SHADOW_SUMMARY_EVERY after, so a CLEAN shadow is OBSERVABLE.
# Otherwise "no MISMATCH" is indistinguishable from "the shadow never ran".
_shadow_stats: dict[str, list[int]] = {}
_SHADOW_SUMMARY_EVERY = 25

# Known-divergent organization keys to ignore in shadow parity (READ_CUTOVER.md
# §4). Surfacing these would be alert noise, not drift:
#   school_admin_uids - Firestore-denormalized; derived (not stored) in PG, and
#                       no get_organization point-get caller reads it (the LIST
#                       path is defect D3, a separate reader).
#   last_activity_at  - not maintained on the PG row yet (always None there).
#   created_at/updated_at - clock skew: Firestore SERVER_TIMESTAMP vs PG now() /
#                       app-clock on status flips (LIMITATIONS #44).
_ORG_SHADOW_IGNORE = frozenset(
    {'school_admin_uids', 'last_activity_at', 'created_at', 'updated_at'}
)

# Known-divergent membership keys to allowlist in point-get shadow parity:
#   primary_class_ids - DEFERRED to [] by the backfill (upsert_membership) while
#                       the live add/remove path mirrors it; a backfill gap (D5),
#                       not benign drift — a flip prereq, surfaced via parity_report
#                       (a clean shadow can't prove it). No UI consumer.
#   created_at/updated_at/removed_at - clock skew (Firestore SERVER_TIMESTAMP vs PG
#                       now()/app-clock), same as the org rule.
# (get_user_memberships is a LIST read -> diffed by id-set, so it never reaches
# this field-level allowlist; the id-set IS the role-guard parity that matters.)
_MEMBERSHIP_SHADOW_IGNORE = frozenset(
    {'primary_class_ids', 'created_at', 'updated_at', 'removed_at'}
)

# Known-divergent class keys to allowlist in point-get shadow parity:
#   created_at/updated_at - clock skew (same rule as org/membership).
#   join_code_generated_at - clock skew on LIVE-generated codes (the shadow stamps
#                       _utcnow() while Firestore stamps SERVER_TIMESTAMP); the code
#                       VALUE + active flag are still compared.
# teacher_membership_ids is intentionally NOT allowlisted (it's the authz-bearing
# field — D2 sibling); the serializer sorts it so single-teacher classes (the norm)
# compare cleanly, and a rare multi-teacher ORDER divergence would surface as signal.
_CLASS_SHADOW_IGNORE = frozenset(
    {'created_at', 'updated_at', 'join_code_generated_at'}
)

# Known-divergent enrollment keys to allowlist in point-get shadow parity:
#   created_at/updated_at - clock skew (Firestore SERVER_TIMESTAMP vs PG now() /
#                       app-clock on status flips), same rule as the others.
# The identity-bearing fields (status, join_source, student_uid, the FK legacy
# ids) are NOT allowlisted — they're the roster/practice-launch parity that
# matters. (The list readers diff by id-set, so they never reach this allowlist.)
_ENROLLMENT_SHADOW_IGNORE = frozenset({'created_at', 'updated_at'})

# Sentinel a pg_call returns to say "I can't authoritatively answer this — fall open
# to Firestore." Distinct from a real None / [] result, which IS authoritative in
# mode '1'. The case that needs it: a child read whose PARENT id doesn't resolve to a
# migrated row (e.g. an enrollment whose class missed the PG backfill). Returning
# None/[] there would DENY access (empty roster / no enrollment) instead of degrading
# to Firestore — a silent data loss the fail-open contract is meant to prevent.
_FALLBACK = object()

# Flag-state ranking for a reader gated on MORE THAN ONE entity flag. The effective
# mode is the WEAKER of the flags: a cross-family reader is only as cut-over as its
# least-cut-over family, so it never serves PG for one family while the other has
# been rolled back to Firestore (the rollback-ordering footgun for list_student_classes).
_MODE_RANK = {'': 0, '0': 0, 'shadow': 1, '1': 2}


def _weaker_mode(*flags: str) -> str:
    """The lowest-ranked of several flags' current modes (off < shadow < '1')."""
    return min((os.environ.get(f, '') for f in flags), key=lambda m: _MODE_RANK.get(m, 0))


def _norm(value: Any) -> Any:
    """Normalize a value for cross-store comparison: datetimes -> ISO string, and
    the falsy-equivalents the two stores disagree on SHAPE for collapse to None —
    `None` (Firestore omits an unset field), `''` / `[]` (empty), and `False` (a
    PG `NOT NULL` boolean column materializes to its `False` default where
    Firestore simply omits the field). A meaningful value present on only one side
    is still flagged (`True` vs `None`, `'x'` vs `None`); `is False` is used so a
    real numeric `0` is NOT collapsed."""
    if value is None or value == '' or value == [] or value is False:
        return None
    iso = getattr(value, 'isoformat', None)
    if callable(iso):
        return iso()
    return value


def _diff_dict(fs: dict | None, pg: dict | None, ignore: frozenset) -> dict:
    """Field-level diff of two point-get dicts over the union of keys minus
    `ignore`. Returns {key: (fs_value, pg_value)} for mismatches only."""
    if fs is None and pg is None:
        return {}
    if fs is None or pg is None:
        return {'<presence>': (fs is not None, pg is not None)}
    out: dict[str, Any] = {}
    for key in (set(fs) | set(pg)) - ignore:
        a, b = _norm(fs.get(key)), _norm(pg.get(key))
        if a != b:
            out[key] = (a, b)
    return out


def _diff_list(fs: list | None, pg: list | None, ignore: frozenset) -> dict:
    """Set-by-id diff of two list reads (membership/coverage parity). Per-item
    field diff + ordering checks arrive with the list-entity slices; for now this
    surfaces rows present on one side only — the live analog of parity_report."""
    fs_ids = {r.get('id') for r in (fs or [])}
    pg_ids = {r.get('id') for r in (pg or [])}
    out: dict[str, Any] = {}
    if fs_ids - pg_ids:
        out['missing_in_pg'] = sorted(x for x in (fs_ids - pg_ids) if x is not None)
    if pg_ids - fs_ids:
        out['extra_in_pg'] = sorted(x for x in (pg_ids - fs_ids) if x is not None)
    return out


def _diff(fs: Any, pg: Any, ignore: frozenset) -> dict:
    if isinstance(fs, list) or isinstance(pg, list):
        return _diff_list(fs if isinstance(fs, list) else None,
                          pg if isinstance(pg, list) else None, ignore)
    if isinstance(fs, dict) or isinstance(pg, dict):
        return _diff_dict(fs, pg, ignore)
    # scalar (e.g. a COUNT): direct compare after normalization.
    a, b = _norm(fs), _norm(pg)
    return {} if a == b else {'<value>': (a, b)}


class ReadRouter:
    """Firestore-module wrapper that routes cut-over reads to Postgres per flag."""

    def __init__(self, fs_db: Any, sql_engine: Callable[[], Any]):
        self._fs = fs_db                  # the Firestore `database` module
        self._sql_engine = sql_engine     # deps.sql_engine provider (engine | None)

    def __getattr__(self, name: str) -> Any:
        # Reached only for attributes NOT defined on ReadRouter -> Firestore.
        # (Writes, not-yet-cut readers, and module constants all land here.)
        return getattr(self._fs, name)

    # --- routing core -----------------------------------------------------

    def _pg_read(self, pg_call: Callable[[Any], Any], engine: Any) -> Any:
        """Run pg_call in a short-lived, latency-bounded Session (lazy imports
        keep the flag-OFF footprint at os + logging)."""
        from sqlalchemy import text
        from sqlalchemy.orm import Session

        with Session(engine) as session:
            session.execute(
                text(f"SET LOCAL statement_timeout = '{_READ_STATEMENT_TIMEOUT_MS}ms'")
            )
            return pg_call(session)

    def _shadow_compare(self, flag, fs_result, pg_call, engine, ignore, extract=None) -> None:
        """Read PG, compare to the Firestore result, log mismatches + a periodic
        rolling summary. Never raises, never mutates the response (Firestore stays
        authoritative in shadow). `extract` maps each result to the comparable part
        (e.g. a paginated reader's `items` list) without changing what's returned."""
        try:
            pg_result = self._pg_read(pg_call, engine)
        except Exception:  # noqa: BLE001 — a broken shadow read must not affect the request
            _log.exception('shadow-read %s: PG side errored', flag)
            return
        if pg_result is _FALLBACK:   # pg_call declined (unresolved parent) — nothing to compare
            return
        fs_cmp = extract(fs_result) if extract else fs_result
        pg_cmp = extract(pg_result) if extract else pg_result
        diff = _diff(fs_cmp, pg_cmp, ignore)
        stats = _shadow_stats.setdefault(flag, [0, 0])
        stats[0] += 1
        if diff:
            stats[1] += 1
            _log.warning('shadow-read MISMATCH %s [#%d]: %s', flag, stats[0], diff)
        elif stats[0] == 1 or stats[0] % _SHADOW_SUMMARY_EVERY == 0:
            # Positive "shadow is running + clean" signal (first compare + every N).
            _log.warning(
                'shadow-read %s: %d compared, %d mismatched (rolling, this instance)',
                flag, stats[0], stats[1],
            )

    def _route_read(self, flag, fs_call, pg_call, *, ignore=frozenset(), extract=None, also=None):
        """The 3-state per-entity gate. See module docstring. `extract` (shadow only)
        maps each result to its comparable part for paginated/wrapped reads. `also`
        (optional) is a SECOND entity flag this reader depends on — the effective mode
        becomes the weaker of the two (cross-family readers, e.g. list_student_classes
        which reads PG class rows via an enrollment JOIN)."""
        mode = _weaker_mode(flag, also) if also else os.environ.get(flag, '')
        if mode not in ('shadow', '1'):
            return fs_call()
        engine = _resolve_engine(self._sql_engine)
        if engine is None:                       # no Cloud SQL target -> Firestore
            return fs_call()
        if mode == 'shadow':
            fs_result = fs_call()
            self._shadow_compare(flag, fs_result, pg_call, engine, ignore, extract)
            return fs_result
        try:                                     # mode == '1': PG authoritative
            pg_result = self._pg_read(pg_call, engine)
        except Exception:  # noqa: BLE001 — fail-open: any PG failure -> Firestore
            _log.exception('%s: PG read failed; fail-open to Firestore', flag)
            return fs_call()
        if pg_result is _FALLBACK:               # pg_call couldn't answer -> Firestore
            return fs_call()
        return pg_result

    # --- overridden readers ----------------------------------------------

    def get_organization(self, org_id):
        """organizations point-get, routed by READ_PG_ORGANIZATIONS."""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.get_organization(session, org_id)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.get_organization(org_id),
            pg_call,
            ignore=_ORG_SHADOW_IGNORE,
        )

    def get_org_by_teacher_invite_code(self, code):
        """Teacher-join invite-code lookup, routed by READ_PG_ORGANIZATIONS.
        (§3.0a: required for entity-atomicity — a teacher-join request must not
        read the org entity from two stores.)"""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.get_org_by_teacher_invite_code(session, code)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.get_org_by_teacher_invite_code(code),
            pg_call,
            ignore=_ORG_SHADOW_IGNORE,
        )

    def search_organizations(self, query, *, limit=10):
        """Active-org name-prefix search (slim list), routed by READ_PG_ORGANIZATIONS."""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.search_organizations(session, query, limit=limit)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.search_organizations(query, limit=limit),
            pg_call,
        )

    def count_organizations_by_status(self, status):
        """Org COUNT by status (dashboard tile), routed by READ_PG_ORGANIZATIONS."""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.count_organizations_by_status(session, status)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.count_organizations_by_status(status),
            pg_call,
        )

    def list_organizations(self, **kwargs):
        """Paged lingual-admin org list (returns {items, next_cursor}), routed by
        READ_PG_ORGANIZATIONS. Shadow compares the `items` by id-set (the whole
        {items,next_cursor} dict isn't a meaningful field-level diff); per-item
        field parity (e.g. memberCount) is a follow-up refinement."""
        def pg_call(session):
            from backend.db.repository import organizations_read
            return organizations_read.list_organizations(session, **kwargs)

        return self._route_read(
            'READ_PG_ORGANIZATIONS',
            lambda: self._fs.list_organizations(**kwargs),
            pg_call,
            extract=lambda r: (r or {}).get('items', []),
        )

    def get_membership(self, membership_id):
        """memberships point-get, routed by READ_PG_MEMBERSHIPS."""
        def pg_call(session):
            from backend.db.repository import memberships_read
            return memberships_read.get_membership(session, membership_id)

        return self._route_read(
            'READ_PG_MEMBERSHIPS',
            lambda: self._fs.get_membership(membership_id),
            pg_call,
            ignore=_MEMBERSHIP_SHADOW_IGNORE,
        )

    def get_user_memberships(self, uid):
        """User membership list (the role-guard feed), routed by READ_PG_MEMBERSHIPS.
        Shadow compares the membership id-SET — the parity that actually gates auth
        (which orgs/roles a user has). Per-row field parity (roles, primaryClassIds)
        is a follow-up; primaryClassIds is a known backfill gap (D5)."""
        def pg_call(session):
            from backend.db.repository import memberships_read
            return memberships_read.get_user_memberships(session, uid)

        return self._route_read(
            'READ_PG_MEMBERSHIPS',
            lambda: self._fs.get_user_memberships(uid),
            pg_call,
        )

    def get_class(self, class_id):
        """classes point-get (raw doc + junction reconstruction), routed by READ_PG_CLASSES.
        The keystone class reader (14 callers incl. the AI-tutor authz gate, D2)."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.get_class(session, class_id)

        return self._route_read(
            'READ_PG_CLASSES',
            lambda: self._fs.get_class(class_id),
            pg_call,
            ignore=_CLASS_SHADOW_IGNORE,
        )

    def list_org_classes(self, org_id, status='active'):
        """Classes for an org (updated_at DESC), routed by READ_PG_CLASSES."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.list_org_classes(session, org_id, status)

        return self._route_read(
            'READ_PG_CLASSES',
            lambda: self._fs.list_org_classes(org_id, status),
            pg_call,
        )

    def list_teacher_classes(self, membership_id, status='active'):
        """Classes a teacher membership teaches (via class_teachers), routed by READ_PG_CLASSES."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.list_teacher_classes(session, membership_id, status)

        return self._route_read(
            'READ_PG_CLASSES',
            lambda: self._fs.list_teacher_classes(membership_id, status),
            pg_call,
        )

    def get_class_by_join_code(self, code):
        """Active-code class lookup (student join), routed by READ_PG_CLASSES."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.get_class_by_join_code(session, code)

        return self._route_read(
            'READ_PG_CLASSES',
            lambda: self._fs.get_class_by_join_code(code),
            pg_call,
            ignore=_CLASS_SHADOW_IGNORE,
        )

    def get_student_class_enrollment(self, class_id, student_uid):
        """(class, student) enrollment point-get, routed by READ_PG_ENROLLMENTS.
        PG keys on the (class_id, student_firebase_uid) UNIQUE columns, so it
        subsumes the Firestore deterministic-key + legacy-fallback scan (which
        exists only because Firestore addresses by the `{class}_{student}` doc id).
        An unresolved class -> None (authoritative; classes are migrated before
        enrollments). The student ref is a Firebase UID — stable, never resolved."""
        def pg_call(session):
            from backend.db.models.org import Class
            from backend.db.repository import enrollments, resolution
            class_uuid = resolution.resolve_legacy_id(session, Class, class_id)
            if class_uuid is None:
                return _FALLBACK   # class not migrated -> can't answer; fall open (not "no enrollment")
            return enrollments.get_student_class_enrollment(session, class_uuid, student_uid)

        return self._route_read(
            'READ_PG_ENROLLMENTS',
            lambda: self._fs.get_student_class_enrollment(class_id, student_uid),
            pg_call,
            ignore=_ENROLLMENT_SHADOW_IGNORE,
        )

    def list_class_enrollments(self, class_id, status='active'):
        """A class's roster (newest first), routed by READ_PG_ENROLLMENTS.
        Unresolved class -> [] (id-set shadow diff catches any real coverage gap)."""
        def pg_call(session):
            from backend.db.models.org import Class
            from backend.db.repository import enrollments, resolution
            class_uuid = resolution.resolve_legacy_id(session, Class, class_id)
            if class_uuid is None:
                return _FALLBACK   # class not migrated -> fall open (not an empty roster)
            return enrollments.list_class_enrollments(session, class_uuid, status)

        return self._route_read(
            'READ_PG_ENROLLMENTS',
            lambda: self._fs.list_class_enrollments(class_id, status),
            pg_call,
        )

    def list_student_enrollments(self, student_uid, status='active'):
        """A student's enrollments (newest first), routed by READ_PG_ENROLLMENTS.
        No id resolution — student_uid is a Firebase UID, native to both stores."""
        def pg_call(session):
            from backend.db.repository import enrollments
            return enrollments.list_student_enrollments(session, student_uid, status)

        return self._route_read(
            'READ_PG_ENROLLMENTS',
            lambda: self._fs.list_student_enrollments(student_uid, status),
            pg_call,
        )

    def count_org_students(self, *, org_id):
        """Org active-student COUNT (one indexed JOIN), routed by READ_PG_ENROLLMENTS.
        Keyword-only to match the Firestore signature."""
        def pg_call(session):
            from backend.db.repository import enrollments
            return enrollments.count_org_students(session, org_id)

        return self._route_read(
            'READ_PG_ENROLLMENTS',
            lambda: self._fs.count_org_students(org_id=org_id),
            pg_call,
        )

    def list_student_classes(self, student_uid):
        """The active classes a student is enrolled in, routed by READ_PG_ENROLLMENTS
        AND READ_PG_CLASSES (the weaker mode wins). It reads PG class rows via an
        enrollments⋈classes JOIN, so it touches BOTH families — gating on the weaker
        flag means it never serves PG class data after classes has been rolled back to
        Firestore (the rollback-ordering footgun), while still cutting over once both
        families are PG-authoritative."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.list_student_classes(session, student_uid)

        return self._route_read(
            'READ_PG_ENROLLMENTS',
            lambda: self._fs.list_student_classes(student_uid),
            pg_call,
            also='READ_PG_CLASSES',
        )

    def list_org_classes_summary(self, *, org_id):
        """Curated class-summary rows (lingual-admin org-detail), routed by
        READ_PG_CLASSES (class-only — no enrollments). Keyword-only to match
        the Firestore signature."""
        def pg_call(session):
            from backend.db.repository import classes_read
            return classes_read.list_org_classes_summary(session, org_id)

        return self._route_read(
            'READ_PG_CLASSES',
            lambda: self._fs.list_org_classes_summary(org_id=org_id),
            pg_call,
        )
