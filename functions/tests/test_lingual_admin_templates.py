"""Template render tests for Plan 5 Lingual-admin org lifecycle templates."""
from __future__ import annotations

import unittest
from unittest.mock import patch


class OrgSuspendedTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_subject_includes_org_name(self):
        subject_fn = self.main._TEMPLATE_SUBJECTS['org_suspended']
        out = subject_fn({'org_name': 'Sunset HS'})
        self.assertIn('Sunset HS', out)
        self.assertIn('suspended', out.lower())

    def test_render_includes_reason_and_until(self):
        _, html = self.main.render_template('org_suspended', {
            'org_name': 'Sunset HS',
            'reason': 'Pending compliance review',
            'suspended_until': '2026-06-01',
            'support_email': 'help@l1ngual.com',
        })
        self.assertIn('Sunset HS', html)
        self.assertIn('Pending compliance review', html)
        self.assertIn('2026-06-01', html)
        self.assertIn('help@l1ngual.com', html)

    def test_render_omits_until_when_indefinite(self):
        _, html = self.main.render_template('org_suspended', {
            'org_name': 'Sunset HS',
            'reason': 'X',
            'suspended_until': None,
            'support_email': 'help@l1ngual.com',
        })
        self.assertNotIn('2026', html)

    def test_reason_is_html_escaped(self):
        _, html = self.main.render_template('org_suspended', {
            'org_name': 'Sunset HS',
            'reason': '<script>alert(1)</script>',
            'suspended_until': None,
            'support_email': 'help@l1ngual.com',
        })
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)


class OrgRestoredTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch('firebase_admin.initialize_app'):
            from functions import main  # noqa: F401
            cls.main = main

    def test_subject_includes_org_name(self):
        subject_fn = self.main._TEMPLATE_SUBJECTS['org_restored']
        out = subject_fn({'org_name': 'Sunset HS'})
        self.assertIn('Sunset HS', out)
        self.assertIn('restored', out.lower())

    def test_render_includes_dashboard_link(self):
        _, html = self.main.render_template('org_restored', {
            'org_name': 'Sunset HS',
            'dashboard_url': 'https://l1ngual.com/app/admin',
        })
        self.assertIn('Sunset HS', html)
        self.assertIn('https://l1ngual.com/app/admin', html)


if __name__ == '__main__':
    unittest.main()
