"""Tier 1 (no DB): the parent-chain dual-write seam (slice 2c-1, organizations).

Runs in `make test-backend`. Covers flag gating, sentinel stripping, the
create-vs-targeted-UPDATE split (create reuses upsert_organization; suspend/
restore issue a targeted UPDATE that must NOT clobber stable fields), and the
wiring through database.py. Rows actually landing through real DDL is the gated
Tier-2 companion (test_dual_write_school_chain_pg.py).
"""

from __future__ import annotations

import os
import unittest
import uuid
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import postgresql

from backend.db import dual_write_school_chain as sc

FLAG = 'DUAL_WRITE_SCHOOL_CHAIN'


class _FakeResult:
    def scalar_one_or_none(self):
        return None


class _FakeSession:
    def __init__(self):
        self.executed = []
        self.committed = False
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True
        return False

    def execute(self, statement, *a, **k):
        self.executed.append(statement)
        return _FakeResult()

    def commit(self):
        self.committed = True

    def flush(self):
        pass


class _FlagMixin(unittest.TestCase):
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


def _capture_run():
    captured = {}

    def fake_run(sql_engine, op_name, fn):
        captured['op'] = op_name
        session = _FakeSession()
        fn(session)
        captured['session'] = session

    return captured, fake_run


def _update_params(session):
    """Compile the captured UPDATE and return (sql_text, bound_params)."""
    stmt = session.executed[0]
    compiled = stmt.compile(dialect=postgresql.dialect())
    return str(compiled), compiled.params


class TestGate(_FlagMixin):
    def test_enabled_reads_env_each_call(self):
        self._off()
        self.assertFalse(sc._enabled_school_chain())
        self._on()
        self.assertTrue(sc._enabled_school_chain())
        for v in ('true', 'yes', '0', '', 'TRUE'):
            os.environ[FLAG] = v
            self.assertFalse(sc._enabled_school_chain(), v)

    def test_create_noop_when_flag_off(self):
        self._off()
        with patch.object(sc, '_run', side_effect=AssertionError('must not run')):
            sc.shadow_create_organization(lambda: object(), org_id='o1', org_data={'name': 'A'})

    def test_suspend_noop_when_flag_off(self):
        self._off()
        with patch.object(sc, '_run', side_effect=AssertionError('must not run')):
            sc.shadow_suspend_organization(
                lambda: object(), org_id='o1', actor_uid='admin', reason='x', suspended_until=None
            )

    def test_flag_on_engine_none_is_noop(self):
        # Reaches _run (real), which resolves the provider to None and returns.
        self._on()
        with patch('sqlalchemy.orm.Session', side_effect=AssertionError('must not open')):
            sc.shadow_restore_organization(lambda: None, org_id='o1', actor_uid='admin')


class TestStripSentinels(_FlagMixin):
    def test_strips_server_timestamp_sentinels(self):
        class _Sentinel:  # mimics firestore.SERVER_TIMESTAMP's type name
            pass
        _Sentinel.__name__ = 'Sentinel'
        doc = {'name': 'A', 'created_at': _Sentinel(), 'status': 'active'}
        cleaned = sc._strip_sentinels(doc)
        self.assertEqual(cleaned['name'], 'A')
        self.assertEqual(cleaned['status'], 'active')
        self.assertIsNone(cleaned['created_at'])


class TestShadowCreateOrganization(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_builds_doc_with_id_and_strips_sentinels(self):
        captured, fake_run = _capture_run()
        seen = {}

        class _Sentinel:
            pass
        _Sentinel.__name__ = 'Sentinel'

        org_data = {
            'name': 'Springfield High', 'name_lower': 'springfield high',
            'type': 'school', 'status': 'active', 'pilot_stage': 'beta',
            'created_at': _Sentinel(), 'updated_at': _Sentinel(),
        }
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.backfill.upsert_organization',
            lambda s, doc: seen.update(doc),
        ):
            sc.shadow_create_organization(lambda: object(), org_id='org1', org_data=org_data)
        self.assertEqual(captured['op'], 'create_organization')
        self.assertEqual(seen['id'], 'org1')
        self.assertEqual(seen['name'], 'Springfield High')
        self.assertEqual(seen['type'], 'school')
        self.assertIsNone(seen['created_at'])  # sentinel neutralized
        self.assertIsNone(seen['updated_at'])


