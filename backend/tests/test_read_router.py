"""Tier 1 (no DB): read-cutover router + organizations read adapter.

Verifies the 3-state per-entity routing (off / shadow / '1'), fail-open,
pass-through, the shadow parity diff helpers, and the org serializer's
Firestore-shape (the suspended_by_uid inverse rename, school_admin_uids
omission). The PG Session is stubbed via _pg_read so no engine is needed.
"""

import datetime
import os
import types
import unittest
import uuid
from unittest import mock

from backend.db import read_router
from backend.db.read_router import ReadRouter, _diff, _diff_dict, _diff_list, _norm
from backend.db.models.org import Organization
from backend.db.repository import organizations_read


_FLAG = 'READ_PG_ORGANIZATIONS'


def _clear_flag():
    os.environ.pop(_FLAG, None)


class TestDiffHelpers(unittest.TestCase):
    def test_norm_collapses_empties_and_isoformats_datetimes(self):
        self.assertIsNone(_norm(None))
        self.assertIsNone(_norm(''))
        self.assertIsNone(_norm([]))
        ts = datetime.datetime(2026, 1, 2, 3, 4, 5)
        self.assertEqual(_norm(ts), ts.isoformat())
        self.assertEqual(_norm('x'), 'x')

    def test_diff_dict_ignores_allowlisted_and_loose_empties(self):
        fs = {'name': 'A', 'city': '', 'school_admin_uids': ['u1'], 'status': 'active'}
        pg = {'name': 'A', 'city': None, 'status': 'active'}  # no school_admin_uids
        # school_admin_uids ignored; '' vs None equal -> no diff
        self.assertEqual(_diff_dict(fs, pg, frozenset({'school_admin_uids'})), {})

    def test_diff_dict_reports_real_mismatch(self):
        diff = _diff_dict({'status': 'active'}, {'status': 'suspended'}, frozenset())
        self.assertEqual(diff, {'status': ('active', 'suspended')})

    def test_diff_dict_presence_mismatch(self):
        self.assertIn('<presence>', _diff_dict({'a': 1}, None, frozenset()))
        self.assertEqual(_diff_dict(None, None, frozenset()), {})

    def test_diff_list_set_by_id(self):
        fs = [{'id': 'a'}, {'id': 'b'}]
        pg = [{'id': 'a'}, {'id': 'c'}]
        out = _diff_list(fs, pg, frozenset())
        self.assertEqual(out['missing_in_pg'], ['b'])
        self.assertEqual(out['extra_in_pg'], ['c'])

    def test_diff_dispatches_on_type(self):
        self.assertEqual(_diff([{'id': 'a'}], [{'id': 'a'}], frozenset()), {})
        self.assertEqual(_diff({'k': 1}, {'k': 1}, frozenset()), {})


class TestPassthrough(unittest.TestCase):
    def test_unknown_attr_and_constants_proxy_to_firestore(self):
        fs = types.SimpleNamespace(
            ALLOWED_ORG_TYPES={'school'},
            create_enrollment=lambda **k: 'wrote',
        )
        r = ReadRouter(fs, sql_engine=lambda: None)
        self.assertEqual(r.ALLOWED_ORG_TYPES, {'school'})        # module constant
        self.assertEqual(r.create_enrollment(class_id='c'), 'wrote')  # write method


