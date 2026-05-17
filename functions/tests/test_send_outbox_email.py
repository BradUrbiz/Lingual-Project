import os
import sys
import unittest
from unittest.mock import patch, MagicMock


class ResendClientTest(unittest.TestCase):
    def setUp(self):
        # Force a clean import of functions.main on each test so module-level
        # initialization (initialize_app, env reads) happens with the test's env.
        sys.modules.pop('functions.main', None)

    def test_send_in_dev_mode_returns_dev_sentinel(self):
        # Force dev mode: no API key in env.
        with patch.dict(os.environ, {}, clear=True):
            with patch('firebase_admin.initialize_app'):
                from functions.main import send_via_resend

                result = send_via_resend(
                    to_email='admin@lingual.app',
                    to_name='Pat',
                    subject='Test',
                    html='<p>hi</p>',
                )
                self.assertEqual(result, {'mode': 'dev', 'message_id': None})

    def test_send_in_live_mode_calls_resend(self):
        with patch.dict(os.environ, {
            'RESEND_API_KEY': 'rk_test',
            'RESEND_FROM_ADDRESS': 'Lingual <noreply@lingual.app>',
        }):
            with patch('firebase_admin.initialize_app'):
                with patch('functions.main.resend') as mock_resend:
                    mock_resend.Emails.send.return_value = {'id': 'msg_123'}
                    from functions.main import send_via_resend

                    result = send_via_resend(
                        to_email='admin@lingual.app',
                        to_name='Pat',
                        subject='Test',
                        html='<p>hi</p>',
                    )
                    self.assertEqual(result, {'mode': 'live', 'message_id': 'msg_123'})
                    mock_resend.Emails.send.assert_called_once()
                    payload = mock_resend.Emails.send.call_args[0][0]
                    self.assertEqual(payload['to'], ['Pat <admin@lingual.app>'])
                    self.assertEqual(payload['from'], 'Lingual <noreply@lingual.app>')
                    self.assertEqual(payload['subject'], 'Test')

    def test_send_in_live_mode_without_name_uses_bare_email(self):
        with patch.dict(os.environ, {'RESEND_API_KEY': 'rk_test'}):
            with patch('firebase_admin.initialize_app'):
                with patch('functions.main.resend') as mock_resend:
                    mock_resend.Emails.send.return_value = {'id': 'msg_456'}
                    from functions.main import send_via_resend

                    send_via_resend(
                        to_email='admin@lingual.app',
                        to_name=None,
                        subject='Test',
                        html='<p>hi</p>',
                    )
                    payload = mock_resend.Emails.send.call_args[0][0]
                    self.assertEqual(payload['to'], ['admin@lingual.app'])


class RenderTemplateTest(unittest.TestCase):
    def setUp(self):
        sys.modules.pop('functions.main', None)

    def test_renders_school_request_to_lingual(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import render_template

            subject, html = render_template(
                'school_request_to_lingual',
                {
                    'org_name': 'SF Friends School',
                    'requester_name': 'Pat',
                    'requester_email': 'pat@sfschool.edu',
                    'review_url': 'https://lingual.app/app/lingual-admin/requests',
                },
            )

            self.assertEqual(subject, 'New school registration: SF Friends School')
            self.assertIn('SF Friends School', html)
            self.assertIn('https://lingual.app/app/lingual-admin/requests', html)

    def test_unknown_template_raises(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import render_template
            with self.assertRaises(KeyError):
                render_template('made_up_template', {})
