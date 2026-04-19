import unittest
from unittest.mock import patch

from flask import Flask, session

from backend.route_deps import RouteDeps
from backend.routes.chat import (
    AVATAR_EXPRESSION_IDS,
    AVATAR_MOTION_REFS,
    AVATAR_REACTION_INTENTS,
    build_avatar_context_payload,
    build_avatar_directive_tool,
    build_realtime_session_request,
    create_chat_blueprint,
    realtime_avatar_directives_requested,
)
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
    'taxonomies': {
        'contextTags': ['restaurant', 'ordering'],
        'communicativeFunctions': ['ask_follow_up', 'ask_for_clarification'],
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
            'title': {'en': 'Restaurant roleplay'},
            'moduleGoal': {'en': 'Order food politely.'},
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
                            'setting': 'Restaurant',
                            'roles': ['learner', 'server'],
                            'contextTags': ['restaurant', 'ordering'],
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
            'canDo': {'en': 'I can order food in a restaurant conversation.'},
            'contextTags': ['restaurant', 'ordering'],
            'communicativeFunctions': ['ask_follow_up', 'ask_for_clarification'],
            'discourseMoves': ['turn_taking', 'self_correction'],
            'foundationDomains': ['communication_strategies', 'language_control'],
            'register': 'mixed',
            'mastery': {'rubricId': 'rub.speaking.v1', 'threshold': 3},
            'evidenceModel': {'taskModel': 'ap.conversation', 'minTurns': 4, 'timeLimitSec': 90},
            'templateRefs': ['tpl.restaurant_roleplay.v1'],
        }
    ],
    'rubrics': [
        {
            'id': 'rub.speaking.v1',
            'title': {'en': 'Speaking Rubric'},
            'scale': {'min': 0, 'max': 4, 'step': 1},
            'dimensions': [
                {
                    'id': 'task_completion',
                    'title': {'en': 'Task completion'},
                    'description': {'en': 'Completes the assigned task clearly.'},
                }
            ],
        }
    ],
    'templates': {
        'activityTemplateIds': ['tpl.restaurant_roleplay.v1'],
        'activityTemplates': [
            {
                'id': 'tpl.restaurant_roleplay.v1',
                'title': {'en': 'Restaurant Roleplay'},
                'mode': 'interpersonal_speaking',
                'assistantRole': 'Play the server and reveal menu details only when the learner asks.',
                'interactionPattern': {
                    'openingMoves': ['Greet the learner and wait for an order request.'],
                    'sustainMoves': ['Answer questions briefly, then push the learner to choose or clarify.'],
                    'closingMoves': ['Close after the learner confirms the final order.'],
                    'completionRule': 'The learner must place an order and ask at least one follow-up question.',
                },
                'promptCues': ['Keep the server voice concise and in character.'],
            }
        ],
    },
}


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


