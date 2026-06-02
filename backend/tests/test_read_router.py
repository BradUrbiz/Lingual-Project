"""Tier 1 (no DB): read-cutover router + organizations/memberships read adapters.

Verifies the 3-state per-entity routing (off / shadow / '1'), fail-open,
pass-through, the shadow parity diff helpers, and the serializers' Firestore-shape
(the *_uid inverse renames, school_admin_uids omission, the membership org-JOIN
enrichment + primary_class_ids UUID->legacy translation). The PG Session is stubbed
via _pg_read / fake sessions so no engine is needed.
"""

import datetime
import os
import types
import unittest
import uuid
from unittest import mock

from backend.db import read_router
from backend.db.read_router import ReadRouter, _diff, _diff_dict, _diff_list, _norm
from backend.db.models.assignment import Assignment
from backend.db.models.org import Class, Enrollment, Membership, Organization
from backend.db.repository import (
    assignments_read,
    classes_read,
    enrollments,
    memberships_read,
    organizations_read,
)


_FLAG = 'READ_PG_ORGANIZATIONS'


def _clear_flag():
    os.environ.pop(_FLAG, None)


class TestDiffHelpers(unittest.TestCase):
    def test_norm_collapses_empties_and_isoformats_datetimes(self):
        self.assertIsNone(_norm(None))
        self.assertIsNone(_norm(''))
        self.assertIsNone(_norm([]))
        # PG NOT-NULL boolean default vs Firestore-absent: False collapses to None
        self.assertIsNone(_norm(False))
        # but meaningful values are preserved (incl. a real 0, not collapsed):
        self.assertIs(_norm(True), True)
        self.assertEqual(_norm(0), 0)
        ts = datetime.datetime(2026, 1, 2, 3, 4, 5)
        self.assertEqual(_norm(ts), ts.isoformat())
        self.assertEqual(_norm('x'), 'x')

    def test_diff_treats_pg_default_false_as_firestore_absent(self):
        # the exact divergence the first shadow soak surfaced: fs None vs pg False
        self.assertEqual(
            _diff_dict({'teacher_invite_code_active': None},
                       {'teacher_invite_code_active': False}, frozenset()),
            {},
        )
        # True vs None is still a real mismatch (dual-write bug not masked):
        self.assertIn(
            'teacher_invite_code_active',
            _diff_dict({'teacher_invite_code_active': True},
                       {'teacher_invite_code_active': None}, frozenset()),
        )

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

    def test_diff_scalar_counts(self):
        # a COUNT reader returns an int — must not crash the dict path
        self.assertEqual(_diff(5, 5, frozenset()), {})
        self.assertEqual(_diff(5, 6, frozenset()), {'<value>': (5, 6)})


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

    def test_list_organizations_shadow_compares_items_by_id(self):
        os.environ[_FLAG] = 'shadow'
        fs_result = {'items': [{'id': 'a'}, {'id': 'b'}], 'next_cursor': None}
        pg_result = {'items': [{'id': 'a'}, {'id': 'c'}], 'next_cursor': {'x': 1}}
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: pg_result):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = self.router._route_read(
                    _FLAG, lambda: fs_result, lambda s: pg_result,
                    extract=lambda r: (r or {}).get('items', []))
        self.assertEqual(out, fs_result)  # Firestore returned unchanged (incl. next_cursor)
        # extract -> items diffed by id: 'b' missing in pg, 'c' extra in pg
        joined = ' '.join(cm.output)
        self.assertIn('missing_in_pg', joined)
        self.assertIn("'b'", joined)
        self.assertIn("'c'", joined)

    def test_new_org_overrides_passthrough_when_off(self):
        # signatures must match the Firestore readers so flag-OFF is transparent
        fs = types.SimpleNamespace(
            get_org_by_teacher_invite_code=lambda c: {'id': 'o', 'code': c},
            search_organizations=lambda q, limit=10: [{'id': 'o', 'q': q, 'limit': limit}],
            count_organizations_by_status=lambda s: 7,
        )
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_org_by_teacher_invite_code('X')['code'], 'X')
        self.assertEqual(router.search_organizations('a', limit=3)[0], {'id': 'o', 'q': 'a', 'limit': 3})
        self.assertEqual(router.count_organizations_by_status('active'), 7)


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


class _FlexResult:
    def __init__(self, *, scalar_one=None, first=None, all_=None):
        self._scalar_one = scalar_one
        self._first = first
        self._all = all_ or []

    def scalar_one(self):
        return self._scalar_one

    def scalars(self):
        return self

    def first(self):
        return self._first

    def all(self):
        return self._all


class _FlexSession:
    def __init__(self, result):
        self._r = result

    def execute(self, stmt):
        return self._r


class _ListResult:
    """Serves both `.scalars().all()` (org rows) and `.all()` (admin tuples)."""
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


class _ListSession:
    """1st execute -> org rows; 2nd -> (org_uuid, uid) admin tuples."""
    def __init__(self, org_rows, admin_rows):
        self._org_rows = org_rows
        self._admin_rows = admin_rows
        self._n = 0

    def execute(self, stmt):
        self._n += 1
        return _ListResult(self._org_rows if self._n == 1 else self._admin_rows)


class TestListOrganizationsAdapter(unittest.TestCase):
    def test_items_cursor_and_derived_admin_uids(self):
        o1 = _make_org(legacy_firestore_id='o1', name='Alpha', name_lower='alpha')
        o2 = _make_org(legacy_firestore_id='o2', name='Beta', name_lower='beta')
        admin = [(o1.id, 'sa1'), (o1.id, 'sa2')]  # o1 has two school admins, o2 none
        out = organizations_read.list_organizations(_ListSession([o1, o2], admin), limit=2)
        self.assertEqual([i['id'] for i in out['items']], ['o1', 'o2'])
        self.assertEqual(out['items'][0]['school_admin_uids'], ['sa1', 'sa2'])
        self.assertEqual(out['items'][1]['school_admin_uids'], [])
        # the documented quirk: a full page (len == limit) always sets the cursor
        self.assertEqual(out['next_cursor'], {'name_lower': 'beta', 'id': 'o2'})

    def test_partial_page_has_no_cursor(self):
        o1 = _make_org(legacy_firestore_id='o1', name_lower='alpha')
        out = organizations_read.list_organizations(_ListSession([o1], []), limit=25)
        self.assertIsNone(out['next_cursor'])


