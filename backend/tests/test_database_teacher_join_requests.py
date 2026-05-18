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


if __name__ == '__main__':
    unittest.main()