class TestShadowSuspendRestore(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_suspend_targeted_update_sets_only_suspension_fields(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run):
            sc.shadow_suspend_organization(
                lambda: object(), org_id='org1', actor_uid='admin-1',
                reason='policy violation', suspended_until=None,
            )
        sql, params = _update_params(captured['session'])
        self.assertIn('UPDATE organizations', sql)
        self.assertEqual(params['status'], 'suspended')
        self.assertEqual(params['suspended_by_firebase_uid'], 'admin-1')
        self.assertEqual(params['suspend_reason'], 'policy violation')
        # Stable fields must NOT be in the SET clause (no clobber).
        self.assertNotIn('name', params)
        self.assertNotIn('type', params)
        # Keyed by the Firestore doc id.
        self.assertIn('org1', params.values())

    def test_restore_targeted_update_clears_suspension_fields(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run):
            sc.shadow_restore_organization(lambda: object(), org_id='org1', actor_uid='admin-1')
        sql, params = _update_params(captured['session'])
        self.assertIn('UPDATE organizations', sql)
        self.assertEqual(params['status'], 'active')
        self.assertIsNone(params['suspended_at'])
        self.assertIsNone(params['suspended_by_firebase_uid'])
        self.assertIsNone(params['suspend_reason'])
        self.assertEqual(params['restored_by_firebase_uid'], 'admin-1')


class TestShadowMembership(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_create_builds_doc_with_id(self):
        captured, fake_run = _capture_run()
        seen = {}
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.backfill.upsert_membership', lambda s, doc: seen.update(doc)
        ):
            sc.shadow_create_membership(
                lambda: object(), membership_id='org1_uidA',
                membership_data={'org_id': 'org1', 'uid': 'uidA', 'roles': ['student'], 'status': 'active'},
            )
        self.assertEqual(captured['op'], 'create_membership')
        self.assertEqual(seen['id'], 'org1_uidA')
        self.assertEqual(seen['org_id'], 'org1')
        self.assertEqual(seen['uid'], 'uidA')

    def test_create_noop_when_flag_off(self):
        self._off()
        with patch.object(sc, '_run', side_effect=AssertionError('must not run')):
            sc.shadow_create_membership(lambda: object(), membership_id='m', membership_data={})

    def test_remove_targeted_update_sets_only_removal_fields(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run):
            sc.shadow_remove_membership(lambda: object(), membership_id='org1_uidA', actor_uid='admin-1')
        sql, params = _update_params(captured['session'])
        self.assertIn('UPDATE memberships', sql)
        self.assertEqual(params['status'], 'removed')
        self.assertEqual(params['removed_by_firebase_uid'], 'admin-1')
        # Stable fields must NOT be clobbered.
        self.assertNotIn('roles', params)
        self.assertNotIn('firebase_uid', params)
        self.assertIn('org1_uidA', params.values())


class TestShadowClassAndPrimary(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_create_class_builds_doc_with_id(self):
        captured, fake_run = _capture_run()
        seen = {}
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.backfill.upsert_class', lambda s, doc: seen.update(doc)
        ):
            sc.shadow_create_class(
                lambda: object(), class_id='class1',
                class_data={'org_id': 'org1', 'name': 'Spanish I', 'learning_locale': 'es-ES'},
            )
        self.assertEqual(captured['op'], 'create_class')
        self.assertEqual(seen['id'], 'class1')
        self.assertEqual(seen['org_id'], 'org1')

    def test_add_primary_class_array_append_when_class_resolves(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id', lambda s, m, fid: uuid.uuid4()
        ):
            sc.shadow_add_primary_class(lambda: object(), membership_id='org1_uidA', class_id='class1')
        sql, _params = _update_params(captured['session'])
        self.assertIn('UPDATE memberships', sql)
        self.assertIn('array_append', sql.lower())

    def test_add_primary_class_noop_when_class_unresolved(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id', lambda s, m, fid: None
        ):
            sc.shadow_add_primary_class(lambda: object(), membership_id='org1_uidA', class_id='ghost')
        self.assertEqual(captured['session'].executed, [])

    def test_remove_primary_class_array_remove(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run), patch(
            'backend.db.repository.resolution.resolve_legacy_id', lambda s, m, fid: uuid.uuid4()
        ):
            sc.shadow_remove_primary_class(lambda: object(), membership_id='org1_uidA', class_id='class1')
        sql, _params = _update_params(captured['session'])
        self.assertIn('array_remove', sql.lower())


class TestShadowInviteCode(_FlagMixin):
    def setUp(self):
        super().setUp()
        self._on()

    def test_update_invite_code_targeted(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run):
            sc.shadow_update_org_invite_code(lambda: object(), org_id='org1', code='ABC123')
        sql, params = _update_params(captured['session'])
        self.assertIn('UPDATE organizations', sql)
        self.assertEqual(params['teacher_invite_code'], 'ABC123')
        self.assertEqual(params['teacher_invite_code_active'], True)
        self.assertNotIn('name', params)

    def test_deactivate_invite_code_targeted(self):
        captured, fake_run = _capture_run()
        with patch.object(sc, '_run', fake_run):
            sc.shadow_deactivate_org_invite_code(lambda: object(), org_id='org1')
        sql, params = _update_params(captured['session'])
        self.assertIn('UPDATE organizations', sql)
        self.assertEqual(params['teacher_invite_code_active'], False)


class _FakeBatch:
    def update(self, *a, **k):
        pass

    def set(self, *a, **k):
        pass

    def commit(self):
        pass


class _FakeClient:
    def batch(self):
        return _FakeBatch()

    def collection(self, *a, **k):
        return MagicMock()


class TestDatabaseWiring(_FlagMixin):
    """database.py parent-chain helpers shadow only when sql_engine is passed."""

    def setUp(self):
        super().setUp()
        import database
        self.database = database
        self._ref = MagicMock()
        self._ref.id = 'org1'

    def test_create_org_shadows_when_engine_passed(self):
        with patch.object(self.database, 'get_organization_ref', return_value=self._ref), patch(
            'backend.db.dual_write_school_chain.shadow_create_organization'
        ) as shadow:
            self.database.create_organization('Springfield', org_id='org1', sql_engine=lambda: object())
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['org_id'], 'org1')

    def test_create_org_no_shadow_without_engine(self):
        with patch.object(self.database, 'get_organization_ref', return_value=self._ref), patch(
            'backend.db.dual_write_school_chain.shadow_create_organization'
        ) as shadow:
            self.database.create_organization('Springfield', org_id='org1')
        shadow.assert_not_called()

    def test_create_membership_shadows_when_engine_passed(self):
        ref = MagicMock()
        ref.id = 'o1_u1'
        with patch.object(self.database, 'get_membership_ref', return_value=ref), patch(
            'backend.db.dual_write_school_chain.shadow_create_membership'
        ) as shadow:
            self.database.create_membership(
                org_id='o1', uid='u1', roles=['student'], membership_id='o1_u1',
                sql_engine=lambda: object(),
            )
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['membership_id'], 'o1_u1')

    def test_create_membership_no_shadow_without_engine(self):
        ref = MagicMock()
        ref.id = 'o1_u1'
        with patch.object(self.database, 'get_membership_ref', return_value=ref), patch(
            'backend.db.dual_write_school_chain.shadow_create_membership'
        ) as shadow:
            self.database.create_membership(org_id='o1', uid='u1', roles=['student'], membership_id='o1_u1')
        shadow.assert_not_called()

    def test_remove_membership_shadows_when_engine_passed(self):
        m = {'id': 'o1_u1', 'status': 'active', 'roles': ['teacher'], 'org_id': 'o1', 'uid': 'u1'}
        with patch.object(self.database, 'get_membership', return_value=m), patch.object(
            self.database, 'get_db', return_value=_FakeClient()
        ), patch.object(self.database, 'get_membership_ref', return_value=MagicMock()), patch(
            'backend.db.dual_write_school_chain.shadow_remove_membership'
        ) as shadow:
            self.database.remove_membership(
                membership_id='o1_u1', actor_uid='admin-1',
                audit_entry={'a': 1}, sql_engine=lambda: object(),
            )
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['membership_id'], 'o1_u1')

    def test_create_class_shadows_when_engine_passed(self):
        ref = MagicMock()
        ref.id = 'class1'
        with patch.object(self.database, 'get_class_ref', return_value=ref), patch(
            'backend.db.dual_write_school_chain.shadow_create_class'
        ) as shadow:
            self.database.create_class('o1', 'Spanish I', class_id='class1', sql_engine=lambda: object())
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['class_id'], 'class1')

    def test_add_primary_class_shadows_when_engine_passed(self):
        with patch.object(self.database, 'get_membership_ref', return_value=MagicMock()), patch(
            'backend.db.dual_write_school_chain.shadow_add_primary_class'
        ) as shadow:
            self.database.add_primary_class_to_membership('o1_u1', 'class1', sql_engine=lambda: object())
        shadow.assert_called_once()

    def test_lti_bypass_calls_shadow_add_primary_class(self):
        from backend.services.lti import identity

        class _Db:
            def get_membership(self, mid):
                return {'id': mid, 'primary_class_ids': []}  # class not yet present

            def get_membership_ref(self, mid):
                return MagicMock()

            def get_student_class_enrollment(self, class_id, uid):
                return {'id': f'{class_id}_{uid}', 'status': 'active'}  # short-circuits enrollment create

        with patch('backend.services.lti.identity._firestore') as mock_fs, patch(
            'backend.db.dual_write_school_chain.shadow_add_primary_class'
        ) as shadow:
            mock_fs.ArrayUnion = MagicMock(return_value=['class-1'])
            mock_fs.SERVER_TIMESTAMP = 'TS'
            identity.auto_enroll_student(
                _Db(), uid='u1', org_id='o1', class_id='class-1',
                membership_id='o1_u1', sql_engine=lambda: object(),
            )
        shadow.assert_called_once()
        self.assertEqual(shadow.call_args.kwargs['class_id'], 'class-1')


if __name__ == '__main__':
    unittest.main()