class TestOrganizationsReadMoreAdapters(unittest.TestCase):
    def test_invite_code_found_and_missing(self):
        org = _make_org(legacy_firestore_id='org-fs-1')
        self.assertEqual(
            organizations_read.get_org_by_teacher_invite_code(
                _FlexSession(_FlexResult(first=org)), 'ABC')['id'],
            'org-fs-1',
        )
        self.assertIsNone(
            organizations_read.get_org_by_teacher_invite_code(
                _FlexSession(_FlexResult(first=None)), 'nope')
        )

    def test_search_returns_slim_projection(self):
        a = _make_org(legacy_firestore_id='o1', name='Alpha', city='NYC', state='NY', school_type='public')
        b = _make_org(legacy_firestore_id='o2', name='Alphabet')
        out = organizations_read.search_organizations(_FlexSession(_FlexResult(all_=[a, b])), 'alph')
        self.assertEqual([r['id'] for r in out], ['o1', 'o2'])
        self.assertEqual(set(out[0].keys()), {'id', 'name', 'city', 'state', 'school_type'})
        self.assertEqual(out[0]['city'], 'NYC')

    def test_search_empty_query_short_circuits(self):
        self.assertEqual(organizations_read.search_organizations(None, '   '), [])

    def test_count_returns_int(self):
        self.assertEqual(
            organizations_read.count_organizations_by_status(
                _FlexSession(_FlexResult(scalar_one=42)), 'active'),
            42,
        )


def _make_membership(**o):
    m = Membership()
    m.id = o.get('id', uuid.uuid4())
    m.legacy_firestore_id = o.get('legacy_firestore_id', 'mem-1')
    m.org_id = o.get('org_id', uuid.uuid4())
    m.firebase_uid = o.get('firebase_uid', 'user-1')
    m.roles = o.get('roles', ['teacher'])
    m.status = o.get('status', 'active')
    m.primary_class_ids = o.get('primary_class_ids', [])
    m.removed_at = o.get('removed_at', None)
    m.removed_by_firebase_uid = o.get('removed_by_firebase_uid', None)
    m.created_at = o.get('created_at', datetime.datetime(2026, 5, 30))
    m.updated_at = o.get('updated_at', datetime.datetime(2026, 5, 30))
    return m


class _SeqResult:
    """One execute() result exposing .one_or_none(), .scalar_one_or_none(),
    .scalar_one(), .scalars() and .all() — the surface the read adapters use."""
    def __init__(self, rows):
        self._rows = rows

    def one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalar_one(self):
        return self._rows[0] if self._rows else None

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _SeqSession:
    """Returns queued results in order across successive execute() calls (the
    membership adapters issue the row query first, then the class-id map query)."""
    def __init__(self, *results):
        self._results = list(results)
        self._n = 0

    def execute(self, stmt):
        r = self._results[self._n] if self._n < len(self._results) else _SeqResult([])
        self._n += 1
        return r


class TestMembershipsReadAdapter(unittest.TestCase):
    def test_get_membership_inverse_renames_and_legacy_ids(self):
        m = _make_membership(
            legacy_firestore_id='mem-7', firebase_uid='u-1',
            removed_by_firebase_uid='admin-9', primary_class_ids=[],
        )
        sess = _SeqSession(_SeqResult([(m, 'org-fs-1')]))  # no class query (empty ids)
        out = memberships_read.get_membership(sess, 'mem-7')
        self.assertEqual(out['id'], 'mem-7')
        self.assertEqual(out['org_id'], 'org-fs-1')      # org UUID FK -> legacy id
        self.assertEqual(out['uid'], 'u-1')              # firebase_uid -> uid
        self.assertEqual(out['removed_by_uid'], 'admin-9')  # *_firebase_uid -> *_uid
        self.assertNotIn('firebase_uid', out)
        self.assertEqual(out['primary_class_ids'], [])

    def test_get_membership_translates_primary_class_ids_in_order(self):
        ua, ub = uuid.uuid4(), uuid.uuid4()
        m = _make_membership(primary_class_ids=[ua, ub])
        sess = _SeqSession(
            _SeqResult([(m, 'org-fs-1')]),
            _SeqResult([(ub, 'cls-b'), (ua, 'cls-a')]),  # map returns out of order
        )
        out = memberships_read.get_membership(sess, 'mem-1')
        self.assertEqual(out['primary_class_ids'], ['cls-a', 'cls-b'])  # array order preserved

    def test_get_membership_missing_returns_none(self):
        self.assertIsNone(memberships_read.get_membership(_SeqSession(_SeqResult([])), 'ghost'))

    def test_get_user_memberships_enriches_and_sorts_by_role(self):
        teacher = _make_membership(legacy_firestore_id='m-t', roles=['teacher'])
        admin = _make_membership(legacy_firestore_id='m-a', roles=['school_admin'])
        rows = [
            (teacher, 'org-fs-1', 'Beta School', 'school'),
            (admin, 'org-fs-1', 'Beta School', 'school'),
        ]
        out = memberships_read.get_user_memberships(_SeqSession(_SeqResult(rows)), 'u-1')
        # school_admin (priority 0) sorts before teacher (priority 1):
        self.assertEqual([m['id'] for m in out], ['m-a', 'm-t'])
        self.assertEqual(out[0]['orgId'], 'org-fs-1')
        self.assertEqual(out[0]['orgName'], 'Beta School')
        self.assertEqual(out[0]['orgType'], 'school')
        self.assertEqual(out[0]['primaryClassIds'], [])

    def test_get_user_memberships_unresolved_class_uuid_falls_back_to_str(self):
        u = uuid.uuid4()
        m = _make_membership(legacy_firestore_id='m-1', primary_class_ids=[u])
        sess = _SeqSession(
            _SeqResult([(m, 'org-fs-1', 'Org', 'school')]),
            _SeqResult([]),  # class map empty -> uuid unresolved
        )
        out = memberships_read.get_user_memberships(sess, 'u-1')
        self.assertEqual(out[0]['primaryClassIds'], [str(u)])


