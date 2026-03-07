import unittest

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


SAMPLE_PACKAGE = {
    'curriculum': {
        'id': 'sample-ap-french',
        'title': {'en': 'Sample AP French'},
        'learningLocale': 'fr-FR',
        'levelBand': 'B1-B2',
        'version': '2026.03',
        'source': {'type': 'native'},
    },
    'units': [
        {
            'id': 'U1',
            'title': {'en': 'Unit 1'},
            'ap': {'unitNumber': 1},
        }
    ],
    'modules': [
        {
            'id': 'M1',
            'unitId': 'U1',
            'title': {'en': 'Past tense narratives'},
            'moduleGoal': {'en': 'Describe what happened last weekend.'},
            'situations': {
                'interpretive_listening': [],
                'interpersonal_speaking': [
                    {
                        'id': 'S1',
                        'kind': 'interpersonal_speaking',
                        'seed': {
                            'setting': 'Weekend recap',
                            'roles': ['learner', 'friend'],
                            'contextTags': ['weekend', 'narrative'],
                            'register': 'mixed',
                            'constraints': {'minTurns': 4},
                        },
                        'objectiveIds': ['OBJ1'],
                    }
                ],
                'presentational_speaking': [],
            },
        }
    ],
    'objectives': [
        {
            'id': 'OBJ1',
            'unitId': 'U1',
            'moduleId': 'M1',
            'mode': 'interpersonal_speaking',
            'canDo': {'en': 'I can describe past events in a conversation.'},
            'contextTags': ['weekend', 'past'],
        }
    ],
}


class FakeCurriculumAdminDb:
    def __init__(self):
        self.organizations = {
            'org-1': {'id': 'org-1', 'name': 'Lingual Academy', 'type': 'school'},
        }
        self.memberships = {
            'mem-teacher': {
                'id': 'mem-teacher',
                'uid': 'teacher-1',
                'orgId': 'org-1',
                'roles': ['teacher'],
                'status': 'active',
                'primaryClassIds': ['class-1'],
            },
            'mem-student': {
                'id': 'mem-student',
                'uid': 'student-1',
                'orgId': 'org-1',
                'roles': ['student'],
                'status': 'active',
                'primaryClassIds': ['class-1'],
            },
        }
        self.classes = {
            'class-1': {
                'id': 'class-1',
                'org_id': 'org-1',
                'name': 'French 2 - Period 3',
                'term': 'Spring 2026',
                'subject': 'French',
                'learning_locale': 'fr-FR',
                'teacher_membership_ids': ['mem-teacher'],
                'grade_band': '10-11',
                'status': 'active',
                'created_at': None,
                'updated_at': None,
            }
        }
        self.curriculum_mappings = {}
        self.assignments = {}
        self.practice_sessions = {}
        self.learning_events = {}
        self.enrollments = {
            'class-1_student-1': {
                'id': 'class-1_student-1',
                'class_id': 'class-1',
                'student_uid': 'student-1',
                'status': 'active',
            }
        }
        self.mapping_counter = 0
        self.assignment_counter = 0
        self.practice_session_counter = 0
        self.learning_event_counter = 0

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

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def create_curriculum_mapping(self, **payload):
        self.mapping_counter += 1
        mapping_id = f'mapping-{self.mapping_counter}'
        self.curriculum_mappings[mapping_id] = {
            'id': mapping_id,
            **payload,
            'created_at': None,
            'updated_at': None,
        }
        return mapping_id

    def get_curriculum_mapping(self, mapping_id):
        return self.curriculum_mappings.get(mapping_id)

    def list_class_curriculum_mappings(self, class_id):
        return [
            dict(mapping)
            for mapping in self.curriculum_mappings.values()
            if mapping.get('class_id') == class_id
        ]

    def create_assignment(self, **payload):
        self.assignment_counter += 1
        assignment_id = f'assignment-{self.assignment_counter}'
        self.assignments[assignment_id] = {
            'id': assignment_id,
            **payload,
            'created_at': None,
            'updated_at': None,
        }
        return assignment_id

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def list_class_assignments(self, class_id, statuses=None):
        allowed = set(statuses or [])
        assignments = []
        for assignment in self.assignments.values():
            if assignment.get('class_id') != class_id:
                continue
            if allowed and assignment.get('status') not in allowed:
                continue
            assignments.append(dict(assignment))
        return assignments

    def list_student_assignments(self, student_uid, statuses=None):
        allowed = set(statuses or [])
        assignments = []
        for enrollment in self.enrollments.values():
            if enrollment.get('student_uid') != student_uid or enrollment.get('status') != 'active':
                continue
            class_id = enrollment.get('class_id')
            for assignment in self.assignments.values():
                if assignment.get('class_id') != class_id:
                    continue
                if allowed and assignment.get('status') not in allowed:
                    continue
                assignments.append(dict(assignment))
        return assignments

    def get_student_class_enrollment(self, class_id, student_uid):
        return self.enrollments.get(f'{class_id}_{student_uid}')

    def create_practice_session(self, payload, session_id=None):
        self.practice_session_counter += 1
        session_id = session_id or f'practice-{self.practice_session_counter}'
        self.practice_sessions[session_id] = {
            'id': session_id,
            **payload,
        }
        return session_id

    def get_practice_session(self, session_id):
        session = self.practice_sessions.get(session_id)
        return dict(session) if session else None

    def update_practice_session(self, session_id, updates):
        self.practice_sessions[session_id].update(updates)

    def list_assignment_practice_sessions(self, assignment_id):
        return [
            dict(session)
            for session in self.practice_sessions.values()
            if session.get('assignment_id') == assignment_id
        ]

    def create_learning_event(self, payload, event_id=None):
        self.learning_event_counter += 1
        event_id = event_id or f'event-{self.learning_event_counter}'
        self.learning_events[event_id] = {
            'id': event_id,
            **payload,
        }
        return event_id


