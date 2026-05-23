import json
import unittest

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.curriculum_admin import create_curriculum_admin_blueprint
from backend.services.membership_context import resolve_school_request_context


def passthrough_login_required(func):
    return func


class _FakeOpenAIResponse:
    def __init__(self, payload):
        self.choices = [type('Choice', (), {
            'message': type('Message', (), {'content': json.dumps(payload)})()
        })()]


class _FakeOpenAIClient:
    def __init__(self, payload):
        self._payload = payload
        self.chat = type('Chat', (), {
            'completions': type('Completions', (), {
                'create': self._create,
            })()
        })()

    def _create(self, *args, **kwargs):
        return _FakeOpenAIResponse(self._payload)


SAMPLE_PACKAGE = {
    'curriculum': {
        'id': 'sample-ap-french',
        'title': {'en': 'Sample AP French'},
        'learningLocale': 'fr-FR',
        'levelBand': 'B1-B2',
        'version': '2026.03',
        'source': {'type': 'native'},
    },
    'taxonomies': {
        'contextTags': ['weekend', 'narrative'],
        'communicativeFunctions': ['ask_follow_up', 'summarize'],
        'discourseMoves': ['turn_taking', 'self_correction'],
        'taskModels': ['ap.conversation'],
        'foundationDomains': ['communication_strategies', 'language_control'],
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
            'capstone': {
                'mode': 'interpersonal_speaking',
                'taskModel': 'ap.conversation',
                'situationId': 'S1',
            },
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
                            'constraints': {'minTurns': 4, 'maxTurns': 8},
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
            'communicativeFunctions': ['ask_follow_up', 'summarize'],
            'discourseMoves': ['turn_taking', 'self_correction'],
            'foundationDomains': ['communication_strategies', 'language_control'],
            'register': 'mixed',
            'mastery': {'rubricId': 'rub.interpersonal_speaking.v1', 'threshold': 3},
            'evidenceModel': {'taskModel': 'ap.conversation', 'minTurns': 4},
            'templateRefs': ['tpl.conversation.v1'],
        }
    ],
    'rubrics': [
        {
            'id': 'rub.interpersonal_speaking.v1',
            'title': {'en': 'Interpersonal Speaking Rubric'},
            'scale': {'min': 0, 'max': 4, 'step': 1},
            'dimensions': [
                {
                    'id': 'interaction_management',
                    'title': {'en': 'Interaction Management'},
                    'description': {'en': 'Initiates and sustains the exchange.'},
                },
                {
                    'id': 'lexical_grammatical_control',
                    'title': {'en': 'Lexical/Grammatical Control'},
                    'description': {'en': 'Uses vocabulary and grammar with control.'},
                },
            ],
        }
    ],
    'templates': {
        'activityTemplateIds': ['tpl.conversation.v1'],
        'activityTemplates': [
            {
                'id': 'tpl.conversation.v1',
                'title': {'en': 'Conversation Exchange'},
                'mode': 'interpersonal_speaking',
                'assistantRole': 'Act as a peer conversation partner who prompts for more detail without taking over.',
                'interactionPattern': {
                    'openingMoves': ['Start with an everyday question tied to the situation.'],
                    'sustainMoves': ['Push the learner to elaborate and summarize what happened.'],
                    'closingMoves': ['Close only after the learner has summarized the main event.'],
                    'completionRule': 'The learner must sustain the exchange and summarize the event before closing.',
                },
                'promptCues': ['Keep the exchange natural and peer-like.'],
            }
        ],
    },
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
                'retention_policy_id': 'standard_school',
            }
        }
        self.consent_events = []
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

    def get_student_compliance_record(self, org_id, student_uid):
        record = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(record) if record else None

    def upsert_student_compliance_record(self, org_id, student_uid, record):
        self.student_compliance_records[f'{org_id}_{student_uid}'] = dict(record)

    def get_user(self, uid):
        return {'uid': uid, 'profile': {'age': 15}}

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'event-{len(self.consent_events)}'

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

    def list_assignment_learning_events(self, assignment_id, event_types=None):
        allowed_event_types = set(event_types or [])
        events = []
        for event in self.learning_events.values():
            if event.get('assignment_id') != assignment_id:
                continue
            if allowed_event_types and event.get('event_type') not in allowed_event_types:
                continue
            events.append(dict(event))
        return events


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
        self.fake_openai_client = _FakeOpenAIClient({
            'scenario': 'Students discuss a teacher-provided source packet and decide how to use the key vocabulary in context.',
            'target_expressions': ['Quisiera practicar...', 'Segun la rubrica...'],
            'target_vocabulary': ['reservar', 'camarero'],
            'focus_grammar': ['polite requests'],
            'success_criteria': ['Use the source vocabulary naturally'],
            'task_type': 'decision_making',
            'suggested_title': 'Source-based speaking task',
            'suggested_description': 'Use the pasted class materials to prepare a guided speaking task.',
            'teacher_notes': 'Keep the discussion anchored to the pasted source packet.',
        })
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
            get_openai_client=lambda: self.fake_openai_client,
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

    def test_teacher_can_create_direct_assignment(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'title': 'Weekend Storytelling',
            'description': 'Retell what happened last weekend.',
            'status': 'published',
            'instructions': 'Describe your weekend in the past tense.',
            'generatedScenario': 'You are catching up with a friend after the weekend.',
            'targetExpressions': ['Could I have'],
            'focusGrammar': ['past tense'],
            'successCriteria': ['Use past tense verbs three times'],
            'teacherNotes': 'Keep the conversation focused on past narrative.',
        })
        self.assertEqual(assignment_response.status_code, 201)
        assignment_payload = assignment_response.get_json()['assignment']
        self.assertEqual(assignment_payload['status'], 'published')
        self.assertNotIn('mappingId', assignment_payload)
        self.assertEqual(assignment_payload['generatedScenario'], 'You are catching up with a friend after the weekend.')
        self.assertEqual(assignment_payload['targetExpressions'], ['Could I have'])

    def test_teacher_can_create_direct_field_assignment_without_mapping(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'title': 'Restaurant role-play',
            'description': 'Practice polite ordering.',
            'instructions': 'Use the target phrases naturally.',
            'generatedScenario': 'You are ordering dinner at a busy restaurant.',
            'targetExpressions': ['Quisiera...', 'La cuenta, por favor'],
            'targetVocabulary': ['reservar', 'camarero'],
            'focusGrammar': ['conditional politeness'],
            'successCriteria': ['Order two items and ask one follow-up question'],
            'teacherNotes': 'Push for full-sentence responses.',
            'status': 'draft',
        })
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        assignment = payload['assignment']
        self.assertEqual(assignment['title'], 'Restaurant role-play')
        self.assertNotIn('mappingId', assignment)
        stored = self.fake_db.get_assignment(assignment['id'])
        self.assertEqual(stored['instructions'], 'Use the target phrases naturally.')
        self.assertEqual(stored['generated_scenario'], 'You are ordering dinner at a busy restaurant.')
        self.assertEqual(stored['target_expressions'], ['Quisiera...', 'La cuenta, por favor'])
        self.assertEqual(stored['target_vocabulary'], ['reservar', 'camarero'])
        self.assertEqual(stored['focus_grammar'], ['conditional politeness'])
        self.assertEqual(stored['teacher_notes'], 'Push for full-sentence responses.')

    def test_teacher_can_generate_assignment_draft_from_source_text(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        response = self.client.post('/api/teacher/classes/class-1/assignment-drafts/generate', json={
            'sourceText': 'Key vocabulary: reservar, mesa, camarero. Rubric note: students should ask for clarification politely.',
        })
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['suggestions']['suggestedTitle'], 'Source-based speaking task')
        self.assertIn('scenario', payload['suggestions'])
        self.assertEqual(payload['suggestions']['targetVocabulary'], ['reservar', 'camarero'])
        self.assertNotIn('taskType', payload['suggestions'])

    def test_student_assignment_bootstrap_returns_realtime_params(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'title': 'Weekend Storytelling',
            'status': 'published',
            'instructions': 'Describe your weekend using past tense verbs.',
            'generatedScenario': 'You are catching up with a friend after the weekend.',
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
        # After C2, the realtime params use the canvas_generated shape.
        self.assertEqual(bootstrap['realtimeSessionParams']['practice']['type'], 'canvas_generated')
        self.assertEqual(bootstrap['realtimeSessionParams']['practice']['assignmentId'], assignment_id)

    def test_student_assignment_bootstrap_keeps_voice_allowed_under_pilot_override(self):
        """Pilot override: voice is always allowed at the bootstrap layer, so
        even when guardian+voice are both revoked on the stored record, the
        resolved ``voice_allowed`` is True and the text-fallback path is not
        triggered. The fallback mechanism itself is still covered by the
        ``apply_launch_compliance`` unit tests in ``test_compliance.py``."""
        self._set_session_user('teacher-1', 'mem-teacher')

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'title': 'Voice practice with fallback',
            'status': 'published',
            'instructions': 'Ask for clarification when needed.',
            'generatedScenario': 'You are ordering dinner at a busy restaurant.',
            'modalityOverride': {
                'mode': 'hybrid',
                'textFallbackEnabled': True,
            },
        })
        assignment_id = assignment_response.get_json()['assignment']['id']

        self.fake_db.student_compliance_records['org-1_student-1'].update({
            'guardian_consent_status': 'revoked',
            'voice_consent_status': 'revoked',
            'voice_allowed': False,
        })

        self._set_session_user('student-1', 'mem-student')
        bootstrap_response = self.client.post(f'/api/student/assignments/{assignment_id}/bootstrap', json={
            'uiLanguage': 'en',
        })

        self.assertEqual(bootstrap_response.status_code, 200)
        bootstrap = bootstrap_response.get_json()['bootstrap']
        self.assertEqual(bootstrap['launch']['configuredMode'], 'hybrid')
        self.assertEqual(bootstrap['launch']['modality']['mode'], 'hybrid')
        self.assertTrue(bootstrap['launch']['voiceAllowed'])
        self.assertTrue(bootstrap['launch']['textAllowed'])
        self.assertFalse(bootstrap['launch']['fallbackApplied'])

    def test_practice_session_events_roll_up_into_assignment_analytics(self):
        self._set_session_user('teacher-1', 'mem-teacher')

        assignment_response = self.client.post('/api/teacher/classes/class-1/assignments', json={
            'title': 'Restaurant mission',
            'status': 'published',
            'instructions': "Use past-tense verbs and 'j'ai' while ordering.",
            'generatedScenario': 'You are ordering at a French cafe and recount your morning.',
            'targetExpressions': ["j'ai"],
            'focusGrammar': ['past tense'],
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
            'payload': {'content': "Hier je vais au restaurant et j'ai manger avec mes amis."},
        })
        self.assertEqual(student_turn_response.status_code, 200)
        self.assertEqual(
            student_turn_response.get_json()['practiceSession']['sessionSummary']['studentTurnCount'],
            1,
        )

        second_student_turn_response = self.client.post(f'/api/practice-sessions/{session_id}/events', json={
            'eventType': 'student.turn',
            'turnIndex': 1,
            'payload': {'content': "Le week-end dernier je vais chez ma tante et j'ai manger trop vite."},
        })
        self.assertEqual(second_student_turn_response.status_code, 200)
        self.assertEqual(
            second_student_turn_response.get_json()['practiceSession']['sessionSummary']['repeatedErrorCounts']['fr.past_auxiliary_infinitive'],
            2,
        )

        assistant_turn_response = self.client.post(f'/api/practice-sessions/{session_id}/events', json={
            'eventType': 'assistant.turn',
            'turnIndex': 2,
            'payload': {'content': "Tu veux dire: hier je suis allé au restaurant ? Essaie encore avec le passé composé."},
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
        self.assertEqual(analytics['summary']['totalStudentTurns'], 2)
        self.assertEqual(analytics['summary']['totalAssistantTurns'], 1)
        self.assertEqual(analytics['summary']['targetExpressionHits']["j'ai"], 2)
        # After C2, the Canvas-generated bootstrap powers the pedagogy
        # context directly from the assignment; curriculum-package objectives
        # and rubrics are no longer attached.
        self.assertEqual(analytics['pedagogy']['taskModel'], 'assignment_conversation')
        self.assertEqual(analytics['pedagogy']['evidence']['minTurns'], 4)
        self.assertEqual(analytics['pedagogy']['objectives'], [])
        self.assertEqual(analytics['pedagogy']['rubrics'], [])

    def _reset_student_voice_consent(self):
        record = self.fake_db.student_compliance_records['org-1_student-1']
        record['voice_consent_status'] = 'unknown'
        record['voice_allowed'] = False

    def test_student_self_consent_grants_voice(self):
        self._reset_student_voice_consent()
        self._set_session_user('student-1', 'mem-student')
        response = self.client.post(
            '/api/student/voice-consent',
            json={'status': 'granted'},
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['compliance']['voiceConsentStatus'], 'granted')
        self.assertTrue(body['compliance']['voiceAllowed'])
        stored = self.fake_db.get_student_compliance_record('org-1', 'student-1')
        self.assertEqual(stored['voice_consent_status'], 'granted')

    def test_student_self_consent_revoke(self):
        self._set_session_user('student-1', 'mem-student')
        response = self.client.post(
            '/api/student/voice-consent',
            json={'status': 'revoked'},
        )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        # The revoke is recorded in the audit field, but the pilot override
        # keeps voice_allowed True regardless of consent state.
        self.assertEqual(body['compliance']['voiceConsentStatus'], 'revoked')
        self.assertTrue(body['compliance']['voiceAllowed'])

    def test_student_self_consent_invalid_status_rejected(self):
        self._set_session_user('student-1', 'mem-student')
        response = self.client.post('/api/student/voice-consent', json={'status': 'maybe'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_status')

    def test_student_can_fetch_own_compliance(self):
        self._set_session_user('student-1', 'mem-student')
        response = self.client.get('/api/student/compliance')
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body['success'])
        self.assertIn('retentionPolicy', body['compliance'])
        self.assertEqual(body['compliance']['retentionPolicy']['id'], 'standard_school')

    def test_student_self_consent_logs_event(self):
        self._reset_student_voice_consent()
        self._set_session_user('student-1', 'mem-student')
        self.client.post('/api/student/voice-consent', json={'status': 'granted'})
        events = [e for e in self.fake_db.consent_events if e.get('event_type') == 'voice_consent_granted']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['actor_type'], 'student')
        self.assertEqual(events[0]['actor_id'], 'student-1')


if __name__ == '__main__':
    unittest.main()
