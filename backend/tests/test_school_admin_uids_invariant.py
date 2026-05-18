"""Regression: organizations.school_admin_uids must stay in sync with school_admin memberships.

This test exercises the create path that Plan 4 wires (the only path that
exists today). Plan 5+ MUST extend coverage when adding removal paths.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import database


class SchoolAdminUidsCreatePathTest(unittest.TestCase):
    def test_create_membership_with_school_admin_role_syncs_array(self):
        captured_updates: list[dict] = []

        fake_org_doc = MagicMock()
        fake_org_doc.update.side_effect = lambda payload: captured_updates.append(payload)

        fake_org_collection = MagicMock()
        fake_org_collection.document.return_value = fake_org_doc

        fake_membership_doc = MagicMock()
        fake_membership_doc.id = 'mem-1'

        fake_membership_collection = MagicMock()
        fake_membership_collection.document.return_value = fake_membership_doc

        with (
            patch('database.get_organizations_collection', return_value=fake_org_collection),
            patch('database.get_memberships_collection', return_value=fake_membership_collection),
        ):
            database.create_membership(
                org_id='org-1',
                uid='admin-1',
                roles=['school_admin'],
            )

        # At least one update on the org doc should set school_admin_uids via ArrayUnion.
        self.assertTrue(
            any('school_admin_uids' in u for u in captured_updates),
            f"create_membership(roles=['school_admin']) did not sync the org array. "
            f"captured updates: {captured_updates}",
        )

    def test_create_membership_without_school_admin_role_does_not_touch_array(self):
        captured_updates: list[dict] = []

        fake_org_doc = MagicMock()
        fake_org_doc.update.side_effect = lambda payload: captured_updates.append(payload)

        fake_org_collection = MagicMock()
        fake_org_collection.document.return_value = fake_org_doc

        fake_membership_doc = MagicMock()
        fake_membership_doc.id = 'mem-2'

        fake_membership_collection = MagicMock()
        fake_membership_collection.document.return_value = fake_membership_doc

        with (
            patch('database.get_organizations_collection', return_value=fake_org_collection),
            patch('database.get_memberships_collection', return_value=fake_membership_collection),
        ):
            database.create_membership(
                org_id='org-1',
                uid='teacher-1',
                roles=['teacher'],  # no school_admin
            )

        self.assertFalse(
            any('school_admin_uids' in u for u in captured_updates),
            "create_membership with teacher-only roles should NOT update school_admin_uids",
        )


if __name__ == '__main__':
    unittest.main()