def build_test_curriculum_context(module_id, situation_id):
    module = SAMPLE_PACKAGE['modules'][0]
    situation = module['situations']['interpersonal_speaking'][0]
    if module['id'] != module_id or situation['id'] != situation_id:
        raise ValueError('Invalid curriculum selection.')
    unit = SAMPLE_PACKAGE['units'][0]
    objectives = [
        objective
        for objective in SAMPLE_PACKAGE['objectives']
        if objective['id'] in situation['objectiveIds']
    ]
    return SAMPLE_PACKAGE, unit, module, situation, 'interpersonal_speaking', objectives


class CurriculumAdminRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakeCurriculumAdminDb()
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
            load_sample_curriculum_package=lambda: SAMPLE_PACKAGE,
            get_curriculum_practice_context=lambda **kwargs: build_test_curriculum_context(
                kwargs['module_id'],
                kwargs['situation_id'],
            ),
            build_curriculum_system_prompt=lambda **kwargs: (
                f"Prompt for {kwargs['module']['id']}::{kwargs['situation']['id']}"
            ),
            get_school_request_context=get_school_request_context,
            set_active_school_membership=lambda _membership_id: None,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_curriculum_admin_blueprint(deps))
        self.client = self.app.test_client()

    def _set_session_user(self, uid, membership_id):
        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': uid,
                'email': f'{uid}@example.com',
                'name': uid,
                'active_membership_id': membership_id,
            }

    def test_teacher_can_create_mapping_and_assignment(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        mapping_response = self.client.post('/api/teacher/classes/class-1/curriculum/mappings', json={
            'packageId': 'sample-ap-french',
            'moduleId': 'M1',
            'objectiveIds': ['OBJ1'],
            'situationIds': ['S1'],
            'targetExpressions': ['Could I have'],
            'focusGrammar': ['past tense'],
            'allowedContextTags': ['weekend'],
            'teacherNotes': 'Keep the conversation focused on past narrative.',
        })
        self.assertEqual(mapping_response.status_code, 201)
        mapping_payload = mapping_response.get_json()['mapping']
        self.assertEqual(mapping_payload['moduleId'], 'M1')
        self.assertEqual(mapping_payload['situationIds'], ['S1'])

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'mappingId': mapping_payload['id'],
            'title': 'Weekend Storytelling',
            'description': 'Retell what happened last weekend.',
            'status': 'published',
            'taskType': 'decision_making',
            'successCriteria': ['Use past tense verbs three times'],
        })
        self.assertEqual(assignment_response.status_code, 201)
        assignment_payload = assignment_response.get_json()['assignment']
        self.assertEqual(assignment_payload['status'], 'published')
        self.assertEqual(assignment_payload['mappingId'], mapping_payload['id'])

    def test_student_assignment_bootstrap_returns_realtime_params(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        mapping_response = self.client.post('/api/teacher/classes/class-1/curriculum/mappings', json={
            'packageId': 'sample-ap-french',
            'moduleId': 'M1',
            'objectiveIds': ['OBJ1'],
            'situationIds': ['S1'],
        })
        mapping_id = mapping_response.get_json()['mapping']['id']

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'mappingId': mapping_id,
            'title': 'Weekend Storytelling',
            'status': 'published',
            'taskType': 'decision_making',
        })
        assignment_id = assignment_response.get_json()['assignment']['id']

        self._set_session_user('student-1', 'mem-student')
        list_response = self.client.get('/api/student/assignments')
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.get_json()['assignments']), 1)

        bootstrap_response = self.client.post(f'/api/student/assignments/{assignment_id}/bootstrap', json={
            'uiLanguage': 'en',
        })
        self.assertEqual(bootstrap_response.status_code, 200)
        bootstrap = bootstrap_response.get_json()['bootstrap']
        self.assertEqual(bootstrap['assignment']['id'], assignment_id)
        self.assertEqual(bootstrap['mapping']['id'], mapping_id)
        self.assertEqual(bootstrap['realtimeSessionParams']['practice']['assignmentId'], assignment_id)
        self.assertEqual(bootstrap['realtimeSessionParams']['practice']['moduleId'], 'M1')
        self.assertIn('sample curriculum package', ' '.join(bootstrap['limitations']).lower())

    def test_practice_session_events_roll_up_into_assignment_analytics(self):
        self._set_session_user('teacher-1', 'mem-teacher')
        mapping_response = self.client.post('/api/teacher/classes/class-1/curriculum/mappings', json={
            'packageId': 'sample-ap-french',
            'moduleId': 'M1',
            'objectiveIds': ['OBJ1'],
            'situationIds': ['S1'],
            'targetExpressions': ['Could I have'],
        })
        mapping_id = mapping_response.get_json()['mapping']['id']

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'mappingId': mapping_id,
            'title': 'Restaurant mission',
            'status': 'published',
            'taskType': 'information_gap',
        })
        assignment_id = assignment_response.get_json()['assignment']['id']

        self._set_session_user('student-1', 'mem-student')
        practice_session_response = self.client.post(
            f'/api/student/assignments/{assignment_id}/practice-sessions',
            json={'uiLanguage': 'en', 'chatId': 'chat-123'},
        )
        self.assertEqual(practice_session_response.status_code, 201)
        practice_session = practice_session_response.get_json()['practiceSession']
        self.assertEqual(practice_session['assignmentId'], assignment_id)
        self.assertEqual(practice_session['chatId'], 'chat-123')

        session_id = practice_session['id']

        student_turn_response = self.client.post(f'/api/practice-sessions/{session_id}/events', json={
            'eventType': 'student.turn',
            'turnIndex': 0,
            'payload': {'content': 'Could I have the soup, please?'},
        })
        self.assertEqual(student_turn_response.status_code, 200)
        self.assertEqual(
            student_turn_response.get_json()['practiceSession']['sessionSummary']['studentTurnCount'],
            1,
        )

        assistant_turn_response = self.client.post(f'/api/practice-sessions/{session_id}/events', json={
            'eventType': 'assistant.turn',
            'turnIndex': 1,
            'payload': {'content': 'Of course. Would you like anything to drink?'},
        })
        self.assertEqual(assistant_turn_response.status_code, 200)
        self.assertEqual(
            assistant_turn_response.get_json()['practiceSession']['sessionSummary']['assistantTurnCount'],
            1,
        )

        session_end_response = self.client.post(f'/api/practice-sessions/{session_id}/events', json={
            'eventType': 'session.ended',
            'payload': {'reason': 'manual_disconnect', 'status': 'completed'},
        })
        self.assertEqual(session_end_response.status_code, 200)
        self.assertEqual(session_end_response.get_json()['practiceSession']['status'], 'completed')

        self._set_session_user('teacher-1', 'mem-teacher')
        analytics_response = self.client.get(f'/api/teacher/assignments/{assignment_id}/analytics')
        self.assertEqual(analytics_response.status_code, 200)
        analytics = analytics_response.get_json()['analytics']
        self.assertEqual(analytics['summary']['sessionCount'], 1)
        self.assertEqual(analytics['summary']['completedSessionCount'], 1)
        self.assertEqual(analytics['summary']['totalStudentTurns'], 1)
        self.assertEqual(analytics['summary']['totalAssistantTurns'], 1)
        self.assertEqual(analytics['summary']['targetExpressionHits']['Could I have'], 1)


if __name__ == '__main__':
    unittest.main()
