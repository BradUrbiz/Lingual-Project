"""Tests for `auto_restore_suspended_orgs` Cloud Function (Plan 5, Task 11).

The scheduler runs every 60 minutes, finds organizations whose
``suspended_until`` is in the past, and restores them atomically — the org
status flip and the ``lingual_admin_audit`` row commit in the SAME Firestore
batch. After restore, ``outbox_emails`` are enqueued (one per active
school_admin) as a fail-soft fan-out — an enqueue error must not undo the
restore that already committed.

Pattern (Plan 1, codified in `docs/superpowers/codebase-conventions.md` §7):
the decorated wrapper is a thin shim; tests exercise the pure
``_auto_restore_suspended_orgs_impl()`` directly.
"""

import sys
import unittest
from unittest.mock import patch, MagicMock


class AutoRestoreSuspendedOrgsTests(unittest.TestCase):
    def setUp(self):
        # Force a clean import of functions.main on each test so module-level
        # initialization (initialize_app) happens under our patches.
        sys.modules.pop('functions.main', None)

    def test_impl_iterates_due_orgs_and_calls_restore(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore'), \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore') as mock_enqueue:
            mock_list.return_value = [
                {'id': 'o1', 'name': 'A'},
                {'id': 'o2', 'name': 'B'},
            ]
            _auto_restore_suspended_orgs_impl()
            self.assertEqual(mock_restore.call_count, 2)
            # The impl forwards org name positionally as a fallback for the
            # outbox email subject line.
            mock_restore.assert_any_call('o1', 'A')
            mock_restore.assert_any_call('o2', 'B')
            self.assertEqual(mock_enqueue.call_count, 2)

    def test_impl_failsoft_per_org(self):
        """One failing restore must not block subsequent orgs."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore'), \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore'):
            mock_list.return_value = [
                {'id': 'o1', 'name': 'A'},
                {'id': 'o2', 'name': 'B'},
            ]
            mock_restore.side_effect = [RuntimeError('boom'), None]
            _auto_restore_suspended_orgs_impl()  # no raise
            self.assertEqual(mock_restore.call_count, 2)

    def test_restore_via_admin_sdk_writes_audit_doc_atomically(self):
        """C2 invariant — auto-restore must produce a ``lingual_admin_audit``
        row with ``actor_uid='system:auto_restore'``. The row commits in the
        SAME Firestore batch as the org update."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _restore_org_via_admin_sdk
        with patch('functions.main._fb_firestore') as mock_fb:
            db = MagicMock()
            mock_fb.client.return_value = db
            batch = MagicMock()
            db.batch.return_value = batch
            audit_doc_ref = MagicMock(id='aud-1')
            audit_col = MagicMock()
            audit_col.document.return_value = audit_doc_ref
            org_doc_ref = MagicMock()
            org_col = MagicMock()
            org_col.document.return_value = org_doc_ref
            db.collection.side_effect = lambda name: {
                'organizations': org_col,
                'lingual_admin_audit': audit_col,
            }[name]

            _restore_org_via_admin_sdk('o1', org_name='Sunset HS')
            self.assertIs(batch.update.call_args[0][0], org_doc_ref)
            self.assertEqual(batch.update.call_args[0][1]['status'], 'active')
            self.assertIs(batch.set.call_args[0][0], audit_doc_ref)
            audit_doc = batch.set.call_args[0][1]
            self.assertEqual(audit_doc['action'], 'org_restored')
            self.assertEqual(audit_doc['actor_uid'], 'system:auto_restore')
            self.assertEqual(audit_doc['target_org_id'], 'o1')
            self.assertEqual(audit_doc['metadata']['trigger'], 'auto_restore')
            batch.commit.assert_called_once()

    def test_impl_email_failure_does_not_revert_restore(self):
        """If outbox enqueue fails, the org is still restored (already
        committed atomically). The email failure is fail-soft."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _auto_restore_suspended_orgs_impl
        with patch('functions.main._fb_firestore'), \
             patch('functions.main._list_orgs_due_for_auto_restore') as mock_list, \
             patch('functions.main._restore_org_via_admin_sdk') as mock_restore, \
             patch('functions.main._enqueue_outbox_for_restore') as mock_enq:
            mock_list.return_value = [{'id': 'o1', 'name': 'A'}]
            mock_enq.side_effect = RuntimeError('outbox down')
            _auto_restore_suspended_orgs_impl()  # no raise
            mock_restore.assert_called_once_with('o1', 'A')

    def test_enqueue_outbox_for_restore_writes_correct_shape(self):
        """Outbox doc shape must match what send_outbox_email consumes
        (nested recipient.{email,name}, template_id, template_data, status,
        attempt_count, scheduled_for, created_at)."""
        with patch('firebase_admin.initialize_app'):
            from functions.main import _enqueue_outbox_for_restore
        with patch('functions.main._fb_firestore') as mock_fb, \
             patch.dict('os.environ', {'PUBLIC_BASE_URL': 'https://test.example'}):
            db = MagicMock()
            mock_fb.client.return_value = db

            org_doc = MagicMock()
            org_doc.exists = True
            org_doc.to_dict.return_value = {'school_admin_uids': ['u1']}

            user_doc = MagicMock()
            user_doc.exists = True
            user_doc.to_dict.return_value = {
                'email': 'admin@example.com',
                'profile': {'display_name': 'Alice'},
            }

            org_col = MagicMock()
            org_col.document.return_value.get.return_value = org_doc
            users_col = MagicMock()
            users_col.document.return_value.get.return_value = user_doc
            outbox_col = MagicMock()

            def collection_router(name):
                return {
                    'organizations': org_col,
                    'users': users_col,
                    'outbox_emails': outbox_col,
                }[name]
            db.collection.side_effect = collection_router

            _enqueue_outbox_for_restore('o1', 'Sunset HS')

            outbox_col.add.assert_called_once()
            doc = outbox_col.add.call_args[0][0]
            # Verify shape matches send_outbox_email consumer
            self.assertEqual(doc['status'], 'pending')
            self.assertEqual(doc['template_id'], 'org_restored')
            self.assertEqual(doc['recipient'], {'email': 'admin@example.com', 'name': 'Alice'})
            self.assertEqual(doc['template_data']['org_name'], 'Sunset HS')
            self.assertEqual(doc['template_data']['dashboard_url'], 'https://test.example/app/admin')
            self.assertEqual(doc['attempt_count'], 0)
            self.assertIn('created_at', doc)
            self.assertIn('scheduled_for', doc)


if __name__ == '__main__':
    unittest.main()