class TestMembershipRouting(unittest.TestCase):
    def setUp(self):
        os.environ.pop('READ_PG_MEMBERSHIPS', None)
        self.addCleanup(lambda: os.environ.pop('READ_PG_MEMBERSHIPS', None))
        read_router._shadow_stats.clear()
        self.addCleanup(read_router._shadow_stats.clear)

    def test_overrides_passthrough_when_off(self):
        fs = types.SimpleNamespace(
            get_membership=lambda mid: {'id': mid, 'src': 'fs'},
            get_user_memberships=lambda uid: [{'id': 'm1', 'uid': uid}],
        )
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_membership('m1'), {'id': 'm1', 'src': 'fs'})
        self.assertEqual(router.get_user_memberships('u1')[0]['uid'], 'u1')

    def test_get_user_memberships_shadow_diffs_by_id_set(self):
        os.environ['READ_PG_MEMBERSHIPS'] = 'shadow'
        fs = types.SimpleNamespace(
            get_user_memberships=lambda uid: [{'id': 'm1'}, {'id': 'm2'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        # PG missing m2 -> the id-set diff (the role-guard parity) must surface it
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'm1'}]):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = router.get_user_memberships('u1')
        self.assertEqual(out, [{'id': 'm1'}, {'id': 'm2'}])  # Firestore authoritative
        joined = ' '.join(cm.output)
        self.assertIn('missing_in_pg', joined)
        self.assertIn("'m2'", joined)

    def test_get_membership_shadow_allowlists_deferred_primary_class_ids(self):
        os.environ['READ_PG_MEMBERSHIPS'] = 'shadow'
        fs = types.SimpleNamespace(
            get_membership=lambda mid: {'id': mid, 'roles': ['teacher'],
                                        'primary_class_ids': ['cls-a']})
        router = ReadRouter(fs, sql_engine=lambda: object())
        # PG returns [] for the deferred field — must NOT be flagged as a mismatch
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'm1', 'roles': ['teacher'], 'primary_class_ids': []},
        ):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_membership('m1')
        joined = ' '.join(cm.output)
        self.assertNotIn('MISMATCH', joined)            # allowlisted -> clean
        self.assertIn('1 compared, 0 mismatched', joined)


def _make_class(**o):
    c = Class()
    c.id = o.get('id', uuid.uuid4())
    c.legacy_firestore_id = o.get('legacy_firestore_id', 'cls-1')
    c.org_id = o.get('org_id', uuid.uuid4())
    c.name = o.get('name', 'Spanish I')
    c.term = o.get('term', 'Fall')
    c.subject = o.get('subject', 'Spanish')
    c.learning_locale = o.get('learning_locale', 'es-ES')
    c.grade_band = o.get('grade_band', '9-12')
    c.status = o.get('status', 'active')
    c.canvas_course_id = o.get('canvas_course_id', None)
    c.created_at = o.get('created_at', datetime.datetime(2026, 5, 30))
    c.updated_at = o.get('updated_at', datetime.datetime(2026, 5, 30))
    return c


class TestClassesReadAdapter(unittest.TestCase):
    def test_serialize_d2_org_legacy_and_no_code(self):
        out = classes_read._serialize_class(
            _make_class(legacy_firestore_id='cls-7'), 'org-fs-1', ['mem-a'], None)
        self.assertEqual(out['id'], 'cls-7')
        self.assertEqual(out['org_id'], 'org-fs-1')      # D2: legacy id, not the UUID
        self.assertEqual(out['teacher_membership_ids'], ['mem-a'])
        self.assertNotIn('join_code', out)               # no code -> Firestore omits

    def test_serialize_active_and_deactivated_code(self):
        active = classes_read._serialize_class(_make_class(), 'o', [], ('ABC123', True, None))
        self.assertEqual(active['join_code'], 'ABC123')
        self.assertIs(active['join_code_active'], True)
        # Firestore keeps join_code after deactivation -> still surfaced, flag False:
        dead = classes_read._serialize_class(_make_class(), 'o', [], ('XYZ789', False, None))
        self.assertEqual(dead['join_code'], 'XYZ789')
        self.assertIs(dead['join_code_active'], False)

    def test_get_class_hydrates_sorted_teachers_and_latest_code(self):
        c = _make_class(legacy_firestore_id='cls-1')
        sess = _SeqSession(
            _SeqResult([(c, 'org-fs-1')]),                  # main row + org legacy
            _SeqResult([(c.id, 'mem-2'), (c.id, 'mem-1')]),  # teachers (unsorted)
            _SeqResult([(c.id, 'ABC123', True, None)]),      # latest join code
        )
        out = classes_read.get_class(sess, 'cls-1')
        self.assertEqual(out['org_id'], 'org-fs-1')
        self.assertEqual(out['teacher_membership_ids'], ['mem-1', 'mem-2'])  # sorted
        self.assertEqual(out['join_code'], 'ABC123')

    def test_get_class_missing_returns_none(self):
        self.assertIsNone(classes_read.get_class(_SeqSession(_SeqResult([])), 'ghost'))

    def test_list_org_classes_hydrates_batch(self):
        c1 = _make_class(legacy_firestore_id='c1')
        c2 = _make_class(legacy_firestore_id='c2')
        sess = _SeqSession(
            _SeqResult([(c1, 'org-fs-1'), (c2, 'org-fs-1')]),  # main list
            _SeqResult([(c1.id, 'mem-1')]),                     # teachers (only c1)
            _SeqResult([(c2.id, 'XYZ', True, None)]),           # codes (only c2)
        )
        out = classes_read.list_org_classes(sess, 'org-fs-1')
        self.assertEqual([x['id'] for x in out], ['c1', 'c2'])
        self.assertEqual(out[0]['teacher_membership_ids'], ['mem-1'])
        self.assertEqual(out[1]['join_code'], 'XYZ')
        self.assertNotIn('join_code', out[0])

    def test_list_teacher_classes_resolves_then_hydrates(self):
        c = _make_class(legacy_firestore_id='c1')
        sess = _SeqSession(
            _SeqResult([uuid.uuid4()]),         # resolve_legacy_id(membership) -> UUID
            _SeqResult([(c, 'org-fs-1')]),      # main
            _SeqResult([(c.id, 'mem-1')]),      # teachers
            _SeqResult([]),                     # codes
        )
        out = classes_read.list_teacher_classes(sess, 'mem-1')
        self.assertEqual(out[0]['id'], 'c1')

    def test_list_teacher_classes_unresolved_membership_empty(self):
        self.assertEqual(classes_read.list_teacher_classes(_SeqSession(_SeqResult([])), 'ghost'), [])


