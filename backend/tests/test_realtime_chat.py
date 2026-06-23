import unittest
from unittest.mock import patch

from flask import Flask, session

import main
from backend.route_deps import RouteDeps
from backend.routes.chat import (
    AVATAR_EXPRESSION_IDS,
    AVATAR_MOTION_REFS,
    AVATAR_REACTION_INTENTS,
    build_avatar_context_payload,
    build_avatar_directive_tool,
    build_realtime_safety_identifier,
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
        self.chats = {
            'student-1': {
                'chat-existing': {
                    'id': 'chat-existing',
                    'title': 'Existing chat',
                    'created_at': '2026-04-20T00:00:00Z',
                    'updated_at': '2026-04-20T00:00:00Z',
                    'messages': [],
                    'language_mix_level': 'target_led',
                }
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

    def get_organization(self, org_id):
        return self.organizations.get(org_id)

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

    def create_chat_session(self, uid, title=None):
        user_chats = self.chats.setdefault(uid, {})
        chat_id = f'chat-{len(user_chats) + 1}'
        user_chats[chat_id] = {
            'id': chat_id,
            'title': title or 'New Chat',
            'created_at': '2026-04-20T00:00:00Z',
            'updated_at': '2026-04-20T00:00:00Z',
            'messages': [],
            'language_mix_level': 'balanced',
        }
        return chat_id

    def get_chat_sessions(self, uid, limit=50):
        user_chats = list(self.chats.get(uid, {}).values())
        return [
            {
                'id': chat['id'],
                'title': chat['title'],
                'created_at': chat['created_at'],
                'updated_at': chat['updated_at'],
                'message_count': len(chat.get('messages', [])),
                'last_message': None,
                'language_mix_level': chat.get('language_mix_level', 'balanced'),
            }
            for chat in user_chats[:limit]
        ]

    def get_chat_session(self, uid, chat_id):
        chat = self.chats.get(uid, {}).get(chat_id)
        return dict(chat) if chat else None

    def add_message_to_chat(self, uid, chat_id, role, content, timestamp=None, sort_order=None):
        chat = self.chats[uid][chat_id]
        message = {
            'role': role,
            'content': content,
            'timestamp': timestamp or '2026-04-20T00:00:00Z',
        }
        if sort_order is not None:
            message['sort_order'] = sort_order
        chat['messages'].append(message)
        chat['updated_at'] = message['timestamp']
        return dict(message)

    def update_chat_title(self, uid, chat_id, title):
        self.chats[uid][chat_id]['title'] = title

    def update_chat_settings(self, uid, chat_id, *, language_mix_level=None):
        if language_mix_level is not None:
            self.chats[uid][chat_id]['language_mix_level'] = language_mix_level

    def delete_chat_session(self, uid, chat_id):
        self.chats.get(uid, {}).pop(chat_id, None)


class FakeRealtimeSessionResponse:
    status_code = 200
    text = ''

    def json(self):
        return {
            'value': 'secret_123',
            'expires_at': 1_234_567_890,
            'session': {
                'id': 'sess_123',
            },
        }


class FakeRealtimeConnectResponse:
    status_code = 201
    text = 'mock-answer-sdp'


class RealtimeChatHelpersTestCase(unittest.TestCase):
    def test_build_system_prompt_defaults_to_balanced_language_mix(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES')

        self.assertIn('selected language mix level is balanced', prompt)
        self.assertIn('adapt somewhat toward the learner', prompt)

    def test_build_system_prompt_english_first_is_explicitly_english_dominant(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES', 'english_first')

        self.assertIn('Lead each turn in English', prompt)
        self.assertIn('Do not let full Spanish sentences dominate the turn', prompt)
        self.assertIn('Accept English replies as valid progress', prompt)

    def test_build_system_prompt_english_led_keeps_english_in_the_driver_seat(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES', 'english_led')

        self.assertIn('English leads the conversation', prompt)
        self.assertIn('Open most turns in English', prompt)
        self.assertIn('keep the learner safe to reply mostly in English', prompt)

    def test_build_system_prompt_keeps_proficiency_from_overriding_language_mix(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES', 'english_first')

        self.assertIn(
            "When proficiency guidance and the selected language mix level pull in different directions, follow the selected language mix level for language choice.",
            prompt,
        )
        self.assertIn(
            'Let proficiency change difficulty, pacing, and correction depth, not the English-vs-target-language ratio.',
            prompt,
        )
        self.assertNotIn('For ACTFL Intermediate learners, use mostly Spanish', prompt)
        self.assertNotIn('Mix Spanish and English by proficiency', prompt)

    def test_build_system_prompt_emits_target_only_policy(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES', 'target_only')

        self.assertIn('target_only', prompt)
        self.assertIn('explicitly asks for translation', prompt)

    def test_build_system_prompt_normalizes_invalid_language_mix(self):
        prompt = main.build_system_prompt('Intermediate Mid', 'es-ES', 'invalid')

        self.assertIn('selected language mix level is balanced', prompt)
        self.assertIn('never exceed the bounds of the selected language mix level', prompt)

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

    def test_realtime_safety_identifier_is_hashed_and_within_openai_limit(self):
        identifier = build_realtime_safety_identifier('student-1')

        self.assertIsNotNone(identifier)
        self.assertEqual(len(identifier), 64)
        self.assertNotIn('student-1', identifier)

    def test_realtime_session_request_skips_avatar_tools_by_default(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        session_payload = payload['session']
        audio_input = session_payload['audio']['input']

        self.assertEqual(payload['expires_after'], {'anchor': 'created_at', 'seconds': 600})
        self.assertEqual(session_payload['type'], 'realtime')
        self.assertEqual(session_payload['model'], 'gpt-realtime-mini-2025-12-15')
        self.assertNotIn('reasoning', session_payload)
        self.assertEqual(session_payload['output_modalities'], ['audio'])
        self.assertIn('Base instructions', session_payload['instructions'])
        self.assertIn('Ignore accidental noise', session_payload['instructions'])
        self.assertEqual(audio_input['format'], {'type': 'audio/pcm', 'rate': 24000})
        self.assertEqual(
            audio_input['transcription']['model'],
            'gpt-4o-mini-transcribe-2025-12-15',
        )
        self.assertEqual(audio_input['turn_detection']['type'], 'semantic_vad')
        self.assertEqual(audio_input['turn_detection']['eagerness'], 'auto')
        self.assertEqual(audio_input['turn_detection']['create_response'], False)
        self.assertEqual(session_payload['audio']['output']['voice'], 'coral')
        self.assertEqual(session_payload['audio']['output']['speed'], 1.0)
        self.assertNotIn('tool_choice', session_payload)
        self.assertNotIn('tools', session_payload)

    def test_realtime_session_request_includes_requested_speaking_speed(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request(
                'Base instructions',
                speaking_speed=1.15,
            )

        session_payload = payload['session']

        self.assertEqual(session_payload['audio']['output']['speed'], 1.15)
        self.assertIn('slightly faster', session_payload['instructions'].lower())

    def test_realtime_session_request_uses_balanced_semantic_turn_detection(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        turn_detection = payload['session']['audio']['input']['turn_detection']

        self.assertEqual(turn_detection['type'], 'semantic_vad')
        self.assertEqual(turn_detection['eagerness'], 'auto')
        self.assertEqual(turn_detection['create_response'], False)
        self.assertEqual(turn_detection['interrupt_response'], True)
        self.assertNotIn('silence_duration_ms', turn_detection)

    def test_realtime_session_request_accepts_transcription_language_and_prompt(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request(
                'Base instructions',
                transcription_language='fr',
                transcription_prompt='Primary expected language is French. English may also appear.',
            )

        transcription = payload['session']['audio']['input']['transcription']

        self.assertEqual(transcription['language'], 'fr')
        self.assertEqual(
            transcription['prompt'],
            'Primary expected language is French. English may also appear.',
        )

    def test_realtime_session_request_includes_avatar_tools_when_enabled(self):
        with patch.dict('os.environ', {'ENABLE_PILOT_AVATAR': 'true', 'ENABLE_REALTIME_AVATAR_DIRECTIVES': 'true'}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        session_payload = payload['session']

        self.assertEqual(session_payload['tool_choice'], 'auto')
        self.assertEqual(session_payload['tools'][0]['name'], 'emit_avatar_directive')
        self.assertIn('Avatar acting contract', session_payload['instructions'])
        self.assertIn('Preferred mappings', session_payload['instructions'])
        self.assertIn('Tap reaction mappings', session_payload['instructions'])

    def test_realtime_session_request_skips_avatar_tools_when_pilot_avatar_is_disabled(self):
        with patch.dict('os.environ', {'ENABLE_REALTIME_AVATAR_DIRECTIVES': 'true'}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertNotIn('tool_choice', payload['session'])
        self.assertNotIn('tools', payload['session'])

    def test_realtime_session_request_includes_avatar_tools_when_explicitly_enabled(self):
        with patch.dict('os.environ', {'ENABLE_PILOT_AVATAR': 'true'}, clear=False):
            payload = build_realtime_session_request(
                'Base instructions',
                enable_avatar_directives=True,
            )

        self.assertEqual(payload['session']['tool_choice'], 'auto')
        self.assertEqual(payload['session']['tools'][0]['name'], 'emit_avatar_directive')

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
        self.build_system_prompt_calls = []

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            return resolve_school_request_context(
                self.fake_db,
                uid,
                preferred_active_membership_id=preferred,
            )

        def build_system_prompt(context, learning_locale='ko-KR', language_mix_level='balanced'):
            self.build_system_prompt_calls.append({
                'context': context,
                'learning_locale': learning_locale,
                'language_mix_level': language_mix_level,
            })
            return f'Generic prompt: {context} ({learning_locale}) [{language_mix_level}]'

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
            build_system_prompt=build_system_prompt,
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

    def test_create_chat_defaults_language_mix_to_balanced(self):
        create_response = self.client.post('/api/chats', json={'title': 'Fresh chat'})

        self.assertEqual(create_response.status_code, 200)
        created = create_response.get_json()
        self.assertTrue(created['success'])

        chat_response = self.client.get(f"/api/chats/{created['chatId']}")
        self.assertEqual(chat_response.status_code, 200)
        chat = chat_response.get_json()['chat']
        self.assertEqual(chat['language_mix_level'], 'balanced')

    def test_get_chats_includes_language_mix_level(self):
        response = self.client.get('/api/chats')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['chats'][0]['language_mix_level'], 'target_led')

    def test_patch_chat_settings_updates_language_mix_level(self):
        response = self.client.patch(
            '/api/chats/chat-existing/settings',
            json={'languageMixLevel': 'english_led'},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['chat']['language_mix_level'], 'english_led')

    def test_realtime_session_uses_chat_language_mix_for_free_practice(self):
        self.fake_db.chats['student-1']['chat-existing']['language_mix_level'] = 'target_led'

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            with patch('backend.routes.chat.requests.post') as mocked_post:
                mocked_post.return_value = FakeRealtimeSessionResponse()

                response = self.client.post('/api/realtime/session', json={
                    'uiLanguage': 'en',
                    'chatId': 'chat-existing',
                    'speakingSpeed': 1.3,
                })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.build_system_prompt_calls[-1]['language_mix_level'], 'target_led')
        request_payload = mocked_post.call_args.kwargs['json']
        transcription = request_payload['session']['audio']['input']['transcription']
        self.assertEqual(transcription['language'], 'fr')
        self.assertIn('never translate', transcription['prompt'].lower())
        self.assertIn('english may also appear', transcription['prompt'].lower())
        self.assertEqual(request_payload['session']['audio']['output']['speed'], 1.3)
        self.assertIn('briskly', request_payload['session']['instructions'].lower())

    def test_text_chat_uses_chat_language_mix_for_free_practice(self):
        self.fake_db.chats['student-1']['chat-existing']['language_mix_level'] = 'english_first'

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            response = self.client.post('/api/chats/chat-existing/messages', json={
                'message': 'Can you help me practice?',
                'uiLanguage': 'en',
            })

        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.build_system_prompt_calls[-1]['language_mix_level'], 'english_first')

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

        self.assertEqual(
            mocked_post.call_args.args[0],
            'https://api.openai.com/v1/realtime/client_secrets',
        )
        request_headers = mocked_post.call_args.kwargs['headers']
        self.assertIn('OpenAI-Safety-Identifier', request_headers)
        self.assertLessEqual(len(request_headers['OpenAI-Safety-Identifier']), 64)
        self.assertNotIn('student-1', request_headers['OpenAI-Safety-Identifier'])

        request_payload = mocked_post.call_args.kwargs['json']
        instructions = request_payload['session']['instructions']
        transcription = request_payload['session']['audio']['input']['transcription']

        self.assertIn('Restaurant Ordering Practice', instructions)
        self.assertIn('ASSIGNMENT:', instructions)
        self.assertNotIn('Task type:', instructions)
        # Canvas-generated scenario content flows into the prompt.
        self.assertIn('Parisian bistro', instructions)
        self.assertIn('Could I have', instructions)
        self.assertIn('polite requests', instructions)
        self.assertEqual(transcription['language'], 'fr')
        self.assertIn('preserve code-switching', transcription['prompt'].lower())

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
        instructions = request_payload['session']['instructions']

        self.assertIn('Generic prompt: Intermediate Mid (fr-FR) [balanced]', instructions)
        self.assertNotIn('Prompt for M1::S1', instructions)

    @unittest.skip(
        "Pilot override: voice is unconditionally allowed, so the voice-block "
        "path is unreachable. Re-enable when _compute_voice_allowed in "
        "backend.services.compliance is restored to gate on consent state."
    )
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
        instructions = request_payload['session']['instructions']

        self.assertIn('Restaurant Ordering Practice', instructions)
        self.assertIn('ASSIGNMENT:', instructions)
        self.assertIn('Parisian bistro', instructions)
        self.assertIn('Could I have', instructions)

    @unittest.skip(
        "Pilot override: voice is unconditionally allowed, so the voice-block "
        "path is unreachable even on the fast path. Re-enable when "
        "_compute_voice_allowed in backend.services.compliance is restored."
    )
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
        self.assertEqual(request_payload['session']['tool_choice'], 'auto')
        self.assertEqual(request_payload['session']['tools'][0]['name'], 'emit_avatar_directive')

    def test_realtime_connect_proxies_offer_to_openai(self):
        with patch('backend.routes.chat.requests.post') as mocked_post:
            mocked_post.return_value = FakeRealtimeConnectResponse()

            response = self.client.post('/api/realtime/connect', json={
                'offerSdp': 'v=0\r\no=- 0 0 IN IP4 127.0.0.1',
                'clientSecret': 'secret_123',
                'model': 'frontend-controlled-model-should-be-ignored',
            })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['answerSdp'], 'mock-answer-sdp')
        self.assertEqual(
            mocked_post.call_args.args[0],
            'https://api.openai.com/v1/realtime/calls',
        )
        self.assertNotIn('params', mocked_post.call_args.kwargs)
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

    def _setup_text_only_assignment_chat(self):
        """Set up fake_db so that assignment-1 resolves text_only and chat-1 exists."""
        self.fake_db.assignments['assignment-1']['modality_override'] = {
            'mode': 'text_only',
        }
        self.fake_db.chats['student-1']['chat-1'] = {
            'id': 'chat-1',
            'title': 'Assignment chat',
            'created_at': '2026-04-20T00:00:00Z',
            'updated_at': '2026-04-20T00:00:00Z',
            'messages': [],
            'language_mix_level': 'balanced',
        }

    def _make_client_with_fake_openai(self):
        """Return (test_client, captured) where captured['messages'] is set on the first
        chat.completions.create call (the main turn; title generation call is ignored)."""
        import unittest.mock as mock

        fake_message = mock.MagicMock()
        fake_message.content = 'Tutor reply.'
        fake_choice = mock.MagicMock()
        fake_choice.message = fake_message
        fake_response = mock.MagicMock()
        fake_response.choices = [fake_choice]

        captured = {}

        def fake_create(**kwargs):
            if 'messages' in kwargs and captured.get('messages') is None:
                captured['messages'] = list(kwargs['messages'])
            return fake_response

        fake_completions = mock.MagicMock()
        fake_completions.create.side_effect = fake_create
        fake_chat_obj = mock.MagicMock()
        fake_chat_obj.completions = fake_completions
        fake_openai = mock.MagicMock()
        fake_openai.chat = fake_chat_obj

        def get_school_request_context():
            uid = (session.get('user') or {}).get('uid')
            preferred = (session.get('user') or {}).get('active_membership_id')
            return resolve_school_request_context(
                self.fake_db,
                uid,
                preferred_active_membership_id=preferred,
            )

        def build_system_prompt(context, learning_locale='ko-KR', language_mix_level='balanced'):
            return f'Generic prompt: {context} ({learning_locale}) [{language_mix_level}]'

        deps = RouteDeps(
            db=self.fake_db,
            firebase_auth=None,
            get_current_user_uid=lambda: (session.get('user') or {}).get('uid'),
            get_openai_client=lambda: fake_openai,
            get_assessment=lambda: {},
            compute_results=lambda *_args, **_kwargs: {},
            get_proficiency_description=lambda *_args, **_kwargs: {
                'level': 'Intermediate Mid',
                'description': 'Test level',
            },
            login_required=passthrough_login_required,
            get_user_proficiency_context=lambda: 'Intermediate Mid',
            build_system_prompt=build_system_prompt,
            get_school_request_context=get_school_request_context,
            set_active_school_membership=lambda _membership_id: None,
            allowed_learning_locales={'ko-KR', 'es-ES', 'fr-FR'},
            allowed_minigame_types={'listening_quiz', 'grammar_challenge'},
            supported_ui_languages={'en', 'ko'},
        )

        app = Flask(__name__)
        app.secret_key = 'test-secret'
        app.register_blueprint(create_chat_blueprint(deps))
        test_client = app.test_client()

        with test_client.session_transaction() as flask_session:
            flask_session['user'] = {
                'uid': 'student-1',
                'email': 'student@example.com',
                'name': 'Student User',
                'active_membership_id': 'mem-student',
            }

        return test_client, captured

    def test_coach_note_injected_as_system_message_before_user_turn_when_flags_on(self):
        self._setup_text_only_assignment_chat()
        test_client, captured = self._make_client_with_fake_openai()

        with patch.dict('os.environ', {
            'OPENAI_API_KEY': 'test-openai-key',
            'PEDAGOGY_ENGINE_PROMOTE_BACK': '1',
            'PEDAGOGY_ENGINE_COACH_CHIPS': '1',
        }, clear=False):
            resp = test_client.post('/api/chats/chat-1/messages', json={
                'message': 'Yo va al tienda otra vez',
                'assignmentId': 'assignment-1',
                'practiceSessionId': 'practice-1',
                'uiLanguage': 'en',
                'coachNote': "COACH NOTE: invite self-correction toward 'voy'.",
            })

        self.assertEqual(resp.status_code, 200)
        sent = captured['messages']
        self.assertEqual(sent[-1]['role'], 'user')
        self.assertEqual(sent[-2], {
            'role': 'system',
            'content': "COACH NOTE: invite self-correction toward 'voy'.",
        })

    def test_coach_note_not_injected_when_pedagogy_flags_off(self):
        self._setup_text_only_assignment_chat()
        test_client, captured = self._make_client_with_fake_openai()

        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-openai-key'}, clear=False):
            # Ensure both flags are absent (off).
            env_without_flags = {k: v for k, v in __import__('os').environ.items()
                                 if k not in ('PEDAGOGY_ENGINE_PROMOTE_BACK', 'PEDAGOGY_ENGINE_COACH_CHIPS')}
            env_without_flags['OPENAI_API_KEY'] = 'test-openai-key'
            with patch.dict('os.environ', env_without_flags, clear=True):
                resp = test_client.post('/api/chats/chat-1/messages', json={
                    'message': 'hola',
                    'assignmentId': 'assignment-1',
                    'practiceSessionId': 'practice-1',
                    'uiLanguage': 'en',
                    'coachNote': 'should be ignored',
                })

        self.assertEqual(resp.status_code, 200)
        sent = captured['messages']
        self.assertFalse(
            any(m.get('content') == 'should be ignored' for m in sent),
            'coachNote should not appear in messages when flags are off',
        )


if __name__ == '__main__':
    unittest.main()
