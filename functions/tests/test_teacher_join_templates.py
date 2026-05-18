"""Template render tests for Plan 4 outbox templates."""
from __future__ import annotations

import unittest
from unittest.mock import patch


class TeacherJoinTemplatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_request_to_admin_subject(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_request_to_admin']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'New teacher request to join SF Friends')

    def test_request_to_admin_html(self):
        subject, html = self.main.render_template(
            'teacher_join_request_to_admin',
            {
                'org_name': 'SF Friends',
                'requester_name': 'Jane Doe',
                'requester_email': 'jane@sfs.org',
                'source_label': 'invite code',
                'review_url': 'https://lingual.app/app/teacher#pending-requests',
            },
        )
        self.assertIn('SF Friends', html)
        self.assertIn('Jane Doe', html)
        self.assertIn('jane@sfs.org', html)
        self.assertIn('invite code', html)
        self.assertIn('https://lingual.app/app/teacher#pending-requests', html)

    def test_approved_subject_and_html(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_approved']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'Welcome to SF Friends on Lingual')
        _, html = self.main.render_template(
            'teacher_join_approved',
            {'org_name': 'SF Friends', 'dashboard_url': 'https://lingual.app/app/teacher'},
        )
        self.assertIn('SF Friends', html)
        self.assertIn('https://lingual.app/app/teacher', html)

    def test_declined_subject_and_html(self):
        subject = self.main._TEMPLATE_SUBJECTS['teacher_join_declined']({
            'org_name': 'SF Friends',
        })
        self.assertEqual(subject, 'Your request to join SF Friends was not approved')
        _, html = self.main.render_template(
            'teacher_join_declined',
            {
                'org_name': 'SF Friends',
                'decline_reason': 'Please use your school email.',
                'retry_url': 'https://lingual.app/signup/teacher/join-org',
            },
        )
        self.assertIn('Please use your school email.', html)
        self.assertIn('https://lingual.app/signup/teacher/join-org', html)


if __name__ == '__main__':
    unittest.main()
