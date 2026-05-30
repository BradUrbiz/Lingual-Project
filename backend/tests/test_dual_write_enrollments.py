"""Tier 1 (no DB, no Firestore): the enrollment dual-write seam (slice 2b).

Runs in `make test-backend`. Exercises everything a real Postgres is NOT needed
for: flag gating, the fail-open `_run` contract (swallow + always close, never
commit on error), the doc/resolution shaping each `shadow_*` builds, and the
wiring through database.py + the LTI direct-update bypass. The parts that need
real text[]/jsonb/CHECK DDL (rows actually landing, idempotency, statement_timeout)
live in the gated Tier-2 companion test_dual_write_enrollments_pg.py.
"""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.db import dual_write
from backend.db.repository.backfill import UnresolvedParentError

FLAG = 'DUAL_WRITE_ENROLLMENTS'


# --- Fakes -------------------------------------------------------------------

class _FakeResult:
    def scalar_one_or_none(self):
        return None


class _FakeSession:
    """Context-manager Session stand-in: records execute/commit, tracks close."""

    def __init__(self, fail_on_commit=False):
        self.committed = False
        self.closed = False
        self.statements = []
        self.fail_on_commit = fail_on_commit

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True
        return False

    def execute(self, statement, *a, **k):
        self.statements.append(statement)
        return _FakeResult()

    def commit(self):
        if self.fail_on_commit:
            raise RuntimeError('commit boom')
        self.committed = True

    def flush(self):
        pass


class _FlagMixin(unittest.TestCase):
    """Restore the flag's original value around each test."""

    def setUp(self):
        self._orig = os.environ.get(FLAG)

    def tearDown(self):
        if self._orig is None:
            os.environ.pop(FLAG, None)
        else:
            os.environ[FLAG] = self._orig

    def _on(self):
        os.environ[FLAG] = '1'

    def _off(self):
        os.environ.pop(FLAG, None)


# --- _enabled / _resolve_engine ---------------------------------------------

class TestGate(_FlagMixin):
    def test_enabled_reads_env_each_call(self):
        self._off()
        self.assertFalse(dual_write._enabled())
        self._on()
        self.assertTrue(dual_write._enabled())
        os.environ[FLAG] = 'true'  # only the literal '1' counts
        self.assertFalse(dual_write._enabled())

    def test_resolve_engine_none_when_flag_off(self):
        self._off()
        self.assertIsNone(dual_write._resolve_engine(lambda: object()))

    def test_resolve_engine_none_when_provider_none(self):
        self._on()
        self.assertIsNone(dual_write._resolve_engine(None))

    def test_resolve_engine_returns_engine_when_on(self):
        self._on()
        sentinel = object()
        self.assertIs(dual_write._resolve_engine(lambda: sentinel), sentinel)

    def test_resolve_engine_none_when_provider_returns_none(self):
        # The _no_sql_engine sentinel: configured-but-unavailable.
        self._on()
        self.assertIsNone(dual_write._resolve_engine(lambda: None))

    def test_resolve_engine_swallows_provider_error(self):
        self._on()

        def boom():
            raise RuntimeError('provider down')

        self.assertIsNone(dual_write._resolve_engine(boom))


# --- _run fail-open contract -------------------------------------------------

