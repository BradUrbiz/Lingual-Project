import unittest
from unittest.mock import MagicMock, patch

import database


SAMPLE_AUDIT_ENTRY = {
    'actor_uid': 'admin-uid',
    'action': 'org_suspended',
    'target': {'type': 'organization', 'id': 'org-1'},
    'target_org_id': 'org-1',
    'metadata': {'reason': 'fraud risk'},
    'ip_hash': 'h',
    'user_agent': 'ua',
    # created_at intentionally omitted — helper stamps SERVER_TIMESTAMP.
}


class SuspendOrganizationTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_suspend_batches_org_update_and_audit(self, mock_get_db, mock_get_org, mock_get_ref):
        """Atomic write: same Firestore batch contains BOTH the org update
        AND the audit doc. If either fails, neither commits."""
        mock_get_org.return_value = {'id': 'org-1', 'status': 'active'}
        ref = MagicMock(name='org_ref')
        mock_get_ref.return_value = ref
        batch = MagicMock(name='batch')
        audit_doc_ref = MagicMock(name='audit_doc_ref', id='audit-x')
        audit_col = MagicMock(name='audit_col')
        audit_col.document.return_value = audit_doc_ref
        db = MagicMock(name='db')
        db.batch.return_value = batch
        db.collection.return_value = audit_col
        mock_get_db.return_value = db

        database.suspend_organization(
            org_id='org-1', actor_uid='admin-uid',
            reason='fraud risk', suspended_until=None,
            audit_entry=dict(SAMPLE_AUDIT_ENTRY),
        )
        # batch.update was called with the org update
        update_call = batch.update.call_args
        self.assertIs(update_call[0][0], ref)
        update = update_call[0][1]
        self.assertEqual(update['status'], 'suspended')
        self.assertEqual(update['suspended_by_uid'], 'admin-uid')
        self.assertEqual(update['suspend_reason'], 'fraud risk')
        self.assertIn('suspended_at', update)
        # batch.set was called with the audit doc
        set_call = batch.set.call_args
        self.assertIs(set_call[0][0], audit_doc_ref)
        self.assertEqual(set_call[0][1]['action'], 'org_suspended')
        # ONE batch.commit() — single atomic write
        batch.commit.assert_called_once()

    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_suspend_records_suspended_until(self, mock_get_db, mock_get_org, mock_get_ref):
        mock_get_org.return_value = {'id': 'org-1', 'status': 'active'}
        mock_get_ref.return_value = MagicMock()
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()
        import datetime
        until = datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc)
        database.suspend_organization(
            org_id='org-1', actor_uid='u', reason='temp',
            suspended_until=until,
            audit_entry=dict(SAMPLE_AUDIT_ENTRY),
        )
        self.assertEqual(batch.update.call_args[0][1]['suspended_until'], until)

    @patch('database.get_organization')
    def test_suspend_rejects_already_suspended(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'suspended'}
        with self.assertRaisesRegex(ValueError, 'already suspended'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_rejects_missing_org(self, mock_get_org):
        mock_get_org.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.suspend_organization(
                org_id='nope', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_rejects_empty_reason(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'reason'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='', suspended_until=None,
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_suspend_requires_audit_entry(self, mock_get_org):
        """SOC 2 invariant: a state-transition cannot be called without audit."""
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.suspend_organization(
                org_id='o', actor_uid='u', reason='r', suspended_until=None,
                audit_entry=None,
            )


class RestoreOrganizationTests(unittest.TestCase):
    @patch('database.get_organization_ref')
    @patch('database.get_organization')
    @patch('database.get_db')
    def test_restore_batches_org_update_and_audit(self, mock_get_db, mock_get_org, mock_get_ref):
        mock_get_org.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspended_at': 't', 'suspended_by_uid': 'u',
            'suspend_reason': 'r', 'suspended_until': 't2',
        }
        ref = MagicMock()
        mock_get_ref.return_value = ref
        batch = MagicMock()
        mock_get_db.return_value.batch.return_value = batch
        mock_get_db.return_value.collection.return_value.document.return_value = MagicMock()
        audit_entry = {**SAMPLE_AUDIT_ENTRY, 'action': 'org_restored'}

        database.restore_organization(
            org_id='o', actor_uid='admin',
            audit_entry=audit_entry,
        )
        update = batch.update.call_args[0][1]
        self.assertEqual(update['status'], 'active')
        self.assertEqual(update['suspend_reason'], None)
        self.assertEqual(update['suspended_at'], None)
        self.assertEqual(update['suspended_by_uid'], None)
        self.assertEqual(update['suspended_until'], None)
        self.assertEqual(update['restored_by_uid'], 'admin')
        self.assertIn('restored_at', update)
        batch.commit.assert_called_once()

    @patch('database.get_organization')
    def test_restore_rejects_already_active(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'active'}
        with self.assertRaisesRegex(ValueError, 'not suspended'):
            database.restore_organization(
                org_id='o', actor_uid='admin',
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_restore_rejects_missing_org(self, mock_get_org):
        mock_get_org.return_value = None
        with self.assertRaisesRegex(ValueError, 'not found'):
            database.restore_organization(
                org_id='nope', actor_uid='admin',
                audit_entry=dict(SAMPLE_AUDIT_ENTRY),
            )

    @patch('database.get_organization')
    def test_restore_requires_audit_entry(self, mock_get_org):
        mock_get_org.return_value = {'id': 'o', 'status': 'suspended'}
        with self.assertRaisesRegex(ValueError, 'audit_entry is required'):
            database.restore_organization(
                org_id='o', actor_uid='admin',
                audit_entry=None,
            )
