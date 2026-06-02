"""Flag-gated Postgres shadow-write for the ANALYTICS family.

Slice A: assignments (DUAL_WRITE_ASSIGNMENTS). Slice B: practice_sessions
(DUAL_WRITE_ANALYTICS_SESSIONS). Slice C (later): learning_events
(DUAL_WRITE_ANALYTICS_EVENTS) — `shadow_write_turn`, not yet built.

Companion to `dual_write.py` (enrollments) and `dual_write_school_chain.py`
(org/membership/class): the SAME fail-open contract, gated on its OWN flag.
Assignments are the FK PARENT of practice_sessions and learning_events, so they
migrate first (ANALYTICS_MIGRATION.md Slice A); sessions resolve org+class+
assignment FKs and are the parent of events (Slice B/C).

Hot-path note: session writes ride the live voice/text practice path, so unlike
the low-churn assignment shadow they use `_run_with_timeout` (a parameterized
statement_timeout) NOT the shared `_run` (hardcoded 10s — a worst-case ceiling,
not a hot-path budget). See ANALYTICS_MIGRATION.md §2.3 / §5b.2.

Mirror strategy (assignments are LOW-CHURN curriculum docs, not a hot path):
  - CREATE / EDIT reuse the idempotent `backfill.upsert_assignment`. The Firestore
    write is a full `doc_ref.set()` (create, or overwrite when an id is supplied),
    so one idempotent upsert faithfully mirrors both. upsert_assignment resolves
    org_id + class_id -> UUIDs and raises UnresolvedParentError (a quiet
    coexistence no-op, swallowed by `_run`) when a parent is not in Postgres yet.
  - The Canvas link/unlink path touches one PG column (canvas_module_item_id) via a
    TARGETED UPDATE keyed by legacy_firestore_id — never an upsert, which would
    clobber the NOT-NULL content fields with a partial doc.

NOT mirrored: `set_assignment_grade_config` writes grade_metric/grade_points, which
are Firestore-only LTI fields with NO column on the PG Assignment model — out of
scope for this slice (see ANALYTICS_MIGRATION.md §1).

Heavy imports stay lazy inside function bodies; flag-OFF cost is os + logging.
"""

from __future__ import annotations

import datetime
import logging
import os
from typing import Any, Callable

# Shared, safety-critical infra (one copy of the open-session / SET LOCAL
# statement_timeout / swallow-and-log contract, and the SERVER_TIMESTAMP
# sentinel scrub) — reused exactly as the school-chain shadow reuses it.
from backend.db.dual_write import _run
from backend.db.dual_write_school_chain import _strip_sentinels

_log = logging.getLogger(__name__)


def _run_with_timeout(
    sql_engine: Any, op_name: str, fn: Callable[[Any], None], *, timeout_ms: int
) -> None:
    """Like `dual_write._run`, but with a caller-supplied statement_timeout.

    The hot-path variant for the analytics family. `_run` hardcodes 10s, which is
    a worst-case ceiling — wrong as a hot-path budget on the live practice route
    (ANALYTICS_MIGRATION.md §2.3 forbids reusing it; §5b.2 #1). `timeout_ms` is
    keyword-only so a caller can't pass it positionally where `_run` takes none.

    Same fail-open contract as `_run`: `UnresolvedParentError` is the expected
    coexistence no-op (parent not yet backfilled) logged at debug; any other
    exception is logged and NEVER re-raised into the live request. `with
    Session(engine)` returns the connection to the pool on every exit path.

    LATENCY MODEL (codex P1 — do NOT mistake `timeout_ms` for a request-latency cap):
    `timeout_ms` bounds the STATEMENT only. The first `execute()` is also where
    SQLAlchemy checks out (or opens) a connection, which happens BEFORE Postgres can
    apply statement_timeout. Healthy PG: ~tens of ms. Degraded PG: a contended checkout
    waits up to `sql.py` pool_timeout (3s) and a cold connect up to its connect timeout
    (~10s) before fail-open catches it. Callers MUST already have written Firestore (the
    system of record) first, so this is a response-latency tail under a PG incident, not
    data loss. Moving the shadow off the hot path is the GA upgrade (§5b.3); at one-school
    beta this tail is accepted — it is the same exposure the live PG read paths carry.
    """
    from backend.db.dual_write import _resolve_engine

    engine = _resolve_engine(sql_engine)
    if engine is None:
        return
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from backend.db.repository.backfill import UnresolvedParentError

    try:
        with Session(engine) as session:
            session.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))
            fn(session)
            session.commit()
    except UnresolvedParentError:
        _log.debug('dual-write %s: parent not yet backfilled; shadow skipped', op_name)
    except Exception:  # noqa: BLE001 — shadow failures are non-fatal to the request
        _log.exception('dual-write %s: Postgres shadow write failed (non-fatal)', op_name)


