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

    def test_update_still_fires_when_events_flag_set_early(self):
        # §5b.2 #7 / codex P2: the self-disable lands WITH Slice C's shadow_write_turn,
        # NOT now. Until then, an early DUAL_WRITE_ANALYTICS_EVENTS=1 must NOT silently
        # drop the PG session UPDATE — shadow_update still fires on SESSIONS=1.
        os.environ['DUAL_WRITE_ANALYTICS_SESSIONS'] = '1'
        os.environ['DUAL_WRITE_ANALYTICS_EVENTS'] = '1'
        with mock.patch.object(da, '_run_with_timeout') as run:
            da.shadow_update_practice_session(
                lambda: object(), session_firestore_id='s1',
                updates={'status': 'completed'})
            run.assert_called_once()

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


if __name__ == '__main__':
    unittest.main()