class TestClassRouting(unittest.TestCase):
    def setUp(self):
        os.environ.pop('READ_PG_CLASSES', None)
        self.addCleanup(lambda: os.environ.pop('READ_PG_CLASSES', None))
        read_router._shadow_stats.clear()
        self.addCleanup(read_router._shadow_stats.clear)

    def test_overrides_passthrough_when_off(self):
        fs = types.SimpleNamespace(
            get_class=lambda cid: {'id': cid, 'src': 'fs'},
            list_org_classes=lambda oid, st='active': [{'id': 'c1', 'org': oid, 'st': st}],
            list_teacher_classes=lambda mid, st='active': [{'id': 'c1', 'm': mid}],
            get_class_by_join_code=lambda code: {'id': 'c1', 'code': code},
        )
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_class('c1'), {'id': 'c1', 'src': 'fs'})
        self.assertEqual(router.list_org_classes('o1', 'archived')[0]['st'], 'archived')
        self.assertEqual(router.list_teacher_classes('m1')[0]['m'], 'm1')
        self.assertEqual(router.get_class_by_join_code('ABC')['code'], 'ABC')

    def test_get_class_shadow_allowlists_clock_skew(self):
        os.environ['READ_PG_CLASSES'] = 'shadow'
        fs = types.SimpleNamespace(
            get_class=lambda cid: {'id': cid, 'org_id': 'o1', 'status': 'active',
                                   'updated_at': 'T1', 'join_code_generated_at': 'T1'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'c1', 'org_id': 'o1', 'status': 'active',
                                   'updated_at': 'T2', 'join_code_generated_at': 'T2'},
        ):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_class('c1')
        joined = ' '.join(cm.output)
        self.assertNotIn('MISMATCH', joined)             # timestamps allowlisted
        self.assertIn('1 compared, 0 mismatched', joined)

    def test_list_org_classes_shadow_diffs_by_id_set(self):
        os.environ['READ_PG_CLASSES'] = 'shadow'
        fs = types.SimpleNamespace(
            list_org_classes=lambda oid, st='active': [{'id': 'c1'}, {'id': 'c2'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'c1'}]):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = router.list_org_classes('o1')
        self.assertEqual(out, [{'id': 'c1'}, {'id': 'c2'}])  # Firestore authoritative
        joined = ' '.join(cm.output)
        self.assertIn('missing_in_pg', joined)
        self.assertIn("'c2'", joined)


def _make_enrollment(**o):
    e = Enrollment()
    e.id = o.get('id', uuid.uuid4())
    e.legacy_firestore_id = o.get('legacy_firestore_id', 'cls-1_stu-1')
    e.class_id = o.get('class_id', uuid.uuid4())
    e.student_firebase_uid = o.get('student_firebase_uid', 'stu-1')
    e.student_membership_id = o.get('student_membership_id', None)
    e.status = o.get('status', 'active')
    e.join_source = o.get('join_source', 'join_code')
    e.student_number = o.get('student_number', None)
    e.guardian_contact_required = o.get('guardian_contact_required', False)
    e.canvas_user_id = o.get('canvas_user_id', None)
    e.canvas_email = o.get('canvas_email', None)
    e.canvas_name = o.get('canvas_name', None)
    e.created_at = o.get('created_at', datetime.datetime(2026, 5, 30))
    e.updated_at = o.get('updated_at', datetime.datetime(2026, 5, 30))
    return e


