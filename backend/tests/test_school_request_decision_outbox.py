import unittest
from unittest.mock import MagicMock, patch

from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeApprovalDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.requests = {}
        self.orgs_created = []
        self.memberships_created = []
        self.last_active = {}
        self.pre_invites_recorded = []   # list of (org_id, requester_uid, emails)
        self.lingual_admin_lookup = lambda uid: True

    def get_school_request(self, request_id):
        return self.requests.get(request_id)

    def update_school_request(self, request_id, updates):
        self.requests[request_id].update(updates)

    def approve_school_request(self, request_id, reviewed_by_uid):
        req = self.requests.get(request_id)
        if req is None:
            return None
        if req.get('status') != 'pending':
            raise ValueError(
                f'Request {request_id} is not pending (status={req.get("status")!r})'
            )

        org_id = self.create_organization(
            name=req['school_name'],
            org_type=req.get('org_type', 'school'),
            pilot_stage='beta',
        )
        membership_id = self.create_membership(
            org_id=org_id,
            uid=req['requester_uid'],
            roles=['school_admin'],
        )
        self.set_user_last_active_membership(req['requester_uid'], membership_id)
        self.update_school_request(request_id, {
            'status': 'approved',
            'reviewed_by_uid': reviewed_by_uid,
            'created_org_id': org_id,
        })
        return {
            'request': dict(self.requests[request_id]),
            'org_id': org_id,
            'membership_id': membership_id,
        }

    def create_organization(self, **kwargs):
        org_id = f'org-{len(self.orgs_created)+1}'
        self.orgs_created.append({'id': org_id, **kwargs})
        return org_id

    def create_membership(self, **kwargs):
        mid = f'mem-{len(self.memberships_created)+1}'
        self.memberships_created.append({'id': mid, **kwargs})
        return mid

    def set_user_last_active_membership(self, uid, membership_id):
        self.last_active[uid] = membership_id

    def get_user_field(self, uid, field):
        if field == 'lingual_admin':
            return self.lingual_admin_lookup(uid)
        return None

    def record_school_request_pre_invites(self, *, org_id, requester_uid, emails):
        self.pre_invites_recorded.append((org_id, requester_uid, list(emails)))
        return [f'inv-{i}' for i in range(len(emails))]

    def update_user_profile(self, uid, **kwargs):
        # Plan 1 helper — no-op for these tests.
        pass


class LegacyApproveSchoolRequestEndpointTest(unittest.TestCase):
    """Plan 5 Task 24: the legacy `/api/admin/school-requests/<id>/approve`
    endpoint now returns 410 Gone. All approval-side-effect behavior moved to
    `/api/lingual-admin/requests/<id>/approve` and is covered by
    `test_lingual_admin_approve_route.py`.

    These tests only assert the deprecation contract — no outbox enqueue, no
    DB mutation, no auth check happens on the legacy path.
    """

    def setUp(self):
        self.db = FakeApprovalDb()
        self.db.users = {'lingual-1': {
            'email': 'la@lingual.app',
            'name': 'LA',
            'lingual_admin': True,
        }}
        self.db.requests['req-1'] = {
            'id': 'req-1',
            'requester_uid': 'uid-A',
            'requester_email': 'ada@ssfs.org',
            'requester_name': 'Ada',
            'school_name': 'SF Friends',
            'org_type': 'school',
            'status': 'pending',
            'pre_invited_teachers': ['t1@ssfs.org', 't2@ssfs.org'],
            'admin_identity': {'full_name': 'Ada Lovelace'},
        }
        self.deps = make_test_deps(db=self.db)
        from backend.routes.school_requests import create_school_requests_blueprint
        self.app = make_test_app(create_school_requests_blueprint(self.deps))
        self.client = self.app.test_client()
        with self.client.session_transaction() as s:
            s['user'] = {'uid': 'lingual-1', 'email': 'la@lingual.app'}

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_legacy_approve_returns_410(self, mock_enqueue, _mock_get_db):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 410, resp.get_json())
        body = resp.get_json()
        self.assertEqual(body['error'], 'gone')
        self.assertIn('lingual-admin', body['message'])
        self.assertIn('approve', body['message'])

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_legacy_approve_does_not_enqueue_outbox(self, mock_enqueue, _mock_get_db):
        """Side effects must not fire on the deprecated path."""
        self.client.post('/api/admin/school-requests/req-1/approve')
        mock_enqueue.assert_not_called()
        self.assertEqual(self.db.pre_invites_recorded, [])
        # The request stays pending — no DB mutation on 410.
        self.assertEqual(self.db.requests['req-1']['status'], 'pending')


class LegacyRejectSchoolRequestEndpointTest(unittest.TestCase):
    """Plan 5 Task 24: the legacy `/api/admin/school-requests/<id>/reject`
    endpoint now returns 410 Gone, pointing callers at
    `/api/lingual-admin/requests/<id>/decline`.
    """

    def setUp(self):
        self.db = FakeApprovalDb()
        self.db.users = {'lingual-1': {
            'email': 'la@lingual.app',
            'name': 'LA',
            'lingual_admin': True,
        }}
        self.db.requests['req-2'] = {
            'id': 'req-2',
            'requester_uid': 'uid-B',
            'requester_email': 'bob@ssfs.org',
            'requester_name': 'Bob',
            'school_name': 'SF Friends',
            'org_type': 'school',
            'status': 'pending',
        }
        self.deps = make_test_deps(db=self.db)
        from backend.routes.school_requests import create_school_requests_blueprint
        self.app = make_test_app(create_school_requests_blueprint(self.deps))
        self.client = self.app.test_client()
        with self.client.session_transaction() as s:
            s['user'] = {'uid': 'lingual-1', 'email': 'la@lingual.app'}

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_legacy_reject_returns_410_pointing_at_decline(self, mock_enqueue, _mock_get_db):
        resp = self.client.post('/api/admin/school-requests/req-2/reject', json={
            'reason': 'Website not reachable.',
            'category': 'info_missing',
        })
        self.assertEqual(resp.status_code, 410, resp.get_json())
        body = resp.get_json()
        self.assertEqual(body['error'], 'gone')
        self.assertIn('lingual-admin', body['message'])
        # The new verb is `decline`, not `reject` — surface that explicitly.
        self.assertIn('decline', body['message'])

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_legacy_reject_does_not_mutate_state(self, mock_enqueue, _mock_get_db):
        """No DB writes, no outbox enqueues on the deprecated path."""
        self.client.post('/api/admin/school-requests/req-2/reject', json={
            'reason': 'r', 'category': 'info_missing',
        })
        mock_enqueue.assert_not_called()
        self.assertEqual(self.db.requests['req-2']['status'], 'pending')
        self.assertNotIn('rejection_reason', self.db.requests['req-2'])
        self.assertNotIn('rejection_category', self.db.requests['req-2'])


if __name__ == '__main__':
    unittest.main()
