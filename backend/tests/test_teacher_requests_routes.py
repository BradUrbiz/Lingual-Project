"""Route tests for backend/routes/teacher_requests.py."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.routes.teacher_requests import create_teacher_requests_blueprint
from backend.tests.conftest import FakeDbBase, make_test_app, make_test_deps


class FakeTeacherRequestsDb(FakeDbBase):
    def __init__(self):
        super().__init__()
        self.users = {}
        self.orgs = {}
        self._membership_list = []  # renamed from memberships to avoid shadowing FakeDbBase.memberships (dict)
        self.teacher_join_requests = {}
        self._tjr_counter = 0
        self.outbox_writes = []

    # User
    def get_user(self, uid):
        return self.users.get(uid)

    def get_user_memberships(self, uid):
        return [
            {'orgId': m['org_id'], 'roles': m['roles'], 'status': m['status']}
            for m in self._membership_list if m['uid'] == uid
        ]

    # Org lookup
    def get_org_by_teacher_invite_code(self, code):
        # Mirror production behavior: only return orgs with status='active'.
        for org_id, org in self.orgs.items():
            if (
                org.get('teacher_invite_code') == code
                and org.get('teacher_invite_code_active')
                and org.get('status') == 'active'  # NEW — mirrors Firestore query filter
            ):
                return {'id': org_id, **org}
        return None

    def get_organization(self, org_id):
        if org_id not in self.orgs:
            return None
        return {'id': org_id, **self.orgs[org_id]}

    # Teacher join requests
    def get_pending_teacher_join_request_by_uid(self, uid):
        for rid, r in self.teacher_join_requests.items():
            if r['uid'] == uid and r['status'] == 'pending':
                return {'id': rid, **r}
        return None

    def create_teacher_join_request(self, *, uid, org_id, source, invite_code=None):
        self._tjr_counter += 1
        rid = f'tjr-{self._tjr_counter}'
        rec = {
            'uid': uid, 'org_id': org_id, 'source': source,
            'status': 'pending',
        }
        if invite_code:
            rec['invite_code'] = invite_code
        self.teacher_join_requests[rid] = rec
        return rid

    # Admin emails
    def list_school_admin_emails(self, org_id):
        return [{'uid': 'admin-1', 'email': 'admin@x.com', 'name': 'Admin'}]

    # Profile update (used by blueprint after request creation)
    def update_user_profile(self, uid, **kwargs):
        pass


def _build_app(*, uid='teacher-1', user_email='t@x.com', user_name='Teacher'):
    db = FakeTeacherRequestsDb()
    db.users[uid] = {'email': user_email, 'name': user_name}
    deps = make_test_deps(db=db)
    bp = create_teacher_requests_blueprint(deps)
    app = make_test_app(bp)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess['user'] = {'uid': uid, 'email': user_email}
    return app, db


class SubmitTeacherJoinRequestTest(unittest.TestCase):
    def test_submit_by_invite_code_succeeds(self):
        app, db = _build_app()
        db.orgs['org-1'] = {
            'name': 'SF Friends',
            'teacher_invite_code': 'ABC123',
            'teacher_invite_code_active': True,
            'status': 'active',  # required by fake's status='active' filter (mirrors production)
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post(
            '/api/teacher-join-requests',
            json={'inviteCode': 'ABC123'},
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['orgName'], 'SF Friends')
        self.assertEqual(body['status'], 'pending')
        self.assertIn('requestId', body)
        # One request created, source=invite_code
        self.assertEqual(len(db.teacher_join_requests), 1)
        request = next(iter(db.teacher_join_requests.values()))
        self.assertEqual(request['source'], 'invite_code')
        self.assertEqual(request['org_id'], 'org-1')

    def test_submit_by_org_id_succeeds(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 201)
        request = next(iter(db.teacher_join_requests.values()))
        self.assertEqual(request['source'], 'search')

    def test_submit_invalid_invite_code_returns_404(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'inviteCode': 'XXXXXX'})
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(resp.get_json()['success'])

    def test_submit_invite_code_for_suspended_org_returns_404(self):
        """Suspended orgs are filtered out by get_org_by_teacher_invite_code.

        Production filters status='active' at the Firestore query level, so
        a stale invite code on a suspended org returns 404 (not found), not
        a friendlier 409. v1.5 may distinguish; tracked in LIMITATIONS.md.
        """
        app, db = _build_app()
        db.orgs['org-1'] = {
            'name': 'SF Friends',
            'teacher_invite_code': 'ABC123',
            'teacher_invite_code_active': True,
            'status': 'suspended',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'inviteCode': 'ABC123'})
        self.assertEqual(resp.status_code, 404)

    def test_submit_unknown_org_id_returns_404(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-missing'})
        self.assertEqual(resp.status_code, 404)

    def test_submit_when_already_member_same_org_returns_422(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db._membership_list.append({
            'uid': 'teacher-1', 'org_id': 'org-1',
            'roles': ['teacher'], 'status': 'active',
        })
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 422)
        self.assertIn('already a member', resp.get_json()['error'])

    def test_submit_when_already_member_different_org_returns_422(self):
        """Spec §3: multi-org out of scope for v1 — any active mem blocks."""
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db.orgs['org-other'] = {'name': 'Existing School', 'status': 'active'}
        db._membership_list.append({
            'uid': 'teacher-1', 'org_id': 'org-other',
            'roles': ['teacher'], 'status': 'active',
        })
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 422)
        body = resp.get_json()
        self.assertIn('Existing School', body['error'])

    def test_submit_when_existing_pending_returns_409(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends', 'status': 'active'}
        db.teacher_join_requests['existing'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'search', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={'orgId': 'org-1'})
        self.assertEqual(resp.status_code, 409)

    def test_submit_requires_one_of_code_or_org(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.post('/api/teacher-join-requests', json={})
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main()
