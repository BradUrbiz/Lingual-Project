import unittest
from datetime import UTC, datetime

from flask import session

from backend.routes.school_requests import create_school_requests_blueprint
from backend.tests.conftest import (
    FakeDbBase,
    make_test_deps,
    make_test_app,
    passthrough_login_required,
)


class FakeSchoolRequestDb(FakeDbBase):
    """Extends FakeDbBase with school_requests store."""

    def __init__(self):
        super().__init__()
        self.school_requests: dict[str, dict] = {}
        self._sr_counter = 0

    def create_school_request(self, requester_uid, requester_email, requester_name,
                              school_name, org_type, website_url='', canvas_instance_url=''):
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

    def list_school_requests(self, status_filter=None):
        results = list(self.school_requests.values())
        if status_filter:
            results = [r for r in results if r.get('status') == status_filter]
        results.sort(key=lambda r: r.get('created_at') or '', reverse=True)
        return [dict(r) for r in results]

    def update_school_request(self, request_id, updates):
        if request_id in self.school_requests:
            self.school_requests[request_id].update(updates)
            self.school_requests[request_id]['updated_at'] = datetime.now(UTC)

    def get_user_field(self, uid, field):
        user = self.users.get(uid)
        if user:
            return user.get(field)
        return None


class TestSchoolRequests(unittest.TestCase):
    """Route-level tests for the school requests blueprint."""

    def setUp(self):
        self.db = FakeSchoolRequestDb()

        # Seed users
        self.db.users['user-1'] = {
            'uid': 'user-1',
            'name': 'Regular User',
            'email': 'user@example.com',
            'profile': {'display_name': 'Regular User'},
        }
        self.db.users['admin-1'] = {
            'uid': 'admin-1',
            'name': 'Admin User',
            'email': 'admin@lingual.test',
            'profile': {'display_name': 'Admin User'},
            'lingual_admin': True,
        }
        self.db.users['nonadmin-1'] = {
            'uid': 'nonadmin-1',
            'name': 'Non-Admin User',
            'email': 'nonadmin@example.com',
            'profile': {'display_name': 'Non-Admin User'},
        }

        deps = make_test_deps(db=self.db)
        bp = create_school_requests_blueprint(deps)
        self.app = make_test_app(bp)
        self.app.config['TESTING'] = True

    def _set_session(self, client, uid):
        with client.session_transaction() as sess:
            sess['user'] = {'uid': uid, 'email': f'{uid}@test.com'}

    # ── User endpoints ──────────────────────────────────────────────

    def test_submit_request(self):
        """POST /api/school-requests with valid data returns 201, status=pending."""
        with self.app.test_client() as client:
            self._set_session(client, 'user-1')
            resp = client.post('/api/school-requests', json={
                'schoolName': 'Springfield Elementary',
                'orgType': 'school',
                'email': 'user@example.com',
                'name': 'Regular User',
            })
            self.assertEqual(resp.status_code, 201)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'pending')
            self.assertEqual(data['request']['schoolName'], 'Springfield Elementary')
            self.assertIsNotNone(data['request']['id'])

    def test_submit_rejects_duplicate(self):
        """Submitting twice returns 409 on the second attempt."""
        with self.app.test_client() as client:
            self._set_session(client, 'user-1')
            resp1 = client.post('/api/school-requests', json={
                'schoolName': 'Springfield Elementary',
            })
            self.assertEqual(resp1.status_code, 201)

            resp2 = client.post('/api/school-requests', json={
                'schoolName': 'Another School',
            })
            self.assertEqual(resp2.status_code, 409)
            self.assertFalse(resp2.get_json()['success'])

    def test_submit_missing_school_name(self):
        """POST without schoolName returns 400."""
        with self.app.test_client() as client:
            self._set_session(client, 'user-1')
            resp = client.post('/api/school-requests', json={})
            self.assertEqual(resp.status_code, 400)
            self.assertFalse(resp.get_json()['success'])

    def test_check_own_request(self):
        """GET /api/school-requests/mine returns the user's request."""
        with self.app.test_client() as client:
            self._set_session(client, 'user-1')
            client.post('/api/school-requests', json={
                'schoolName': 'Springfield Elementary',
            })

            resp = client.get('/api/school-requests/mine')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertIsNotNone(data['request'])
            self.assertEqual(data['request']['schoolName'], 'Springfield Elementary')

    def test_check_own_request_none(self):
        """GET /api/school-requests/mine when no request returns null."""
        with self.app.test_client() as client:
            self._set_session(client, 'user-1')
            resp = client.get('/api/school-requests/mine')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertIsNone(data['request'])

    # ── Admin endpoints ─────────────────────────────────────────────

    def test_admin_list_requests(self):
        """GET /api/admin/school-requests lists all requests."""
        # Create a request as a regular user
        self.db.create_school_request(
            requester_uid='user-1',
            requester_email='user@example.com',
            requester_name='Regular User',
            school_name='Springfield Elementary',
            org_type='school',
        )
        with self.app.test_client() as client:
            self._set_session(client, 'admin-1')
            resp = client.get('/api/admin/school-requests')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(len(data['requests']), 1)
            self.assertEqual(data['requests'][0]['schoolName'], 'Springfield Elementary')

    def test_admin_approve_request(self):
        """POST approve creates org + membership, status=approved."""
        request_id = self.db.create_school_request(
            requester_uid='user-1',
            requester_email='user@example.com',
            requester_name='Regular User',
            school_name='Springfield Elementary',
            org_type='school',
        )
        with self.app.test_client() as client:
            self._set_session(client, 'admin-1')
            resp = client.post(f'/api/admin/school-requests/{request_id}/approve')
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'approved')
            self.assertIsNotNone(data['request']['createdOrgId'])

            # Verify org was created
            org_id = data['request']['createdOrgId']
            org = self.db.get_organization(org_id)
            self.assertIsNotNone(org)
            self.assertEqual(org['name'], 'Springfield Elementary')

            # Verify membership was created
            memberships = [
                m for m in self.db.memberships.values()
                if m.get('uid') == 'user-1' and m.get('orgId') == org_id
            ]
            self.assertEqual(len(memberships), 1)
            self.assertIn('school_admin', memberships[0]['roles'])

    def test_admin_approve_rejects_non_pending(self):
        """Approving an already-approved request returns 409."""
        request_id = self.db.create_school_request(
            requester_uid='user-1',
            requester_email='user@example.com',
            requester_name='Regular User',
            school_name='Springfield Elementary',
            org_type='school',
        )
        # Approve it first
        with self.app.test_client() as client:
            self._set_session(client, 'admin-1')
            client.post(f'/api/admin/school-requests/{request_id}/approve')

            # Try to approve again
            resp = client.post(f'/api/admin/school-requests/{request_id}/approve')
            self.assertEqual(resp.status_code, 409)
            self.assertFalse(resp.get_json()['success'])

    def test_admin_reject_request(self):
        """POST reject with reason sets status=rejected."""
        request_id = self.db.create_school_request(
            requester_uid='user-1',
            requester_email='user@example.com',
            requester_name='Regular User',
            school_name='Springfield Elementary',
            org_type='school',
        )
        with self.app.test_client() as client:
            self._set_session(client, 'admin-1')
            resp = client.post(
                f'/api/admin/school-requests/{request_id}/reject',
                json={'reason': 'Not a real school'},
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertTrue(data['success'])
            self.assertEqual(data['request']['status'], 'rejected')
            self.assertEqual(data['request']['rejectionReason'], 'Not a real school')

    def test_non_admin_blocked(self):
        """Non-admin user gets 403 on admin endpoints."""
        with self.app.test_client() as client:
            self._set_session(client, 'nonadmin-1')

            resp_list = client.get('/api/admin/school-requests')
            self.assertEqual(resp_list.status_code, 403)

            resp_detail = client.get('/api/admin/school-requests/sr-1')
            self.assertEqual(resp_detail.status_code, 403)

            resp_approve = client.post('/api/admin/school-requests/sr-1/approve')
            self.assertEqual(resp_approve.status_code, 403)

            resp_reject = client.post('/api/admin/school-requests/sr-1/reject', json={})
            self.assertEqual(resp_reject.status_code, 403)


if __name__ == '__main__':
    unittest.main()
