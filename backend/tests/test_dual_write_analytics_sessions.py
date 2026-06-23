"""Tier 1 (no DB): practice_session dual-write (Slice B) gating + wiring + reconciler.

Covers:
  - `_run_with_timeout` fail-open contract + caller-supplied statement_timeout
  - `shadow_create_practice_session`: OFF unless DUAL_WRITE_ANALYTICS_SESSIONS=1;
    routes to upsert_practice_session at 1000ms
  - `shadow_update_practice_session`: the §5b.2 #7 flag matrix (self-disables when
    DUAL_WRITE_ANALYTICS_EVENTS=1), the mutable-column subset, 2000ms
  - `sweep_orphaned_sessions`: flag gating
  - the internal reconciler route: shared-secret auth + flag-off short-circuit

Engine + Session are stubbed so no Postgres is needed.
"""

import os
import unittest
from unittest import mock

from flask import Flask

from backend.db import dual_write_analytics as da
from backend.routes.analytics_internal import create_analytics_internal_blueprint


def _provider_that_explodes():
    """A sql_engine provider that fails if the shadow ever resolves it — proves the
    flag-OFF / self-disabled path returns BEFORE touching the engine."""
    def _boom():
        raise AssertionError('engine must not be resolved on the no-op path')
    return _boom


class _RecordingSession:
    """Stand-in Session context manager: records executed statements, no real DB."""

    def __init__(self, *_a, **_k):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, stmt):
        self.statements.append(stmt)

    def commit(self):
        pass


class TestRunWithTimeout(unittest.TestCase):
    """The hot-path variant: fail-open like _run, with a caller-set timeout."""

    def test_none_engine_is_noop(self):
        with mock.patch('backend.db.dual_write._resolve_engine', return_value=None):
            called = {'n': 0}

            def fn(_s):
                called['n'] += 1

            da._run_with_timeout(lambda: object(), 'op', fn, timeout_ms=1000)
            self.assertEqual(called['n'], 0)  # never reached the op

    def test_unresolved_parent_swallowed(self):
        from backend.db.repository.backfill import UnresolvedParentError

        with mock.patch('backend.db.dual_write._resolve_engine', return_value=object()), \
                mock.patch('sqlalchemy.orm.Session', _RecordingSession):
            def fn(_s):
                raise UnresolvedParentError('parent missing')

            # Must NOT raise into the caller.
            da._run_with_timeout(lambda: object(), 'op', fn, timeout_ms=1000)

    def test_generic_exception_swallowed(self):
        with mock.patch('backend.db.dual_write._resolve_engine', return_value=object()), \
                mock.patch('sqlalchemy.orm.Session', _RecordingSession):
            def fn(_s):
                raise RuntimeError('postgres is on fire')

            da._run_with_timeout(lambda: object(), 'op', fn, timeout_ms=1000)

    def test_sets_caller_supplied_timeout(self):
        captured = _RecordingSession()
        with mock.patch('backend.db.dual_write._resolve_engine', return_value=object()), \
                mock.patch('sqlalchemy.orm.Session', return_value=captured):
            da._run_with_timeout(lambda: object(), 'op', lambda _s: None, timeout_ms=2000)
        # First statement is the SET LOCAL statement_timeout carrying the budget.
        self.assertTrue(captured.statements)
        self.assertIn('2000ms', str(captured.statements[0]))


