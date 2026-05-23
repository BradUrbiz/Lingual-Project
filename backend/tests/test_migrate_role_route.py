import unittest

from backend.tests.conftest import FakeDbBase, make_test_deps, make_test_app


class FakeMigrateDb(FakeDbBase):
    """`is_legacy_user_needing_role_pick` is imported directly from
    `database` by the route — we do NOT mock it on the db fake. State
    helpers (`mark_user_legacy_role_picked`) ARE on the fake because
    they touch Firestore."""

    def __init__(self):
        super().__init__()
        self.users = {
            'u-legacy': {'uid': 'u-legacy', 'email': 'l@x.com',
                         'profile': {}},  # no intended_role, no memberships
            'u-already-migrated': {'uid': 'u-already-migrated', 'email': 'm@x.com',
                                   'profile': {'intended_role': 'student',
                                               'onboarding_state': 'complete'}},
            'u-has-membership': {'uid': 'u-has-membership', 'email': 'h@x.com',
                                 'profile': {}},
        }
        self.memberships_by_uid = {
            'u-has-membership': [
                {'org_id': 'o', 'roles': ['teacher'], 'status': 'active'},
            ],
        }
        self.picked = []

    def get_user(self, uid):
        return self.users.get(uid)

    def get_user_memberships(self, uid):
        return self.memberships_by_uid.get(uid, [])

    def mark_user_legacy_role_picked(self, *, uid, role):
        # When picking, also mutate self.users so the route's re-read sees the new state.
        from database import (
            INTENDED_ROLE_STUDENT, INTENDED_ROLE_TEACHER, INTENDED_ROLE_ADMIN,
            ONBOARDING_STATE_COMPLETE, ONBOARDING_STATE_ROLE_SELECTED,
        )
        state_by_role = {
            INTENDED_ROLE_STUDENT: ONBOARDING_STATE_COMPLETE,
            INTENDED_ROLE_TEACHER: ONBOARDING_STATE_ROLE_SELECTED,
            INTENDED_ROLE_ADMIN: ONBOARDING_STATE_ROLE_SELECTED,
        }
        self.picked.append({'uid': uid, 'role': role})
        user = self.users.setdefault(uid, {'uid': uid, 'profile': {}})
        profile = user.setdefault('profile', {})
        profile['intended_role'] = role
        profile['onboarding_state'] = state_by_role[role]


class MigrateRoleRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.routes.auth import create_auth_blueprint
        self.db = FakeMigrateDb()
        self.deps = make_test_deps(db=self.db)
        self.app = make_test_app(
            self.deps,
            extra_blueprints=[create_auth_blueprint(self.deps)],
        )
        self.client = self.app.test_client()

    def _as(self, uid):
        # IMPORTANT: get_current_user_uid in conftest reads
        # `(session.get("user") or {}).get("uid")`, so we MUST set
        # session["user"]["uid"], not session["uid"].
        with self.client.session_transaction() as sess:
            sess['user'] = {'uid': uid}

    def test_legacy_user_picking_student_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'student'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'student'}])
        self.assertEqual(resp.get_json()['intendedRole'], 'student')
        self.assertEqual(resp.get_json()['onboardingState'], 'complete')

    def test_legacy_user_picking_teacher_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'teacher'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'teacher'}])
        self.assertEqual(resp.get_json()['onboardingState'], 'role_selected')

    def test_legacy_user_picking_admin_writes(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'admin'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [{'uid': 'u-legacy', 'role': 'admin'}])

    def test_invalid_role_400(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'principal'})
        self.assertEqual(resp.status_code, 400)

    def test_missing_role_400(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={})
        self.assertEqual(resp.status_code, 400)

    def test_non_string_role_400(self):
        self._as('u-legacy')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 123})
        self.assertEqual(resp.status_code, 400)

    def test_successful_legacy_pick_logs_transition(self):
        self._as('u-legacy')
        with self.assertLogs(self.app.logger, level='INFO') as logs:
            resp = self.client.post('/api/auth/migrate-role', json={'role': 'student'})
        self.assertEqual(resp.status_code, 200)
        joined = '\n'.join(logs.output)
        self.assertIn('legacy_role_pick', joined)
        self.assertIn('u-legacy', joined)
        self.assertIn('student', joined)

    def test_non_legacy_user_is_no_op_200(self):
        """Already-migrated user calling the endpoint is idempotent."""
        self._as('u-already-migrated')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'teacher'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [])
        self.assertEqual(resp.get_json()['intendedRole'], 'student')

    def test_user_with_active_membership_is_no_op_200(self):
        self._as('u-has-membership')
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'admin'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.db.picked, [])
        body = resp.get_json()
        self.assertIsNone(body['intendedRole'])
        self.assertIsNone(body['onboardingState'])

    def test_unauthenticated_401(self):
        # No session set.
        resp = self.client.post('/api/auth/migrate-role', json={'role': 'student'})
        self.assertEqual(resp.status_code, 401)