class FakeRealtimeRouteDb:
    def __init__(self):
        self.organizations = {
            'org-1': {'id': 'org-1', 'name': 'Lingual Academy', 'type': 'school'},
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
            }
        }
        self.assignments = {
            'assignment-1': {
                'id': 'assignment-1',
                'org_id': 'org-1',
                'class_id': 'class-1',
                'title': 'Restaurant Ordering Practice',
                'description': 'Order a meal and ask one follow-up question.',
                'status': 'published',
                'task_type': 'information_gap',
                'success_criteria': ['Use at least one polite request', 'Ask for clarification once'],
                'modality_override': {
                    'mode': 'hybrid',
                    'voice_minutes_cap': 8,
                    'text_fallback_enabled': True,
                },
                'max_attempts': 3,
            }
        }
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
        self.practice_sessions = {
            'practice-1': {
                'id': 'practice-1',
                'org_id': 'org-1',
                'class_id': 'class-1',
                'assignment_id': 'assignment-1',
                'student_uid': 'student-1',
                'mapping_snapshot': {
                    'id': None,
                    'targetExpressions': ['Could I have'],
                    'targetVocabulary': [],
                    'focusGrammar': ['polite requests'],
                    'teacherNotes': 'Keep the student in the restaurant ordering lane.',
                    'feedbackPolicy': {
                        'mode': 'balanced',
                        'targetOnlyStrict': False,
                        'recastDefault': True,
                        'elicitationRepeatThreshold': 3,
                        'endReviewEnabled': True,
                    },
                    'scaffoldPolicy': {
                        'silenceToleranceMs': 3000,
                        'hintLadder': ['wait', 'context_hint', 'choice_prompt', 'model_and_retry'],
                        'maxModelingSteps': 1,
                    },
                    'outputPolicy': {
                        'min_student_turn_words': 8,
                        'follow_up_pressure': 'balanced',
                        'allow_clarification_requests': True,
                    },
                },
                'assignment_snapshot': {
                    'id': 'assignment-1',
                    'classId': 'class-1',
                    'title': 'Restaurant Ordering Practice',
                    'description': 'Order a meal and ask one follow-up question.',
                    'maxAttempts': 3,
                    'successCriteria': ['Use at least one polite request', 'Ask for clarification once'],
                },
                'curriculum_snapshot': {
                    'package': {
                        'id': 'canvas-generated',
                        'title': {'en': 'Canvas-Generated Practice'},
                        'learningLocale': 'fr-FR',
                        'levelBand': 'adaptive',
                    },
                    'unit': None,
                    'module': None,
                    'situation': {
                        'id': 'canvas-generated',
                        'kind': 'interpersonal_speaking',
                        'seed': {'setting': 'Parisian bistro roleplay', 'register': 'informal'},
                        'objectiveIds': ['canvas-objective-1'],
                    },
                    'objectives': [
                        {
                            'id': 'canvas-objective-1',
                            'mode': 'interpersonal_speaking',
                            'canDo': {'en': 'I can order politely in a restaurant conversation.'},
                        }
                    ],
                    'rubrics': [],
                    'pedagogy': {
                        'taskModel': 'assignment_conversation',
                        'evidence': {'minTurns': 4, 'maxTurns': 12, 'timeLimitSec': 300},
                        'objectiveIds': ['canvas-objective-1'],
                        'rubricIds': [],
                        'activityTemplates': [],
                        'templateRefs': [],
                    },
                },
                'pedagogy_snapshot': {
                    'taskModel': 'assignment_conversation',
                    'evidence': {'minTurns': 4, 'maxTurns': 12, 'timeLimitSec': 300},
                    'objectiveIds': ['canvas-objective-1'],
                    'rubricIds': [],
                    'activityTemplates': [],
                    'templateRefs': [],
                },
                'modality': 'hybrid',
                'voice_enabled': True,
                'text_enabled': True,
                'status': 'active',
                'prompt_version': 'assignment_bootstrap.v1',
                'transcript_ref': {'chat_id': 'chat-1'},
                'teacher_preview': False,
                'ui_language': 'en',
                'system_prompt_preview': '\n'.join([
                    'You are an AI language tutor helping a student practice spoken fr-FR in a French class (French 2 - Period 3).',
                    '',
                    '## Scenario',
                    'You are ordering dinner at a Parisian bistro and need to ask one clarifying question.',
                    '',
                    '## Objectives',
                    '- I can order politely in a restaurant conversation.',
                    '',
                    '## Target Expressions',
                    'The student should practice using: Could I have',
                    '',
                    '## Focus Grammar',
                    'Pay attention to: polite requests',
                    '',
                    '## Language Mix',
                    'Speak primarily in French. Brief English scaffolding (a single word or short clause) '
                    "is fine when the learner clearly stalls, asks for a translation, or otherwise can't move forward — "
                    'then return to French immediately. Never switch to a different target language.',
                    '',
                    'Guide the conversation naturally. Provide gentle corrections and scaffolding when needed.',
                ]),
                'class_snapshot': {
                    'id': 'class-1',
                    'orgId': 'org-1',
                    'name': 'French 2 - Period 3',
                    'term': 'Spring 2026',
                    'subject': 'French',
                    'learningLocale': 'fr-FR',
                    'gradeBand': '10-11',
                    'status': 'active',
                },
            }
        }
        self.consent_events = []

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

    def get_assignment(self, assignment_id):
        return self.assignments.get(assignment_id)

    def get_class(self, class_id):
        return self.classes.get(class_id)

    def get_student_class_enrollment(self, class_id, student_uid):
        return self.enrollments.get(f'{class_id}_{student_uid}')

    def get_student_compliance_record(self, org_id, student_uid):
        record = self.student_compliance_records.get(f'{org_id}_{student_uid}')
        return dict(record) if record else None

    def create_consent_event(self, **payload):
        self.consent_events.append(dict(payload))
        return f'event-{len(self.consent_events)}'

    def get_user_profile_context(self, _uid):
        return {
            'learning_locale': 'fr-FR',
        }

    def get_practice_session(self, session_id):
        session_record = self.practice_sessions.get(session_id)
        return dict(session_record) if session_record else None


