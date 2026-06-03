"""Flag-gated Postgres shadow-write for the ANALYTICS family.

Slice A: assignments (DUAL_WRITE_ASSIGNMENTS). Slice B: practice_sessions
(DUAL_WRITE_ANALYTICS_SESSIONS). Slice C: learning_events
(DUAL_WRITE_ANALYTICS_EVENTS) — `shadow_write_turn`, one batched transaction per
turn that subsumes the per-turn session UPDATE (§5b.2 #7 flag matrix).

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


def _run_with_timeout_strict(
    sql_engine: Any, op_name: str, fn: Callable[[Any], None], *, timeout_ms: int
) -> None:
    """FAIL-CLOSED counterpart of `_run_with_timeout` for `WRITE_FIRESTORE_ANALYTICS='0'`.

    Same own-Session / `SET LOCAL statement_timeout` / commit skeleton, but exceptions
    PROPAGATE to the caller instead of being swallowed. When Firestore writes are retired
    (Slice E), Postgres is the SOLE store — a swallowed failure here would be silent data
    loss (the turn is gone from BOTH stores). Letting it raise makes the route handler
    return 500 so the SPA retries (the existing 5xx-retry contract). This is the inherent
    cost of removing the Firestore safety net, and is WHY `WRITE_FIRESTORE_ANALYTICS`
    defaults '1' for a confidence sprint before the flip (ANALYTICS_MIGRATION.md §5 Slice E).

    A separate function (NOT a `raise_on_failure` flag on `_run_with_timeout`) deliberately
    keeps the swallow-all path and the propagate path structurally distinct — a conditional
    re-raise inside the shared swallow would invert that helper's correctness contract.
    """
    from backend.db.dual_write import _resolve_engine

    engine = _resolve_engine(sql_engine)
    if engine is None:
        # PG is the sole store but no engine is configured — a real misconfiguration,
        # not a fail-open coexistence case. Surface it.
        raise RuntimeError(
            f'{op_name}: WRITE_FIRESTORE_ANALYTICS=0 (Postgres is the sole store) but no '
            'Cloud SQL engine is available'
        )
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        session.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))
        fn(session)
        session.commit()


def firestore_analytics_enabled() -> bool:
    """WRITE_FIRESTORE_ANALYTICS gate (Slice E retirement). Default ON.

    '1' (or unset/any non-'0'): Firestore is the system of record for the analytics
    family (practice_sessions + learning_events) — written first, PG mirrors fail-open.
    '0': Firestore writes are RETIRED; Postgres is the SOLE store and writes are
    fail-CLOSED (`primary_*` paths). Read on every call (not a module constant); the
    safe default keeps a brand-new flag from silently dropping Firestore writes.

    Hard operational constraint when '0': READ_PG_ANALYTICS_SESSIONS=1 (so the
    `get_practice_session` read-after-write resolves from PG) AND
    DUAL_WRITE_ANALYTICS_EVENTS=1 (so events still persist). main.py warns otherwise.
    """
    return os.environ.get('WRITE_FIRESTORE_ANALYTICS', '1') != '0'


def _enabled_assignments() -> bool:
    """Read the flag on EVERY call (not a module constant). OFF unless '1'."""
    return os.environ.get('DUAL_WRITE_ASSIGNMENTS') == '1'


def _enabled_sessions() -> bool:
    """practice_session shadow gate (Slice B). OFF unless DUAL_WRITE_ANALYTICS_SESSIONS='1'."""
    return os.environ.get('DUAL_WRITE_ANALYTICS_SESSIONS') == '1'


def _enabled_events() -> bool:
    """learning_event shadow gate (Slice C). OFF unless DUAL_WRITE_ANALYTICS_EVENTS='1'.

    Per §5b.5 this flag is meaningful ONLY when DUAL_WRITE_ANALYTICS_SESSIONS=1 too:
    events FK to practice_sessions, so with sessions absent every event shadow is a
    silent FK no-op. The §5b.2 #7 flag matrix composes the two:

      sessions=1, events=0 -> shadow_update_practice_session (standalone per-turn UPDATE)
      sessions=1, events=1 -> shadow_write_turn subsumes that UPDATE + inserts the
                              turn's events in ONE transaction; the standalone
                              shadow_update self-disables (one pool checkout per turn).
    """
    return os.environ.get('DUAL_WRITE_ANALYTICS_EVENTS') == '1'


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

    Slice C composition (§5b.2 #7): when DUAL_WRITE_ANALYTICS_EVENTS=1, the per-turn
    `shadow_write_turn` writes the events AND this summary UPDATE in ONE transaction,
    so this standalone path SELF-DISABLES (the events-on guard below) to keep the turn
    at one pool checkout, not two. This is the §5b.2 #7 self-disable the Slice B codex-
    P2 fix deferred to "land WITH shadow_write_turn" — it is safe now because that
    writer exists and carries `session_updates`. Net matrix: this runs only on
    sessions=1 AND events=0.
    """
    if not _enabled_sessions() or _enabled_events():
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