class TestRunFailOpen(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_happy_path_commits_and_sets_statement_timeout(self):
        fake = _FakeSession()
        applied = []
        with patch('sqlalchemy.orm.Session', lambda engine: fake):
            dual_write._run(lambda: object(), 'op', lambda s: applied.append(s))
        self.assertTrue(fake.committed)
        self.assertTrue(fake.closed)
        self.assertEqual(applied, [fake])
        # The first statement is the transaction-scoped statement_timeout guard.
        self.assertIn('statement_timeout', str(fake.statements[0]).lower())

    def test_generic_exception_is_swallowed_and_session_closed(self):
        fake = _FakeSession()

        def boom(_s):
            raise RuntimeError('pg exploded')

        with patch('sqlalchemy.orm.Session', lambda engine: fake):
            with self.assertLogs('backend.db.dual_write', level='ERROR') as cm:
                dual_write._run(lambda: object(), 'create_enrollment', boom)  # must not raise
        self.assertFalse(fake.committed)
        self.assertTrue(fake.closed)  # context manager guarantees close on error
        self.assertTrue(any('shadow write failed' in m for m in cm.output))

    def test_commit_failure_is_swallowed(self):
        fake = _FakeSession(fail_on_commit=True)
        with patch('sqlalchemy.orm.Session', lambda engine: fake):
            dual_write._run(lambda: object(), 'op', lambda s: None)  # must not raise
        self.assertFalse(fake.committed)
        self.assertTrue(fake.closed)

    def test_unresolved_parent_is_quiet_not_error(self):
        fake = _FakeSession()

        def no_parent(_s):
            raise UnresolvedParentError('class not backfilled')

        with patch('sqlalchemy.orm.Session', lambda engine: fake):
            with self.assertLogs('backend.db.dual_write', level='DEBUG') as cm:
                dual_write._run(lambda: object(), 'create_enrollment', no_parent)
        # Expected coexistence no-op: logged at DEBUG, never ERROR.
        self.assertFalse(any('ERROR' in line for line in cm.output))
        self.assertTrue(fake.closed)

    def test_noop_when_engine_unavailable(self):
        # flag on but provider returns None -> Session never constructed.
        with patch('sqlalchemy.orm.Session', side_effect=AssertionError('must not open')):
            dual_write._run(lambda: None, 'op', lambda s: None)


# --- shadow_* shaping --------------------------------------------------------

def _capture_run():
    """Patch-able _run replacement that invokes the closure with a fake session."""
    captured = {}

    def fake_run(sql_engine, op_name, fn):
        captured['op'] = op_name
        fn(_FakeSession())

    return captured, fake_run


class TestShadowCreate(_FlagMixin):
    def test_noop_when_flag_off(self):
        self._off()
        with patch.object(dual_write, '_run', side_effect=AssertionError('must not run')):
            dual_write.shadow_create_enrollment(
                lambda: object(), class_id='c', student_uid='u', enrollment_id='c_u'
            )

    def test_builds_composite_doc_and_upserts(self):
        self._on()
        captured, fake_run = _capture_run()
        seen = {}
        with patch.object(dual_write, '_run', fake_run), patch(
            'backend.db.repository.backfill.upsert_enrollment',
            lambda s, doc: seen.update(doc),
        ):
            dual_write.shadow_create_enrollment(
                lambda: object(),
                class_id='cls1',
                student_uid='uidA',
                enrollment_id='cls1_uidA',
                student_membership_id='org1_uidA',
                status='active',
                join_source='canvas',  # normalization is upsert's job, not the seam's
            )
        self.assertEqual(captured['op'], 'create_enrollment')
        self.assertEqual(seen['id'], 'cls1_uidA')  # composite legacy id
        self.assertEqual(seen['class_id'], 'cls1')
        self.assertEqual(seen['student_uid'], 'uidA')
        self.assertEqual(seen['student_membership_id'], 'org1_uidA')
        self.assertEqual(seen['join_source'], 'canvas')


class TestShadowSetStatus(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def _run_with_resolution(self, resolves_to, status):
        calls = []
        _captured, fake_run = _capture_run()
        with patch.object(dual_write, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id',
            lambda s, model, fid: resolves_to,
        ), patch(
            'backend.db.repository.enrollments.deactivate_enrollment',
            lambda s, c, u: calls.append(('deactivate', c, u)),
        ), patch(
            'backend.db.repository.enrollments.reactivate_enrollment',
            lambda s, c, u: calls.append(('reactivate', c, u)),
        ):
            dual_write.shadow_set_enrollment_status(
                lambda: object(), class_id='cls1', student_uid='uidA', status=status
            )
        return calls

    def test_inactive_resolves_and_deactivates(self):
        calls = self._run_with_resolution('CLASS_UUID', 'inactive')
        self.assertEqual(calls, [('deactivate', 'CLASS_UUID', 'uidA')])

    def test_active_resolves_and_reactivates(self):
        calls = self._run_with_resolution('CLASS_UUID', 'active')
        self.assertEqual(calls, [('reactivate', 'CLASS_UUID', 'uidA')])

    def test_unresolved_class_is_noop(self):
        calls = self._run_with_resolution(None, 'inactive')
        self.assertEqual(calls, [])


class TestShadowLtiReactivate(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_resolves_class_and_membership_then_writes_three_fields(self):
        calls = []
        _captured, fake_run = _capture_run()

        def fake_resolve(s, model, fid):
            return {'Class': 'CLASS_UUID', 'Membership': 'MEM_UUID'}.get(model.__name__)

        with patch.object(dual_write, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id', fake_resolve
        ), patch(
            'backend.db.repository.enrollments.lti_reactivate_enrollment',
            lambda s, c, u, *, student_membership_id: calls.append((c, u, student_membership_id)),
        ):
            dual_write.shadow_lti_reactivate(
                lambda: object(),
                class_id='cls1',
                student_uid='uidA',
                student_membership_id='org1_uidA',
            )
        self.assertEqual(calls, [('CLASS_UUID', 'uidA', 'MEM_UUID')])

    def test_unresolved_class_is_noop(self):
        calls = []
        _captured, fake_run = _capture_run()
        with patch.object(dual_write, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id', lambda s, m, fid: None
        ), patch(
            'backend.db.repository.enrollments.lti_reactivate_enrollment',
            lambda *a, **k: calls.append(a),
        ):
            dual_write.shadow_lti_reactivate(
                lambda: object(), class_id='cls1', student_uid='uidA'
            )
        self.assertEqual(calls, [])


# --- Wiring through database.py ---------------------------------------------

class TestDatabaseWiring(_FlagMixin):
    """database.py write helpers shadow only when sql_engine is passed."""

    def setUp(self):
        super().setUp()
        import database  # import-safe (firestore.client() is lazy)
        self.database = database
        self._ref = MagicMock()
        self._ref.id = 'cls1_uidA'

    def test_create_shadows_when_engine_passed(self):
        with patch.object(self.database, 'get_enrollment_ref', return_value=self._ref), patch(
            'backend.db.dual_write.shadow_create_enrollment'
        ) as shadow:
            self.database.create_enrollment(
                class_id='cls1', student_uid='uidA', sql_engine=lambda: object()
            )
        shadow.assert_called_once()
        kwargs = shadow.call_args.kwargs
        self.assertEqual(kwargs['enrollment_id'], 'cls1_uidA')
        self.assertEqual(kwargs['class_id'], 'cls1')

    def test_create_does_not_shadow_without_engine(self):
        with patch.object(self.database, 'get_enrollment_ref', return_value=self._ref), patch(
            'backend.db.dual_write.shadow_create_enrollment'
        ) as shadow:
            self.database.create_enrollment(class_id='cls1', student_uid='uidA')
        shadow.assert_not_called()

    def test_deactivate_shadows_inactive_when_engine_passed(self):
        with patch.object(self.database, 'get_enrollment_ref', return_value=self._ref), patch(
            'backend.db.dual_write.shadow_set_enrollment_status'
        ) as shadow:
            self.database.deactivate_enrollment('cls1', 'uidA', sql_engine=lambda: object())
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['status'], 'inactive')

    def test_reactivate_shadows_active_when_engine_passed(self):
        with patch.object(self.database, 'get_enrollment_ref', return_value=self._ref), patch(
            'backend.db.dual_write.shadow_set_enrollment_status'
        ) as shadow:
            self.database.reactivate_enrollment('cls1', 'uidA', sql_engine=lambda: object())
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['status'], 'active')

    def test_deactivate_does_not_shadow_without_engine(self):
        with patch.object(self.database, 'get_enrollment_ref', return_value=self._ref), patch(
            'backend.db.dual_write.shadow_set_enrollment_status'
        ) as shadow:
            self.database.deactivate_enrollment('cls1', 'uidA')
        shadow.assert_not_called()


# --- Wiring through the LTI launch (the direct-update bypass) ----------------

class _FakeIdentityDb:
    def __init__(self, enrollment_status):
        self._status = enrollment_status
        self.enrollment_ref = MagicMock()
        self.membership_ref = MagicMock()
        self.create_kwargs = None

    def get_membership(self, mid):
        return {'id': mid, 'primary_class_ids': ['class-1']}

    def get_membership_ref(self, mid):
        return self.membership_ref

    def get_student_class_enrollment(self, class_id, uid):
        if self._status is None:
            return None
        return {'id': f'{class_id}_{uid}', 'status': self._status}

    def get_enrollment_ref(self, eid):
        return self.enrollment_ref

    def create_enrollment(self, **kwargs):
        self.create_kwargs = kwargs
        return 'new-enr'


class TestLtiWiring(_FlagMixin):
    def setUp(self):
        super().setUp()
        from backend.services.lti import identity
        self.identity = identity

    @patch('backend.services.lti.identity._firestore')
    def test_inactive_reactivation_shadows_lti(self, mock_fs):
        mock_fs.ArrayUnion = MagicMock(return_value=['class-1'])
        mock_fs.SERVER_TIMESTAMP = 'TS'
        db = _FakeIdentityDb(enrollment_status='inactive')
        engine = lambda: object()
        with patch('backend.db.dual_write.shadow_lti_reactivate') as shadow:
            self.identity.auto_enroll_student(
                db, uid='stu-1', org_id='org-1', class_id='class-1',
                membership_id='org-1_stu-1', sql_engine=engine,
            )
        shadow.assert_called_once()
        kwargs = shadow.call_args.kwargs
        self.assertEqual(kwargs['class_id'], 'class-1')
        self.assertEqual(kwargs['student_uid'], 'stu-1')
        self.assertEqual(kwargs['student_membership_id'], 'org-1_stu-1')

    @patch('backend.services.lti.identity._firestore')
    def test_new_enrollment_forwards_engine_to_create(self, mock_fs):
        mock_fs.ArrayUnion = MagicMock(return_value=['class-1'])
        mock_fs.SERVER_TIMESTAMP = 'TS'
        db = _FakeIdentityDb(enrollment_status=None)  # no existing enrollment
        engine = lambda: object()
        self.identity.auto_enroll_student(
            db, uid='stu-1', org_id='org-1', class_id='class-1',
            membership_id='org-1_stu-1', sql_engine=engine,
        )
        self.assertIs(db.create_kwargs['sql_engine'], engine)

    @patch('backend.services.lti.identity._firestore')
    def test_no_engine_means_no_shadow(self, mock_fs):
        mock_fs.ArrayUnion = MagicMock(return_value=['class-1'])
        mock_fs.SERVER_TIMESTAMP = 'TS'
        db = _FakeIdentityDb(enrollment_status='inactive')
        with patch('backend.db.dual_write.shadow_lti_reactivate') as shadow:
            self.identity.auto_enroll_student(
                db, uid='stu-1', org_id='org-1', class_id='class-1',
                membership_id='org-1_stu-1',
            )
        shadow.assert_not_called()


if __name__ == '__main__':
    unittest.main()
