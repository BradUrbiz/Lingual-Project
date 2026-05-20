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
        self.assertIn('next_cursor', out)

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


if __name__ == '__main__':
    unittest.main()
