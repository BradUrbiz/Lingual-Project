import unittest

from backend.services.pedagogy.coach_review import (
    CoachReview,
    ReviewItem,
    ReviewWin,
    build_coach_review_prompt,
    parse_coach_review,
    serialize_coach_review,
)


class ParseCoachReviewTestCase(unittest.TestCase):
    def _raw(self, **over):
        base = {
            'wins': [{'text': 'Good past tense.'}, {'text': 'Nice fillers.'}, {'text': 'extra'}],
            'work_on': [
                {'utterance': 'Yo va', 'better': 'Yo voy', 'why': 'irregular', 'target': 'focus_grammar:ir'},
                {'utterance': 'el tienda', 'better': 'la tienda', 'why': 'feminine', 'target': 'unknown:x'},
                {'utterance': 'mas', 'better': 'más', 'why': 'accent', 'confidence_caveat': True},
                {'utterance': 'a', 'better': 'b', 'why': 'c'},
                {'utterance': 'd', 'better': 'e', 'why': 'f'},
            ],
            'target_coverage': [
                {'surface': 'expression:ordering', 'status': 'used'},
                {'surface': 'x', 'status': 'bogus'},
            ],
        }
        base.update(over)
        return base

    def test_raises_on_non_dict(self):
        with self.assertRaises(ValueError):
            parse_coach_review(['not', 'a', 'dict'], feedback_mode='balanced', surface='text')

    def test_caps_wins_at_two(self):
        review = parse_coach_review(self._raw(), feedback_mode='balanced', surface='text')
        self.assertEqual(len(review.wins), 2)

    def test_work_on_cap_by_mode(self):
        self.assertEqual(len(parse_coach_review(self._raw(), feedback_mode='fluency_first', surface='text').work_on), 2)
        self.assertEqual(len(parse_coach_review(self._raw(), feedback_mode='balanced', surface='text').work_on), 3)
        self.assertEqual(len(parse_coach_review(self._raw(), feedback_mode='accuracy_first', surface='text').work_on), 4)
        # unknown mode falls back to the default cap (3)
        self.assertEqual(len(parse_coach_review(self._raw(), feedback_mode='???', surface='text').work_on), 3)

    def test_drops_item_without_utterance_or_better(self):
        raw = {'work_on': [{'utterance': '', 'better': 'x', 'why': 'y'}, {'utterance': 'p', 'why': 'q'}]}
        self.assertEqual(parse_coach_review(raw, feedback_mode='balanced', surface='text').work_on, ())

    def test_unknown_target_normalized_to_none(self):
        review = parse_coach_review(self._raw(), feedback_mode='accuracy_first', surface='text',
                                    known_targets=['focus_grammar:ir'])
        by_utt = {i.utterance: i for i in review.work_on}
        self.assertEqual(by_utt['Yo va'].target, 'focus_grammar:ir')
        self.assertIsNone(by_utt['el tienda'].target)

    def test_confidence_caveat_forced_false_on_text(self):
        review = parse_coach_review(self._raw(), feedback_mode='accuracy_first', surface='text')
        self.assertTrue(all(i.confidence_caveat is False for i in review.work_on))

    def test_confidence_caveat_kept_on_voice(self):
        review = parse_coach_review(self._raw(), feedback_mode='accuracy_first', surface='voice')
        self.assertTrue(any(i.confidence_caveat for i in review.work_on))

    def test_target_coverage_filters_invalid_status(self):
        review = parse_coach_review(self._raw(), feedback_mode='balanced', surface='text')
        self.assertEqual([c.surface for c in review.target_coverage], ['expression:ordering'])

    def test_is_empty_and_serialize_roundtrip(self):
        self.assertTrue(parse_coach_review({}, feedback_mode='balanced', surface='text').is_empty())
        review = CoachReview(
            wins=(ReviewWin('w'),),
            work_on=(ReviewItem('u', 'b', 'y', target=None, confidence_caveat=False),),
            surface='text',
        )
        data = serialize_coach_review(review)
        self.assertEqual(data['surface'], 'text')
        self.assertEqual(data['wins'], [{'text': 'w'}])
        self.assertEqual(data['work_on'][0]['utterance'], 'u')
        self.assertIn('target', data['work_on'][0])


class BuildCoachReviewPromptTestCase(unittest.TestCase):
    def _msgs(self, surface='text', ui_language='en'):
        transcript = [
            {'role': 'assistant', 'content': '¿Qué hiciste?'},
            {'role': 'user', 'content': 'Yo va al tienda'},
        ]
        return build_coach_review_prompt(
            transcript, ['focus_grammar:ir', 'expression:ordering'],
            {'mode': 'accuracy_first'}, surface, ui_language,
        )

    def test_returns_system_then_user(self):
        msgs = self._msgs()
        self.assertEqual([m['role'] for m in msgs], ['system', 'user'])

    def test_targets_and_mode_in_prompt(self):
        body = self._msgs()[1]['content']
        self.assertIn('focus_grammar:ir', body)
        self.assertIn('accuracy_first', body)

    def test_transcript_uses_learner_tutor_labels(self):
        body = self._msgs()[1]['content']
        self.assertIn('Learner:', body)
        self.assertIn('Tutor:', body)
        self.assertIn('Yo va al tienda', body)

    def test_ui_language_threaded(self):
        self.assertIn('en', self._msgs(ui_language='en')[0]['content'])

    def test_voice_is_terser_than_text(self):
        sys_voice = self._msgs(surface='voice')[0]['content']
        sys_text = self._msgs(surface='text')[0]['content']
        self.assertNotEqual(sys_voice, sys_text)
        self.assertIn('confidence', sys_voice.lower())  # voice mentions ASR-confidence caveat

    def test_json_instruction_present(self):
        self.assertIn('json', self._msgs()[0]['content'].lower())


if __name__ == '__main__':
    unittest.main()
