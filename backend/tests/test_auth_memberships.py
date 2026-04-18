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
        self.pending_canvas_enrollments = []
        self.activated_enrollments = []
        self.created_memberships = []
        self.classes = {}
        self.memberships = {}

    def get_or_create_user(self, uid, email, name):
        self.created_users.append((uid, email, name))
        return {'uid': uid, 'email': email, 'name': name}

    def set_user_last_active_membership(self, uid, membership_id):
        self.persisted_active_membership_id = (uid, membership_id)

    def list_pending_canvas_enrollments_by_email(self, email):
        return [e for e in self.pending_canvas_enrollments if e.get('canvas_email') == email]

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

    def activate_pending_canvas_enrollment(self, enrollment_id, student_uid, student_membership_id):
        self.activated_enrollments.append({
            'enrollment_id': enrollment_id,
            'student_uid': student_uid,
            'student_membership_id': student_membership_id,
        })

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


class CanvasPendingEnrollmentActivationTestCase(unittest.TestCase):
    """Test that pending_sync Canvas enrollments are activated on login."""

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

    def test_activates_pending_canvas_enrollment_on_login(self):
        fake_db = FakeDb()
        fake_db.classes['class-1'] = {'id': 'class-1', 'org_id': 'org-1'}
        fake_db.pending_canvas_enrollments = [
            {
                'id': 'class-1__canvas-user-1',
                'class_id': 'class-1',
                'canvas_email': 'student@example.com',
                'canvas_user_id': 'canvas-user-1',
                'status': 'pending_sync',
            },
        ]
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)

        # Enrollment should be activated
        self.assertEqual(len(fake_db.activated_enrollments), 1)
        activated = fake_db.activated_enrollments[0]
        self.assertEqual(activated['enrollment_id'], 'class-1__canvas-user-1')
        self.assertEqual(activated['student_uid'], 'student-1')
        self.assertEqual(activated['student_membership_id'], 'org-1_student-1')

        # Student membership should be created
        self.assertEqual(len(fake_db.created_memberships), 1)
        mem = fake_db.created_memberships[0]
        self.assertEqual(mem['roles'], ['student'])
        self.assertEqual(mem['org_id'], 'org-1')

    def test_activates_multi_org_pending_enrollments(self):
        fake_db = FakeDb()
        fake_db.classes['class-1'] = {'id': 'class-1', 'org_id': 'org-1'}
        fake_db.classes['class-2'] = {'id': 'class-2', 'org_id': 'org-2'}
        fake_db.pending_canvas_enrollments = [
            {
                'id': 'class-1__cv1',
                'class_id': 'class-1',
                'canvas_email': 'student@example.com',
                'canvas_user_id': 'cv1',
                'status': 'pending_sync',
            },
            {
                'id': 'class-2__cv2',
                'class_id': 'class-2',
                'canvas_email': 'student@example.com',
                'canvas_user_id': 'cv2',
                'status': 'pending_sync',
            },
        ]
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)

        # Both enrollments should be activated
        self.assertEqual(len(fake_db.activated_enrollments), 2)
        # Two memberships created (one per org)
        self.assertEqual(len(fake_db.created_memberships), 2)
        org_ids = {m['org_id'] for m in fake_db.created_memberships}
        self.assertEqual(org_ids, {'org-1', 'org-2'})

    def test_skips_activation_when_class_not_found(self):
        fake_db = FakeDb()
        # No class record for class-missing
        fake_db.pending_canvas_enrollments = [
            {
                'id': 'class-missing__cv1',
                'class_id': 'class-missing',
                'canvas_email': 'student@example.com',
                'canvas_user_id': 'cv1',
                'status': 'pending_sync',
            },
        ]
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(fake_db.activated_enrollments), 0)

    def test_no_pending_enrollments_does_not_error(self):
        fake_db = FakeDb()
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(fake_db.activated_enrollments), 0)

    def test_existing_membership_adds_class_instead_of_creating(self):
        fake_db = FakeDb()
        fake_db.classes['class-1'] = {'id': 'class-1', 'org_id': 'org-1'}
        # Pre-existing membership
        fake_db.memberships['org-1_student-1'] = {
            'id': 'org-1_student-1', 'org_id': 'org-1', 'uid': 'student-1',
            'roles': ['student'], 'primaryClassIds': ['class-other'],
        }
        fake_db.pending_canvas_enrollments = [
            {
                'id': 'class-1__cv1',
                'class_id': 'class-1',
                'canvas_email': 'student@example.com',
                'canvas_user_id': 'cv1',
                'status': 'pending_sync',
            },
        ]
        app = self._make_app(fake_db, CanvasStudentFirebaseAuth)
        client = app.test_client()
        response = client.post('/api/auth/verify', json={'idToken': 'valid-student-token'})
        self.assertEqual(response.status_code, 200)

        # No new membership created
        self.assertEqual(len(fake_db.created_memberships), 0)
        # Enrollment still activated
        self.assertEqual(len(fake_db.activated_enrollments), 1)
        # Class added to existing membership
        self.assertIn('class-1', fake_db.memberships['org-1_student-1']['primaryClassIds'])


if __name__ == '__main__':
    unittest.main()