def _enabled_assignments() -> bool:
    """Read the flag on EVERY call (not a module constant). OFF unless '1'."""
    return os.environ.get('DUAL_WRITE_ASSIGNMENTS') == '1'


def _enabled_sessions() -> bool:
    """practice_session shadow gate (Slice B). OFF unless DUAL_WRITE_ANALYTICS_SESSIONS='1'."""
    return os.environ.get('DUAL_WRITE_ANALYTICS_SESSIONS') == '1'


# NOTE: there is deliberately NO `_enabled_events()` gate in Slice B. The §5b.2 #7
# flag matrix says that when DUAL_WRITE_ANALYTICS_EVENTS=1, Slice C's per-turn
# `shadow_write_turn` writes the events AND the session-summary UPDATE in one
# transaction, and the standalone `shadow_update_practice_session` must self-disable
# to keep one pool checkout per turn. That self-disable is a SLICE C change — it must
# land in the SAME commit as shadow_write_turn. Adding it now (before that writer
# exists) would silently drop the PG session UPDATE whenever the events flag is set
# early — a footgun with no upside until Slice C (codex P2).


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def shadow_create_assignment(
    sql_engine: Any, *, assignment_id: str, assignment_data: dict[str, Any]
) -> None:
    """Mirror an assignment CREATE/EDIT into Postgres (idempotent upsert).

    `assignment_data` is the same dict the Firestore write used; `assignment_id`
    is the Firestore doc id (becomes legacy_firestore_id). Idempotent by that key,
    so a create and a later full-`set()` edit both converge. upsert_assignment
    resolves org_id + class_id and raises UnresolvedParentError (quiet no-op via
    `_run`) if either parent is not migrated yet.
    """
    if not _enabled_assignments():
        return
    from backend.db.repository import backfill

    doc = {**_strip_sentinels(assignment_data), 'id': assignment_id}

    def op(session: Any) -> None:
        backfill.upsert_assignment(session, doc)

    _run(sql_engine, 'create_assignment', op)


def shadow_update_assignment_canvas_link(
    sql_engine: Any, *, assignment_id: str, canvas_module_item_id: str | None
) -> None:
    """Mirror link/unlink_assignment_to_canvas_item: targeted UPDATE of the
    canvas_module_item_id column ONLY (link sets the item id; unlink clears it to
    '').  Keyed by legacy_firestore_id; no-op when the assignment row is absent.
    Never an upsert — a partial doc would clobber the NOT-NULL content fields."""
    if not _enabled_assignments():
        return
    from sqlalchemy import update

    from backend.db.models.assignment import Assignment

    def op(session: Any) -> None:
        session.execute(
            update(Assignment)
            .where(Assignment.legacy_firestore_id == assignment_id)
            .values(
                # Firestore stores '' on unlink; mirror '' -> NULL on the nullable
                # PG column so the read adapter renders it back as '' consistently.
                canvas_module_item_id=canvas_module_item_id or None,
                updated_at=_utcnow(),
            )
        )

    _run(sql_engine, 'update_assignment_canvas_link', op)


def shadow_set_assignment_grade_config(
    sql_engine: Any, *, assignment_id: str, grade_metric: Any, grade_points: Any
) -> None:
    """Mirror set_assignment_grade_config: targeted UPDATE of the LTI grade fields
    ONLY (so the PG read adapter is a faithful inverse of get_assignment — the
    grade-config GET reads metric/points off that dict). Keyed by
    legacy_firestore_id; no-op when the assignment row is absent. Never an upsert."""
    if not _enabled_assignments():
        return
    from sqlalchemy import update

    from backend.db.models.assignment import Assignment

    def op(session: Any) -> None:
        session.execute(
            update(Assignment)
            .where(Assignment.legacy_firestore_id == assignment_id)
            .values(grade_metric=grade_metric, grade_points=grade_points, updated_at=_utcnow())
        )

    _run(sql_engine, 'set_assignment_grade_config', op)


# --- Slice B: practice_sessions ----------------------------------------------
#
# Sessions ride the LIVE practice path (create on launch; one UPDATE per turn at
# curriculum_admin.py:579), so both shadows use `_run_with_timeout` (bounded
# hot-path budget), NOT the 10s `_run`. Firestore is written first (system of
# record); the shadow mirrors after and never raises. FK parents (org/class/
# assignment) must already be in Postgres — an unresolved parent is a quiet
# coexistence no-op (UnresolvedParentError, swallowed), reconciled by the
# mandatory term-scope backfill before Firestore writes retire (§5b.6).