class TestRouting(unittest.TestCase):
    def setUp(self):
        _clear_flag()
        self.addCleanup(_clear_flag)
        read_router._shadow_stats.clear()  # per-process counter is module-global
        self.addCleanup(read_router._shadow_stats.clear)
        # provider returns a truthy fake engine so _resolve_engine yields non-None
        self.router = ReadRouter(types.SimpleNamespace(), sql_engine=lambda: object())

    def _route(self, fs_call, pg_call):
        return self.router._route_read(_FLAG, fs_call, pg_call)

    def test_off_returns_firestore_without_touching_pg(self):
        pg_called = []
        out = self._route(lambda: {'src': 'fs'}, lambda s: pg_called.append(1))
        self.assertEqual(out, {'src': 'fs'})
        self.assertEqual(pg_called, [])  # pg_call never invoked when flag off

    def test_shadow_returns_firestore_but_runs_pg_compare(self):
        os.environ[_FLAG] = 'shadow'
        seen = []
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: pc('SESS')):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = self._route(lambda: {'id': 'o1', 'v': 1},
                                 lambda s: seen.append(s) or {'id': 'o1', 'v': 2})
        self.assertEqual(out, {'id': 'o1', 'v': 1})   # Firestore authoritative
        self.assertEqual(seen, ['SESS'])              # PG read ran for the compare
        self.assertTrue(any('MISMATCH' in m and "'v': (1, 2)" in m for m in cm.output))
        self.assertEqual(read_router._shadow_stats[_FLAG], [1, 1])  # 1 compared, 1 mismatched

    def test_shadow_clean_compare_logs_positive_first_signal(self):
        os.environ[_FLAG] = 'shadow'
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: {'id': 'o1', 'v': 1}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = self._route(lambda: {'id': 'o1', 'v': 1}, lambda s: {'id': 'o1', 'v': 1})
        self.assertEqual(out, {'id': 'o1', 'v': 1})
        # a CLEAN compare still emits the positive "shadow is running" summary:
        self.assertTrue(any('1 compared, 0 mismatched' in m for m in cm.output))
        self.assertEqual(read_router._shadow_stats[_FLAG], [1, 0])

    def test_shadow_pg_error_is_swallowed_returns_firestore(self):
        os.environ[_FLAG] = 'shadow'

        def boom(self, pc, eng):
            raise RuntimeError('pg down')

        with mock.patch.object(ReadRouter, '_pg_read', boom):
            out = self._route(lambda: {'src': 'fs'}, lambda s: {'src': 'pg'})
        self.assertEqual(out, {'src': 'fs'})

    def test_cutover_returns_postgres(self):
        os.environ[_FLAG] = '1'
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: pc('SESS')):
            out = self._route(lambda: {'src': 'fs'}, lambda s: {'src': 'pg'})
        self.assertEqual(out, {'src': 'pg'})

    def test_cutover_fails_open_to_firestore_on_pg_error(self):
        os.environ[_FLAG] = '1'

        def boom(self, pc, eng):
            raise RuntimeError('pg down')

        with mock.patch.object(ReadRouter, '_pg_read', boom):
            out = self._route(lambda: {'src': 'fs'}, lambda s: {'src': 'pg'})
        self.assertEqual(out, {'src': 'fs'})

    def test_no_engine_falls_back_to_firestore_even_when_flag_on(self):
        os.environ[_FLAG] = '1'
        router = ReadRouter(types.SimpleNamespace(), sql_engine=lambda: None)
        pg_called = []
        out = router._route_read(
            _FLAG, lambda: {'src': 'fs'}, lambda s: pg_called.append(1)
        )
        self.assertEqual(out, {'src': 'fs'})
        self.assertEqual(pg_called, [])

    def test_get_organization_override_routes_through_firestore_when_off(self):
        fs = types.SimpleNamespace(get_organization=lambda oid: {'id': oid, 'src': 'fs'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_organization('org-1'), {'id': 'org-1', 'src': 'fs'})


def _make_org(**overrides):
    org = Organization()
    org.id = overrides.get('id', uuid.uuid4())
    org.legacy_firestore_id = overrides.get('legacy_firestore_id', 'org-fs-1')
    org.name = overrides.get('name', 'Test School')
    org.name_lower = overrides.get('name_lower', 'test school')
    org.type = overrides.get('type', 'school')
    org.status = overrides.get('status', 'active')
    org.pilot_stage = overrides.get('pilot_stage', None)
    org.lms_capabilities = overrides.get('lms_capabilities', [])
    org.default_modality_policy = overrides.get('default_modality_policy', 'hybrid')
    org.default_retention_policy = overrides.get('default_retention_policy', 'standard_school')
    org.school_type = overrides.get('school_type', 'public')
    org.country = overrides.get('country', 'US')
    org.state = overrides.get('state', 'NY')
    org.county = overrides.get('county', None)
    org.city = overrides.get('city', None)
    org.website_url = overrides.get('website_url', None)
    org.public_or_private = overrides.get('public_or_private', None)
    org.grade_size = overrides.get('grade_size', None)
    org.teacher_invite_code = overrides.get('teacher_invite_code', None)
    org.teacher_invite_code_active = overrides.get('teacher_invite_code_active', False)
    org.teacher_invite_code_generated_at = overrides.get('teacher_invite_code_generated_at', None)
    org.last_activity_at = overrides.get('last_activity_at', None)
    org.suspended_at = overrides.get('suspended_at', None)
    org.suspended_by_firebase_uid = overrides.get('suspended_by_firebase_uid', None)
    org.suspend_reason = overrides.get('suspend_reason', None)
    org.suspended_until = overrides.get('suspended_until', None)
    org.restored_at = overrides.get('restored_at', None)
    org.restored_by_firebase_uid = overrides.get('restored_by_firebase_uid', None)
    org.created_at = overrides.get('created_at', datetime.datetime(2026, 5, 30))
    org.updated_at = overrides.get('updated_at', datetime.datetime(2026, 5, 30))
    return org


class _FakeOrgResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _FakeOrgSession:
    def __init__(self, row):
        self._row = row

    def execute(self, stmt):
        return _FakeOrgResult(self._row)


class TestOrganizationsReadAdapter(unittest.TestCase):
    def test_serialize_uses_legacy_id_and_inverse_renames(self):
        org = _make_org(
            legacy_firestore_id='org-fs-1',
            suspended_by_firebase_uid='admin-uid',
            restored_by_firebase_uid='restorer-uid',
        )
        out = organizations_read._serialize(org)
        self.assertEqual(out['id'], 'org-fs-1')
        # PG *_firebase_uid columns serialize back to the Firestore *_uid keys:
        self.assertEqual(out['suspended_by_uid'], 'admin-uid')
        self.assertEqual(out['restored_by_uid'], 'restorer-uid')
        self.assertNotIn('suspended_by_firebase_uid', out)
        self.assertNotIn('restored_by_firebase_uid', out)

    def test_serialize_omits_derived_school_admin_uids(self):
        out = organizations_read._serialize(_make_org())
        self.assertNotIn('school_admin_uids', out)

    def test_serialize_full_shape_for_suspended_gate_and_compliance(self):
        org = _make_org(status='suspended', suspend_reason='policy', default_retention_policy='strict')
        out = organizations_read._serialize(org)
        # fields the fail-closed suspended-org gate + compliance retention read:
        self.assertEqual(out['status'], 'suspended')
        self.assertEqual(out['suspend_reason'], 'policy')
        self.assertEqual(out['default_retention_policy'], 'strict')

    def test_get_organization_found_and_missing(self):
        org = _make_org(legacy_firestore_id='org-fs-1')
        self.assertEqual(
            organizations_read.get_organization(_FakeOrgSession(org), 'org-fs-1')['id'],
            'org-fs-1',
        )
        self.assertIsNone(
            organizations_read.get_organization(_FakeOrgSession(None), 'ghost')
        )


if __name__ == '__main__':
    unittest.main()
