import unittest
from unittest.mock import MagicMock, patch

import database


class ListOrgMembershipsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_returns_school_admin_and_teacher_rows(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        # Real Firestore membership docs always have ``created_at`` written
        # by ``create_membership``; ``joined_at`` is not currently populated
        # so the helper should fall back to ``created_at``.
        col.stream.return_value = [
            MagicMock(id='m1', to_dict=lambda: {
                'org_id': 'o', 'uid': 'u1', 'roles': ['teacher'], 'status': 'active',
                'joined_at': None, 'created_at': 'CREATED-1',
            }),
            MagicMock(id='m2', to_dict=lambda: {
                'org_id': 'o', 'uid': 'u2', 'roles': ['school_admin'], 'status': 'active',
                'joined_at': 'JOINED-2', 'created_at': 'CREATED-2',
            }),
        ]
        # User lookups
        def get_user(uid):
            return {'u1': {'email': 'a@x.com', 'profile': {'display_name': 'A'}},
                    'u2': {'email': 'b@x.com', 'profile': {'display_name': 'B'}}}[uid]
        with patch('database.get_user', side_effect=get_user):
            out = database.list_org_memberships(org_id='o', roles=('school_admin', 'teacher'))
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]['email'], 'a@x.com')
        self.assertEqual(out[1]['email'], 'b@x.com')
        self.assertEqual(out[0]['membership_id'], 'm1')
        # joined_at falls back to created_at when None, and prefers joined_at
        # when populated (future-proofing for v1.5 when we backfill the field).
        self.assertEqual(out[0]['joined_at'], 'CREATED-1')
        self.assertEqual(out[1]['joined_at'], 'JOINED-2')

    @patch('database.get_db')
    def test_excludes_student_role_by_default(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.stream.return_value = []
        database.list_org_memberships(org_id='o')
        # Should have constrained by org_id + status active, and roles filter:
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('org_id' in c for c in calls))
        self.assertTrue(any('status' in c for c in calls))


class ListOrgClassesSummaryTests(unittest.TestCase):
    # NOTE: Plan 5 spec originally named this helper ``list_org_classes`` but
    # that name collided with a pre-existing function in database.py used by
    # admin.py/lti.py/schools.py. Renamed to ``list_org_classes_summary`` —
    # see the function docstring for the rationale.
    @patch('database.get_db')
    def test_returns_metadata_rows(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.stream.return_value = [
            MagicMock(id='c1', to_dict=lambda: {
                'org_id': 'o', 'name': 'Spanish I', 'term': 'F2026',
                'subject': 'spanish', 'teacher_membership_ids': ['m1'],
                'created_at': None,
            }),
        ]
        out = database.list_org_classes_summary(org_id='o')
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]['name'], 'Spanish I')
        self.assertEqual(out[0]['id'], 'c1')


class ListOrgAuditEventsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_filters_by_target_org_id_and_orders_desc(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_org_audit_events(org_id='o-1', limit=50)
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('target_org_id' in c and 'o-1' in c for c in calls))
        # order_by should be on created_at desc.
        ob_args = col.order_by.call_args
        self.assertIn('created_at', ob_args[0])


if __name__ == '__main__':
    unittest.main()
