"""Template render test for the email verification code outbox template."""
from __future__ import annotations

import unittest
from unittest.mock import patch


class EmailVerificationTemplateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_subject_is_generic(self):
        subject = self.main._TEMPLATE_SUBJECTS['email_verification_code']({'code': '123456'})
        self.assertEqual(subject, 'Verify your Lingual email')

    def test_html_contains_code_but_subject_does_not(self):
        subject = self.main._TEMPLATE_SUBJECTS['email_verification_code']({'code': '123456'})
        _, html = self.main.render_template(
            'email_verification_code',
            {'name': 'Jamie', 'code': '123456'},
        )
        self.assertIn('123456', html)
        self.assertIn('Jamie', html)
        self.assertNotIn('123456', subject)
