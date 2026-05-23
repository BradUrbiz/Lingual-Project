import unittest
from unittest.mock import patch

from backend.services.suspended_org_guard import (
    SuspendedOrgError,
    enforce_org_active,
    is_org_suspended,
)


class IsOrgSuspendedTests(unittest.TestCase):
    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_active_returns_false(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'active'}
        self.assertFalse(is_org_suspended('o'))

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_suspended_returns_true(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'suspended'}
        self.assertTrue(is_org_suspended('o'))

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_missing_returns_false(self, mock_get):
        mock_get.return_value = None
        self.assertFalse(is_org_suspended('o'))

    def test_none_org_id_returns_false(self):
        self.assertFalse(is_org_suspended(None))
        self.assertFalse(is_org_suspended(''))


class EnforceOrgActiveTests(unittest.TestCase):
    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_active_returns_quietly(self, mock_get):
        mock_get.return_value = {'id': 'o', 'status': 'active'}
        enforce_org_active('o')  # no raise

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_suspended_raises_with_payload(self, mock_get):
        mock_get.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspend_reason': 'fraud risk',
            'suspended_until': '2026-06-01',
        }
        with self.assertRaises(SuspendedOrgError) as ctx:
            enforce_org_active('o')
        self.assertEqual(ctx.exception.org_id, 'o')
        self.assertEqual(ctx.exception.reason, 'fraud risk')
        self.assertEqual(ctx.exception.until, '2026-06-01')
        self.assertEqual(ctx.exception.to_payload(), {
            'error': 'org_suspended',
            'reason': 'fraud risk',
            'until': '2026-06-01',
        })

    @patch('backend.services.suspended_org_guard.database.get_organization')
    def test_indefinite_suspension_has_no_until(self, mock_get):
        mock_get.return_value = {
            'id': 'o', 'status': 'suspended',
            'suspend_reason': 'r', 'suspended_until': None,
        }
        with self.assertRaises(SuspendedOrgError) as ctx:
            enforce_org_active('o')
        self.assertNotIn('until', ctx.exception.to_payload())

    def test_none_org_id_returns_quietly(self):
        enforce_org_active(None)
        enforce_org_active('')