class TestSessionShadowGating(unittest.TestCase):
    def setUp(self):
        for k in ('DUAL_WRITE_ANALYTICS_SESSIONS', 'DUAL_WRITE_ANALYTICS_EVENTS'):
            os.environ.pop(k, None)
            self.addCleanup(lambda key=k: os.environ.pop(key, None))

    def test_create_is_noop_when_flag_off(self):
        da.shadow_create_practice_session(
            _provider_that_explodes(), session_doc={'id': 's1', 'org_id': 'o1'})

    def test_update_is_noop_when_flag_off(self):
        da.shadow_update_practice_session(
            _provider_that_explodes(), session_firestore_id='s1',
            updates={'status': 'completed'})

    def test_create_routes_to_upsert_at_1000ms_when_on(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms
            fn('SESSION')  # drive the op to exercise the upsert wiring

        with mock.patch.object(da, '_run_with_timeout', fake_run), \
                mock.patch('backend.db.repository.backfill.upsert_practice_session') as upsert:
            da.shadow_create_practice_session(
                lambda: object(),
                session_doc={'id': 'sess-7', 'org_id': 'o1', 'class_id': 'c1',
                             'assignment_id': 'a1', 'student_uid': 'u1'})

        self.assertEqual(captured['op_name'], 'create_practice_session')
        self.assertEqual(captured['timeout_ms'], 1000)
        upsert.assert_called_once()
        self.assertEqual(upsert.call_args.args[1]['id'], 'sess-7')

    def test_create_skips_when_doc_missing_id(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_create_practice_session(lambda: object(), session_doc={'org_id': 'o1'})
            run.assert_not_called()  # no id -> no idempotency key -> skip

    def test_update_maps_only_mutable_columns_at_2000ms_when_on(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms
            sess = _RecordingSession()
            fn(sess)
            captured['sql'] = str(sess.statements[0]) if sess.statements else ''

        with mock.patch.object(da, '_run_with_timeout', fake_run):
            da.shadow_update_practice_session(
                lambda: object(), session_firestore_id='sess-1',
                updates={
                    'session_summary': {'turns': 3},
                    'status': 'completed',
                    'ended_at': '2026-06-02T00:00:00Z',
                    # irrelevant keys that must NOT reach the UPDATE:
                    'org_id': 'o1', 'student_uid': 'u1',
                })

        self.assertEqual(captured['op_name'], 'update_practice_session')
        self.assertEqual(captured['timeout_ms'], 2000)
        sql = captured['sql']
        self.assertIn('session_summary', sql)
        self.assertIn('status', sql)
        self.assertIn('ended_at', sql)
        self.assertIn('updated_at', sql)  # always re-stamped
        self.assertNotIn('org_id', sql)
        self.assertNotIn('student_firebase_uid', sql)

    def test_update_noop_when_no_mutable_keys(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_update_practice_session(
                lambda: object(), session_firestore_id='s1', updates={'prompt_version': 'v9'})
            run.assert_not_called()  # nothing PG-relevant -> no checkout

    def test_update_self_disables_when_events_flag_on(self):
        # §5b.2 #7 (Slice C): with the events flag on, shadow_write_turn writes the
        # summary UPDATE in the same transaction as the turn's events, so this
        # standalone path MUST self-disable — one pool checkout per turn, not two.
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_update_practice_session(
                lambda: object(), session_firestore_id='s1',
                updates={'status': 'completed'})
            run.assert_not_called()

    def test_create_still_fires_when_events_flag_on(self):
        # Session-create is unchanged by the events flag (matrix: both on-rows use
        # shadow_create_practice_session).
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run, \
                mock.patch('backend.db.repository.backfill.upsert_practice_session'):
            da.shadow_create_practice_session(
                lambda: object(), session_doc={'id': 's1', 'org_id': 'o1'})
            run.assert_called_once()


class TestShadowWriteTurn(unittest.TestCase):
    """Slice C: one batched transaction per turn (events + summary UPDATE), §5b.2."""

    def setUp(self):
        for k in ('DUAL_WRITE_ANALYTICS_SESSIONS', 'DUAL_WRITE_ANALYTICS_EVENTS'):
            os.environ.pop(k, None)
            self.addCleanup(lambda key=k: os.environ.pop(key, None))

    def _events(self, n=2):
        base = {'org_id': 'o1', 'class_id': 'c1', 'assignment_id': 'a1',
                'session_id': 's1', 'student_uid': 'u1', 'turn_index': 3}
        return [
            {**base, 'id': f'ev{i}', 'event_type': 'student.turn', 'payload': {'k': i}}
            for i in range(n)
        ]

    def test_noop_when_events_flag_off(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'  # sessions on, events OFF
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=self._events(), session_updates={'status': 'completed'})
            run.assert_not_called()

    def test_noop_when_no_events_and_no_session_values(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=[], session_updates={'prompt_version': 'v9'})  # no mutable cols
            run.assert_not_called()

    def test_skips_events_without_id(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=[{'org_id': 'o1', 'event_type': 'x'}],  # no 'id' -> can't dedupe
                session_updates={})
            run.assert_not_called()  # nothing valid to write

    def test_inserts_events_and_update_in_one_txn_at_2000ms(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms
            sess = _RecordingSession()
            fn(sess)
            captured['sql'] = [str(s) for s in sess.statements]

        with mock.patch.object(da, '_run_with_timeout', fake_run), \
                mock.patch('backend.db.repository.resolution.resolve_legacy_id',
                           return_value='uuid-x'):
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=self._events(2),
                session_updates={'session_summary': {'turns': 3}, 'status': 'active'})

        self.assertEqual(captured['op_name'], 'write_turn')
        self.assertEqual(captured['timeout_ms'], 2000)
        joined = '\n'.join(captured['sql'])
        self.assertIn('INSERT INTO learning_events', joined)
        self.assertIn('UPDATE practice_sessions', joined)
        # Event insert precedes the summary UPDATE (UPDATE is the last statement).
        self.assertLess(
            joined.index('INSERT INTO learning_events'),
            joined.index('UPDATE practice_sessions'),
        )

    def test_resolves_four_parents_once_regardless_of_event_count(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'

        def fake_run(engine, op_name, fn, *, timeout_ms):
            fn(_RecordingSession())

        with mock.patch.object(da, '_run_with_timeout', fake_run), \
                mock.patch('backend.db.repository.resolution.resolve_legacy_id',
                           return_value='uuid-x') as resolve:
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=self._events(5), session_updates={})
        # O(4) resolutions (org/class/assignment/session) for the whole turn, not O(4N).
        self.assertEqual(resolve.call_count, 4)

    def test_unresolved_parent_drops_events_but_keeps_session_update(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn, *, timeout_ms):
            sess = _RecordingSession()
            fn(sess)
            captured['sql'] = [str(s) for s in sess.statements]

        # session FK unresolved -> events can't insert (accepted drop, §5b.6); the
        # UPDATE is keyed by legacy_firestore_id and still issues (0 rows if absent).
        with mock.patch.object(da, '_run_with_timeout', fake_run), \
                mock.patch('backend.db.repository.resolution.resolve_legacy_id',
                           return_value=None):
            da.shadow_write_turn(
                lambda: object(), session_firestore_id='s1',
                events=self._events(2), session_updates={'status': 'completed'})

        joined = '\n'.join(captured['sql'])
        self.assertNotIn('INSERT INTO learning_events', joined)
        self.assertIn('UPDATE practice_sessions', joined)


class TestSweepOrphanedSessions(unittest.TestCase):
    def setUp(self):
        os.environ.pop('DUAL_WRITE_ANALYTICS_SESSIONS', None)
        self.addCleanup(lambda: os.environ.pop('DUAL_WRITE_ANALYTICS_SESSIONS', None))

    def test_flag_off_returns_early(self):
        result = da.sweep_orphaned_sessions(_provider_that_explodes())
        self.assertEqual(result['status'], 'flag_off')
        self.assertEqual(result['swept'], 0)

    def test_flag_on_issues_update(self):
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        captured = {}

        def fake_run(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name

            class _Res:
                rowcount = 4

            class _Sess:
                def execute(self, stmt):
                    captured['sql'] = str(stmt)
                    return _Res()

            fn(_Sess())

        with mock.patch.object(da, '_run_with_timeout', fake_run):
            result = da.sweep_orphaned_sessions(lambda: object())

        self.assertEqual(captured['op_name'], 'sweep_orphaned_sessions')
        self.assertIn('practice_sessions', captured['sql'])
        self.assertEqual(result['swept'], 4)


class TestReconcilerRoute(unittest.TestCase):
    def setUp(self):
        for k in ('INTERNAL_SCHEDULER_SECRET', 'DUAL_WRITE_ANALYTICS_SESSIONS'):
            os.environ.pop(k, None)
            self.addCleanup(lambda key=k: os.environ.pop(key, None))

        class _Deps:
            sql_engine = staticmethod(lambda: None)

        app = Flask(__name__)
        app.register_blueprint(create_analytics_internal_blueprint(_Deps()))
        self.client = app.test_client()
        self.url = '/internal/analytics/sweep-orphaned-sessions'

    def test_missing_secret_env_seals_route(self):
        # No INTERNAL_SCHEDULER_SECRET configured -> fail-closed even with a header.
        resp = self.client.post(self.url, headers={'X-Internal-Secret': 'anything'})
        self.assertEqual(resp.status_code, 403)

    def test_wrong_secret_rejected(self):
        os.environ['INTERNAL_SCHEDULER_SECRET'] = 'right'
        resp = self.client.post(self.url, headers={'X-Internal-Secret': 'wrong'})
        self.assertEqual(resp.status_code, 403)

    def test_correct_secret_flag_off_returns_flag_off(self):
        os.environ['INTERNAL_SCHEDULER_SECRET'] = 'right'
        resp = self.client.post(self.url, headers={'X-Internal-Secret': 'right'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['status'], 'flag_off')

    def test_correct_secret_flag_on_sweeps(self):
        os.environ['INTERNAL_SCHEDULER_SECRET'] = 'right'
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        with mock.patch.object(da, 'sweep_orphaned_sessions', return_value={'swept': 3}):
            resp = self.client.post(self.url, headers={'X-Internal-Secret': 'right'})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body['status'], 'ok')
        self.assertEqual(body['swept'], 3)


class TestWriteRetirement(unittest.TestCase):
    """Slice E: WRITE_FIRESTORE_ANALYTICS retirement — the fail-closed primary path
    and the write_turn dispatcher."""

    def setUp(self):
        for k in ('WRITE_FIRESTORE_ANALYTICS', 'DUAL_WRITE_ANALYTICS_EVENTS'):
            os.environ.pop(k, None)
            self.addCleanup(lambda key=k: os.environ.pop(key, None))

    def test_firestore_enabled_defaults_on(self):
        self.assertTrue(da.firestore_analytics_enabled())  # unset -> on

    def test_firestore_enabled_off_only_for_zero(self):
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'
        self.assertFalse(da.firestore_analytics_enabled())
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '1'
        self.assertTrue(da.firestore_analytics_enabled())

    def test_write_turn_dispatches_to_shadow_when_flag_on(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'  # so neither path no-ops early
        with mock.patch.object(da, 'shadow_write_turn') as shadow, \
                mock.patch.object(da, 'primary_write_turn') as primary:
            da.write_turn(lambda: object(), session_firestore_id='s1',
                          events=[{'id': 'e1'}], session_updates={})
        shadow.assert_called_once()
        primary.assert_not_called()

    def test_write_turn_dispatches_to_primary_when_flag_off(self):
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, 'shadow_write_turn') as shadow, \
                mock.patch.object(da, 'primary_write_turn') as primary:
            da.write_turn(lambda: object(), session_firestore_id='s1',
                          events=[{'id': 'e1'}], session_updates={})
        primary.assert_called_once()
        shadow.assert_not_called()

    def test_strict_runner_propagates_exception(self):
        """_run_with_timeout_strict must NOT swallow — the whole point vs _run_with_timeout."""
        with mock.patch('backend.db.dual_write._resolve_engine', return_value=object()), \
                mock.patch('sqlalchemy.orm.Session', _RecordingSession):
            def boom(_s):
                raise RuntimeError('pg down')
            with self.assertRaises(RuntimeError):
                da._run_with_timeout_strict(lambda: object(), 'op', boom, timeout_ms=2000)

    def test_strict_runner_raises_when_no_engine(self):
        with mock.patch('backend.db.dual_write._resolve_engine', return_value=None):
            with self.assertRaises(RuntimeError):
                da._run_with_timeout_strict(lambda: object(), 'op', lambda _s: None, timeout_ms=2000)

    def test_primary_write_turn_uses_strict_runner(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        captured = {}

        def fake_strict(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms

        with mock.patch.object(da, '_run_with_timeout_strict', fake_strict):
            da.primary_write_turn(lambda: object(), session_firestore_id='s1',
                                  events=[{'id': 'e1'}], session_updates={'status': 'completed'})
        self.assertEqual(captured['op_name'], 'write_turn')
        self.assertEqual(captured['timeout_ms'], 2000)

    def test_write_turn_raises_when_retired_and_events_off(self):
        # codex P1: WRITE_FIRESTORE_ANALYTICS=0 + DUAL_WRITE_ANALYTICS_EVENTS=0 would drop
        # the turn's events from BOTH stores — write_turn must fail-closed (raise), not no-op.
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'  # events flag left OFF
        with mock.patch.object(da, 'primary_write_turn') as primary:
            with self.assertRaises(RuntimeError):
                da.write_turn(lambda: object(), session_firestore_id='s1',
                              events=[{'id': 'e1'}], session_updates={})
            primary.assert_not_called()

    def test_primary_write_turn_writes_regardless_of_events_flag(self):
        # primary_write_turn no longer self-gates on the events flag (write_turn enforces
        # the prereq); it persists whenever there is something to write.
        with mock.patch.object(da, '_run_with_timeout_strict') as run:
            da.primary_write_turn(lambda: object(), session_firestore_id='s1',
                                  events=[{'id': 'e1'}], session_updates={'status': 'completed'})
            run.assert_called_once()

    def test_apply_turn_strict_raises_on_unresolved_parent(self):
        """Fail-closed core: with PG the sole store, an unresolved FK parent must RAISE
        (data loss otherwise), unlike the shadow which silently drops (§5b.6)."""
        with mock.patch('backend.db.repository.resolution.resolve_legacy_id', return_value=None):
            with self.assertRaises(RuntimeError):
                da._apply_turn(
                    _RecordingSession(), session_firestore_id='s1',
                    valid_events=[{'id': 'e1', 'org_id': 'o1', 'class_id': 'c1',
                                   'assignment_id': 'a1', 'event_type': 'student.turn'}],
                    session_values={}, strict=True,
                )

    def test_apply_turn_shadow_drops_silently_on_unresolved_parent(self):
        """Same unresolved parent in shadow mode (strict=False) -> no raise, no insert."""
        rec = _RecordingSession()
        with mock.patch('backend.db.repository.resolution.resolve_legacy_id', return_value=None):
            da._apply_turn(
                rec, session_firestore_id='s1',
                valid_events=[{'id': 'e1', 'org_id': 'o1', 'class_id': 'c1',
                               'assignment_id': 'a1', 'event_type': 'student.turn'}],
                session_values={}, strict=False,
            )
        self.assertEqual(rec.statements, [])  # no insert when parents unresolved

    def test_database_update_raises_when_retired_without_engine(self):
        # codex P2: under retirement, a missing engine is a misconfiguration, not a
        # silent no-op (mirrors create_practice_session). Raises BEFORE touching Firestore.
        import database
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'
        with self.assertRaises(RuntimeError):
            database.update_practice_session('s1', {'status': 'completed'}, sql_engine=None)

    def test_primary_create_uses_strict_runner(self):
        captured = {}

        def fake_strict(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms

        with mock.patch.object(da, '_run_with_timeout_strict', fake_strict):
            da.primary_create_practice_session(
                lambda: object(),
                session_doc={'id': 'sess-9', 'org_id': 'o1', 'class_id': 'c1',
                             'assignment_id': 'a1', 'student_uid': 'u1'})
        self.assertEqual(captured['op_name'], 'create_practice_session')
        self.assertEqual(captured['timeout_ms'], 1000)


class TestSessionAnalysisStateWrite(unittest.TestCase):
    """Post-hoc analysis_state write (S3.1 coach-review cache). UNLIKE the per-turn
    UPDATE this must NOT self-disable under DUAL_WRITE_ANALYTICS_EVENTS=1 — analysis_state
    is never carried by write_turn, so the events self-disable would silently drop it."""

    def setUp(self):
        for k in ('WRITE_FIRESTORE_ANALYTICS', 'DUAL_WRITE_ANALYTICS_EVENTS'):
            os.environ.pop(k, None)
            self.addCleanup(lambda key=k: os.environ.pop(key, None))

    def test_issues_update_even_when_events_enabled(self):
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'  # would self-disable primary_update
        captured = {}

        def fake_strict(engine, op_name, fn, *, timeout_ms):
            captured['op_name'] = op_name
            captured['timeout_ms'] = timeout_ms
            sess = _RecordingSession()
            fn(sess)
            captured['sql'] = [str(s) for s in sess.statements]

        with mock.patch.object(da, '_run_with_timeout_strict', fake_strict):
            da.write_session_analysis_state(
                lambda: object(), session_firestore_id='s1',
                analysis_state={'coach_review': {'model': 'm'}})

        self.assertEqual(captured['op_name'], 'update_practice_session_analysis_state')
        self.assertEqual(captured['timeout_ms'], 2000)
        self.assertIn('UPDATE practice_sessions', '\n'.join(captured['sql']))

    def test_zero_row_update_warns_but_does_not_raise(self):
        # A session absent from PG (legacy Firestore-only) -> 0-row update. Fail-open
        # cache write must NOT raise (the caller still returns a correct uncached
        # review), but the otherwise-silent drop must be logged.
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'

        class _ZeroRowSession(_RecordingSession):
            def execute(self, stmt):
                super().execute(stmt)
                return type('R', (), {'rowcount': 0})()

        def fake_strict(engine, op_name, fn, *, timeout_ms):
            fn(_ZeroRowSession())

        with mock.patch.object(da, '_run_with_timeout_strict', fake_strict):
            with self.assertLogs('backend.db.dual_write_analytics', level='WARNING') as cm:
                da.write_session_analysis_state(
                    lambda: object(), session_firestore_id='ghost',
                    analysis_state={'coach_review': {'model': 'm'}})
        self.assertTrue(any('0 rows' in m for m in cm.output))

    def test_database_wrapper_raises_when_retired_without_engine(self):
        import database
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'
        with self.assertRaises(RuntimeError):
            database.update_practice_session_analysis_state('s1', {'coach_review': {}}, sql_engine=None)

    def test_database_wrapper_calls_pg_write_when_retired(self):
        import database
        os.environ['WRITE_FIRESTORE_ANALYTICS'] = '0'
        with mock.patch.object(da, 'write_session_analysis_state') as w:
            database.update_practice_session_analysis_state(
                's1', {'coach_review': {'x': 1}}, sql_engine=object())
        w.assert_called_once()
        self.assertEqual(w.call_args.kwargs['session_firestore_id'], 's1')
        self.assertEqual(w.call_args.kwargs['analysis_state'], {'coach_review': {'x': 1}})


if __name__ == '__main__':
    unittest.main()
