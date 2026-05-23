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
                    'review_url': 'https://lingual.app/lingual-admin/requests',
                },
            )

            self.assertEqual(subject, 'New school registration: SF Friends School')
            self.assertIn('SF Friends School', html)
            self.assertIn('https://lingual.app/lingual-admin/requests', html)

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

    def _claimed_payload(self, payload):
        claimed = dict(payload)
        claimed['status'] = 'sending'
        claimed['attempt_count'] = int(payload.get('attempt_count') or 0) + 1
        return claimed

    def test_claim_pending_doc_updates_status_inside_transaction(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _claim_pending_outbox_email

            snapshot = MagicMock()
            snapshot.exists = True
            snapshot.to_dict.return_value = {
                'status': 'pending',
                'attempt_count': 2,
                'template_id': 'school_request_to_lingual',
            }
            ref = MagicMock()
            ref.get.return_value = snapshot
            transaction = MagicMock()
            mock_db = MagicMock()
            mock_db.transaction.return_value = transaction

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                claimed = _claim_pending_outbox_email(ref)

            self.assertIsNotNone(claimed)
            self.assertEqual(claimed['status'], 'sending')
            self.assertEqual(claimed['attempt_count'], 3)
            transaction.update.assert_called_once()
            update_ref, update_payload = transaction.update.call_args.args
            self.assertEqual(update_ref, ref)
            self.assertEqual(update_payload['status'], 'sending')
            self.assertEqual(update_payload['attempt_count'], 3)
            self.assertIn('last_attempt_at', update_payload)
            ref.update.assert_not_called()

    def test_claim_non_pending_doc_returns_none_without_transaction_update(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _claim_pending_outbox_email

            snapshot = MagicMock()
            snapshot.exists = True
            snapshot.to_dict.return_value = {'status': 'sending', 'attempt_count': 1}
            ref = MagicMock()
            ref.get.return_value = snapshot
            transaction = MagicMock()
            mock_db = MagicMock()
            mock_db.transaction.return_value = transaction

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                claimed = _claim_pending_outbox_email(ref)

            self.assertIsNone(claimed)
            transaction.update.assert_not_called()

    def test_pending_event_skips_send_when_transaction_claim_loses_race(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            ev = self._make_event({'status': 'pending', 'attempt_count': 0})
            with patch('functions.main._claim_pending_outbox_email', return_value=None), \
                 patch('functions.main.render_template') as mock_render, \
                 patch('functions.main.send_via_resend') as mock_send:
                _send_outbox_email_impl(ev)

            mock_render.assert_not_called()
            mock_send.assert_not_called()
            ev.data.after.reference.update.assert_not_called()

    def test_pending_email_sends_and_updates_doc(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render, \
                 patch('functions.main._claim_pending_outbox_email') as mock_claim:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.return_value = {'mode': 'live', 'message_id': 'msg_999'}

                payload = {
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
                }
                mock_claim.return_value = self._claimed_payload(payload)
                ev = self._make_event(payload)

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            statuses = [c.args[0]['status'] for c in update_calls]
            self.assertIn('sent', statuses)
            sent_call = next(c for c in update_calls if c.args[0]['status'] == 'sent')
            self.assertEqual(sent_call.args[0]['resend_message_id'], 'msg_999')

    def test_dev_mode_marks_sent_dev(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render, \
                 patch('functions.main._claim_pending_outbox_email') as mock_claim:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.return_value = {'mode': 'dev', 'message_id': None}

                payload = {
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
                }
                mock_claim.return_value = self._claimed_payload(payload)
                ev = self._make_event(payload)

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            statuses = [c.args[0]['status'] for c in update_calls]
            self.assertIn('sent_dev', statuses)

    def test_resend_failure_marks_failed_with_retry_remaining(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render, \
                 patch('functions.main._claim_pending_outbox_email') as mock_claim:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.side_effect = RuntimeError('boom')

                payload = {
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
                }
                mock_claim.return_value = self._claimed_payload(payload)
                ev = self._make_event(payload)

                _send_outbox_email_impl(ev)

            update_calls = ev.data.after.reference.update.call_args_list
            final = update_calls[-1].args[0]
            self.assertEqual(final['status'], 'failed')
            self.assertEqual(final['attempt_count'], 3)
            self.assertIn('boom', final['error'])

    def test_attempts_exhausted_marks_dead_letter(self):
        # Doc is pending with attempt_count=4; next attempt becomes 5 → terminal.
        # (The trigger only processes 'pending'; sweep promotes failed→pending
        # before the trigger runs, so by the time we see attempt_count=4 the
        # status will have been reset to 'pending' by the sweep.)
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            with patch('functions.main.send_via_resend') as mock_send, \
                 patch('functions.main.render_template') as mock_render, \
                 patch('functions.main._claim_pending_outbox_email') as mock_claim:
                mock_render.return_value = ('Subject', '<p>hi</p>')
                mock_send.side_effect = RuntimeError('boom')

                payload = {
                    'recipient': {'email': 'admin@lingual.app', 'name': 'Pat'},
                    'template_id': 'school_request_to_lingual',
                    'template_data': {
                        'org_name': 'X',
                        'requester_name': 'P',
                        'requester_email': 'p@x',
                        'review_url': 'https://x',
                    },
                    'status': 'pending',
                    'attempt_count': 4,  # next attempt would be 5 → terminal
                }
                mock_claim.return_value = self._claimed_payload(payload)
                ev = self._make_event(payload)

                _send_outbox_email_impl(ev)

            final_status = ev.data.after.reference.update.call_args_list[-1].args[0]['status']
            self.assertEqual(final_status, 'dead_letter')

    def test_failed_doc_is_skipped(self):
        # Trigger must exit immediately for status='failed'; the sweep is
        # responsible for promoting failed→pending before the trigger runs.
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            ev = self._make_event({'status': 'failed', 'attempt_count': 2})
            _send_outbox_email_impl(ev)
            ev.data.after.reference.update.assert_not_called()

    def test_already_sent_doc_is_skipped(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _send_outbox_email_impl

            ev = self._make_event({'status': 'sent', 'attempt_count': 1})
            _send_outbox_email_impl(ev)
            ev.data.after.reference.update.assert_not_called()


class RetryOutboxSweepTest(unittest.TestCase):
    def setUp(self):
        sys.modules.pop('functions.main', None)

    def _make_sweep_db(self, failed_docs, pending_docs):
        """Return a mock Firestore client that routes where() by status value."""
        mock_db = MagicMock()

        def where_router(field, op, val):
            q = MagicMock()
            if val == 'failed':
                q.stream.return_value = failed_docs
            elif val == 'pending':
                q.stream.return_value = pending_docs
            else:
                q.stream.return_value = []
            return q

        mock_db.collection.return_value.where.side_effect = where_router
        return mock_db

    def test_failed_docs_under_max_attempts_are_repromoted(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _retry_outbox_sweep_impl

            doc1 = MagicMock()
            doc1.to_dict.return_value = {'status': 'failed', 'attempt_count': 2}
            doc1.reference = MagicMock()

            doc2 = MagicMock()
            doc2.to_dict.return_value = {'status': 'failed', 'attempt_count': 5}
            doc2.reference = MagicMock()

            mock_db = self._make_sweep_db(failed_docs=[doc1, doc2], pending_docs=[])

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                _retry_outbox_sweep_impl()

            # doc1 (attempt_count=2 < 5) is repromoted.
            doc1.reference.update.assert_called_once()
            self.assertEqual(doc1.reference.update.call_args[0][0]['status'], 'pending')
            # doc2 (attempt_count=5 >= 5) is NOT touched.
            doc2.reference.update.assert_not_called()

    def test_empty_query_is_noop(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _retry_outbox_sweep_impl

            mock_db = self._make_sweep_db(failed_docs=[], pending_docs=[])

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                _retry_outbox_sweep_impl()
            # No exception, no updates — passes implicitly.

    def test_stuck_pending_doc_is_touched_to_fire_trigger(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _retry_outbox_sweep_impl

            pending_stuck = MagicMock()
            pending_stuck.to_dict.return_value = {
                'status': 'pending', 'attempt_count': 0,
                # no scheduled_for → treat as immediately due
            }
            pending_stuck.reference = MagicMock()

            pending_in_progress = MagicMock()
            pending_in_progress.to_dict.return_value = {
                'status': 'pending', 'attempt_count': 1,  # trigger already started it
            }
            pending_in_progress.reference = MagicMock()

            mock_db = self._make_sweep_db(
                failed_docs=[],
                pending_docs=[pending_stuck, pending_in_progress],
            )

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                _retry_outbox_sweep_impl()

            # Stuck pending (attempt_count=0, no scheduled_for) gets touched.
            pending_stuck.reference.update.assert_called_once()
            updated_payload = pending_stuck.reference.update.call_args[0][0]
            self.assertIn('last_swept_at', updated_payload)
            # In-progress pending (attempt_count=1) is NOT touched.
            pending_in_progress.reference.update.assert_not_called()

    def test_future_scheduled_pending_doc_is_not_touched(self):
        import datetime as dt
        with patch('firebase_admin.initialize_app'):
            from functions.main import _retry_outbox_sweep_impl

            future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)

            pending_future = MagicMock()
            pending_future.to_dict.return_value = {
                'status': 'pending',
                'attempt_count': 0,
                'scheduled_for': future,
            }
            pending_future.reference = MagicMock()

            mock_db = self._make_sweep_db(failed_docs=[], pending_docs=[pending_future])

            with patch('functions.main.fb_firestore.client', return_value=mock_db):
                _retry_outbox_sweep_impl()

            # Future-scheduled doc must NOT be touched yet.
            pending_future.reference.update.assert_not_called()


class TemplateSubjectTableTest(unittest.TestCase):
    def test_approved_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['school_request_approved']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'Your school SF Friends is now on Lingual',
        )

    def test_declined_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['school_request_declined']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'Your school registration needs more info',
        )

    def test_invitation_subject_contains_org_name(self):
        with patch('firebase_admin.initialize_app'):
            from functions.main import _TEMPLATE_SUBJECTS
        builder = _TEMPLATE_SUBJECTS['teacher_invitation']
        self.assertEqual(
            builder({'org_name': 'SF Friends'}),
            'SF Friends is inviting you to teach on Lingual',
        )
