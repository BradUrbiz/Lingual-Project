import io
import os
import unittest
from contextlib import redirect_stderr
from datetime import datetime
from unittest.mock import MagicMock, patch

import database


class WizardEnumConstantsTest(unittest.TestCase):
    def test_school_type_values(self):
        self.assertEqual(database.ALLOWED_SCHOOL_TYPES, frozenset({
            'middle', 'high', 'k12', 'university',
            'language_academy', 'district', 'other',
        }))

    def test_public_private_values(self):
        self.assertEqual(database.ALLOWED_PUBLIC_PRIVATE, frozenset({
            'public', 'private', 'charter', 'other',
        }))

    def test_grade_size_values(self):
        self.assertEqual(database.ALLOWED_GRADE_SIZES, frozenset({
            '<50', '50-100', '100-200', '200-500', '500+',
        }))

    def test_canvas_integration_types(self):
        self.assertEqual(database.ALLOWED_CANVAS_INTEGRATION_TYPES, frozenset({
            'lti13', 'roster_sync', 'grade_passback', 'sso',
        }))

    def test_grade_ranges(self):
        self.assertEqual(database.ALLOWED_GRADE_RANGES, frozenset({
            'k_2', 'g3_5', 'g6_8', 'g9_12', 'undergrad', 'graduate', 'adult_ed',
        }))

    def test_course_frameworks(self):
        self.assertEqual(database.ALLOWED_COURSE_FRAMEWORKS, frozenset({
            'ap', 'actfl', 'cefr', 'ib', 'school_specific', 'none',
        }))

    def test_rejection_categories(self):
        self.assertEqual(database.ALLOWED_REJECTION_CATEGORIES, frozenset({
            'info_missing', 'fraud_risk', 'out_of_scope', 'duplicate', 'other',
        }))

    def test_wizard_step_range(self):
        self.assertEqual(database.WIZARD_STEP_MIN, 1)
        self.assertEqual(database.WIZARD_STEP_MAX, 4)