# --- Slice C: learning_events (per-turn, batched) ----------------------------


def shadow_write_turn(
    sql_engine: Any,
    *,
    session_firestore_id: str,
    events: list[dict[str, Any]],
    session_updates: dict[str, Any] | None = None,
) -> None:
    """Mirror ONE practice turn into Postgres: the turn's learning_events AND the
    session-summary/finalize UPDATE, in a SINGLE transaction / one pool checkout.

    `events` is the list of event docs the route just wrote to Firestore, each
    carrying its Firestore doc id as 'id' (the legacy_firestore_id — REQUIRED for
    `on_conflict_do_nothing` idempotency; a null id can't dedupe, §5b.2 #1). All
    events in a turn share the same org/class/assignment/session parents (copied
    from one `session_record`), so the four FKs resolve ONCE per turn, not per
    event (§6.1, codex-validated). `session_updates` is the same dict handed to
    `update_practice_session`; when present its mutable columns are applied as the
    LAST statement so the rolling summary / `session.ended` finalize rides the same
    transaction as the event inserts (§5b.2 #2/#7).

    Gating (§5b.2 #7): this is the events-flag-ON path. It SUBSUMES the standalone
    `shadow_update_practice_session`, which self-disables while the events flag is
    on — so a turn takes one checkout (events + summary), never two.

    Fail-open (2000ms hot-path budget). Unresolved parents (session not yet in PG,
    or it predates DUAL_WRITE_ANALYTICS_SESSIONS=1) make the event insert a silent
    accepted coexistence drop (§5b.6) reconciled by the term-scope backfill +
    per-session count-parity gate before Firestore writes retire; the session
    UPDATE is keyed by legacy_firestore_id (0 rows when absent), independent of
    that resolution. DURABILITY INVARIANT: every row is built from request scope
    here — NEVER re-read events from Firestore (would break post-cutover, §5b.2 #3).
    """
    if not _enabled_events():
        return
    valid_events, session_values = _prepare_turn(events, session_updates)
    if not valid_events and not session_values:
        return
    _run_with_timeout(
        sql_engine,
        'write_turn',
        lambda s: _apply_turn(
            s,
            session_firestore_id=session_firestore_id,
            valid_events=valid_events,
            session_values=session_values,
            strict=False,
        ),
        timeout_ms=2000,
    )


def primary_write_turn(
    sql_engine: Any,
    *,
    session_firestore_id: str,
    events: list[dict[str, Any]],
    session_updates: dict[str, Any] | None = None,
) -> None:
    """PRIMARY (fail-closed) counterpart of `shadow_write_turn` for
    `WRITE_FIRESTORE_ANALYTICS='0'` (Postgres is the SOLE store).

    Identical row-building / FK-resolve-once / one-transaction logic (shared via
    `_apply_turn`), but: (1) it runs through `_run_with_timeout_strict`, so a PG failure
    PROPAGATES (route -> 500 -> SPA retry) instead of a silent drop; (2) `strict=True`,
    so an UNRESOLVED FK parent RAISES rather than silently dropping the turn's events —
    with no Firestore backup, a drop would be permanent data loss. In the retired state
    all parents (org/class/assignment) are PG-authoritative and the session was just
    created in PG, so resolution should always succeed; a failure is a real error.

    Unlike the shadow this is NOT gated on DUAL_WRITE_ANALYTICS_EVENTS — under retirement
    PG is the sole store, so events MUST persist; `write_turn` enforces the events=1 prereq
    fail-closed before dispatching here (a silent no-op would be permanent event loss, the
    codex P1). Subsumes the standalone session UPDATE (which self-disables). DURABILITY
    INVARIANT (§5b.2 #3) holds — every row is built from request scope, never re-read.
    """
    valid_events, session_values = _prepare_turn(events, session_updates)
    if not valid_events and not session_values:
        return
    _run_with_timeout_strict(
        sql_engine,
        'write_turn',
        lambda s: _apply_turn(
            s,
            session_firestore_id=session_firestore_id,
            valid_events=valid_events,
            session_values=session_values,
            strict=True,
        ),
        timeout_ms=2000,
    )


