"""Integration test: school request submission enqueues outbox emails for each lingual admin."""
import unittest
from unittest.mock import MagicMock, call, patch

from flask import session

from backend.routes.school_requests import create_school_requests_blueprint
from backend.tests.conftest import (
    FakeDbBase,
    make_test_deps,
    make_test_app,
)
from datetime import UTC, datetime


class FakeSchoolRequestOutboxDb(FakeDbBase):
    """FakeDb with school_requests store and list_lingual_admin_emails support."""

    def __init__(self):
        super().__init__()
        self.school_requests: dict = {}
        self._sr_counter = 0
        self._lingual_admins: list = []

    # -- School request methods --

    def create_school_request(self, requester_uid, requester_email, requester_name,
                              school_name, org_type, website_url='', canvas_instance_url='',
                              enriched=None):
        self._sr_counter += 1
        request_id = f'sr-{self._sr_counter}'
        self.school_requests[request_id] = {
            'id': request_id,
            'requester_uid': requester_uid,
            'requester_email': requester_email,
            'requester_name': requester_name,
            'school_name': school_name,
            'org_type': org_type,
            'website_url': website_url or '',
            'canvas_instance_url': canvas_instance_url or '',
            'status': 'pending',
            'reviewed_by_uid': None,
            'reviewed_at': None,
            'rejection_reason': None,
            'created_org_id': None,
            'created_at': datetime.now(UTC),
        }
        return request_id

    def get_school_request(self, request_id):
        r = self.school_requests.get(request_id)
        return dict(r) if r else None

    def get_user_school_request(self, uid):
        matches = [
            r for r in self.school_requests.values()
            if r.get('requester_uid') == uid
        ]
        if not matches:
            return None
        matches.sort(key=lambda r: r.get('created_at') or '', reverse=True)
        return dict(matches[0])

    def get_user_field(self, uid, field):
        user = self.users.get(uid)
        if user:
            return user.get(field)
        return None

    # -- list_lingual_admin_emails is a module-level function in database.py;
    #    the route patches it. This method is here only for completeness and is
    #    not called directly by the route.
    def _seed_lingual_admins(self, admins):
        self._lingual_admins = admins