class SchoolCreationDraftAccessorsTest(unittest.TestCase):
    @patch('database.get_db')
    def test_collection_accessor(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        coll = database.get_school_creation_drafts_collection()
        client.collection.assert_called_once_with('school_creation_drafts')
        self.assertEqual(coll, client.collection.return_value)

    @patch('database.get_school_creation_drafts_collection')
    def test_ref_accessor(self, mock_coll):
        ref = database.get_school_creation_draft_ref('uid-1')
        mock_coll.return_value.document.assert_called_once_with('uid-1')
        self.assertEqual(ref, mock_coll.return_value.document.return_value)


class SchoolCreationDraftHelpersTest(unittest.TestCase):
    @patch('database.get_school_creation_draft_ref')
    def test_get_returns_none_when_missing(self, mock_ref):
        snap = MagicMock()
        snap.exists = False
        mock_ref.return_value.get.return_value = snap
        self.assertIsNone(database.get_school_creation_draft('uid-1'))

    @patch('database.get_school_creation_draft_ref')
    def test_get_returns_data_when_present(self, mock_ref):
        snap = MagicMock()
        snap.exists = True
        snap.to_dict.return_value = {
            'current_step': 2,
            'draft_payload': {'school_name': 'SF Friends'},
        }
        mock_ref.return_value.get.return_value = snap
        draft = database.get_school_creation_draft('uid-1')
        self.assertEqual(draft['current_step'], 2)
        self.assertEqual(draft['draft_payload'], {'school_name': 'SF Friends'})
        self.assertEqual(draft['uid'], 'uid-1')

    @patch('database.get_school_creation_draft_ref')
    def test_upsert_writes_payload(self, mock_ref):
        database.upsert_school_creation_draft(
            'uid-1',
            current_step=3,
            draft_payload={'school_name': 'SF Friends'},
        )
        args, kwargs = mock_ref.return_value.set.call_args
        payload = args[0]
        self.assertEqual(payload['current_step'], 3)
        self.assertEqual(payload['draft_payload'], {'school_name': 'SF Friends'})
        self.assertIn('updated_at', payload)
        self.assertEqual(kwargs, {'merge': True})

    def test_upsert_rejects_step_below_min(self):
        with self.assertRaisesRegex(ValueError, 'current_step'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=0, draft_payload={},
            )

    def test_upsert_rejects_step_above_max(self):
        with self.assertRaisesRegex(ValueError, 'current_step'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=5, draft_payload={},
            )

    def test_upsert_rejects_non_dict_payload(self):
        with self.assertRaisesRegex(ValueError, 'draft_payload'):
            database.upsert_school_creation_draft(
                'uid-1', current_step=1, draft_payload='not a dict',
            )

    @patch('database.get_school_creation_draft_ref')
    def test_delete_calls_doc_delete(self, mock_ref):
        database.delete_school_creation_draft('uid-1')
        mock_ref.return_value.delete.assert_called_once()


class HashAttestationIpTest(unittest.TestCase):
    def test_hash_is_deterministic_given_salt(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        b = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        self.assertEqual(a, b)
        self.assertTrue(a.startswith('sha256:'))

    def test_different_salts_produce_different_hashes(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepperA')
        b = database.hash_attestation_ip('1.2.3.4', salt='pepperB')
        self.assertNotEqual(a, b)

    def test_different_ips_produce_different_hashes(self):
        a = database.hash_attestation_ip('1.2.3.4', salt='pepper')
        b = database.hash_attestation_ip('1.2.3.5', salt='pepper')
        self.assertNotEqual(a, b)

    def test_empty_ip_returns_empty_marker(self):
        self.assertEqual(database.hash_attestation_ip('', salt='pepper'), 'sha256:none')
        self.assertEqual(database.hash_attestation_ip(None, salt='pepper'), 'sha256:none')

    @patch.dict(os.environ, {'ATTESTATION_HASH_SALT': 'env-salt'}, clear=False)
    def test_default_salt_from_env(self):
        a = database.hash_attestation_ip('1.2.3.4')
        b = database.hash_attestation_ip('1.2.3.4', salt='env-salt')
        self.assertEqual(a, b)

    def test_warns_once_when_default_salt_is_empty(self):
        # Reset the sentinel so this test is self-contained
        database._ATTESTATION_SALT_WARNED = False
        buf = io.StringIO()
        with redirect_stderr(buf):
            # Ensure env var is unset for this call
            with patch.dict(os.environ, {}, clear=True):
                database.hash_attestation_ip('1.2.3.4')
                database.hash_attestation_ip('5.6.7.8')  # second call must NOT re-warn
        output = buf.getvalue()
        self.assertIn('ATTESTATION_HASH_SALT', output)
        self.assertEqual(output.count('ATTESTATION_HASH_SALT'), 1)


class CancelSchoolRequestTest(unittest.TestCase):
    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_cancels_own_pending_request(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'pending',
        }
        result = database.cancel_school_request('req-1', 'uid-1')
        self.assertTrue(result)
        args, _ = mock_update.call_args
        updates = args[1]
        self.assertEqual(args[0], 'req-1')
        self.assertEqual(updates['status'], 'cancelled')
        self.assertIn('cancelled_at', updates)

    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_rejects_wrong_owner(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'pending',
        }
        with self.assertRaisesRegex(PermissionError, 'not owned'):
            database.cancel_school_request('req-1', 'uid-OTHER')
        mock_update.assert_not_called()

    @patch('database.update_school_request')
    @patch('database.get_school_request')
    def test_rejects_already_approved(self, mock_get, mock_update):
        mock_get.return_value = {
            'id': 'req-1',
            'requester_uid': 'uid-1',
            'status': 'approved',
        }
        with self.assertRaisesRegex(ValueError, 'not pending'):
            database.cancel_school_request('req-1', 'uid-1')
        mock_update.assert_not_called()

    @patch('database.get_school_request')
    def test_returns_false_when_not_found(self, mock_get):
        mock_get.return_value = None
        self.assertFalse(database.cancel_school_request('req-missing', 'uid-1'))


class RecordPreInvitesTest(unittest.TestCase):
    @patch('database.get_db')
    def test_writes_one_doc_per_email_via_batch(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        ids = database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['a@x.test', 'b@x.test'],
        )

        self.assertEqual(len(ids), 2)
        # Two `batch.set(...)` calls expected, one per email.
        self.assertEqual(batch.set.call_count, 2)
        batch.commit.assert_called_once()

    @patch('database.get_db')
    def test_skips_empty_or_whitespace_emails(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        ids = database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['  ', '', 'good@x.test'],
        )

        self.assertEqual(len(ids), 1)
        self.assertEqual(batch.set.call_count, 1)

    @patch('database.get_db')
    def test_lowercases_and_strips_emails(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client
        batch = MagicMock()
        client.batch.return_value = batch

        database.record_school_request_pre_invites(
            org_id='org-1',
            requester_uid='uid-1',
            emails=['  Foo@X.test  '],
        )

        payload = batch.set.call_args[0][1]
        self.assertEqual(payload['email'], 'foo@x.test')

    @patch('database.get_db')
    def test_no_emails_means_no_batch_commit(self, mock_get_db):
        client = MagicMock()
        mock_get_db.return_value = client

        ids = database.record_school_request_pre_invites(
            org_id='org-1', requester_uid='uid-1', emails=[],
        )

        self.assertEqual(ids, [])
        client.batch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
