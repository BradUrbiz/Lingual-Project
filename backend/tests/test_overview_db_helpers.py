"""Unit tests for the Plan 5 overview db helpers.

Covers the four read-only helpers added to support the
`GET /api/lingual-admin/overview` dashboard:
- count_school_requests_pending
- count_organizations_by_status
- count_school_requests_since
- list_recent_audit_events
"""
import unittest
from unittest.mock import MagicMock, patch
import datetime

import database


class CountSchoolRequestsPendingTests(unittest.TestCase):
    @patch('database.get_db')
    def test_filters_status_pending(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=7)]]
        n = database.count_school_requests_pending()
        self.assertEqual(n, 7)
        calls = [c[0] for c in col.where.call_args_list]
        self.assertTrue(any('status' in c and 'pending' in c for c in calls))


class CountOrganizationsByStatusTests(unittest.TestCase):
    @patch('database.get_db')
    def test_counts_per_status(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=12)]]
        n = database.count_organizations_by_status('active')
        self.assertEqual(n, 12)

    @patch('database.get_db')
    def test_rejects_invalid_status(self, mock_get_db):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database.count_organizations_by_status('paused')


class CountSchoolRequestsSinceTests(unittest.TestCase):
    @patch('database.get_db')
    def test_counts_requests_created_at_after(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.where.return_value = col
        col.count.return_value.get.return_value = [[MagicMock(value=3)]]
        since = datetime.datetime(2026, 5, 13, tzinfo=datetime.timezone.utc)
        n = database.count_school_requests_since(since=since)
        self.assertEqual(n, 3)


class ListRecentAuditEventsTests(unittest.TestCase):
    @patch('database.get_db')
    def test_orders_desc_and_applies_limit(self, mock_get_db):
        col = MagicMock()
        mock_get_db.return_value.collection.return_value = col
        col.order_by.return_value = col
        col.limit.return_value = col
        col.stream.return_value = [
            MagicMock(id='a1', to_dict=lambda: {'action': 'request_approved'}),
        ]
        out = database.list_recent_audit_events(limit=20)
        col.order_by.assert_called_once()
        col.limit.assert_called_with(20)
        self.assertEqual(len(out), 1)


if __name__ == '__main__':
    unittest.main()
