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
        }
    ],
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
        self.curriculum_mappings = {
            'mapping-1': {
                'id': 'mapping-1',
                'org_id': 'org-1',
                'class_id': 'class-1',
                'package_id': 'sample-ap-french',
                'module_id': 'M1',
                'objective_ids': ['OBJ1'],
                'situation_ids': ['S1'],
                'target_expressions': ['Could I have', 'I would like'],
                'focus_grammar': ['polite requests'],
                'allowed_context_tags': ['restaurant'],
                'feedback_policy': {
                    'mode': 'accuracy_first',
                    'target_only_strict': True,
                    'recast_default': True,
                    'elicitation_repeat_threshold': 2,
                    'end_review_enabled': True,
                },
                'scaffold_policy': {
                    'silence_tolerance_ms': 3500,
                    'hint_ladder': ['wait', 'context_hint', 'choice_prompt'],
                    'max_modeling_steps': 1,
                },
                'modality_policy': {
                    'mode': 'hybrid',
                    'voice_minutes_cap': 10,
                    'text_fallback_enabled': True,
                },
                'rubric_focus': ['task_completion'],
                'teacher_notes': 'Keep the student in the restaurant ordering lane.',
            }
        }
        self.assignments = {
            'assignment-1': {
                'id': 'assignment-1',
                'org_id': 'org-1',
                'class_id': 'class-1',
                'mapping_id': 'mapping-1',
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

    def get_curriculum_mapping(self, mapping_id):
        return self.curriculum_mappings.get(mapping_id)

    def get_student_class_enrollment(self, class_id, student_uid):
        return self.enrollments.get(f'{class_id}_{student_uid}')


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
        self.assertEqual(body_context['reactionIntent'], 'tap_body_affirm')
        self.assertIn('module M1', body_context['systemMessage'])
        self.assertIn('situation S2', body_context['systemMessage'])

    def test_realtime_session_request_skips_avatar_tools_by_default(self):
        with patch.dict('os.environ', {}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertEqual(payload['instructions'], 'Base instructions')
        self.assertNotIn('tool_choice', payload)
        self.assertNotIn('tools', payload)

    def test_realtime_session_request_includes_avatar_tools_when_enabled(self):
        with patch.dict('os.environ', {'ENABLE_REALTIME_AVATAR_DIRECTIVES': 'true'}, clear=False):
            payload = build_realtime_session_request('Base instructions')

        self.assertEqual(payload['tool_choice'], 'auto')
        self.assertEqual(payload['tools'][0]['name'], 'emit_avatar_directive')
        self.assertIn('Avatar acting contract', payload['instructions'])


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
            build_system_prompt=lambda context: f'Generic prompt: {context}',
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

        self.assertIn('Prompt for M1::S1', instructions)
        self.assertIn('Assignment title: Restaurant Ordering Practice', instructions)
        self.assertIn('Task type: information_gap', instructions)
        self.assertIn('Could I have', instructions)
        self.assertIn('polite requests', instructions)
        self.assertIn('Feedback mode: accuracy_first', instructions)
        self.assertIn('Teacher notes: Keep the student in the restaurant ordering lane.', instructions)


if __name__ == '__main__':
    unittest.main()