class FakeRealtimeSessionResponse:
    status_code = 200
    text = ''

    def json(self):
        return {
            'id': 'sess_123',
            'client_secret': {
                'value': 'secret_123',
                'expires_at': 1_234_567_890,
            },
        }


class FakeRealtimeConnectResponse:
    status_code = 201
    text = 'mock-answer-sdp'


class RealtimeChatHelpersTestCase(unittest.TestCase):
    def test_build_avatar_directive_tool_exposes_manifest_scoped_enums(self):
        tool = build_avatar_directive_tool()
        properties = tool['parameters']['properties']

        self.assertEqual(tool['name'], 'emit_avatar_directive')
        self.assertEqual(properties['expressionId']['enum'], AVATAR_EXPRESSION_IDS)
        self.assertEqual(properties['motionRef']['enum'], AVATAR_MOTION_REFS)
        self.assertEqual(properties['reactionIntent']['enum'], AVATAR_REACTION_INTENTS)

    def test_build_avatar_context_payload_varies_by_hit_area(self):
        head_context = build_avatar_context_payload('head', 'realtime')
        body_context = build_avatar_context_payload(
            'body',
            'realtime',
            {'type': 'curriculum_module', 'moduleId': 'M1', 'situationId': 'S2'},
        )

        self.assertEqual(head_context['reactionIntent'], 'tap_head_notice')
        self.assertIn('head', head_context['systemMessage'].lower())
        self.assertIn('reactionintent=tap_head_notice', head_context['systemMessage'].lower())
        self.assertEqual(body_context['reactionIntent'], 'tap_body_affirm')
        self.assertIn('module M1', body_context['systemMessage'])
        self.assertIn('situation S2', body_context['systemMessage'])

    def test_realtime_session_request_skips_avatar_tools_by_default(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertIn('Base instructions', payload['instructions'])
        self.assertIn('Ignore accidental noise', payload['instructions'])
        self.assertEqual(payload['turn_detection']['threshold'], 0.7)
        self.assertEqual(payload['turn_detection']['create_response'], False)
        self.assertNotIn('tool_choice', payload)
        self.assertNotIn('tools', payload)

    def test_realtime_session_request_includes_avatar_tools_when_enabled(self):
        with patch.dict('os.environ', {'ENABLE_PILOT_AVATAR': 'true', 'ENABLE_REALTIME_AVATAR_DIRECTIVES': 'true'}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertEqual(payload['tool_choice'], 'auto')
        self.assertEqual(payload['tools'][0]['name'], 'emit_avatar_directive')
        self.assertIn('Avatar acting contract', payload['instructions'])
        self.assertIn('Preferred mappings', payload['instructions'])
        self.assertIn('Tap reaction mappings', payload['instructions'])

    def test_realtime_session_request_skips_avatar_tools_when_pilot_avatar_is_disabled(self):
        with patch.dict('os.environ', {'ENABLE_REALTIME_AVATAR_DIRECTIVES': 'true'}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertNotIn('tool_choice', payload)
        self.assertNotIn('tools', payload)

    def test_realtime_session_request_includes_avatar_tools_when_explicitly_enabled(self):
        with patch.dict('os.environ', {'ENABLE_PILOT_AVATAR': 'true'}, clear=False):
            payload = build_realtime_session_request(
                'Base instructions',
                enable_avatar_directives=True,
            )

        self.assertEqual(payload['tool_choice'], 'auto')
        self.assertEqual(payload['tools'][0]['name'], 'emit_avatar_directive')

    def test_realtime_avatar_directives_requested_only_allows_payload_opt_in_in_development(self):
        with patch.dict('os.environ', {'ENABLE_PILOT_AVATAR': 'true', 'FLASK_ENV': 'development'}, clear=False):
            self.assertTrue(realtime_avatar_directives_requested({'avatarDirectives': True}))

        with patch.dict('os.environ', {'FLASK_ENV': 'production'}, clear=False):
            self.assertFalse(realtime_avatar_directives_requested({'avatarDirectives': True}))

        with patch.dict('os.environ', {'FLASK_ENV': 'development'}, clear=False):
            self.assertFalse(realtime_avatar_directives_requested({'avatarDirectives': False}))

        with patch.dict('os.environ', {'FLASK_ENV': 'development'}, clear=False):
            self.assertFalse(realtime_avatar_directives_requested({'avatarDirectives': True}))


class RealtimeChatRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.fake_db = FakeRealtimeRouteDb()
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
            get_user_proficiency_context=lambda: 'Intermediate Mid',
            build_system_prompt=lambda context, learning_locale='ko-KR': (
                f'Generic prompt: {context} ({learning_locale})'
            ),
            get_school_request_context=get_school_request_context,
            set_active_school_membership=lambda _membership_id: None,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        self.app.register_blueprint(create_chat_blueprint(deps))
        self.client = self.app.test_client()

        with self.client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student@example.com',
                'name': 'Student User',
                'active_membership_id': 'mem-student',
            }

    def test_realtime_session_uses_assignment_bootstrap_prompt_when_assignment_id_is_present(self):
        # After C2, the Canvas-generated bootstrap is the only path. The
        # assignment doc carries scenario fields directly (no mapping row).
        self.fake_db.assignments['assignment-1'].update({
            'instructions': 'Order a meal politely in French.',
            'generated_scenario': 'You are ordering dinner at a Parisian bistro and need to ask one clarifying question.',
            'target_expressions': ['Could I have'],
            'focus_grammar': ['polite requests'],
            'teacher_notes': 'Keep the student in the restaurant ordering lane.',
        })

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                mocked_post.return_value = FakeRealtimeSessionResponse()

                response = self.client.post('/api/realtime/session', json={
                    'uiLanguage': 'en',
                    'practice': {
                        'type': 'curriculum_module',
                        'assignmentId': 'assignment-1',
                        'moduleId': 'M1',
                        'situationId': 'S1',
                    },
                })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['client_secret'], 'secret_123')

        request_payload = mocked_post.call_args.kwargs['json']
        instructions = request_payload['instructions']

        self.assertIn('Assignment title: Restaurant Ordering Practice', instructions)
        self.assertNotIn('Task type:', instructions)
        # Canvas-generated scenario content flows into the prompt.
        self.assertIn('Parisian bistro', instructions)
        self.assertIn('Could I have', instructions)
        self.assertIn('polite requests', instructions)

    def test_realtime_session_curriculum_module_payload_without_assignment_uses_generic_prompt(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                mocked_post.return_value = FakeRealtimeSessionResponse()

                response = self.client.post('/api/realtime/session', json={
                    'uiLanguage': 'en',
                    'practice': {
                        'type': 'curriculum_module',
                        'moduleId': 'M1',
                        'situationId': 'S1',
                    },
                })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])

        request_payload = mocked_post.call_args.kwargs['json']
        instructions = request_payload['instructions']

        self.assertIn('Generic prompt: Intermediate Mid (fr-FR)', instructions)
        self.assertNotIn('Prompt for M1::S1', instructions)

    def test_realtime_session_blocks_voice_when_consent_is_missing(self):
        self.fake_db.student_compliance_records['org-1_student-1'].update({
            'guardian_consent_status': 'revoked',
            'voice_consent_status': 'revoked',
            'voice_allowed': False,
        })

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                response = self.client.post('/api/realtime/session', json={
                    'uiLanguage': 'en',
                    'practice': {
                        'type': 'curriculum_module',
                        'assignmentId': 'assignment-1',
                        'moduleId': 'M1',
                        'situationId': 'S1',
                    },
                })

        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('blockedReasons', payload)
        mocked_post.assert_not_called()
        self.assertEqual(self.fake_db.consent_events[-1]['event_type'], 'voice.blocked.realtime_session')

    def test_realtime_session_uses_practice_session_snapshot_fast_path(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                mocked_post.return_value = FakeRealtimeSessionResponse()
                with patch('backend.routes.chat.resolve_assignment_bootstrap_for_user') as mocked_bootstrap:
                    mocked_bootstrap.side_effect = AssertionError('full bootstrap should not run for the fast path')

                    response = self.client.post('/api/realtime/session', json={
                        'uiLanguage': 'en',
                        'practice': {
                            'type': 'canvas_generated',
                            'assignmentId': 'assignment-1',
                            'practiceSessionId': 'practice-1',
                        },
                    })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])

        request_payload = mocked_post.call_args.kwargs['json']
        instructions = request_payload['instructions']

        self.assertIn('Assignment title: Restaurant Ordering Practice', instructions)
        self.assertIn('Parisian bistro', instructions)
        self.assertIn('Could I have', instructions)

    def test_realtime_session_fast_path_still_blocks_when_voice_permission_is_revoked(self):
        self.fake_db.student_compliance_records['org-1_student-1'].update({
            'guardian_consent_status': 'revoked',
            'voice_consent_status': 'revoked',
            'voice_allowed': False,
        })

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                with patch('backend.routes.chat.resolve_assignment_bootstrap_for_user') as mocked_bootstrap:
                    mocked_bootstrap.side_effect = AssertionError('full bootstrap should not run for the fast path')

                    response = self.client.post('/api/realtime/session', json={
                        'uiLanguage': 'en',
                        'practice': {
                            'type': 'canvas_generated',
                            'assignmentId': 'assignment-1',
                            'practiceSessionId': 'practice-1',
                        },
                    })

        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('blockedReasons', payload)
        mocked_post.assert_not_called()

    def test_realtime_session_allows_avatar_directive_opt_in_in_development(self):
        with patch.dict(
            'os.environ',
            {'OPENAI_API_KEY': 'test-openai-key', 'ENABLE_PILOT_AVATAR': 'true', 'FLASK_ENV': 'development'},
            clear=False,
        ):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                mocked_post.return_value = FakeRealtimeSessionResponse()

                response = self.client.post('/api/realtime/session', json={
                    'uiLanguage': 'en',
                    'avatarDirectives': True,
                })

        self.assertEqual(response.status_code, 200)
        request_payload = mocked_post.call_args.kwargs['json']
        self.assertEqual(request_payload['tool_choice'], 'auto')
        self.assertEqual(request_payload['tools'][0]['name'], 'emit_avatar_directive')

    def test_realtime_connect_proxies_offer_to_openai(self):
        with patch('backend.routes.chat.requests.post') as mocked_post:
            mocked_post.return_value = FakeRealtimeConnectResponse()

            response = self.client.post('/api/realtime/connect', json={
                'offerSdp': 'v=0\r\no=- 0 0 IN IP4 127.0.0.1',
                'clientSecret': 'secret_123',
                'model': 'gpt-realtime-mini',
            })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['answerSdp'], 'mock-answer-sdp')
        self.assertEqual(
            mocked_post.call_args.kwargs['params'],
            {'model': 'gpt-realtime-mini'},
        )
        self.assertEqual(
            mocked_post.call_args.kwargs['headers']['Content-Type'],
            'application/sdp',
        )
        self.assertEqual(
            mocked_post.call_args.kwargs['headers']['Accept'],
            'application/sdp',
        )
        self.assertEqual(
            mocked_post.call_args.kwargs['data'],
            'v=0\r\no=- 0 0 IN IP4 127.0.0.1',
        )

    def test_realtime_connect_requires_offer_and_client_secret(self):
        response = self.client.post('/api/realtime/connect', json={})

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        self.assertIn('offerSdp is required', payload['error'])


if __name__ == '__main__':
    unittest.main()
