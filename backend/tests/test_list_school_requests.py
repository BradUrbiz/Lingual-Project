import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import database
from firebase_admin import firestore


class ListSchoolRequestsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_cursor_advances_query_with_single_ordered_cursor(self, mock_get_db):
        """The request list cursor must be one Firestore cursor object.

        The query orders by created_at and then __name__, so the cursor's
        ordered values are [leading_value, id].
        """
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.start_after.return_value = col
        col.stream.return_value = []

        leading = datetime(2026, 5, 1, 12, 0, 0, tzinfo=UTC)
        database.list_school_requests(
            cursor={'leading_value': leading, 'id': 'r100'}
        )

        col.start_after.assert_called_once_with([leading, 'r100'])

    @patch('database.get_db')
    def test_newest_sort_tiebreaker_uses_descending_document_id(self, mock_get_db):
        """Newest-first uses created_at DESC, so the __name__ tie-breaker must
        also be DESC. Otherwise real Firestore asks for an unnecessary
        composite index for created_at DESC + __name__ ASC."""
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []

        database.list_school_requests(sort='requested_at_desc')

        col.order_by.assert_any_call(
            '__name__', direction=firestore.Query.DESCENDING
        )

    @patch('database.get_db')
    def test_oldest_and_name_sorts_tiebreak_by_ascending_document_id(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = []

        database.list_school_requests(sort='requested_at_asc')
        database.list_school_requests(sort='name')

        name_order_calls = [
            call for call in col.order_by.call_args_list
            if call[0] and call[0][0] == '__name__'
        ]
        self.assertEqual(len(name_order_calls), 2)
        for call in name_order_calls:
            self.assertEqual(call.kwargs.get('direction'), firestore.Query.ASCENDING)


if __name__ == '__main__':
    unittest.main()