class TestEnrollmentsReadAdapter(unittest.TestCase):
    def test_serialize_emits_parent_legacy_ids_not_uuids(self):
        # DEFECT D1: FKs serialize as the parents' Firestore doc ids (JOIN-supplied),
        # never the PG UUID — or get_class(enrollment['class_id']) silently misses.
        out = enrollments._serialize(
            _make_enrollment(legacy_firestore_id='cls-1_stu-1', student_firebase_uid='stu-1'),
            'cls-fs-1', 'mem-fs-1')
        self.assertEqual(out['id'], 'cls-1_stu-1')
        self.assertEqual(out['class_id'], 'cls-fs-1')             # legacy id, not str(uuid)
        self.assertEqual(out['student_membership_id'], 'mem-fs-1')
        self.assertEqual(out['student_uid'], 'stu-1')             # native Firebase uid
        self.assertEqual(out['status'], 'active')

    def test_serialize_null_membership_fk_stays_none(self):
        out = enrollments._serialize(_make_enrollment(), 'cls-fs-1', None)
        self.assertIsNone(out['student_membership_id'])           # matches Firestore

    def test_get_student_class_enrollment_found_and_missing(self):
        e = _make_enrollment(legacy_firestore_id='cls-1_stu-1')
        found = enrollments.get_student_class_enrollment(
            _SeqSession(_SeqResult([(e, 'cls-fs-1', None)])), uuid.uuid4(), 'stu-1')
        self.assertEqual(found['class_id'], 'cls-fs-1')
        self.assertIsNone(enrollments.get_student_class_enrollment(
            _SeqSession(_SeqResult([])), uuid.uuid4(), 'ghost'))

    def test_list_readers_serialize_each_row(self):
        rows = [(_make_enrollment(legacy_firestore_id='e1'), 'cls-a', None),
                (_make_enrollment(legacy_firestore_id='e2'), 'cls-b', 'mem-1')]
        out = enrollments.list_class_enrollments(_SeqSession(_SeqResult(rows)), uuid.uuid4())
        self.assertEqual([r['id'] for r in out], ['e1', 'e2'])
        self.assertEqual(out[1]['student_membership_id'], 'mem-1')
        out2 = enrollments.list_student_enrollments(_SeqSession(_SeqResult(rows)), 'stu-1')
        self.assertEqual([r['id'] for r in out2], ['e1', 'e2'])

    def test_count_org_students_resolves_then_counts(self):
        # 1st execute -> org uuid (resolve_legacy_id); 2nd -> the COUNT scalar
        sess = _SeqSession(_SeqResult([uuid.uuid4()]), _SeqResult([5]))
        self.assertEqual(enrollments.count_org_students(sess, 'org-fs-1'), 5)

    def test_count_org_students_unresolved_org_is_zero(self):
        self.assertEqual(
            enrollments.count_org_students(_SeqSession(_SeqResult([])), 'ghost'), 0)


class TestClassListAndSummaryReaders(unittest.TestCase):
    def test_list_student_classes_joins_enrollments_then_hydrates(self):
        c = _make_class(legacy_firestore_id='c1')
        sess = _SeqSession(
            _SeqResult([(c, 'org-fs-1')]),     # enrollments⋈classes main rows
            _SeqResult([(c.id, 'mem-1')]),     # teachers (batched)
            _SeqResult([]),                    # codes
        )
        out = classes_read.list_student_classes(sess, 'stu-1')
        self.assertEqual([x['id'] for x in out], ['c1'])
        self.assertEqual(out[0]['teacher_membership_ids'], ['mem-1'])
        self.assertEqual(out[0]['status'], 'active')      # full get_class shape

    def test_list_org_classes_summary_is_narrow_shape(self):
        c1 = _make_class(legacy_firestore_id='c1', name='Spanish')
        sess = _SeqSession(
            _SeqResult([c1]),                  # .scalars().all() -> class rows
            _SeqResult([(c1.id, 'mem-1')]),    # teachers
        )
        out = classes_read.list_org_classes_summary(sess, 'org-fs-1')
        self.assertEqual(out[0]['id'], 'c1')
        self.assertEqual(out[0]['name'], 'Spanish')
        self.assertEqual(out[0]['teacher_membership_ids'], ['mem-1'])
        self.assertIsNone(out[0]['last_activity_at'])     # not tracked on PG row
        # curated shape: omits the full-record fields
        self.assertNotIn('status', out[0])
        self.assertNotIn('learning_locale', out[0])
        self.assertNotIn('join_code', out[0])


