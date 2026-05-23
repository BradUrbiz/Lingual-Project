import unittest
from unittest.mock import patch

import database


class MarkUserLegacyRolePickedTests(unittest.TestCase):
    @patch('database.update_user_profile')
    def test_student_writes_complete(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='student')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='student',
            onboarding_state='complete',
        )

    @patch('database.update_user_profile')
    def test_teacher_writes_role_selected(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='teacher')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='teacher',
            onboarding_state='role_selected',
        )

    @patch('database.update_user_profile')
    def test_admin_writes_role_selected(self, mock_update):
        database.mark_user_legacy_role_picked(uid='u1', role='admin')
        mock_update.assert_called_once_with(
            uid='u1',
            intended_role='admin',
            onboarding_state='role_selected',
        )

    def test_rejects_unknown_role(self):
        with self.assertRaisesRegex(ValueError, 'role'):
            database.mark_user_legacy_role_picked(uid='u1', role='principal')

    def test_rejects_empty_role(self):
        with self.assertRaisesRegex(ValueError, 'role'):
            database.mark_user_legacy_role_picked(uid='u1', role='')

    def test_rejects_empty_uid(self):
        with self.assertRaisesRegex(ValueError, 'uid'):
            database.mark_user_legacy_role_picked(uid='', role='student')
