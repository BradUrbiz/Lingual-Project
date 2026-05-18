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
        # Capture for assertions; no-op semantics otherwise.
        self.profile_updates = getattr(self, 'profile_updates', [])
        self.profile_updates.append((uid, kwargs))

    def update_teacher_join_request_status(self, *, request_id, status,
                                            reviewed_by_uid=None,
                                            decline_reason=None):
        rec = self.teacher_join_requests.get(request_id)
        if rec is None:
            raise KeyError(request_id)
        rec['status'] = status
        if reviewed_by_uid is not None:
            rec['reviewed_by_uid'] = reviewed_by_uid
        if decline_reason is not None:
            rec['decline_reason'] = decline_reason

    def list_pending_teacher_join_requests_by_org(self, org_id):
        out = []
        for rid, r in self.teacher_join_requests.items():
            if r['org_id'] == org_id and r['status'] == 'pending':
                out.append({'id': rid, **r})
        return out

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        """Override FakeDbBase.resolve_user_school_context to read _membership_list."""
        memberships = []
        for i, m in enumerate(self._membership_list):
            if m.get('uid') != uid or m.get('status') not in {'active', 'invited'}:
                continue
            org_id = m.get('org_id')
            org = self.orgs.get(org_id) or {}
            mem_id = m.get('id') or f'mem-{i}'
            memberships.append({
                'id': mem_id,
                'orgId': org_id,
                'orgName': org.get('name', ''),
                'orgType': org.get('type'),
                'roles': m.get('roles', []),
                'status': m.get('status', 'active'),
                'primaryClassIds': m.get('primaryClassIds', []),
            })
        active_membership_id = preferred_active_membership_id or self.user_active_memberships.get(uid)
        active = next((m for m in memberships if m['id'] == active_membership_id), memberships[0] if memberships else None)
        return {
            'memberships': memberships,
            'active_membership': active,
            'active_membership_id': active.get('id') if active else None,
            'active_organization_id': active.get('orgId') if active else None,
            'active_roles': active.get('roles', []) if active else [],
        }


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


class PollAndCancelTest(unittest.TestCase):
    def test_get_me_returns_pending_request(self):
        app, db = _build_app()
        db.orgs['org-1'] = {'name': 'SF Friends'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body['status'], 'pending')
        self.assertEqual(body['orgId'], 'org-1')
        self.assertEqual(body['orgName'], 'SF Friends')

    def test_get_me_returns_204_when_no_request(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 204)

    def test_delete_me_cancels_pending(self):
        app, db = _build_app()
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'search', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.delete('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json()['success'])
        self.assertEqual(db.teacher_join_requests['tjr-1']['status'], 'cancelled')
        # Confirm onboarding_state revert was attempted on the user profile.
        revert_calls = [
            (uid, kwargs) for uid, kwargs in (db.profile_updates or [])
            if uid == 'teacher-1' and kwargs.get('onboarding_state') == 'role_selected'
        ]
        self.assertEqual(len(revert_calls), 1)

    def test_delete_me_returns_404_when_no_pending(self):
        app, db = _build_app()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.delete('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 404)

    def test_delete_me_ignores_non_pending_request(self):
        """DELETE only acts on pending requests — approved/declined/cancelled return 404."""
        app, db = _build_app()
        db.teacher_join_requests['tjr-cancelled'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'search', 'status': 'cancelled',
        }
        db.teacher_join_requests['tjr-approved'] = {
            'uid': 'teacher-1', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'approved',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.delete('/api/teacher-join-requests/me')
        self.assertEqual(resp.status_code, 404)
        # Existing records are unchanged.
        self.assertEqual(db.teacher_join_requests['tjr-cancelled']['status'], 'cancelled')
        self.assertEqual(db.teacher_join_requests['tjr-approved']['status'], 'approved')


class AdminListPendingTest(unittest.TestCase):
    def _admin_app(self):
        app, db = _build_app(uid='admin-1', user_email='admin@x.com', user_name='Admin')
        db._membership_list.append({
            'uid': 'admin-1', 'org_id': 'org-1',
            'roles': ['school_admin'], 'status': 'active',
        })
        db.orgs['org-1'] = {'name': 'SF Friends'}
        return app, db

    def test_admin_sees_pending_for_own_org(self):
        app, db = self._admin_app()
        db.users['teacher-99'] = {'email': 't99@x.com', 'name': 'T 99'}
        db.teacher_join_requests['tjr-1'] = {
            'uid': 'teacher-99', 'org_id': 'org-1',
            'source': 'invite_code', 'status': 'pending',
        }
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'admin-1', 'email': 'admin@x.com'}
            sess['active_organization_id'] = 'org-1'
            sess['active_membership_id'] = 'mem-1'

        resp = client.get('/api/teacher-join-requests')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(len(body['requests']), 1)
        first = body['requests'][0]
        self.assertEqual(first['requestId'], 'tjr-1')
        self.assertEqual(first['uid'], 'teacher-99')
        self.assertEqual(first['email'], 't99@x.com')
        self.assertEqual(first['name'], 'T 99')

    def test_non_admin_gets_403(self):
        app, db = _build_app(uid='teacher-1')
        # No school_admin membership.
        client = app.test_client()
        with client.session_transaction() as sess:
            sess['user'] = {'uid': 'teacher-1', 'email': 't@x.com'}

        resp = client.get('/api/teacher-join-requests')
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
