import unittest

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.auth import create_auth_blueprint


class FakeFirebaseAuth:
    class InvalidIdTokenError(Exception):
        pass

    class ExpiredIdTokenError(Exception):
        pass

    @staticmethod
    def verify_id_token(id_token):
        if id_token != 'valid-token':
            raise FakeFirebaseAuth.InvalidIdTokenError()
        return {
            'uid': 'teacher-1',
            'email': 'teacher@example.com',
            'name': 'Teacher User',
        }


class FakeDb:
    def __init__(self):
        self.created_users = []
        self.last_preferred_active_membership_id = None
        self.persisted_active_membership_id = None
        self.roster_entries = {}
        self.created_enrollments = []
        self.created_memberships = []
        self.classes = {}
        self.memberships = {}

    def get_user(self, uid):
        # These tests model returning users logging in, so the user already
        # exists. Returning a non-None doc (no email_verification field) makes
        # verify_auth treat them as existing → no signup-time verification.
        return {'uid': uid}

    def get_or_create_user(self, uid, email, name):
        self.created_users.append((uid, email, name))
        return {'uid': uid, 'email': email, 'name': name}

    def set_user_last_active_membership(self, uid, membership_id):
        self.persisted_active_membership_id = (uid, membership_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_membership(self, membership_id):
        return self.memberships.get(membership_id)

    def create_membership(self, org_id, uid, roles, primary_class_ids=None, membership_id=None, **_kwargs):
        membership_id = membership_id or f'{org_id}_{uid}'
        membership = {
            'id': membership_id, 'org_id': org_id, 'uid': uid,
            'roles': list(roles), 'primaryClassIds': list(primary_class_ids or []),
        }
        self.memberships[membership_id] = membership
        self.created_memberships.append(membership)
        return membership_id

    def add_primary_class_to_membership(self, membership_id, class_id):
        membership = self.memberships.get(membership_id)
        if membership and class_id not in membership.get('primaryClassIds', []):
            membership.setdefault('primaryClassIds', []).append(class_id)

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        self.last_preferred_active_membership_id = preferred_active_membership_id
        return {
            'memberships': [
                {
                    'id': 'membership-teacher',
                    'orgId': 'org-school-1',
                    'orgName': 'Lingual Academy',
                    'orgType': 'school',
                    'roles': ['teacher'],
                    'status': 'active',
                    'primaryClassIds': ['class-1'],
                }
            ],
            'active_membership': {
                'id': 'membership-teacher',
                'orgId': 'org-school-1',
                'orgName': 'Lingual Academy',
                'roles': ['teacher'],
            },
            'active_membership_id': 'membership-teacher',
            'active_organization_id': 'org-school-1',
            'active_roles': ['teacher'],
        }


def passthrough_login_required(func):
    return func


class AuthMembershipsTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakeDb()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'
        self.app.register_blueprint(
            create_auth_blueprint(
                RouteDeps(
                    db=self.fake_db,
                    firebase_auth=FakeFirebaseAuth,
                    get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
                    get_openai_client=lambda: None,
                    get_assessment=lambda: {},
                    compute_results=lambda *_args, **_kwargs: {},
                    get_proficiency_description=lambda *_args, **_kwargs: {
                        'level': 'Novice Mid',
                        'description': 'Test level',
                    },
                    login_required=passthrough_login_required,
                    get_user_proficiency_context=lambda: '',
                    build_system_prompt=lambda _context: '',
            get_school_request_context=lambda: None,
                    set_active_school_membership=lambda _membership_id: None,
                    allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
                    allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
                    supported_ui_languages={'en', 'ko'},
                )
            )
        )
        self.client = self.app.test_client()

    def test_verify_auth_returns_membership_context(self):
        response = self.client.post('/api/auth/verify', json={'idToken': 'valid-token'})

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['user']['uid'], 'teacher-1')
        self.assertEqual(payload['user']['activeMembershipId'], 'membership-teacher')
        self.assertEqual(payload['user']['activeOrganizationId'], 'org-school-1')
        self.assertEqual(payload['user']['activeRoles'], ['teacher'])
        self.assertEqual(payload['user']['memberships'][0]['orgName'], 'Lingual Academy')
        self.assertEqual(
            self.fake_db.created_users,
            [('teacher-1', 'teacher@example.com', 'Teacher User')],
        )
        self.assertEqual(
            self.fake_db.persisted_active_membership_id,
            ('teacher-1', 'membership-teacher'),
        )


class CanvasStudentFirebaseAuth:
    """Firebase auth that returns a student identity."""

    class InvalidIdTokenError(Exception):
        pass

    class ExpiredIdTokenError(Exception):
        pass

    @staticmethod
    def verify_id_token(id_token):
        if id_token != 'valid-student-token':
            raise CanvasStudentFirebaseAuth.InvalidIdTokenError()
        return {
            'uid': 'student-1',
            'email': 'student@example.com',
            'name': 'Canvas Student',
        }


class CanvasRosterLoginTestCase(unittest.TestCase):
    """Canvas roster entries must NOT trigger silent enrollment on login.

    Students whose email appears in canvas_roster_entries/ are visible to
    teachers as roster candidates, but they must go through the join-code
    flow to actually enroll. Logging in alone must not create enrollments.
    """

    def _make_app(self, fake_db, firebase_auth_cls):
        app = Flask(__name__)
        app.secret_key = 'test-secret'
        app.register_blueprint(
            create_auth_blueprint(
                RouteDeps(
                    db=fake_db,
                    firebase_auth=firebase_auth_cls,
                    get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
                    get_openai_client=lambda: None,
                    get_assessment=lambda: {},
                    compute_results=lambda *_args, **_kwargs: {},
                    get_proficiency_description=lambda *_args, **_kwargs: {
                        'level': 'Novice Mid',
                        'description': 'Test level',
                    },
                    login_required=passthrough_login_required,
                    get_user_proficiency_context=lambda: '',
                    build_system_prompt=lambda _context: '',
            get_school_request_context=lambda: None,
                    set_active_school_membership=lambda _membership_id: None,
                    allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
                    allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
                    supported_ui_languages={'en', 'ko'},
                )
            )
        )
        return app

    def test_login_does_not_create_enrollment_from_canvas_roster_entry(self):
        """A student with no existing enrollment whose email appears in
        canvas_roster_entries must NOT be enrolled just by logging in."""
        fake_db = FakeDb()
        fake_db.classes['class-1'] = {'id': 'class-1', 'org_id': 'org-1'}
        # Seed: roster entry exists, no enrollment exists
        fake_db.roster_entries['class-1__cv50'] = {
            'class_id': 'class-1',
            'canvas_user_id': 'cv50',
            'canvas_email': 'student@example.com',
            'canvas_name': 'Canvas Student',
        }
        # Removed methods must not exist on the fake-db
        self.assertFalse(hasattr(fake_db, 'list_pending_canvas_enrollments_by_email'))
        self.assertFalse(hasattr(fake_db, 'activate_pending_canvas_enrollment'))
        # Login
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)
        # No enrollment or membership should have been created for this student
        self.assertEqual(len(fake_db.created_enrollments), 0)
        self.assertEqual(len(fake_db.created_memberships), 0)


if __name__ == '__main__':
    unittest.main()
