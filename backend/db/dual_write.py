"""Flag-gated Postgres shadow-write for enrollments (school-domain migration, slice 2b).

Firestore stays the system of record; Postgres is a SHADOW that must NEVER break
or slow the live write. Every public `shadow_*` function is FAIL-OPEN:

  - gated on DUAL_WRITE_ENROLLMENTS=1 AND a configured engine (else a pure no-op),
  - opens and closes its own short-lived Session (the live request owns no session),
  - bounds its own latency (pool_timeout + connect timeout in sql.py; a transaction-
    scoped statement_timeout here) so a hung Postgres cannot inflate the request,
  - wraps the whole shadow op in try/except and NEVER raises into the caller.

Heavy imports (SQLAlchemy, repository, models) are LAZY — inside function bodies —
so when the flag is OFF the import footprint is just this module plus os/logging.

Strategy A (trust-backfill): only enrollments are mirrored here; orgs, memberships,
and classes are populated by the 2a backfill. At write time the only resolution is
class_id (Firestore string) -> Postgres UUID. An unresolved parent is the EXPECTED
coexistence case (class enrolled-against was created before its backfill) and is a
quiet no-op, reconciled later by parity_report + re-running the backfill.

Nothing here reads request state; callers pass `sql_engine` (the deps.sql_engine
zero-arg provider, which returns the engine or None).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

_log = logging.getLogger(__name__)

# Transaction-scoped ceiling on a hung shadow query. SET LOCAL confines it to the
# shadow transaction only, so this aggressive bound never leaks onto future
# non-shadow uses of the shared engine (e.g. slice 2c writes / read paths).
_SHADOW_STATEMENT_TIMEOUT_MS = 10_000


def _enabled() -> bool:
    """Read the flag on EVERY call (not a module constant) so ops and tests can
    toggle os.environ without reimporting. OFF unless explicitly set to '1'."""
    return os.environ.get('DUAL_WRITE_ENROLLMENTS') == '1'


def _resolve_engine(sql_engine: Any) -> Any:
    """Return the Engine to shadow-write through, or None to skip.

    `sql_engine` is the deps.sql_engine provider: a zero-arg callable returning
    the process-singleton engine, or `_no_sql_engine` returning None when no
    Postgres target is configured. Skips (returns None) when the flag is off, the
    provider is absent/None, or the provider itself errors.
    """
    if not _enabled() or sql_engine is None:
        return None
    try:
        return sql_engine() if callable(sql_engine) else sql_engine
    except Exception:  # noqa: BLE001 — a broken provider must not break the write
        _log.exception('dual-write: sql_engine provider raised; skipping shadow')
        return None


def _run(sql_engine: Any, op_name: str, fn: Callable[[Any], None]) -> None:
    """Open a short-lived Session, apply fn(session), commit — fail-open.

    `UnresolvedParentError` is the EXPECTED coexistence no-op (parent class not yet
    backfilled) and is logged at debug; ANY other exception is logged but never
    re-raised. `with Session(engine)` guarantees the connection is returned to the
    pool on every exit path (SA 2.0 __exit__ -> close(); pool rolls back on return).
    """
    engine = _resolve_engine(sql_engine)
    if engine is None:
        return
    # Lazy: SQLAlchemy / repo / models load only when a shadow write actually runs;
    # the flag-OFF import footprint stays at os + logging.
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from backend.db.repository.backfill import UnresolvedParentError

    try:
        with Session(engine) as session:
            # Bound a hung INSERT/UPDATE; transaction-scoped, auto-reset at commit.
            session.execute(
                text(f"SET LOCAL statement_timeout = '{_SHADOW_STATEMENT_TIMEOUT_MS}ms'")
            )
            fn(session)
            session.commit()
    except UnresolvedParentError:
        _log.debug('dual-write %s: parent not yet backfilled; shadow skipped', op_name)
    except Exception:  # noqa: BLE001 — shadow failures are non-fatal to the request
        _log.exception('dual-write %s: Postgres shadow write failed (non-fatal)', op_name)


def shadow_create_enrollment(
    sql_engine: Any,
    *,
    class_id: str,
    student_uid: str,
    enrollment_id: str,
    student_membership_id: str | None = None,
    status: str = 'active',
    join_source: str = 'manual',
    student_number: str = '',
    guardian_contact_required: bool = False,
    canvas_user_id: str = '',
    canvas_email: str = '',
    canvas_name: str = '',
) -> None:
    """Mirror a Firestore enrollment CREATE into Postgres (idempotent upsert).

    Reuses the already-tested `backfill.upsert_enrollment`, which resolves the
    Firestore class_id/membership_id to UUIDs, normalizes status/join_source
    (pending_sync->inactive, canvas->canvas_legacy), and dedupes by the composite
    legacy_firestore_id ({class_id}_{student_uid}) so retries don't duplicate.
    """
    if not _enabled():
        return
    from backend.db.repository import backfill

    doc = {
        'id': enrollment_id,  # composite Firestore key -> legacy_firestore_id
        'class_id': class_id,
        'student_uid': student_uid,
        'student_membership_id': student_membership_id,
        'status': status,
        'join_source': join_source,
        'student_number': student_number,
        'guardian_contact_required': guardian_contact_required,
        'canvas_user_id': canvas_user_id,
        'canvas_email': canvas_email,
        'canvas_name': canvas_name,
    }
    _run(sql_engine, 'create_enrollment', lambda s: backfill.upsert_enrollment(s, doc))


def shadow_set_enrollment_status(
    sql_engine: Any, *, class_id: str, student_uid: str, status: str
) -> None:
    """Mirror a deactivate ('inactive') / reactivate ('active') status flip.

    Resolves the Firestore class_id to a UUID; no-op when the class — or the
    enrollment row — is not in Postgres yet (coexistence). Uses the targeted
    status setters, NOT upsert, so other fields (join_source, student_number)
    are never clobbered.
    """
    if not _enabled():
        return
    from backend.db.models.org import Class
    from backend.db.repository import enrollments as repo
    from backend.db.repository.resolution import resolve_legacy_id

    def op(session: Any) -> None:
        class_uuid = resolve_legacy_id(session, Class, class_id)
        if class_uuid is None:
            return  # parent not backfilled — quiet coexistence no-op
        setter = repo.deactivate_enrollment if status == 'inactive' else repo.reactivate_enrollment
        setter(session, class_uuid, student_uid)

    _run(sql_engine, f'set_status:{status}', op)


def shadow_lti_reactivate(
    sql_engine: Any,
    *,
    class_id: str,
    student_uid: str,
    student_membership_id: str | None = None,
) -> None:
    """Mirror the LTI reactivation path (status=active + join_source=lti + membership).

    This is the one enrollment mutation that bypasses the database.py helpers (a
    direct Firestore ref .update() in services/lti/identity.py), so it gets its own
    explicit shadow entry point. Resolves class + membership to UUIDs; no-op when
    the class is unresolved.
    """
    if not _enabled():
        return
    from backend.db.models.org import Class, Membership
    from backend.db.repository import enrollments as repo
    from backend.db.repository.resolution import resolve_legacy_id

    def op(session: Any) -> None:
        class_uuid = resolve_legacy_id(session, Class, class_id)
        if class_uuid is None:
            return
        membership_uuid = (
            resolve_legacy_id(session, Membership, student_membership_id)
            if student_membership_id
            else None
        )
        repo.lti_reactivate_enrollment(
            session, class_uuid, student_uid, student_membership_id=membership_uuid
        )

    _run(sql_engine, 'lti_reactivate', op)
