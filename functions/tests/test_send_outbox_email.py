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


from datetime import datetime, timezone


class SendOutboxEmailTriggerTest(unittest.TestCase):
    def setUp(self):
        sys.modules.pop('functions.main', None)

    def _make_event(self, after_dict):
        ev = MagicMock()
        ev.data = MagicMock()
        ev.data.after = MagicMock()
        ev.data.after.to_dict.return_value = after_dict
        ev.data.after.reference = MagicMock()
        ev.params = {'emailId': 'em-1'}
        return ev

    def test_pending_email_sends_and_updates_doc(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.return_value = {'mode': 'live', 'message_id': 'msg_999'}

                ev = self._make_event({
                    'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                    'template_id': 'school_request_to_lingual',
                    'template_data': {
                        'org_name': 'X',
                        'requester_name': 'P',
                        'requester_email': 'p@x',
                        'review_url': 'https://x',
                    },
                    'status': 'pending',
                    'attempt_count': 0,
                })

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            statuses = [c.args[0]['status'] for c in update_calls]
            self.assertIn('sending', statuses)
            self.assertIn('sent', statuses)
            sent_call = next(c for c in update_calls if c.args[0]['status'] == 'sent')
            self.assertEqual(sent_call.args[0]['resend_message_id'], 'msg_999')

    def test_dev_mode_marks_sent_dev(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.return_value = {'mode': 'dev', 'message_id': None}

                ev = self._make_event({
                    'recipient': {'email': 'admin@lingual.app', 'name': None},
                    'template_id': 'school_request_to_lingual',
                    'template_data': {
                        'org_name': 'X',
                        'requester_name': 'P',
                        'requester_email': 'p@x',
                        'review_url': 'https://x',
                    },
                    'status': 'pending',
                    'attempt_count': 0,
                })

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            statuses = [c.args[0]['status'] for c in update_calls]
            self.assertIn('sent_dev', statuses)

    def test_resend_failure_marks_failed_with_retry_remaining(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.side_effect = RuntimeError('boom')

                ev = self._make_event({
                    'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                    'template_id': 'school_request_to_lingual',
                    'template_data': {
                        'org_name': 'X',
                        'requester_name': 'P',
                        'requester_email': 'p@x',
                        'review_url': 'https://x',
                    },
                    'status': 'pending',
                    'attempt_count': 2,
                })

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            final = update_calls[-1].args[0]
            self.assertEqual(final['status'], 'failed')
            self.assertEqual(final['attempt_count'], 3)
            self.assertIn('boom', final['error'])

    def test_attempts_exhausted_marks_dead_letter(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.side_effect = RuntimeError('boom')

                ev = self._make_event({
                    'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                    'template_id': 'school_request_to_lingual',
                    'template_data': {
                        'org_name': 'X',
                        'requester_name': 'P',
                        'requester_email': 'p@x',
                        'review_url': 'https://x',
                    },
                    'status': 'failed',
                    'attempt_count': 4,  # next attempt would be 5 → terminal
                })

                _send_outbox_email_impl(ev)

            final_status = ev.data.after.reference.update.call_args_list[-1].args[0]['status']
            self.assertEqual(final_status, 'dead_letter')

    def test_already_sent_doc_is_skipped(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            ev = self._make_event({'status': 'sent', 'attempt_count': 1})
            _send_outbox_email_impl(ev)
            ev.data.after.reference.update.assert_not_called()
