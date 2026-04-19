import unittest

from backend.services.assignment_resolver import (
    build_assignment_system_prompt,
    build_correction_ladder_prompt,
    build_feedback_mode_prompt,
    build_output_pressure_prompt,
    build_scaffold_ladder_prompt,
    build_task_template_prompt,
    normalize_output_policy,
    serialize_output_policy,
)


class PedagogyPoliciesTestCase(unittest.TestCase):
    def test_normalize_output_policy_derives_defaults_from_task_type_and_feedback_mode(self):
        normalized = normalize_output_policy(
            None,
            task_type='opinion_gap',
            evidence={'minTurns': 5},
            feedback_mode='balanced',
        )

        self.assertEqual(normalized['min_student_turn_words'], 10)
        self.assertEqual(normalized['follow_up_pressure'], 'high')
        self.assertTrue(normalized['allow_clarification_requests'])

    def test_normalize_output_policy_allows_explicit_overrides(self):
        normalized = normalize_output_policy(
            {
                'minStudentTurnWords': 12,
                'followUpPressure': 'light',
                'allowClarificationRequests': False,
            },
            task_type='decision_making',
            feedback_mode='accuracy_first',
        )

        self.assertEqual(normalized['min_student_turn_words'], 12)
        self.assertEqual(normalized['follow_up_pressure'], 'light')
        self.assertFalse(normalized['allow_clarification_requests'])


class PedagogyPromptSectionsTestCase(unittest.TestCase):
    def test_feedback_and_correction_sections_reflect_teacher_policy(self):
        feedback_policy = {
            'mode': 'accuracy_first',
            'targetOnlyStrict': True,
            'recastDefault': True,
            'elicitationRepeatThreshold': 2,
            'endReviewEnabled': True,
        }

        feedback_prompt = build_feedback_mode_prompt(feedback_policy)
        correction_prompt = build_correction_ladder_prompt(feedback_policy)

        self.assertIn('FEEDBACK MODE DIRECTIVE', feedback_prompt)
        self.assertIn('accurate production of the mapped targets', feedback_prompt)
        self.assertIn('CORRECTION LADDER', correction_prompt)
        self.assertIn('repeats 2 time(s)', correction_prompt)
        self.assertIn('1-3 recurring issues', correction_prompt)

    def test_scaffold_task_template_and_output_pressure_sections_render_expected_guidance(self):
        scaffold_prompt = build_scaffold_ladder_prompt(
            {
                'silenceToleranceMs': 3500,
                'hintLadder': ['wait', 'context_hint', 'choice_prompt', 'model_and_retry'],
                'maxModelingSteps': 1,
            }
        )
        task_prompt = build_task_template_prompt(
            task_type='decision_making',
            assignment={
                'description': 'Choose the best plan for the weekend.',
                'successCriteria': ['Compare two options', 'Agree on one final plan'],
            },
            curriculum={
                'objectives': [
                    {'id': 'OBJ1', 'canDo': {'en': 'I can compare plans and justify a choice.'}},
                ],
                'rubrics': [
                    {
                        'id': 'rub.speaking.v1',
                        'dimensions': [
                            {
                                'id': 'task_completion',
                                'title': {'en': 'Task completion'},
                                'description': {'en': 'Completes the assigned task clearly.'},
                            }
                        ],
                    }
                ],
                'situation': {
                    'seed': {
                        'setting': 'Weekend planning',
                        'roles': ['student', 'friend'],
                        'register': 'informal',
                    }
                }
            },
            pedagogy={
                'taskModel': 'ap.conversation',
                'contextTags': ['weekend', 'planning'],
                'communicativeFunctions': ['ask_follow_up', 'summarize'],
                'discourseMoves': ['turn_taking', 'self_correction'],
                'templateRefs': ['tpl.weekend_roleplay.v1'],
                'activityTemplates': [
                    {
                        'id': 'tpl.weekend_roleplay.v1',
                        'title': {'en': 'Weekend Roleplay'},
                        'mode': 'interpersonal_speaking',
                        'assistantRole': 'Act as the learner’s friend and hold back details until the learner asks.',
                        'interactionPattern': {
                            'openingMoves': ['Open with a shared weekend planning problem.'],
                            'sustainMoves': ['Reveal options gradually and ask the learner to compare them.'],
                            'closingMoves': ['End only after the learner agrees on one plan.'],
                            'completionRule': 'The learner must compare options and commit to one final plan.',
                        },
                        'promptCues': ['Use natural friend-to-friend follow-up questions.'],
                    }
                ],
                'evidence': {'minTurns': 4, 'timeLimitSec': 90},
            },
            mapping={
                'allowedContextTags': ['weekend'],
                'rubricFocus': ['task_completion'],
            },
        )
        output_prompt = build_output_pressure_prompt(
            serialize_output_policy(
                None,
                task_type='decision_making',
                evidence={'minTurns': 4},
                feedback_mode='balanced',
            ),
            assignment={'successCriteria': ['Compare two options']},
            pedagogy={'evidence': {'minTurns': 4}},
        )

        self.assertIn('SCAFFOLD LADDER', scaffold_prompt)
        self.assertIn('Step 3 (choice_prompt)', scaffold_prompt)
        self.assertIn('TASK TEMPLATE DIRECTIVE', task_prompt)
        self.assertIn('decision-making task where the learner must compare options', task_prompt)
        self.assertIn('Resolved scenario anchor: setting=Weekend planning; roles=student, friend; register=informal.', task_prompt)
        self.assertIn('Teacher-approved context bounds: weekend.', task_prompt)
        self.assertIn('Resolved structured activity template: Weekend Roleplay.', task_prompt)
        self.assertIn('Template assistant role: Act as the learner’s friend and hold back details until the learner asks.', task_prompt)
        self.assertIn('ask a targeted follow-up question', task_prompt)
        self.assertIn('Bias the exchange toward rubric evidence for Task completion.', task_prompt)
        self.assertIn('Create visible evidence for these mapped curriculum outcomes', task_prompt)
        self.assertIn('Do not close the task until the learner has materially demonstrated', task_prompt)
        self.assertNotIn('finish within about', task_prompt)
        self.assertIn('OUTPUT PRESSURE', output_prompt)
        self.assertIn('roughly 9+ words', output_prompt)
        self.assertIn('target turn volume of about 4 turns', output_prompt)


