import unittest
from unittest.mock import MagicMock, patch

import database


class ListOrganizationsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_default_returns_page_of_25_active(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        docs = [MagicMock(id=f'o{i}') for i in range(25)]
        for i, d in enumerate(docs):
            d.to_dict.return_value = {
                'name': f'School {i}',
                'name_lower': f'school {i}',
                'status': 'active',
                'created_at': None,
            }
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.start_after.return_value = col
        col.stream.return_value = docs

        out = database.list_organizations()
        self.assertEqual(len(out['items']), 25)
        self.assertEqual(out['items'][0]['id'], 'o0')
        self.assertIsNotNone(out['next_cursor'])
        self.assertEqual(out['next_cursor'], {'name_lower': 'school 24', 'id': 'o24'})

    @patch('database.get_db')
    def test_filter_by_status(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_organizations(status='suspended')
        # First .where should be on `status`.
        first_where = col.where.call_args_list[0]
        self.assertIn('status', first_where[0])
        self.assertIn('suspended', first_where[0])

    @patch('database.get_db')
    def test_filter_by_school_type(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_organizations(school_type='high')
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('school_type' in c for c in calls))

    @patch('database.get_db')
    def test_cursor_advances_query_with_positional_args(self, mock_get_db):
        """Firestore `start_after` takes positional values matching the
        order_by chain (name_lower, __name__). NOT a dict."""
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.start_after.return_value = col
        col.stream.return_value = []
        database.list_organizations(cursor={'name_lower': 'lincoln high', 'id': 'o100'})
        col.start_after.assert_called_once_with('lincoln high', 'o100')

    @patch('database.get_db')
    def test_invalid_status_rejected(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database.list_organizations(status='paused')

    @patch('database.get_db')
    def test_empty_string_school_type_does_filter(self, mock_get_db):
        """Empty string is an explicit filter value, not absent.

        Locks in the `is not None` contract: ``school_type=''`` adds a
        ``where('school_type', '==', '')`` clause rather than silently
        bypassing the filter as the old truthy check did.
        """
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []
        database.list_organizations(school_type='')
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(
            any(c == ('school_type', '==', '') for c in calls),
            f'Expected where("school_type", "==", "") in {calls!r}',
        )

    @patch('database.get_db')
    def test_invalid_school_type_rejected(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'school_type'):
            database.list_organizations(school_type='bootcamp')

    @patch('database.get_db')
    def test_invalid_public_or_private_rejected(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'public_or_private'):
            database.list_organizations(public_or_private='hybrid')

    @patch('database.get_db')
    def test_partial_page_returns_none_cursor(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        docs = [MagicMock(id='o0')]
        docs[0].to_dict.return_value = {'name_lower': 'a', 'status': 'active'}
        col.stream.return_value = docs

        out = database.list_organizations()
        self.assertEqual(len(out['items']), 1)
        self.assertIsNone(out['next_cursor'])


if __name__ == '__main__':
    unittest.main()
