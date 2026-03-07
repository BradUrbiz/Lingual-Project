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

    def get_or_create_user(self, uid, email, name):
        self.created_users.append((uid, email, name))
        return {'uid': uid, 'email': email, 'name': name}

    def set_user_last_active_membership(self, uid, membership_id):
        self.persisted_active_membership_id = (uid, membership_id)

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
                    load_sample_curriculum_package=lambda: {},
                    get_curriculum_practice_context=lambda **_kwargs: None,
                    build_curriculum_system_prompt=lambda **_kwargs: '',
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


if __name__ == '__main__':
    unittest.main()
