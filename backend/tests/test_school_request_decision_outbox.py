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


class ApproveSchoolRequestOutboxTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeApprovalDb()
        # Seed the Lingual admin user
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
    def test_approve_enqueues_approved_email_to_requester(self, mock_enqueue, _mock_get_db):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200, resp.get_json())
        approved_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'school_request_approved'
        ]
        self.assertEqual(len(approved_calls), 1, mock_enqueue.call_args_list)
        kwargs = approved_calls[0].kwargs
        self.assertEqual(kwargs['recipient_email'], 'ada@ssfs.org')
        self.assertEqual(kwargs['template_data']['org_name'], 'SF Friends')
        self.assertEqual(kwargs['template_data']['requester_name'], 'Ada')
        self.assertIn('login_url', kwargs['template_data'])

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_records_pre_invites(self, mock_enqueue, _mock_get_db):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(self.db.pre_invites_recorded), 1)
        org_id, requester_uid, emails = self.db.pre_invites_recorded[0]
        self.assertEqual(requester_uid, 'uid-A')
        self.assertEqual(emails, ['t1@ssfs.org', 't2@ssfs.org'])

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_enqueues_one_invitation_per_pre_invite(self, mock_enqueue, _mock_get_db):
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        invite_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'teacher_invitation'
        ]
        self.assertEqual(len(invite_calls), 2)
        emails_sent = {c.kwargs['recipient_email'] for c in invite_calls}
        self.assertEqual(emails_sent, {'t1@ssfs.org', 't2@ssfs.org'})

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_succeeds_when_no_pre_invites(self, mock_enqueue, _mock_get_db):
        self.db.requests['req-1']['pre_invited_teachers'] = []
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200)
        approved_calls = [
            c for c in mock_enqueue.call_args_list
            if c.kwargs.get('template').value == 'school_request_approved'
        ]
        self.assertEqual(len(approved_calls), 1)

    @patch('backend.routes.school_requests.database.get_db', return_value=MagicMock())
    @patch('backend.routes.school_requests.enqueue_outbox_email')
    def test_approve_returns_200_even_if_pre_invite_record_blows_up(self, mock_enqueue, _mock_get_db):
        def boom(*_a, **_kw):
            raise RuntimeError('firestore down')
        self.db.record_school_request_pre_invites = boom
        resp = self.client.post('/api/admin/school-requests/req-1/approve')
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertTrue(any(
            c.kwargs.get('template').value == 'school_request_approved'
            for c in mock_enqueue.call_args_list
        ))


if __name__ == '__main__':
    unittest.main()