class TestEnrollmentRouting(unittest.TestCase):
    _FLAGS = ('READ_PG_ENROLLMENTS', 'READ_PG_CLASSES')

    def setUp(self):
        for f in self._FLAGS:
            os.environ.pop(f, None)
        self.addCleanup(lambda: [os.environ.pop(f, None) for f in self._FLAGS])
        read_router._shadow_stats.clear()
        self.addCleanup(read_router._shadow_stats.clear)

    def test_overrides_passthrough_when_off(self):
        # signatures must match the Firestore readers so flag-OFF is transparent
        fs = types.SimpleNamespace(
            get_student_class_enrollment=lambda cid, uid: {'id': f'{cid}_{uid}', 'src': 'fs'},
            list_class_enrollments=lambda cid, st='active': [{'id': 'e1', 'st': st}],
            list_student_enrollments=lambda uid, st='active': [{'id': 'e1', 'u': uid}],
            count_org_students=lambda *, org_id: 9,
            list_student_classes=lambda uid: [{'id': 'c1', 'u': uid}],
            list_org_classes_summary=lambda *, org_id: [{'id': 'c1', 'o': org_id}],
        )
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_student_class_enrollment('c1', 'u1')['src'], 'fs')
        self.assertEqual(router.list_class_enrollments('c1', 'inactive')[0]['st'], 'inactive')
        self.assertEqual(router.list_student_enrollments('u1')[0]['u'], 'u1')
        self.assertEqual(router.count_org_students(org_id='o1'), 9)
        self.assertEqual(router.list_student_classes('u1')[0]['u'], 'u1')
        self.assertEqual(router.list_org_classes_summary(org_id='o1')[0]['o'], 'o1')

    def test_count_org_students_cutover_returns_pg_scalar(self):
        os.environ['READ_PG_ENROLLMENTS'] = '1'
        fs = types.SimpleNamespace(count_org_students=lambda *, org_id: 9)
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: 4):
            self.assertEqual(router.count_org_students(org_id='o1'), 4)

    def test_count_org_students_shadow_diffs_the_scalar(self):
        os.environ['READ_PG_ENROLLMENTS'] = 'shadow'
        fs = types.SimpleNamespace(count_org_students=lambda *, org_id: 9)
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: 8):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = router.count_org_students(org_id='o1')
        self.assertEqual(out, 9)                          # Firestore authoritative
        self.assertIn('<value>', ' '.join(cm.output))     # scalar mismatch surfaced

    def test_list_student_classes_weaker_flag_gates_to_firestore(self):
        # ENROLLMENTS=1 but CLASSES OFF -> weaker mode is OFF -> Firestore, PG untouched
        # (defends against a class rollback while enrollments is still forward).
        os.environ['READ_PG_ENROLLMENTS'] = '1'   # READ_PG_CLASSES left unset (off)
        fs = types.SimpleNamespace(list_student_classes=lambda uid: [{'id': 'c-fs'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        pg_called = []
        with mock.patch.object(ReadRouter, '_pg_read',
                               lambda self, pc, eng: pg_called.append(1) or [{'id': 'c-pg'}]):
            out = router.list_student_classes('u1')
        self.assertEqual(out, [{'id': 'c-fs'}])
        self.assertEqual(pg_called, [])           # weaker flag off -> PG never touched

    def test_list_student_classes_serves_pg_only_when_both_flags_one(self):
        os.environ['READ_PG_ENROLLMENTS'] = '1'
        os.environ['READ_PG_CLASSES'] = '1'
        fs = types.SimpleNamespace(list_student_classes=lambda uid: [{'id': 'c-fs'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'c-pg'}]):
            self.assertEqual(router.list_student_classes('u1'), [{'id': 'c-pg'}])

    def test_list_student_classes_shadow_when_one_flag_shadow_one_cutover(self):
        # weaker of (shadow, '1') is shadow -> Firestore authoritative + compare
        os.environ['READ_PG_ENROLLMENTS'] = 'shadow'
        os.environ['READ_PG_CLASSES'] = '1'
        fs = types.SimpleNamespace(list_student_classes=lambda uid: [{'id': 'c1'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'c1'}]):
            with self.assertLogs('backend.db.read_router', level='WARNING'):
                out = router.list_student_classes('u1')
        self.assertEqual(out, [{'id': 'c1'}])     # shadow -> Firestore returned

    def test_unresolved_parent_fails_open_in_mode_1(self):
        # pg_call returns the _FALLBACK sentinel (class not migrated) -> Firestore,
        # NOT an authoritative None that would deny the practice-launch / roster read
        os.environ['READ_PG_ENROLLMENTS'] = '1'
        fs = types.SimpleNamespace(
            get_student_class_enrollment=lambda cid, uid: {'id': 'e-fs', 'src': 'fs'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read',
                               lambda self, pc, eng: read_router._FALLBACK):
            out = router.get_student_class_enrollment('ghost-class', 'u1')
        self.assertEqual(out, {'id': 'e-fs', 'src': 'fs'})

    def test_fallback_sentinel_skips_the_shadow_compare(self):
        os.environ['READ_PG_ENROLLMENTS'] = 'shadow'
        fs = types.SimpleNamespace(
            list_class_enrollments=lambda cid, st='active': [{'id': 'e1'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read',
                               lambda self, pc, eng: read_router._FALLBACK):
            out = router.list_class_enrollments('ghost')
        self.assertEqual(out, [{'id': 'e1'}])                       # Firestore authoritative
        self.assertNotIn('READ_PG_ENROLLMENTS', read_router._shadow_stats)  # never counted

    def test_list_org_classes_summary_is_gated_on_classes_flag(self):
        os.environ['READ_PG_CLASSES'] = '1'
        fs = types.SimpleNamespace(list_org_classes_summary=lambda *, org_id: [{'id': 'fs'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'pg'}]):
            self.assertEqual(router.list_org_classes_summary(org_id='o1'), [{'id': 'pg'}])

    def test_enrollment_point_get_shadow_allowlists_timestamps(self):
        os.environ['READ_PG_ENROLLMENTS'] = 'shadow'
        fs = types.SimpleNamespace(
            get_student_class_enrollment=lambda cid, uid: {
                'id': f'{cid}_{uid}', 'class_id': cid, 'status': 'active', 'updated_at': 'T1'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'c1_u1', 'class_id': 'c1', 'status': 'active',
                                   'updated_at': 'T2'}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_student_class_enrollment('c1', 'u1')
        joined = ' '.join(cm.output)
        self.assertNotIn('MISMATCH', joined)              # updated_at allowlisted
        self.assertIn('1 compared, 0 mismatched', joined)

    def test_enrollment_list_cutover_fails_open_on_pg_error(self):
        os.environ['READ_PG_ENROLLMENTS'] = '1'
        fs = types.SimpleNamespace(
            list_class_enrollments=lambda cid, st='active': [{'id': 'e-fs'}])
        router = ReadRouter(fs, sql_engine=lambda: object())

        def boom(self, pc, eng):
            raise RuntimeError('pg down')

        with mock.patch.object(ReadRouter, '_pg_read', boom):
            self.assertEqual(router.list_class_enrollments('c1'), [{'id': 'e-fs'}])


def _make_assignment(**o):
    a = Assignment()
    a.id = o.get('id', uuid.uuid4())
    a.legacy_firestore_id = o.get('legacy_firestore_id', 'asg-1')
    a.org_id = o.get('org_id', uuid.uuid4())
    a.class_id = o.get('class_id', uuid.uuid4())
    a.title = o.get('title', 'Cafe ordering')
    a.description = o.get('description', '')
    a.status = o.get('status', 'published')
    a.release_at = o.get('release_at', None)
    a.due_at = o.get('due_at', None)
    a.modality_override = o.get('modality_override', {})
    a.max_attempts = o.get('max_attempts', None)
    a.task_type = o.get('task_type', 'decision_making')
    a.success_criteria = o.get('success_criteria', [])
    a.created_by_firebase_uid = o.get('created_by_firebase_uid', 'teacher-1')
    a.instructions = o.get('instructions', 'Order a drink.')
    a.generated_scenario = o.get('generated_scenario', 'A cafe.')
    a.objectives = o.get('objectives', [])
    a.target_expressions = o.get('target_expressions', [])
    a.target_vocabulary = o.get('target_vocabulary', [])
    a.focus_grammar = o.get('focus_grammar', [])
    a.teacher_notes = o.get('teacher_notes', '')
    a.student_instructions = o.get('student_instructions', '')
    a.target_language_intensity = o.get('target_language_intensity', 'target_led')
    a.canvas_module_item_ref = o.get('canvas_module_item_ref', None)
    a.canvas_module_item_id = o.get('canvas_module_item_id', None)
    a.grade_metric = o.get('grade_metric', None)
    a.grade_points = o.get('grade_points', None)
    a.created_at = o.get('created_at', datetime.datetime(2026, 5, 30))
    a.updated_at = o.get('updated_at', datetime.datetime(2026, 5, 30))
    return a


class TestAssignmentsReadAdapter(unittest.TestCase):
    def test_serialize_emits_parent_legacy_ids_and_renames(self):
        out = assignments_read._serialize_assignment(
            _make_assignment(legacy_firestore_id='asg-7', created_by_firebase_uid='t-9'),
            'org-fs-1', 'cls-fs-1')
        self.assertEqual(out['id'], 'asg-7')
        self.assertEqual(out['org_id'], 'org-fs-1')        # FK legacy id, not UUID
        self.assertEqual(out['class_id'], 'cls-fs-1')       # FK legacy id, not UUID
        self.assertEqual(out['created_by_uid'], 't-9')      # *_firebase_uid -> *_uid
        self.assertNotIn('created_by_firebase_uid', out)

    def test_serialize_null_canvas_item_id_renders_empty_string(self):
        # Firestore stores '' (not None) for an unlinked assignment.
        out = assignments_read._serialize_assignment(
            _make_assignment(canvas_module_item_id=None), 'o', 'c')
        self.assertEqual(out['canvas_module_item_id'], '')

    def test_serialize_dates_are_iso_or_empty_and_grade_config_present(self):
        # release_at/due_at must match the Firestore stored SHAPE (ISO string or '')
        # so serialize_assignment doesn't pass a raw datetime through to the API.
        unset = assignments_read._serialize_assignment(_make_assignment(), 'o', 'c')
        self.assertEqual(unset['release_at'], '')          # None -> '' (Firestore default)
        self.assertEqual(unset['due_at'], '')
        set_ = assignments_read._serialize_assignment(
            _make_assignment(due_at=datetime.datetime(2026, 6, 1)), 'o', 'c')
        self.assertEqual(set_['due_at'], '2026-06-01T00:00:00')   # ISO string, not datetime
        # grade config MUST be present (read by api_get_grade_config off this dict):
        graded = assignments_read._serialize_assignment(
            _make_assignment(grade_metric='completion', grade_points=10.0), 'o', 'c')
        self.assertEqual(graded['grade_metric'], 'completion')
        self.assertEqual(graded['grade_points'], 10.0)

    def test_serialize_carries_tutor_bearing_content(self):
        out = assignments_read._serialize_assignment(
            _make_assignment(instructions='Greet the barista', task_type='information_gap',
                             target_expressions=['bonjour']),
            'o', 'c')
        self.assertEqual(out['instructions'], 'Greet the barista')
        self.assertEqual(out['task_type'], 'information_gap')
        self.assertEqual(out['target_expressions'], ['bonjour'])

    def test_get_assignment_found_and_missing(self):
        a = _make_assignment(legacy_firestore_id='asg-1')
        found = assignments_read.get_assignment(
            _SeqSession(_SeqResult([(a, 'org-fs-1', 'cls-fs-1')])), 'asg-1')
        self.assertEqual(found['id'], 'asg-1')
        self.assertEqual(found['class_id'], 'cls-fs-1')
        self.assertIsNone(assignments_read.get_assignment(_SeqSession(_SeqResult([])), 'ghost'))

    def test_list_class_assignments_serializes_each_row(self):
        rows = [(_make_assignment(legacy_firestore_id='a1'), 'o', 'cls-fs-1'),
                (_make_assignment(legacy_firestore_id='a2'), 'o', 'cls-fs-1')]
        out = assignments_read.list_class_assignments(_SeqSession(_SeqResult(rows)), 'cls-fs-1')
        self.assertEqual([r['id'] for r in out], ['a1', 'a2'])


class TestAssignmentRouting(unittest.TestCase):
    def setUp(self):
        os.environ.pop('READ_PG_ASSIGNMENTS', None)
        self.addCleanup(lambda: os.environ.pop('READ_PG_ASSIGNMENTS', None))
        read_router._shadow_stats.clear()
        self.addCleanup(read_router._shadow_stats.clear)

    def test_overrides_passthrough_when_off(self):
        fs = types.SimpleNamespace(
            get_assignment=lambda aid: {'id': aid, 'src': 'fs'},
            list_class_assignments=lambda cid, statuses=None: [{'id': 'a1', 'c': cid, 's': statuses}],
        )
        router = ReadRouter(fs, sql_engine=lambda: object())
        self.assertEqual(router.get_assignment('a1'), {'id': 'a1', 'src': 'fs'})
        self.assertEqual(router.list_class_assignments('c1', ['published'])[0]['s'], ['published'])

    def test_get_assignment_cutover_returns_pg(self):
        os.environ['READ_PG_ASSIGNMENTS'] = '1'
        fs = types.SimpleNamespace(get_assignment=lambda aid: {'id': aid, 'src': 'fs'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: {'id': 'a1', 'src': 'pg'}):
            self.assertEqual(router.get_assignment('a1'), {'id': 'a1', 'src': 'pg'})

    def test_get_assignment_shadow_normalizes_intensity_and_dates(self):
        os.environ['READ_PG_ASSIGNMENTS'] = 'shadow'
        # Firestore raw legacy intensity + 'Z'-suffixed ISO date vs PG canonical value
        # + '+00:00' date: compared AFTER the per-field normalizer, so the intended
        # transform/format skew is clean (not a blanket ignore). updated_at is ignored.
        fs = types.SimpleNamespace(
            get_assignment=lambda aid: {
                'id': aid, 'status': 'published', 'instructions': 'X',
                'target_language_intensity': 'mostly_target',
                'due_at': '2026-06-01T00:00:00Z', 'updated_at': 'T1'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {
                'id': 'a1', 'status': 'published', 'instructions': 'X',
                'target_language_intensity': 'target_led',
                'due_at': '2026-06-01T00:00:00+00:00', 'updated_at': 'T2'}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_assignment('a1')
        joined = ' '.join(cm.output)
        self.assertNotIn('MISMATCH', joined)              # normalized -> clean
        self.assertIn('1 compared, 0 mismatched', joined)

    def test_get_assignment_shadow_flags_real_intensity_drift(self):
        os.environ['READ_PG_ASSIGNMENTS'] = 'shadow'
        # A NON-legacy divergence (balanced vs target_led) is NOT normalized away —
        # it surfaces, proving the normalizer is narrower than a blanket ignore.
        fs = types.SimpleNamespace(
            get_assignment=lambda aid: {'id': aid, 'target_language_intensity': 'balanced'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'a1', 'target_language_intensity': 'target_led'}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_assignment('a1')
        self.assertIn('MISMATCH', ' '.join(cm.output))

    def test_get_assignment_shadow_still_flags_content_drift(self):
        os.environ['READ_PG_ASSIGNMENTS'] = 'shadow'
        fs = types.SimpleNamespace(
            get_assignment=lambda aid: {'id': aid, 'status': 'published', 'instructions': 'real'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        # instructions is tutor-bearing -> NOT allowlisted -> a real divergence surfaces
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'a1', 'status': 'published', 'instructions': 'wrong'}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_assignment('a1')
        self.assertIn('MISMATCH', ' '.join(cm.output))

    def test_get_assignment_shadow_ignores_vestigial_mapping_id(self):
        os.environ['READ_PG_ASSIGNMENTS'] = 'shadow'
        # mapping_id is a vestigial legacy field (removed curriculum-overlay): 39/40
        # pre-migration prod assignments carry a dangling one, the PG adapter
        # intentionally does NOT emit it, and no read path consumes it. It is ignored
        # so its absence in PG is not flagged, while a real content field still would be.
        fs = types.SimpleNamespace(
            get_assignment=lambda aid: {
                'id': aid, 'status': 'published', 'instructions': 'X',
                'mapping_id': 'legacy-overlay-ref'})
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(
            ReadRouter, '_pg_read',
            lambda self, pc, eng: {'id': 'a1', 'status': 'published', 'instructions': 'X'}):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                router.get_assignment('a1')
        joined = ' '.join(cm.output)
        self.assertNotIn('MISMATCH', joined)              # mapping_id absence is intended
        self.assertIn('1 compared, 0 mismatched', joined)

    def test_list_class_assignments_shadow_diffs_by_id_set(self):
        os.environ['READ_PG_ASSIGNMENTS'] = 'shadow'
        fs = types.SimpleNamespace(
            list_class_assignments=lambda cid, statuses=None: [{'id': 'a1'}, {'id': 'a2'}])
        router = ReadRouter(fs, sql_engine=lambda: object())
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: [{'id': 'a1'}]):
            with self.assertLogs('backend.db.read_router', level='WARNING') as cm:
                out = router.list_class_assignments('c1')
        self.assertEqual(out, [{'id': 'a1'}, {'id': 'a2'}])  # Firestore authoritative
        joined = ' '.join(cm.output)
        self.assertIn('missing_in_pg', joined)
        self.assertIn("'a2'", joined)


class TestRouteReadAlsoTuple(unittest.TestCase):
    """The `also` param accepts a single flag OR a tuple/list — the effective mode is
    the WEAKER of `flag` and every `also` flag (forward-prep for the analytics
    session/event readers, which each depend on two upstream families)."""
    _FLAGS = ('RPG_A', 'RPG_B', 'RPG_C')

    def setUp(self):
        for f in self._FLAGS:
            os.environ.pop(f, None)
        self.addCleanup(lambda: [os.environ.pop(f, None) for f in self._FLAGS])
        self.router = ReadRouter(types.SimpleNamespace(), sql_engine=lambda: object())

    def test_tuple_also_all_cutover_serves_pg(self):
        for f in self._FLAGS:
            os.environ[f] = '1'
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: 'pg'):
            out = self.router._route_read(
                'RPG_A', lambda: 'fs', lambda s: 'pg', also=('RPG_B', 'RPG_C'))
        self.assertEqual(out, 'pg')

    def test_tuple_also_one_off_gates_to_firestore(self):
        os.environ['RPG_A'] = '1'
        os.environ['RPG_B'] = '1'   # RPG_C left OFF -> weaker mode OFF -> Firestore
        pg_called = []
        with mock.patch.object(ReadRouter, '_pg_read',
                               lambda self, pc, eng: pg_called.append(1) or 'pg'):
            out = self.router._route_read(
                'RPG_A', lambda: 'fs', lambda s: 'pg', also=('RPG_B', 'RPG_C'))
        self.assertEqual(out, 'fs')
        self.assertEqual(pg_called, [])     # weaker-of-three is OFF -> PG untouched

    def test_string_also_still_supported(self):
        os.environ['RPG_A'] = '1'
        os.environ['RPG_B'] = 'shadow'      # weaker of ('1','shadow') is shadow
        with mock.patch.object(ReadRouter, '_pg_read', lambda self, pc, eng: 'fs'):
            with self.assertLogs('backend.db.read_router', level='WARNING'):
                out = self.router._route_read(
                    'RPG_A', lambda: 'fs', lambda s: 'fs', also='RPG_B')
        self.assertEqual(out, 'fs')          # shadow -> Firestore authoritative


if __name__ == '__main__':
    unittest.main()
