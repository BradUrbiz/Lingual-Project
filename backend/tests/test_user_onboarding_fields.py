import unittest

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