class SchoolRequestOutboxIntegrationTest(unittest.TestCase):
    """Verify that submit_school_request enqueues one outbox email per lingual admin."""

    def setUp(self):
        self.db = FakeSchoolRequestOutboxDb()

        # Seed the requester
        self.db.users['requester-1'] = {
            'uid': 'requester-1',
            'name': 'Alice Teacher',
            'email': 'alice@example.com',
            'profile': {'display_name': 'Alice Teacher'},
        }

        # Seed two lingual admins (returned by list_lingual_admin_emails mock)
        self._lingual_admins = [
            {'uid': 'la-1', 'email': 'admin1@lingual.app', 'name': 'Admin One'},
            {'uid': 'la-2', 'email': 'admin2@lingual.app', 'name': 'Admin Two'},
        ]

        deps = make_test_deps(db=self.db)
        bp = create_school_requests_blueprint(deps)
        self.app = make_test_app(bp)
        self.app.config['TESTING'] = True

    def _set_session(self, client, uid):
        user = self.db.users.get(uid) or {}
        email = user.get('email') or f'{uid}@test.com'
        name = (user.get('profile') or {}).get('display_name') or user.get('name') or ''
        with client.session_transaction() as sess:
            sess['user'] = {'uid': uid, 'email': email, 'name': name}

    def _valid_payload(self, school_name):
        return {
            'schoolName': school_name,
            'orgType': 'school',
            'websiteUrl': 'https://sfschool.edu',
            'location': {'country': 'US', 'state': 'CA'},
            'schoolType': 'k12',
            'publicPrivate': 'private',
            'gradeSize': '100-200',
            'adminIdentity': {
                'fullName': 'Alice Teacher',
                'schoolEmail': 'alice@example.com',
                'roleTitle': 'Principal',
                'authorizationAttested': True,
            },
        }

    def test_submission_enqueues_outbox_email_per_lingual_admin(self):
        """One enqueue_outbox_email call per lingual admin on successful submission."""
        lingual_admins = self._lingual_admins

        with patch(
            'backend.routes.school_requests.enqueue_outbox_email'
        ) as mock_enq, patch(
            'backend.routes.school_requests.list_lingual_admin_emails',
            return_value=lingual_admins,
        ), patch(
            'backend.routes.school_requests.database.get_db',
            return_value=MagicMock(),
        ):
            with self.app.test_client() as client:
                self._set_session(client, 'requester-1')
                resp = client.post(
                    '/api/school-requests',
                    json=self._valid_payload('SF Friends School'),
                )
                self.assertIn(resp.status_code, (200, 201))
                self.assertEqual(mock_enq.call_count, 2)

                sent_emails = sorted(
                    c.kwargs['recipient_email'] for c in mock_enq.call_args_list
                )
                self.assertEqual(sent_emails, ['admin1@lingual.app', 'admin2@lingual.app'])

                for c in mock_enq.call_args_list:
                    self.assertEqual(
                        c.kwargs['template'].value, 'school_request_to_lingual'
                    )
                    self.assertIn('org_name', c.kwargs['template_data'])
                    self.assertEqual(c.kwargs['related_entity_type'], 'school_request')
                    self.assertTrue(
                        c.kwargs['template_data']['review_url'].endswith('/lingual-admin/requests'),
                        msg=f"review_url should point at live admin route, got: {c.kwargs['template_data']['review_url']}",
                    )

    def test_outbox_failure_does_not_break_submission(self):
        """If enqueue_outbox_email raises, the submission still returns 201."""
        lingual_admins = self._lingual_admins

        with patch(
            'backend.routes.school_requests.enqueue_outbox_email',
            side_effect=Exception('Firestore unavailable'),
        ), patch(
            'backend.routes.school_requests.list_lingual_admin_emails',
            return_value=lingual_admins,
        ), patch(
            'backend.routes.school_requests.database.get_db',
            return_value=MagicMock(),
        ):
            with self.app.test_client() as client:
                self._set_session(client, 'requester-1')
                resp = client.post(
                    '/api/school-requests',
                    json=self._valid_payload('Resilient Academy'),
                )
                self.assertIn(resp.status_code, (200, 201))
                data = resp.get_json()
                self.assertTrue(data['success'])

    def test_no_admins_means_zero_enqueue_calls(self):
        """When there are no lingual admins, enqueue_outbox_email is never called."""
        with patch(
            'backend.routes.school_requests.enqueue_outbox_email'
        ) as mock_enq, patch(
            'backend.routes.school_requests.list_lingual_admin_emails',
            return_value=[],
        ), patch(
            'backend.routes.school_requests.database.get_db',
            return_value=MagicMock(),
        ):
            with self.app.test_client() as client:
                self._set_session(client, 'requester-1')
                resp = client.post(
                    '/api/school-requests',
                    json=self._valid_payload('Empty Admin School'),
                )
                self.assertIn(resp.status_code, (200, 201))
                mock_enq.assert_not_called()

    def test_list_lingual_admin_emails_failure_does_not_break_submission(self):
        """If listing admins itself fails, the submission still succeeds."""
        with patch(
            'backend.routes.school_requests.list_lingual_admin_emails',
            side_effect=RuntimeError('firestore index missing'),
        ):
            with self.app.test_client() as client:
                self._set_session(client, 'requester-1')
                resp = client.post(
                    '/api/school-requests',
                    json=self._valid_payload('SF Friends School'),
                )
                self.assertIn(resp.status_code, (200, 201))
                body = resp.get_json()
                self.assertTrue(body['success'])


if __name__ == '__main__':
    unittest.main()
