"""Plan 5 Task 7: `database.remove_membership` helper unit tests.

Verifies:
- Atomicity: membership status update + audit doc land in one Firestore batch.
- Invariant: school_admin removals also `ArrayRemove` the org's
  `school_admin_uids` in the SAME batch (Plan 4 codebase-conventions §14).
- Guard rails: missing membership, already-removed membership, missing audit.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import database


SAMPLE_REMOVE_AUDIT = {
    'actor_uid': 'admin',
    'action': 'membership_removed',
    'target': {'type': 'membership', 'id': 'm1'},
    'target_org_id': 'o',
    'metadata': {'reason': 'teacher left school'},
    'ip_hash': 'h',
    'user_agent': 'ua',
}


class RemoveMembershipTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_batches_membership_update_and_audit(self, mock_get_db, mock_ref, mock_get, mock_org_ref):
        """Atomic: membership update + audit doc in one batch."""
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        membership_ref = MagicMock(name='membership_ref')
        mock_ref.return_value = membership_ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        first_call = batch.update.call_args_list[0]
        self.assertIs(first_call[0][0], membership_ref)
        self.assertEqual(first_call[0][1]['status'], 'removed')
        self.assertEqual(first_call[0][1]['removed_by_uid'], 'admin')
        set_call = batch.set.call_args
        self.assertEqual(set_call[0][1]['action'], 'membership_removed')
        batch.commit.assert_called_once()

    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_school_admin_removal_also_batches_org_admin_uids_update(
        self, mock_get_db, mock_ref, mock_get, mock_org_ref
    ):
        """`school_admin` removal must include arrayRemove on the org doc in the SAME batch."""
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['school_admin'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        org_ref = MagicMock(name='org_ref')
        mock_org_ref.return_value = org_ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        update_calls = batch.update.call_args_list
        self.assertEqual(len(update_calls), 2)
        org_update = update_calls[1]
        self.assertIs(org_update[0][0], org_ref)
        self.assertIn('school_admin_uids', org_update[0][1])

    @patch('database.get_organization_ref')
    @patch('database.get_membership')
    @patch('database.get_membership_ref')
    @patch('database.get_db')
    def test_teacher_removal_does_not_touch_org_admin_uids(
        self, mock_get_db, mock_ref, mock_get, mock_org_ref
    ):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u1', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        mock_ref.return_value = MagicMock()
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()

        database.remove_membership(
            membership_id='m1', actor_uid='admin',
            audit_entry=dict(SAMPLE_REMOVE_AUDIT),
        )
        self.assertEqual(len(batch.update.call_args_list), 1)
        batch.set.assert_called_once()  # audit doc still set
        batch.commit.assert_called_once()  # batch still commits

    @patch('database.get_membership')
    def test_missing_membership_raises(self, mock_get):
        mock_get.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=dict(SAMPLE_REMOVE_AUDIT),
            )

    @patch('database.get_membership')
    def test_already_removed_raises(self, mock_get):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'removed',
        }
        with self.assertRaisesRegex(ValueError, 'already removed'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=dict(SAMPLE_REMOVE_AUDIT),
            )

    @patch('database.get_membership')
    def test_requires_audit_entry(self, mock_get):
        mock_get.return_value = {
            'id': 'm1', 'uid': 'u', 'org_id': 'o',
            'roles': ['teacher'], 'status': 'active',
        }
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.remove_membership(
                membership_id='m1', actor_uid='admin',
                audit_entry=None,
            )


if __name__ == '__main__':
    unittest.main()