# Mutable practice_session columns mirrored by the per-turn / finalize UPDATE.
# Anything else in the Firestore `updates` dict (e.g. its own `updated_at`) is
# ignored; `updated_at` is always re-stamped here.
_SESSION_MUTABLE_COLUMNS = (
    'session_summary',
    'cost_summary',
    'analysis_state',
    'status',
    'ended_at',
)


def shadow_create_practice_session(sql_engine: Any, *, session_doc: dict[str, Any]) -> None:
    """Mirror a practice-session CREATE into Postgres (idempotent upsert).

    `session_doc` is the full doc just written to Firestore, with 'id' set to the
    server-assigned doc id (the legacy_firestore_id). Idempotent by that key.
    `upsert_practice_session` resolves org+class+assignment -> UUIDs and raises
    UnresolvedParentError (quiet no-op via `_run_with_timeout`) if any parent is
    not migrated yet. One write per session; the student already waits on session
    init, so 1000ms is an acceptable bound (§2.4).
    """
    if not _enabled_sessions():
        return
    from backend.db.repository import backfill

    # _strip_sentinels scrubs any SERVER_TIMESTAMP -> None (the create payload
    # actually carries real _utc_now() datetimes today, so this is defensive and
    # keeps parity with the assignment shadow).
    doc = {**_strip_sentinels(session_doc)}
    if not doc.get('id'):
        _log.debug('dual-write create_practice_session: doc missing id; shadow skipped')
        return

    def op(session: Any) -> None:
        backfill.upsert_practice_session(session, doc)

    _run_with_timeout(sql_engine, 'create_practice_session', op, timeout_ms=1000)


def shadow_update_practice_session(
    sql_engine: Any, *, session_firestore_id: str, updates: dict[str, Any]
) -> None:
    """Mirror a practice-session UPDATE (rolling summary every turn AND finalize).

    Targeted UPDATE of the mutable columns present in `updates`, keyed by
    legacy_firestore_id. 0 rows affected (session not in PG yet) is a SILENT
    accepted coexistence drop (§5b.6) — the term-scope backfill + count-parity
    gate reconciles it before Firestore writes retire. 2000ms hot-path budget
    (§5b.2 #1).

    Slice C composition (§5b.2 #7): when DUAL_WRITE_ANALYTICS_EVENTS lands, its
    per-turn `shadow_write_turn` will write the events AND this summary UPDATE in
    ONE transaction. At THAT point Slice C must add a self-disable here (gated on
    the events flag) so the turn takes one pool checkout, not two. It is NOT gated
    on the events flag yet: shadow_write_turn does not exist, so self-disabling now
    would SILENTLY DROP the PG session UPDATE if that flag were set early (codex P2).
    """
    if not _enabled_sessions():
        return
    from sqlalchemy import update

    from backend.db.models.practice import PracticeSession

    clean = _strip_sentinels(updates)
    values = {k: clean[k] for k in _SESSION_MUTABLE_COLUMNS if k in clean}
    if not values:
        return  # nothing PG-relevant in this update
    values['updated_at'] = _utcnow()

    def op(session: Any) -> None:
        session.execute(
            update(PracticeSession)
            .where(PracticeSession.legacy_firestore_id == session_firestore_id)
            .values(**values)
        )

    _run_with_timeout(sql_engine, 'update_practice_session', op, timeout_ms=2000)


def sweep_orphaned_sessions(sql_engine: Any, *, idle_minutes: int = 90) -> dict[str, Any]:
    """Reconciler: mark PG practice_sessions stuck 'active' past `idle_minutes`
    as 'abandoned' (ended_at=now). Resolves the no-server-owned-close gap (§5b.2
    #5): a client that never sends `session.ended` (browser close) leaves a row
    permanently 'active'. Idempotent; at beta touches ~0 rows. Gated on the
    SESSIONS flag (dormant until on); fail-open. Returns {'swept': int}.

    90 min default: a class period is <=60 min. Uses a Python cutoff (not a raw
    SQL INTERVAL) so the comparison stays type-safe against the tz-aware column.
    """
    if not _enabled_sessions():
        return {'swept': 0, 'status': 'flag_off'}
    from sqlalchemy import update

    from backend.db.models.practice import PracticeSession

    cutoff = _utcnow() - datetime.timedelta(minutes=idle_minutes)
    now = _utcnow()
    result: dict[str, Any] = {'swept': 0}

    def op(session: Any) -> None:
        res = session.execute(
            update(PracticeSession)
            .where(PracticeSession.status == 'active')
            .where(PracticeSession.started_at < cutoff)
            .values(status='abandoned', ended_at=now, updated_at=now)
        )
        result['swept'] = res.rowcount or 0

    _run_with_timeout(sql_engine, 'sweep_orphaned_sessions', op, timeout_ms=2000)
    return result
