import unittest
from unittest.mock import MagicMock, patch

import database


class OnboardingConstantsTest(unittest.TestCase):
    def test_intended_role_constants_are_exposed(self):
        self.assertEqual(database.INTENDED_ROLE_STUDENT, 'student')
        self.assertEqual(database.INTENDED_ROLE_TEACHER, 'teacher')
        self.assertEqual(database.INTENDED_ROLE_ADMIN, 'admin')
        self.assertEqual(
            database.ALLOWED_INTENDED_ROLES,
            frozenset({'student', 'teacher', 'admin'}),
        )

    def test_onboarding_state_constants_are_exposed(self):
        self.assertEqual(database.ONBOARDING_STATE_ROLE_SELECTED, 'role_selected')
        self.assertEqual(database.ONBOARDING_STATE_STUDENT_SETUP, 'student_setup')
        self.assertEqual(database.ONBOARDING_STATE_TEACHER_PENDING, 'teacher_pending')
        self.assertEqual(database.ONBOARDING_STATE_ORG_CREATION_PENDING, 'org_creation_pending')
        self.assertEqual(database.ONBOARDING_STATE_AWAITING_LINGUAL, 'awaiting_lingual')
        self.assertEqual(database.ONBOARDING_STATE_COMPLETE, 'complete')
        self.assertEqual(
            database.ALLOWED_ONBOARDING_STATES,
            frozenset({
                'role_selected',
                'student_setup',
                'teacher_pending',
                'org_creation_pending',
                'awaiting_lingual',
                'complete',
            }),
        )


class UpdateUserProfileOnboardingTest(unittest.TestCase):
    @patch('database.get_user_ref')
    def test_writes_intended_role(self, mock_get_user_ref):
        user_ref = MagicMock()
        mock_get_user_ref.return_value = user_ref

        database.update_user_profile('uid-1', intended_role='teacher')

        # update() is called with the full payload dict; check the field is present.
        args, kwargs = user_ref.update.call_args
        self.assertEqual(args[0]['profile.intended_role'], 'teacher')

    @patch('database.get_user_ref')
    def test_writes_onboarding_state(self, mock_get_user_ref):
        user_ref = MagicMock()
        mock_get_user_ref.return_value = user_ref

        database.update_user_profile('uid-1', onboarding_state='role_selected')

        args, _ = user_ref.update.call_args
        self.assertEqual(args[0]['profile.onboarding_state'], 'role_selected')

    def test_rejects_invalid_intended_role(self):
        with self.assertRaisesRegex(ValueError, 'Invalid intended_role'):
            database.update_user_profile('uid-1', intended_role='superuser')

    def test_rejects_invalid_onboarding_state(self):
        with self.assertRaisesRegex(ValueError, 'Invalid onboarding_state'):
            database.update_user_profile('uid-1', onboarding_state='not-a-state')


class IsLegacyUserNeedingRolePickTest(unittest.TestCase):
    def test_no_role_and_no_memberships_needs_pick(self):
        user_doc = {'profile': {'display_name': 'Pat'}}
        self.assertTrue(database.is_legacy_user_needing_role_pick(user_doc, []))

    def test_user_with_intended_role_does_not_need_pick(self):
        user_doc = {'profile': {'intended_role': 'student'}}
        self.assertFalse(database.is_legacy_user_needing_role_pick(user_doc, []))

    def test_user_with_onboarding_state_does_not_need_pick(self):
        user_doc = {'profile': {'onboarding_state': 'complete'}}
        self.assertFalse(database.is_legacy_user_needing_role_pick(user_doc, []))

    def test_user_with_active_membership_does_not_need_pick(self):
        user_doc = {'profile': {}}
        memberships = [{'status': 'active', 'roles': ['teacher']}]
        self.assertFalse(database.is_legacy_user_needing_role_pick(user_doc, memberships))

    def test_user_with_only_invited_membership_still_needs_pick(self):
        """status='invited' is not yet active; counts as no membership."""
        user_doc = {'profile': {}}
        memberships = [{'status': 'invited', 'roles': ['teacher']}]
        self.assertTrue(database.is_legacy_user_needing_role_pick(user_doc, memberships))