def write_turn(
    sql_engine: Any,
    *,
    session_firestore_id: str,
    events: list[dict[str, Any]],
    session_updates: dict[str, Any] | None = None,
) -> None:
    """Dispatch one practice turn to the PRIMARY (fail-closed) or SHADOW (fail-open) PG
    write based on `WRITE_FIRESTORE_ANALYTICS`. The route calls only this — it is unaware
    of which store is the system of record. Zero behavioral change while the flag is '1'.
    """
    if firestore_analytics_enabled():
        shadow_write_turn(
            sql_engine,
            session_firestore_id=session_firestore_id,
            events=events,
            session_updates=session_updates,
        )
        return
    # PG is the SOLE store (retirement). The DUAL_WRITE_ANALYTICS_EVENTS gate only makes
    # sense while Firestore is the backup — under retirement it is a HARD prereq, enforced
    # fail-closed here (codex P1): with events off, `database.create_learning_event` skips
    # Firestore AND `primary_write_turn` would otherwise no-op, dropping the turn's events
    # from BOTH stores while the request succeeds. Raise instead -> 500 -> operator fixes.
    if not _enabled_events():
        raise RuntimeError(
            'WRITE_FIRESTORE_ANALYTICS=0 (Postgres sole store) requires '
            'DUAL_WRITE_ANALYTICS_EVENTS=1 — refusing to drop learning_events'
        )
    primary_write_turn(
        sql_engine,
        session_firestore_id=session_firestore_id,
        events=events,
        session_updates=session_updates,
    )


def primary_create_practice_session(sql_engine: Any, *, session_doc: dict[str, Any]) -> None:
    """PRIMARY (fail-closed) session CREATE for `WRITE_FIRESTORE_ANALYTICS='0'`.

    Reuses the same idempotent `backfill.upsert_practice_session` as the shadow, but
    through `_run_with_timeout_strict` so a PG/FK failure propagates (route -> 500). The
    caller (`database.create_practice_session`) supplies a client-side-minted id (no
    Firestore write) as `session_doc['id']` -> legacy_firestore_id.
    """
    from backend.db.repository import backfill

    doc = {**_strip_sentinels(session_doc)}
    if not doc.get('id'):
        raise RuntimeError('primary_create_practice_session: session_doc missing id')

    def op(session: Any) -> None:
        backfill.upsert_practice_session(session, doc)

    _run_with_timeout_strict(sql_engine, 'create_practice_session', op, timeout_ms=1000)


def primary_update_practice_session(
    sql_engine: Any, *, session_firestore_id: str, updates: dict[str, Any]
) -> None:
    """PRIMARY (fail-closed) session UPDATE for `WRITE_FIRESTORE_ANALYTICS='0'`.

    Self-disables when DUAL_WRITE_ANALYTICS_EVENTS=1 (mirrors `shadow_update_practice_session`
    §5b.2 #7) — the per-turn UPDATE rides `primary_write_turn` then. So this fires only in
    the degenerate sessions=1/events=0 state; in normal retirement (events=1) it is a no-op.
    """
    if _enabled_events():
        return
    clean = _strip_sentinels(updates)
    values = {k: clean[k] for k in _SESSION_MUTABLE_COLUMNS if k in clean}
    if not values:
        return
    values['updated_at'] = _utcnow()

    def op(session: Any) -> None:
        from sqlalchemy import update

        from backend.db.models.practice import PracticeSession

        session.execute(
            update(PracticeSession)
            .where(PracticeSession.legacy_firestore_id == session_firestore_id)
            .values(**values)
        )

    _run_with_timeout_strict(sql_engine, 'update_practice_session', op, timeout_ms=2000)


