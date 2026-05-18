import os
import sys
import unittest
from unittest.mock import patch


class SchoolRequestDecisionTemplateRenderTest(unittest.TestCase):
    def setUp(self):
        # Force a clean import of functions.main on each test so module-level
        # initialization (initialize_app, env reads) happens with the test's env.
        sys.modules.pop('functions.main', None)

    def _render(self, template_id, data):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _JINJA_ENV
        return _JINJA_ENV.get_template(f'{template_id}.html.j2').render(**data)

    def test_approved_template_renders(self):
        html = self._render('school_request_approved', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'login_url': 'https://lingual.app/login',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Ada', html)
        self.assertIn('https://lingual.app/login', html)

    def test_declined_template_renders_with_reason(self):
        html = self._render('school_request_declined', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'reason': 'Website not reachable.',
            'category': 'info_missing',
            'support_url': 'mailto:support@lingual.app',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Website not reachable.', html)
        self.assertIn('mailto:support@lingual.app', html)

    def test_declined_template_renders_without_reason(self):
        # Reason may be omitted; the template must still render.
        html = self._render('school_request_declined', {
            'org_name': 'SF Friends',
            'requester_name': 'Ada',
            'reason': '',
            'category': 'other',
            'support_url': 'mailto:support@lingual.app',
        })
        self.assertIn('SF Friends', html)

    def test_teacher_invitation_template_renders(self):
        html = self._render('teacher_invitation', {
            'org_name': 'SF Friends',
            'inviter_name': 'Ada Lovelace',
            'signup_url': 'https://lingual.app/signup?role=teacher',
        })
        self.assertIn('SF Friends', html)
        self.assertIn('Ada Lovelace', html)
        self.assertIn('https://lingual.app/signup?role=teacher', html)


if __name__ == '__main__':
    unittest.main()
