import unittest
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


if __name__ == '__main__':
    unittest.main()