def _prepare_turn(
    events: list[dict[str, Any]] | None, session_updates: dict[str, Any] | None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Shared prep for shadow/primary write_turn: drop id-less events (can't dedupe,
    §5b.2 #1) and project the session_updates dict to the mutable PG columns."""
    valid_events = [e for e in (events or []) if e.get('id')]
    clean_updates = _strip_sentinels(session_updates or {})
    session_values = {
        k: clean_updates[k] for k in _SESSION_MUTABLE_COLUMNS if k in clean_updates
    }
    return valid_events, session_values


def _apply_turn(
    session: Any,
    *,
    session_firestore_id: str,
    valid_events: list[dict[str, Any]],
    session_values: dict[str, Any],
    strict: bool,
) -> None:
    """The single transaction body shared by shadow_write_turn (fail-open) and
    primary_write_turn (fail-closed). Resolves the four FK parents ONCE, bulk-inserts the
    turn's events (`on_conflict_do_nothing` on legacy_firestore_id), then applies the
    session summary/finalize UPDATE as the last statement.

    `strict` selects the unresolved-parent contract: shadow (False) silently drops the
    events as an accepted coexistence drop (§5b.6, reconciled by the backfill); primary
    (True) RAISES — with Firestore retired there is no backup, so a drop is data loss.
    """
    from sqlalchemy import update
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from backend.db.models.assignment import Assignment
    from backend.db.models.org import Class, Organization
    from backend.db.models.practice import LearningEvent, PracticeSession
    from backend.db.repository.normalization import coerce_jsonb
    from backend.db.repository.resolution import resolve_legacy_id

    rows: list[dict[str, Any]] = []
    if valid_events:
        first = valid_events[0]
        org_uuid = resolve_legacy_id(session, Organization, first.get('org_id'))
        class_uuid = resolve_legacy_id(session, Class, first.get('class_id'))
        assignment_uuid = resolve_legacy_id(session, Assignment, first.get('assignment_id'))
        session_uuid = resolve_legacy_id(session, PracticeSession, session_firestore_id)
        if None in (org_uuid, class_uuid, assignment_uuid, session_uuid):
            if strict:
                # PG is the sole store (WRITE_FIRESTORE_ANALYTICS=0): a drop is permanent
                # data loss, not a reconcilable coexistence no-op. Surface it.
                raise RuntimeError(
                    'primary write_turn: unresolved FK parent for session '
                    f'{session_firestore_id} (org/class/assignment/session must all be in PG)'
                )
            # shadow: accepted coexistence drop (§5b.6) — reconciled by the term backfill.
        else:
            rows = [
                {
                    'legacy_firestore_id': e['id'],
                    'org_id': org_uuid,
                    'class_id': class_uuid,
                    'assignment_id': assignment_uuid,
                    'session_id': session_uuid,
                    # Rename (not an FK): Firestore student_uid -> student_firebase_uid.
                    'student_firebase_uid': e.get('student_uid') or '',
                    'event_type': e.get('event_type'),
                    'turn_index': e.get('turn_index'),
                    'payload': coerce_jsonb(e.get('payload'), default={}),
                    'created_at': e.get('created_at'),
                }
                for e in valid_events
            ]
    if rows:
        session.execute(
            pg_insert(LearningEvent)
            .values(rows)
            .on_conflict_do_nothing(index_elements=['legacy_firestore_id'])
        )
    # The summary/finalize UPDATE rides the same transaction (last statement),
    # keyed by legacy_firestore_id; 0 rows when the session is not in PG.
    if session_values:
        session.execute(
            update(PracticeSession)
            .where(PracticeSession.legacy_firestore_id == session_firestore_id)
            .values(**session_values, updated_at=_utcnow())
        )


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
