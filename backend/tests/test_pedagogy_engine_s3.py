import os
import unittest
from unittest import mock

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

    def test_scalar_sections_do_not_raise(self):
        # A dict payload whose sections are scalars/null must yield an empty review,
        # not a TypeError — only a non-dict ``raw`` raises.
        review = parse_coach_review(
            {'wins': 1, 'work_on': 'nope', 'target_coverage': None},
            feedback_mode='balanced', surface='text',
        )
        self.assertTrue(review.is_empty())
        self.assertEqual(review.target_coverage, ())

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

    def test_voice_mentions_confidence_caveat_text_does_not(self):
        # The voice variant differs from text by adding the ASR/confidence-caveat
        # instruction (text never mentions confidence). This is the behaviour that
        # matters — not raw length (the voice prompt is in fact slightly longer).
        sys_voice = self._msgs(surface='voice')[0]['content'].lower()
        sys_text = self._msgs(surface='text')[0]['content'].lower()
        self.assertNotEqual(sys_voice, sys_text)
        # The voice-only rule names the SPOKEN/ASR-confidence caveat; text has no
        # such rule. (Both mention the confidence_caveat JSON *field*, so the
        # discriminator is the rule sentence, not the bare word "confidence".)
        self.assertIn('spoken session', sys_voice)
        self.assertNotIn('spoken session', sys_text)

    def test_json_instruction_present(self):
        self.assertIn('json', self._msgs()[0]['content'].lower())


_BOOTSTRAP = {
    'mapping': {
        'targetExpressions': ['expression:ordering'],
        'targetVocabulary': [],
        'focusGrammar': ['focus_grammar:ir'],
        'feedbackPolicy': {'mode': 'balanced'},
    }
}

_SESSION = {
    'id': 'sess-1',
    'student_uid': 'student-1',
    'assignment_id': 'asg-1',
    'modality': 'voice',
    'ui_language': 'en',
    'transcript_ref': {'chat_id': 'chat-1'},
    'analysis_state': {},
}

_CHAT = {
    'id': 'chat-1',
    'messages': [
        {'role': 'assistant', 'content': '¿Qué hiciste?'},
        {'role': 'user', 'content': 'Yo va al tienda'},
    ],
}

_MODEL_JSON = (
    '{"wins":[{"text":"Good effort."}],'
    '"work_on":[{"utterance":"Yo va al tienda","better":"Yo voy a la tienda",'
    '"why":"ir is irregular","target":"focus_grammar:ir","confidence_caveat":false}],'
    '"target_coverage":[{"surface":"expression:ordering","status":"attempted"}]}'
)


class _FakeOpenAI:
    def __init__(self, content=_MODEL_JSON, raise_on_create=False):
        self._content = content
        self._raise = raise_on_create
        self.create_calls = 0
        outer = self

        class _Completions:
            def create(self, *a, **kw):
                outer.create_calls += 1
                if outer._raise:
                    raise RuntimeError("boom")
                msg = type('M', (), {'content': outer._content})()
                return type('R', (), {'choices': [type('C', (), {'message': msg})()]})()

        self.chat = type('Chat', (), {'completions': _Completions()})()


class _FakeDb:
    def __init__(self, session=None, chat=None, raise_on=None):
        self._session = dict(session) if session else None
        self._chat = chat
        self._raise_on = raise_on or set()
        self.updates = []

    def get_practice_session(self, session_id):
        if 'get_practice_session' in self._raise_on:
            raise RuntimeError("db down")
        return self._session

    def get_chat_session(self, uid, chat_id):
        return self._chat

    def update_practice_session(self, session_id, updates, *, sql_engine=None):
        self.updates.append(updates)
        if isinstance(self._session, dict):
            self._session.update(updates)

    def update_practice_session_analysis_state(self, session_id, analysis_state, *, sql_engine=None):
        self.updates.append({'analysis_state': analysis_state})
        if isinstance(self._session, dict):
            self._session['analysis_state'] = analysis_state


class _FakeDeps:
    def __init__(self, db, client):
        self.db = db
        self.sql_engine = None
        self._client = client

    def get_openai_client(self):
        return self._client


def _on():
    return mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_REVIEW': '1'})


