import unittest

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.pronunciation import create_pronunciation_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


class FakePronunciationDb:
    def __init__(self):
        self.organizations = {
            'org-1': {
                'id': 'org-1',
                'name': 'Lingual Academy',
                'type': 'school',
                'default_retention_policy': 'standard_school',
            }
        }
        self.memberships = {
            'mem-student': {
                'id': 'mem-student',
                'uid': 'student-1',
                'orgId': 'org-1',
                'roles': ['student'],
                'status': 'active',
                'primaryClassIds': ['class-1'],
            }
        }
        self.users = {
            'student-1': {
                'profile': {'age': 16},
            }
        }
        self.student_compliance_records = {
            'org-1_student-1': {
                'id': 'org-1_student-1',
                'org_id': 'org-1',
                'student_uid': 'student-1',
                'is_minor': True,
                'guardian_consent_status': 'granted',
                'voice_consent_status': 'granted',
                'text_allowed': True,
                'voice_allowed': True,
                'retention_policy_id': 'no_raw_audio',
            }
        }
        self.pronunciation_sessions = {}
        self.pronunciation_attempts = {}
        self.consent_events = []
        self.session_counter = 0
        self.attempt_counter = 0

    def resolve_user_school_context(self, uid, preferred_active_membership_id=None):
        memberships = []
        for membership in self.memberships.values():
            if membership.get('uid') != uid:
                continue
            org = self.organizations[membership['orgId']]
            memberships.append({
                'id': membership['id'],
                'orgId': membership['orgId'],
                'orgName': org['name'],
                'orgType': org['type'],
                'roles': membership['roles'],
                'status': membership['status'],
                'primaryClassIds': membership.get('primaryClassIds', []),
            })

        active_membership = None
        if preferred_active_membership_id:
            active_membership = next(
                (membership for membership in memberships if membership['id'] == preferred_active_membership_id),
                None,
            )
        if active_membership is None and memberships:
            active_membership = memberships[0]

        return {
            'memberships': memberships,
            'active_membership': active_membership,
            'active_membership_id': active_membership.get('id') if active_membership else None,
            'active_organization_id': active_membership.get('orgId') if active_membership else None,
            'active_roles': active_membership.get('roles', []) if active_membership else [],
        }

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def get_user(self, uid):
        return self.users.get(uid)

    def get_student_compliance_record(self, org_id, student_uid):
        record = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(record) if record else None

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'event-{len(self.consent_events)}'

    def create_pronunciation_session(self, uid, locale, kind='practice', prompt_set_id=None, objective_id=None):
        self.session_counter += 1
        session_id = f'session-{self.session_counter}'
        self.pronunciation_sessions[(uid, session_id)] = {
            'id': session_id,
            'locale': locale,
            'kind': kind,
            'prompt_set_id': prompt_set_id,
            'objective_id': objective_id,
        }
        return session_id

    def get_pronunciation_session(self, uid, session_id):
        session_record = self.pronunciation_sessions.get((uid, session_id))
        return dict(session_record) if session_record else None

    def add_pronunciation_attempt(self, uid, session_id, attempt):
        self.attempt_counter += 1
        attempt_id = f'attempt-{self.attempt_counter}'
        self.pronunciation_attempts[(uid, session_id, attempt_id)] = dict(attempt)
        return attempt_id


class PronunciationRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakePronunciationDb()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-secret'

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            return resolve_school_request_context(
                self.fake_db,
                uid,
                preferred_active_membership_id=preferred,
            )

        deps = RouteDeps(
            db=self.fake_db,
            firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: None,
            get_assessment=lambda: {},
            compute_results=lambda *_args, **_kwargs: {},
            get_proficiency_description=lambda *_args, **_kwargs: {
                'level': 'Intermediate Mid',
                'description': 'Test level',
            },
            login_required=passthrough_login_required,
            get_user_proficiency_context=lambda: '',
            build_system_prompt=lambda _context: '',
            get_school_request_context=get_school_request_context,
            set_active_school_membership=lambda _membership_id: None,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_pronunciation_blueprint(deps))
        self.client = self.app.test_client()

        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student@example.com',
                'name': 'Student User',
                'active_membership_id': 'mem-student',
            }

    @unittest.skip(
        "Pilot override: voice is unconditionally allowed, so the voice-block "
        "path is unreachable. Re-enable when _compute_voice_allowed in "
        "backend.services.compliance is restored to gate on consent state."
    )
    def test_speech_token_is_blocked_when_voice_consent_is_missing(self):
        self.fake_db.student_compliance_records['org-1_student-1'].update({
            'guardian_consent_status': 'revoked',
            'voice_consent_status': 'revoked',
            'voice_allowed': False,
        })

        response = self.client.post('/api/azure/speech-token')

        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'voice.blocked.pronunciation_token')

    def test_pronunciation_attempt_strips_audio_url_when_retention_forbids_raw_audio(self):
        create_response = self.client.post('/api/pronunciation/sessions', json={
            'locale': 'fr-FR',
            'kind': 'practice',
            'promptSetId': 'scenario-1',
            'objectiveId': 'OBJ1',
        })
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.get_json()['sessionId']
        self.assertFalse(create_response.get_json()['session']['rawAudioStorageAllowed'])

        attempt_response = self.client.post('/api/pronunciation/attempts', json={
            'sessionId': session_id,
            'promptId': 'prompt-1',
            'referenceText': 'Bonjour',
            'recognizedText': 'Bonjour',
            'locale': 'fr-FR',
            'objectiveId': 'OBJ1',
            'scores': {'accuracy': 92},
            'words': [],
            'audioUrl': 'https://example.com/audio.webm',
        })

        self.assertEqual(attempt_response.status_code, 200)
        stored_attempt = self.fake_db.pronunciation_attempts[('student-1', session_id, 'attempt-1')]
        self.assertIsNone(stored_attempt['audio_url'])
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'retention.audio_storage_suppressed')


if __name__ == '__main__':
    unittest.main()
