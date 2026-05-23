"""Tests for ALLOWED_ORG_STATUSES enum and _validate_org_status."""
import unittest

import database


class OrgStatusEnumTests(unittest.TestCase):
    def test_constants_are_exposed(self):
        self.assertEqual(database.ORG_STATUS_ACTIVE, 'active')
        self.assertEqual(database.ORG_STATUS_SUSPENDED, 'suspended')
        self.assertEqual(database.ORG_STATUS_ARCHIVED, 'archived')

    def test_allowed_org_statuses_is_frozenset(self):
        self.assertIsInstance(database.ALLOWED_ORG_STATUSES, frozenset)
        self.assertEqual(
            database.ALLOWED_ORG_STATUSES,
            frozenset({'active', 'suspended', 'archived'}),
        )

    def test_validate_accepts_known(self):
        self.assertEqual(database._validate_org_status('active'), 'active')
        self.assertEqual(database._validate_org_status('suspended'), 'suspended')
        self.assertEqual(database._validate_org_status('archived'), 'archived')

    def test_validate_rejects_unknown(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status('paused')

    def test_validate_rejects_empty(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status('')

    def test_validate_rejects_none(self):
        with self.assertRaisesRegex(ValueError, 'org status'):
            database._validate_org_status(None)
