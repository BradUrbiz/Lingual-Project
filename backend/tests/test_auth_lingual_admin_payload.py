import unittest
from unittest.mock import MagicMock

import database


class ResolveUserSchoolContextLingualAdminTests(unittest.TestCase):
    """`resolve_user_school_context` must set `lingual_admin` from the union of
    (a) the legacy `users/{uid}.lingual_admin` boolean and (b) any active
    membership whose roles include 'lingual_admin'."""

    def setUp(self):
        self.original_get_db = database.get_db
        self.original_get_user_memberships = database.get_user_memberships
        self.original_get_user = database.get_user
        self.original_is_legacy = database.is_legacy_user_needing_role_pick

    def tearDown(self):
        database.get_db = self.original_get_db
        database.get_user_memberships = self.original_get_user_memberships
        database.get_user = self.original_get_user
        database.is_legacy_user_needing_role_pick = self.original_is_legacy

    def _patch(self, *, user_doc, memberships):
        database.get_user_memberships = MagicMock(return_value=memberships)
        database.get_user = MagicMock(return_value=user_doc)
        database.is_legacy_user_needing_role_pick = MagicMock(return_value=False)

    def test_legacy_flag_alone_grants_lingual_admin(self):
        self._patch(
            user_doc={'lingual_admin': True, 'profile': {}},
            memberships=[],
        )
        ctx = database.resolve_user_school_context('uid-legacy')
        self.assertTrue(ctx['lingual_admin'])

    def test_membership_role_alone_grants_lingual_admin(self):
        self._patch(
            user_doc={'profile': {}},
            memberships=[{
                'id': 'm1',
                'orgId': 'org-1',
                'status': 'active',
                'roles': ['lingual_admin'],
            }],
        )
        ctx = database.resolve_user_school_context('uid-membership')
        self.assertTrue(ctx['lingual_admin'])

    def test_invited_membership_does_not_grant(self):
        self._patch(
            user_doc={'profile': {}},
            memberships=[{
                'id': 'm1',
                'orgId': 'org-1',
                'status': 'invited',
                'roles': ['lingual_admin'],
            }],
        )
        ctx = database.resolve_user_school_context('uid-invited')
        self.assertFalse(ctx['lingual_admin'])

    def test_no_signal_returns_false(self):
        self._patch(
            user_doc={'profile': {}},
            memberships=[],
        )
        ctx = database.resolve_user_school_context('uid-plain')
        self.assertFalse(ctx['lingual_admin'])


class BuildAuthUserPayloadLingualAdminTests(unittest.TestCase):
    def test_payload_exposes_lingual_admin(self):
        from backend.routes.auth import build_auth_user_payload

        payload = build_auth_user_payload(
            uid='u1',
            email='admin@lingual.app',
            name='Admin',
            school_context={
                'memberships': [],
                'active_membership_id': None,
                'active_organization_id': None,
                'active_roles': [],
                'lingual_admin': True,
            },
        )
        self.assertTrue(payload['lingualAdmin'])

    def test_payload_defaults_lingual_admin_false_when_missing(self):
        from backend.routes.auth import build_auth_user_payload

        payload = build_auth_user_payload(
            uid='u1',
            email='student@school.edu',
            name='Student',
            school_context={
                'memberships': [],
                'active_membership_id': None,
                'active_organization_id': None,
                'active_roles': [],
            },
        )
        self.assertFalse(payload['lingualAdmin'])


if __name__ == '__main__':
    unittest.main()