class AssignmentPromptAssemblyTestCase(unittest.TestCase):
    def test_build_assignment_system_prompt_assembles_modular_pedagogy_sections(self):
        bootstrap = {
            'systemPromptPreview': 'Base assignment prompt',
            'assignment': {
                'title': 'Restaurant Ordering Practice',
                'maxAttempts': 3,
                'successCriteria': ['Use one polite request', 'Ask one follow-up question'],
                'description': 'Order a meal and ask about one menu item.',
            },
            'mapping': {
                'targetExpressions': ['Could I have', 'I would like'],
                'targetVocabulary': ['appetizer', 'receipt'],
                'focusGrammar': ['polite requests'],
                'allowedContextTags': ['restaurant'],
                'rubricFocus': ['task_completion'],
                'teacherNotes': 'Keep the learner in the restaurant ordering lane.',
                'feedbackPolicy': {
                    'mode': 'accuracy_first',
                    'targetOnlyStrict': True,
                    'recastDefault': True,
                    'elicitationRepeatThreshold': 2,
                    'endReviewEnabled': True,
                },
                'scaffoldPolicy': {
                    'silenceToleranceMs': 3200,
                    'hintLadder': ['wait', 'context_hint', 'choice_prompt'],
                    'maxModelingSteps': 1,
                },
            },
            'class': {
                'name': 'French 2 - Period 3',
            },
            'curriculum': {
                'objectives': [
                    {'id': 'OBJ1', 'canDo': {'en': 'I can order food politely in a restaurant.'}},
                ],
                'rubrics': [
                    {
                        'id': 'rub.speaking.v1',
                        'title': {'en': 'Speaking Rubric'},
                        'dimensions': [
                            {
                                'id': 'task_completion',
                                'title': {'en': 'Task completion'},
                                'description': {'en': 'Completes the assigned task clearly.'},
                            }
                        ],
                    },
                ],
                'situation': {
                    'seed': {
                        'setting': 'Restaurant',
                        'roles': ['learner', 'server'],
                        'register': 'mixed',
                    }
                },
                'pedagogy': {
                    'taskModel': 'ap.conversation',
                    'contextTags': ['restaurant', 'ordering'],
                    'communicativeFunctions': ['ask_follow_up'],
                    'discourseMoves': ['turn_taking'],
                    'foundationDomains': ['communication_strategies'],
                    'evidence': {
                        'minTurns': 4,
                        'maxTurns': 8,
                        'timeLimitSec': 90,
                    },
                    'templateRefs': ['tpl.restaurant_roleplay.v1'],
                    'activityTemplates': [
                        {
                            'id': 'tpl.restaurant_roleplay.v1',
                            'title': {'en': 'Restaurant Roleplay'},
                            'mode': 'interpersonal_speaking',
                            'assistantRole': 'Stay in character as the server and reveal menu details only when asked.',
                            'interactionPattern': {
                                'openingMoves': ['Greet the learner and wait for the first ordering move.'],
                                'sustainMoves': ['Answer questions briefly, then push the learner to confirm or refine the order.'],
                                'closingMoves': ['Close after the learner confirms the final order and any follow-up request.'],
                                'completionRule': 'The learner must place an order and clarify at least one detail before closing.',
                            },
                            'promptCues': ['Keep the server voice natural and concise.'],
                        }
                    ],
                },
            },
            'launch': {
                'voiceAllowed': True,
                'textAllowed': True,
                'modality': {'mode': 'hybrid'},
            },
        }

        prompt = build_assignment_system_prompt(bootstrap)

        self.assertIn('Base assignment prompt', prompt)
        self.assertIn('ASSIGNMENT ENVELOPE', prompt)
        self.assertNotIn('Task type:', prompt)
        self.assertIn('FEEDBACK MODE DIRECTIVE', prompt)
        self.assertIn('CORRECTION LADDER', prompt)
        self.assertIn('SCAFFOLD LADDER', prompt)
        self.assertIn('TASK TEMPLATE DIRECTIVE', prompt)
        self.assertIn('OUTPUT PRESSURE', prompt)
        self.assertIn('TARGET VOCABULARY TO ELICIT', prompt)
        self.assertIn('appetizer', prompt)
        self.assertIn('Output min student turn words: 8', prompt)
        self.assertIn('repeats 2 time(s)', prompt)
        self.assertIn('Resolved scenario anchor: setting=Restaurant; roles=learner, server; register=mixed.', prompt)
        self.assertIn('Teacher-approved context bounds: restaurant.', prompt)
        self.assertIn('Bias the exchange toward rubric evidence for Task completion.', prompt)
        self.assertIn('Resolved curriculum template references: tpl.restaurant_roleplay.v1.', prompt)
        self.assertIn('Resolved structured activity template: Restaurant Roleplay.', prompt)
        self.assertNotIn('Evidence time limit sec:', prompt)
        self.assertNotIn('finish within about', prompt)


if __name__ == '__main__':
    unittest.main()
