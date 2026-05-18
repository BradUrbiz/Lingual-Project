"""Tests for teacher_join_requests CRUD helpers in database.py."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import database


class TeacherJoinRequestsHelpersTest(unittest.TestCase):
    def setUp(self):
        self.fake_doc_ref = MagicMock()
        self.fake_doc_ref.id = 'tjr-1'
        self.fake_collection = MagicMock()
        self.fake_collection.document.return_value = self.fake_doc_ref
        self.fake_client = MagicMock()
        self.fake_client.collection.return_value = self.fake_collection
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def test_create_teacher_join_request_code_source(self):
        """Code path writes source='invite_code' and invite_code."""
        request_id = database.create_teacher_join_request(
            uid='teacher-1',
            org_id='org-1',
            source='invite_code',
            invite_code='ABC123',
        )
        self.assertEqual(request_id, 'tjr-1')
        self.fake_doc_ref.set.assert_called_once()
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['uid'], 'teacher-1')
        self.assertEqual(payload['org_id'], 'org-1')
        self.assertEqual(payload['source'], 'invite_code')
        self.assertEqual(payload['invite_code'], 'ABC123')
        self.assertEqual(payload['status'], 'pending')
        self.assertIn('requested_at', payload)

    def test_create_teacher_join_request_search_source(self):
        """Search path writes source='search' with no invite_code."""
        database.create_teacher_join_request(
            uid='teacher-1',
            org_id='org-1',
            source='search',
        )
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['source'], 'search')
        self.assertNotIn('invite_code', payload)

    def test_create_teacher_join_request_rejects_invalid_source(self):
        with self.assertRaisesRegex(ValueError, 'Invalid source'):
            database.create_teacher_join_request(
                uid='teacher-1',
                org_id='org-1',
                source='garbage',
            )

    def test_get_pending_teacher_join_request_by_uid_returns_first_pending(self):
        pending_doc = MagicMock()
        pending_doc.id = 'tjr-1'
        pending_doc.to_dict.return_value = {'uid': 'teacher-1', 'status': 'pending'}
        query = MagicMock()
        query.stream.return_value = iter([pending_doc])
        self.fake_collection.where.return_value.where.return_value.limit.return_value = query

        result = database.get_pending_teacher_join_request_by_uid('teacher-1')
        self.assertEqual(result['id'], 'tjr-1')
        self.assertEqual(result['status'], 'pending')

    def test_get_pending_teacher_join_request_by_uid_none(self):
        query = MagicMock()
        query.stream.return_value = iter([])
        self.fake_collection.where.return_value.where.return_value.limit.return_value = query
        self.assertIsNone(database.get_pending_teacher_join_request_by_uid('teacher-1'))

    def test_list_pending_teacher_join_requests_by_org(self):
        doc1 = MagicMock(); doc1.id = 'tjr-1'
        doc1.to_dict.return_value = {'uid': 'teacher-1', 'status': 'pending', 'org_id': 'org-1'}
        doc2 = MagicMock(); doc2.id = 'tjr-2'
        doc2.to_dict.return_value = {'uid': 'teacher-2', 'status': 'pending', 'org_id': 'org-1'}
        query = MagicMock()
        query.stream.return_value = iter([doc1, doc2])
        self.fake_collection.where.return_value.where.return_value.order_by.return_value = query

        results = database.list_pending_teacher_join_requests_by_org('org-1')
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['id'], 'tjr-1')

    def test_update_teacher_join_request_status_sets_review_metadata(self):
        database.update_teacher_join_request_status(
            request_id='tjr-1',
            status='approved',
            reviewed_by_uid='admin-1',
        )
        self.fake_doc_ref.update.assert_called_once()
        updates = self.fake_doc_ref.update.call_args[0][0]
        self.assertEqual(updates['status'], 'approved')
        self.assertEqual(updates['reviewed_by_uid'], 'admin-1')
        self.assertIn('reviewed_at', updates)

    def test_update_teacher_join_request_status_cancel_omits_review_metadata(self):
        """Self-cancellation is not a review — must NOT stamp reviewed_*."""
        database.update_teacher_join_request_status(
            request_id='tjr-1',
            status='cancelled',
        )
        updates = self.fake_doc_ref.update.call_args[0][0]
        self.assertEqual(updates['status'], 'cancelled')
        self.assertNotIn('reviewed_at', updates)
        self.assertNotIn('reviewed_by_uid', updates)

    def test_update_teacher_join_request_status_rejects_invalid_status(self):
        with self.assertRaisesRegex(ValueError, 'Invalid status'):
            database.update_teacher_join_request_status(
                request_id='tjr-1',
                status='bogus',
                reviewed_by_uid='admin-1',
            )

    def test_update_teacher_join_request_status_review_requires_actor(self):
        """Approved/declined transitions require reviewed_by_uid for audit integrity."""
        with self.assertRaisesRegex(ValueError, 'reviewed_by_uid is required'):
            database.update_teacher_join_request_status(
                request_id='tjr-1',
                status='approved',
            )
        with self.assertRaisesRegex(ValueError, 'reviewed_by_uid is required'):
            database.update_teacher_join_request_status(
                request_id='tjr-1',
                status='declined',
            )


class OrgSearchHelperTest(unittest.TestCase):
    def setUp(self):
        self.fake_client = MagicMock()
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def _seed_org_docs(self, orgs: list[dict]):
        docs = []
        for org in orgs:
            d = MagicMock()
            d.id = org['id']
            d.to_dict.return_value = {k: v for k, v in org.items() if k != 'id'}
            docs.append(d)
        query = MagicMock()
        query.stream.return_value = iter(docs)
        # search_organizations chains: collection().where().where().limit()
        self.fake_client.collection.return_value.where.return_value.where.return_value.limit.return_value = query

    def test_search_organizations_returns_metadata_only(self):
        """Search response excludes sensitive fields."""
        self._seed_org_docs([
            {
                'id': 'org-1',
                'name': 'San Francisco Friends School',
                'name_lower': 'san francisco friends school',
                'city': 'San Francisco',
                'state': 'CA',
                'school_type': 'k12',
                'status': 'active',
                # Sensitive fields below MUST NOT appear in result.
                'admin_email_domains': ['@sfs.org'],
                'student_count': 412,
                'teacher_count': 38,
            },
        ])
        results = database.search_organizations('san fran', limit=10)
        self.assertEqual(len(results), 1)
        result = results[0]
        self.assertEqual(result['id'], 'org-1')
        self.assertEqual(result['name'], 'San Francisco Friends School')
        self.assertEqual(result['city'], 'San Francisco')
        self.assertEqual(result['state'], 'CA')
        self.assertEqual(result['school_type'], 'k12')
        self.assertNotIn('admin_email_domains', result)
        self.assertNotIn('student_count', result)
        self.assertNotIn('teacher_count', result)

    def test_search_organizations_excludes_suspended_archived(self):
        self._seed_org_docs([
            {'id': 'org-1', 'name': 'Active', 'name_lower': 'active', 'status': 'active'},
            {'id': 'org-2', 'name': 'Susp', 'name_lower': 'susp', 'status': 'suspended'},
            {'id': 'org-3', 'name': 'Arch', 'name_lower': 'arch', 'status': 'archived'},
        ])
        results = database.search_organizations('a', limit=10)
        ids = [r['id'] for r in results]
        self.assertIn('org-1', ids)
        self.assertNotIn('org-2', ids)
        self.assertNotIn('org-3', ids)

    def test_search_organizations_blank_query_returns_empty(self):
        """Empty / whitespace-only query yields no results, no DB hit."""
        result = database.search_organizations('   ', limit=10)
        self.assertEqual(result, [])
        self.fake_client.collection.assert_not_called()


class ListSchoolAdminEmailsTest(unittest.TestCase):
    def setUp(self):
        self.fake_client = MagicMock()
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()
        # Memberships query
        self.memberships_query = MagicMock()
        # Users
        self.users_doc = MagicMock()

    def tearDown(self):
        self.client_patch.stop()

    def test_returns_active_school_admins_for_org(self):
        m1 = MagicMock()
        m1.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-1',
            'roles': ['school_admin'], 'status': 'active',
        }
        m2 = MagicMock()
        m2.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-2',
            'roles': ['school_admin', 'teacher'], 'status': 'active',
        }
        m3 = MagicMock()
        m3.to_dict.return_value = {
            'org_id': 'org-1', 'uid': 'admin-inactive',
            'roles': ['school_admin'], 'status': 'invited',
        }
        self.memberships_query.stream.return_value = iter([m1, m2, m3])

        users = {
            'admin-1': {'email': 'a1@x.com', 'name': 'A1', 'profile': {'display_name': 'A One'}},
            'admin-2': {'email': 'a2@x.com', 'name': 'A2'},
        }

        def _collection(name):
            mock = MagicMock()
            if name == 'memberships':
                mock.where.return_value.where.return_value.where.return_value.stream.return_value = (
                    iter([m1, m2, m3])
                )
            elif name == 'users':
                def _doc(uid):
                    doc_mock = MagicMock()
                    if uid in users:
                        doc_mock.get.return_value.to_dict.return_value = users[uid]
                        doc_mock.get.return_value.exists = True
                    else:
                        doc_mock.get.return_value.exists = False
                    return doc_mock
                mock.document.side_effect = _doc
            return mock

        self.fake_client.collection.side_effect = _collection

        results = database.list_school_admin_emails('org-1')
        emails = sorted(r['email'] for r in results)
        self.assertEqual(emails, ['a1@x.com', 'a2@x.com'])


class CreateOrganizationNameLowerTest(unittest.TestCase):
    def setUp(self):
        self.fake_doc_ref = MagicMock()
        self.fake_doc_ref.id = 'org-new'
        self.fake_collection = MagicMock()
        self.fake_collection.document.return_value = self.fake_doc_ref
        self.fake_client = MagicMock()
        self.fake_client.collection.return_value = self.fake_collection
        self.client_patch = patch('database.firestore.client', return_value=self.fake_client)
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()

    def test_create_organization_writes_name_lower(self):
        database.create_organization(name='  SF Friends School  ')
        payload = self.fake_doc_ref.set.call_args[0][0]
        self.assertEqual(payload['name_lower'], 'sf friends school')


if __name__ == '__main__':
    unittest.main()