class GenerateCoachReviewTestCase(unittest.TestCase):
    def test_flag_off_returns_none_without_reads(self):
        from backend.services.coach_review_service import generate_coach_review
        db = _FakeDb(session=_SESSION, chat=_CHAT, raise_on={'get_practice_session'})
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_REVIEW': '0'}):
            # raise_on would explode if the session were read — proving zero reads
            self.assertIsNone(generate_coach_review(_FakeDeps(db, _FakeOpenAI()), _BOOTSTRAP, 'student-1', 'sess-1'))

    def test_happy_path_generates_caches_and_snapshots(self):
        from backend.services.coach_review_service import generate_coach_review
        client = _FakeOpenAI()
        db = _FakeDb(session=_SESSION, chat=_CHAT)
        with _on():
            review = generate_coach_review(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1')
        self.assertIsNotNone(review)
        self.assertEqual(review['model'], 'gpt-5.4-mini-2026-03-17')
        self.assertIn('generated_at', review)
        self.assertEqual(review['work_on'][0]['utterance'], 'Yo va al tienda')
        self.assertEqual(len(db.updates), 1)
        self.assertEqual(db.updates[0]['analysis_state']['coach_review']['model'], 'gpt-5.4-mini-2026-03-17')

    def test_cached_review_returns_without_second_llm_call(self):
        from backend.services.coach_review_service import generate_coach_review
        cached = {'model': 'gpt-5.4-mini-2026-03-17', 'wins': [{'text': 'x'}], 'work_on': []}
        session = {**_SESSION, 'analysis_state': {'coach_review': cached}}
        client = _FakeOpenAI()
        with _on():
            review = generate_coach_review(_FakeDeps(_FakeDb(session=session, chat=_CHAT), client),
                                           _BOOTSTRAP, 'student-1', 'sess-1')
        self.assertEqual(review, cached)
        self.assertEqual(client.create_calls, 0)

    def test_not_assignment_linked_returns_none(self):
        from backend.services.coach_review_service import generate_coach_review
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=_SESSION, chat=_CHAT), _FakeOpenAI()),
                                      {'mapping': None}, 'student-1', 'sess-1')
            )

    def test_no_targets_returns_none(self):
        from backend.services.coach_review_service import generate_coach_review
        bootstrap = {'mapping': {'targetExpressions': [], 'targetVocabulary': [], 'focusGrammar': []}}
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=_SESSION, chat=_CHAT), _FakeOpenAI()),
                                      bootstrap, 'student-1', 'sess-1')
            )

    def test_missing_chat_id_returns_none(self):
        from backend.services.coach_review_service import generate_coach_review
        session = {**_SESSION, 'transcript_ref': {}}
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=session, chat=_CHAT), _FakeOpenAI()),
                                      _BOOTSTRAP, 'student-1', 'sess-1')
            )

    def test_thin_transcript_returns_none(self):
        from backend.services.coach_review_service import generate_coach_review
        chat = {'id': 'chat-1', 'messages': [{'role': 'assistant', 'content': 'only tutor talked'}]}
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=_SESSION, chat=chat), _FakeOpenAI()),
                                      _BOOTSTRAP, 'student-1', 'sess-1')
            )

    def test_openai_failure_is_fail_open(self):
        from backend.services.coach_review_service import generate_coach_review
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=_SESSION, chat=_CHAT), _FakeOpenAI(raise_on_create=True)),
                                      _BOOTSTRAP, 'student-1', 'sess-1')
            )

    def test_malformed_json_is_fail_open(self):
        from backend.services.coach_review_service import generate_coach_review
        with _on():
            self.assertIsNone(
                generate_coach_review(_FakeDeps(_FakeDb(session=_SESSION, chat=_CHAT), _FakeOpenAI(content='not json')),
                                      _BOOTSTRAP, 'student-1', 'sess-1')
            )

    def test_empty_review_returns_none_and_does_not_snapshot(self):
        from backend.services.coach_review_service import generate_coach_review
        db = _FakeDb(session=_SESSION, chat=_CHAT)
        with _on():
            review = generate_coach_review(
                _FakeDeps(db, _FakeOpenAI(content='{"wins":[],"work_on":[]}')),
                _BOOTSTRAP, 'student-1', 'sess-1',
            )
        self.assertIsNone(review)
        self.assertEqual(db.updates, [])


class CoachReviewEnabledTestCase(unittest.TestCase):
    def test_flag_reads_env(self):
        from backend.services.pedagogy.integration import coach_review_enabled
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_REVIEW': '1'}):
            self.assertTrue(coach_review_enabled())
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_REVIEW': '0'}):
            self.assertFalse(coach_review_enabled())


if __name__ == '__main__':
    unittest.main()
