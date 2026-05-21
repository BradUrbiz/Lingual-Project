import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import database


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


if __name__ == '__main__':
    unittest.main()
