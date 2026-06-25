import os
import unittest
from unittest import mock

from backend.services.pedagogy.coach_review import (
    CoachReview,
    ReviewItem,
    ReviewWin,
    build_coach_chip_prompt,
    build_coach_review_prompt,
    parse_coach_chip,
    parse_coach_review,
    serialize_coach_chip,
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
    def __init__(self, session=None, chat=None, raise_on=None, events=None):
        self._session = dict(session) if session else None
        self._chat = chat
        self._raise_on = raise_on or set()
        self._events = events or []
        self.updates = []
        self._events_calls = 0

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

    def list_session_learning_events(self, session_id):
        self._events_calls += 1
        return list(self._events)


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


class CoachChipsEnabledTestCase(unittest.TestCase):
    def test_truthy_values_enable(self):
        from backend.services.pedagogy.integration import coach_chips_enabled
        for v in ('1', 'true', 'YES', 'on'):
            with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': v}):
                self.assertTrue(coach_chips_enabled())

    def test_absent_or_falsey_disables(self):
        from backend.services.pedagogy.integration import coach_chips_enabled
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PEDAGOGY_ENGINE_COACH_CHIPS', None)
            self.assertFalse(coach_chips_enabled())
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': '0'}):
            self.assertFalse(coach_chips_enabled())


class ChipFastGateEnabledTestCase(unittest.TestCase):
    def test_chip_fast_gate_flag(self):
        from backend.services.pedagogy.integration import chip_fast_gate_enabled
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_CHIP_FAST_GATE": "1"}):
            self.assertTrue(chip_fast_gate_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_CHIP_FAST_GATE": "0"}):
            self.assertFalse(chip_fast_gate_enabled())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(chip_fast_gate_enabled())


class BuildCoachChipPromptTestCase(unittest.TestCase):
    def _msgs(self, surface='text'):
        from backend.services.pedagogy.coach_review import build_coach_chip_prompt
        return build_coach_chip_prompt(
            [{'role': 'user', 'content': 'Yo va al tienda'},
             {'role': 'assistant', 'content': 'Quieres decir "voy"?'}],
            ['focus_grammar:ir'], {'mode': 'balanced'}, surface, 'en')

    def test_returns_system_then_user(self):
        msgs = self._msgs()
        self.assertEqual([m['role'] for m in msgs], ['system', 'user'])

    def test_system_demands_one_focus_or_silent_and_strict_json(self):
        system = self._msgs()[0]['content']
        self.assertIn('at most one', system.lower())
        self.assertIn('"chip"', system)

    def test_voice_mentions_spoken_text_does_not(self):
        self.assertIn('spoken', self._msgs('voice')[0]['content'].lower())
        self.assertNotIn('spoken', self._msgs('text')[0]['content'].lower())

    def test_user_carries_targets_and_transcript(self):
        user = self._msgs()[1]['content']
        self.assertIn('focus_grammar:ir', user)
        self.assertIn('Yo va al tienda', user)

    def test_window_ending_with_tutor_turn_has_honest_header(self):
        # The chip fires AFTER the tutor reply, so the window can end on an assistant turn.
        # The header must NOT claim "the last is the latest learner turn" (that would be false),
        # and it MUST still instruct correcting the most recent LEARNER turn.
        from backend.services.pedagogy.coach_review import build_coach_chip_prompt
        msgs = build_coach_chip_prompt(
            [{'role': 'user', 'content': 'Yo va al tienda'},
             {'role': 'assistant', 'content': 'Quieres decir "voy"?'}],
            ['focus_grammar:ir'], {'mode': 'balanced'}, 'text', 'en',
        )
        user_body = msgs[1]['content']
        self.assertNotIn('the last is the latest learner turn', user_body)
        # Must still tell the model to target the most recent LEARNER turn
        self.assertIn('LEARNER', user_body)


class ParseCoachChipTestCase(unittest.TestCase):
    def _raw(self, **over):
        chip = {'utterance': 'Yo va al tienda', 'better': 'Yo voy a la tienda',
                'why': 'ir is irregular', 'target': 'focus_grammar:ir', 'confidence_caveat': True}
        chip.update(over)
        return {'chip': chip}

    def test_non_dict_raises(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip
        with self.assertRaises(ValueError):
            parse_coach_chip(['nope'], surface='text')

    def test_valid_chip_returns_review_item(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip, ReviewItem
        item = parse_coach_chip(self._raw(), surface='text', known_targets=['focus_grammar:ir'])
        self.assertIsInstance(item, ReviewItem)
        self.assertEqual(item.utterance, 'Yo va al tienda')
        self.assertEqual(item.better, 'Yo voy a la tienda')

    def test_null_or_missing_chip_returns_none(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip
        self.assertIsNone(parse_coach_chip({'chip': None}, surface='text'))
        self.assertIsNone(parse_coach_chip({}, surface='text'))

    def test_missing_utterance_or_better_returns_none(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip
        self.assertIsNone(parse_coach_chip(self._raw(utterance=''), surface='text'))
        self.assertIsNone(parse_coach_chip(self._raw(better=''), surface='text'))

    def test_unknown_target_normalized_to_none(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip
        item = parse_coach_chip(self._raw(target='focus_grammar:zzz'), surface='text',
                                known_targets=['focus_grammar:ir'])
        self.assertIsNone(item.target)

    def test_confidence_caveat_forced_false_on_text_kept_on_voice(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip
        self.assertFalse(parse_coach_chip(self._raw(), surface='text').confidence_caveat)
        self.assertTrue(parse_coach_chip(self._raw(), surface='voice').confidence_caveat)

    def test_serialize_roundtrip(self):
        from backend.services.pedagogy.coach_review import parse_coach_chip, serialize_coach_chip
        item = parse_coach_chip(self._raw(), surface='voice', known_targets=['focus_grammar:ir'])
        self.assertEqual(serialize_coach_chip(item), {
            'utterance': 'Yo va al tienda', 'better': 'Yo voy a la tienda',
            'why': 'ir is irregular', 'target': 'focus_grammar:ir', 'confidence_caveat': True})


_CHIP_JSON = ('{"chip":{"utterance":"Yo va al tienda","better":"Yo voy a la tienda",'
              '"why":"ir is irregular","target":null,"confidence_caveat":false}}')
_CHIP_NULL_JSON = '{"chip": null}'
_CORRECTIVE_EVENTS = [{'turn_index': 4, 'event_type': 'feedback.recast'}]


def _chips_on():
    return mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': '1'})


class GenerateCoachChipTestCase(unittest.TestCase):
    def test_flag_off_returns_none_without_reads(self):
        from backend.services.coach_chip_service import generate_coach_chip
        db = _FakeDb(session=_SESSION, chat=_CHAT, raise_on={'get_practice_session'})
        with mock.patch.dict(os.environ, {'PEDAGOGY_ENGINE_COACH_CHIPS': '0'}):
            self.assertIsNone(generate_coach_chip(_FakeDeps(db, _FakeOpenAI()), _BOOTSTRAP, 'student-1', 'sess-1', 4))

    def test_no_corrective_signal_skips_llm(self):
        from backend.services.coach_chip_service import generate_coach_chip
        client = _FakeOpenAI(content=_CHIP_JSON)
        db = _FakeDb(session=_SESSION, chat=_CHAT, events=[{'turn_index': 4, 'event_type': 'student.turn'}])
        with _chips_on():
            self.assertIsNone(generate_coach_chip(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1', 4))
        self.assertEqual(client.create_calls, 0)

    def test_first_error_detected_opens_gate(self):
        # A single metric.error_detected (the FIRST slip, before it repeats) must
        # open the chip gate so the learner can see a structured chip early --
        # not only after the same error recurs (metric.repeated_error needs >=2).
        # The chip LLM still decides whether to surface anything, so this only
        # widens *when* a chip is possible, never forces one.
        from backend.services.coach_chip_service import generate_coach_chip
        client = _FakeOpenAI(content=_CHIP_JSON)
        db = _FakeDb(session=_SESSION, chat=_CHAT,
                     events=[{'turn_index': 4, 'event_type': 'metric.error_detected'}])
        with _chips_on():
            chip = generate_coach_chip(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1', 4)
        self.assertIsNotNone(chip)
        self.assertEqual(chip['turn_index'], 4)
        self.assertEqual(client.create_calls, 1)

    def test_first_error_detected_counts_as_corrective_signal(self):
        # Focused unit test on the gate helper: a learner-turn error at turn N
        # opens the gate at turn N (window covers {N, N+1}).
        from backend.services.coach_chip_service import _turn_had_corrective_signal
        events = [{'turn_index': 4, 'event_type': 'metric.error_detected'}]
        self.assertTrue(_turn_had_corrective_signal(events, 4))

    def test_happy_path_generates_and_appends(self):
        from backend.services.coach_chip_service import generate_coach_chip
        client = _FakeOpenAI(content=_CHIP_JSON)
        db = _FakeDb(session=_SESSION, chat=_CHAT, events=_CORRECTIVE_EVENTS)
        with _chips_on():
            chip = generate_coach_chip(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1', 4)
        self.assertIsNotNone(chip)
        self.assertEqual(chip['turn_index'], 4)
        self.assertEqual(chip['model'], 'gpt-5.4-mini-2026-03-17')
        self.assertEqual(chip['utterance'], 'Yo va al tienda')
        self.assertEqual(len(db.updates), 1)
        self.assertEqual(db.updates[0]['analysis_state']['coach_chips'][0]['turn_index'], 4)

    def test_model_silent_returns_none_no_write(self):
        from backend.services.coach_chip_service import generate_coach_chip
        client = _FakeOpenAI(content=_CHIP_NULL_JSON)
        db = _FakeDb(session=_SESSION, chat=_CHAT, events=_CORRECTIVE_EVENTS)
        with _chips_on():
            self.assertIsNone(generate_coach_chip(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1', 4))
        self.assertEqual(len(db.updates), 0)

    def test_dedup_existing_turn_returns_without_llm(self):
        from backend.services.coach_chip_service import generate_coach_chip
        existing = {'turn_index': 4, 'utterance': 'cached'}
        session = {**_SESSION, 'analysis_state': {'coach_chips': [existing]}}
        client = _FakeOpenAI(content=_CHIP_JSON)
        db = _FakeDb(session=session, chat=_CHAT, events=_CORRECTIVE_EVENTS)
        with _chips_on():
            chip = generate_coach_chip(_FakeDeps(db, client), _BOOTSTRAP, 'student-1', 'sess-1', 4)
        self.assertEqual(chip, existing)
        self.assertEqual(client.create_calls, 0)

    def test_no_targets_returns_none(self):
        from backend.services.coach_chip_service import generate_coach_chip
        bootstrap = {'mapping': {'targetExpressions': [], 'targetVocabulary': [], 'focusGrammar': []}}
        db = _FakeDb(session=_SESSION, chat=_CHAT, events=_CORRECTIVE_EVENTS)
        with _chips_on():
            self.assertIsNone(generate_coach_chip(_FakeDeps(db, _FakeOpenAI()), bootstrap, 'student-1', 'sess-1', 4))

    def test_fail_open_on_db_error(self):
        from backend.services.coach_chip_service import generate_coach_chip
        db = _FakeDb(session=_SESSION, chat=_CHAT, events=_CORRECTIVE_EVENTS, raise_on={'get_practice_session'})
        with _chips_on():
            self.assertIsNone(generate_coach_chip(_FakeDeps(db, _FakeOpenAI(content=_CHIP_JSON)), _BOOTSTRAP, 'student-1', 'sess-1', 4))


class PromoteBackTestCase(unittest.TestCase):
    def _chip(self, **over):
        base = {"utterance": "Yo va al tienda", "better": "Yo voy a la tienda",
                "why": "ir is irregular", "target": None, "confidence_caveat": False}
        base.update(over)
        return base

    def test_error_signature_prefers_target(self):
        from backend.services.pedagogy.promote_back import error_signature
        self.assertEqual(error_signature(self._chip(target="focus_grammar:ir")), "focus_grammar:ir")

    def test_error_signature_falls_back_to_normalized_better(self):
        from backend.services.pedagogy.promote_back import error_signature
        # accent-stripped, lowercased, whitespace-collapsed
        self.assertEqual(error_signature(self._chip(target=None, better="  Yo VOY  a la tiénda ")),
                         "yo voy a la tienda")

    def test_mode_threshold_by_mode(self):
        from backend.services.pedagogy.promote_back import mode_threshold
        self.assertEqual(mode_threshold({"mode": "balanced"}), (2, 1))           # base 2
        self.assertEqual(mode_threshold({"mode": "accuracy_first"}), (1, 1))     # max(1, 2-1), max(1, 2-2)
        self.assertEqual(mode_threshold({"mode": "fluency_first"}), (3, 2))      # 2+1, 2+0
        self.assertEqual(mode_threshold({"mode": "balanced", "elicitation_repeat_threshold": 4}), (4, 3))

    def test_promote_fires_on_threshold_then_resets(self):
        from backend.services.pedagogy.promote_back import decide_promote_back
        chip = self._chip(target=None, better="voy")  # regular, balanced threshold 2
        state = {}
        d1, state = decide_promote_back(state, chip, {"mode": "balanced"}, turn_index=0)
        self.assertFalse(d1.promote)                       # count 1 < 2
        d2, state = decide_promote_back(state, chip, {"mode": "balanced"}, turn_index=4)
        self.assertTrue(d2.promote)                        # count 2 >= 2, cooldown ok (no prior)
        self.assertEqual(d2.reason, "repeat")
        self.assertEqual(state["counts"][d2.signature], 0) # reset-on-promote
        self.assertEqual(state["promoted_count"], 1)
        self.assertEqual(state["last_promoted_turn"], 4)

    def test_hard_target_promotes_one_sooner(self):
        from backend.services.pedagogy.promote_back import decide_promote_back
        chip = self._chip(target="focus_grammar:ir")      # balanced hard-target threshold 1
        d, state = decide_promote_back({}, chip, {"mode": "balanced"}, turn_index=0)
        self.assertTrue(d.promote)
        self.assertEqual(d.reason, "hard_target")

    def test_cooldown_blocks_back_to_back(self):
        from backend.services.pedagogy.promote_back import decide_promote_back
        chip = self._chip(target="focus_grammar:ir")      # would promote at count 1
        d1, state = decide_promote_back({}, chip, {"mode": "balanced"}, turn_index=5)
        self.assertTrue(d1.promote)
        # a DIFFERENT hard-target error one turn later: cooldown (need >=2 turns) blocks it
        d2, state = decide_promote_back(state, self._chip(target="focus_grammar:ser"),
                                        {"mode": "balanced"}, turn_index=6)
        self.assertFalse(d2.promote)

    def test_per_session_cap(self):
        from backend.services.pedagogy.promote_back import decide_promote_back
        policy = {"mode": "fluency_first"}                 # cap 2
        state = {"counts": {}, "last_promoted_turn": None, "promoted_count": 2}
        d, _ = decide_promote_back(state, self._chip(target="focus_grammar:ir"), policy, turn_index=20)
        self.assertFalse(d.promote)                        # cap reached

    def test_does_not_mutate_input_state(self):
        from backend.services.pedagogy.promote_back import decide_promote_back
        original = {"counts": {"focus_grammar:ir": 1}, "last_promoted_turn": None, "promoted_count": 0}
        snapshot = {"counts": {"focus_grammar:ir": 1}, "last_promoted_turn": None, "promoted_count": 0}
        decide_promote_back(original, self._chip(target="focus_grammar:ir"), {"mode": "balanced"}, turn_index=0)
        self.assertEqual(original, snapshot)               # unchanged

    def test_build_promote_prompt_grammar_elicits(self):
        from backend.services.pedagogy.promote_back import build_promote_prompt
        out = build_promote_prompt(self._chip(target="focus_grammar:ir"), surface="text")
        self.assertIn("Yo va al tienda", out)              # quoted learner words
        self.assertIn("Yo voy a la tienda", out)           # quoted target form
        self.assertIn("self-correct", out.lower())         # elicitation, not a flat recast

    def test_build_promote_prompt_lexical_recasts_and_voice_is_terser(self):
        from backend.services.pedagogy.promote_back import build_promote_prompt
        lexical = build_promote_prompt(self._chip(target=None, better="la biblioteca"), surface="text")
        self.assertIn("model", lexical.lower())
        voice = build_promote_prompt(self._chip(target="focus_grammar:ir"), surface="voice")
        self.assertIn("one short sentence", voice.lower())


class PromoteBackEnabledTestCase(unittest.TestCase):
    def test_truthy_values_enable(self):
        from backend.services.pedagogy.integration import promote_back_enabled
        for v in ("1", "true", "yes", "on", "TRUE"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_PROMOTE_BACK": v}):
                self.assertTrue(promote_back_enabled())

    def test_absent_or_falsey_disables(self):
        from backend.services.pedagogy.integration import promote_back_enabled
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(promote_back_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_PROMOTE_BACK": "0"}):
            self.assertFalse(promote_back_enabled())


_PROMOTE_CHIP_JSON = (
    '{"chip": {"utterance":"Yo va al tienda","better":"Yo voy a la tienda",'
    '"why":"ir is irregular","target":"focus_grammar:ir","confidence_caveat":false}}'
)
# a learner-turn corrective event so the S3.2 heuristic gate passes (turn_index 0)
_CORR_EVENTS = [{"turn_index": 0, "event_type": "metric.repeated_error"}]


class GenerateCoachChipPromoteTestCase(unittest.TestCase):
    def _deps(self, session_analysis=None):
        session = dict(_SESSION)
        session["analysis_state"] = session_analysis or {}
        db = _FakeDb(session=session, chat=_CHAT, events=_CORR_EVENTS)
        return _FakeDeps(db, _FakeOpenAI(content=_PROMOTE_CHIP_JSON)), db

    def test_promote_flag_off_chip_has_no_promote_fields(self):
        from backend.services.coach_chip_service import generate_coach_chip
        deps, db = self._deps()
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_COACH_CHIPS": "1",
                                          "PEDAGOGY_ENGINE_PROMOTE_BACK": "0"}):
            chip = generate_coach_chip(deps, _BOOTSTRAP, "student-1", "sess-1", 0)
        self.assertIsNotNone(chip)
        self.assertNotIn("promote", chip)
        # no promote_back_state written (only coach_chips)
        last = db.updates[-1]["analysis_state"]
        self.assertEqual(last.get("promote_back_state", {}), {})
        self.assertEqual(last.get("promotions", []), [])

    def test_promote_on_hard_target_promotes_and_logs(self):
        from backend.services.coach_chip_service import generate_coach_chip
        deps, db = self._deps()  # focus_grammar:ir -> hard target, balanced threshold 1 -> promotes at count 1
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_COACH_CHIPS": "1",
                                          "PEDAGOGY_ENGINE_PROMOTE_BACK": "1"}):
            chip = generate_coach_chip(deps, _BOOTSTRAP, "student-1", "sess-1", 0)
        self.assertTrue(chip["promote"])
        self.assertEqual(chip["promote_reason"], "hard_target")
        self.assertIn("Yo voy a la tienda", chip["promote_prompt"])
        last = db.updates[-1]["analysis_state"]
        self.assertEqual(last["promote_back_state"]["promoted_count"], 1)
        self.assertEqual(len(last["promotions"]), 1)
        self.assertEqual(last["promotions"][0]["reason"], "hard_target")

    def test_promote_on_below_threshold_chip_without_promote(self):
        from backend.services.coach_chip_service import generate_coach_chip
        # regular error (no focus_grammar target), balanced threshold 2 -> count 1, no promote
        bootstrap = {"mapping": {"targetExpressions": ["expression:ordering"], "targetVocabulary": [],
                                 "focusGrammar": [], "feedbackPolicy": {"mode": "balanced"}}}
        session = dict(_SESSION); session["analysis_state"] = {}
        plain_chip = ('{"chip": {"utterance":"la mesa roja","better":"la mesa roja, por favor",'
                      '"why":"add politeness","target":null,"confidence_caveat":false}}')
        db = _FakeDb(session=session, chat=_CHAT, events=_CORR_EVENTS)
        deps = _FakeDeps(db, _FakeOpenAI(content=plain_chip))
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_COACH_CHIPS": "1",
                                          "PEDAGOGY_ENGINE_PROMOTE_BACK": "1"}):
            chip = generate_coach_chip(deps, bootstrap, "student-1", "sess-1", 0)
        self.assertNotIn("promote", chip)
        self.assertEqual(db.updates[-1]["analysis_state"]["promote_back_state"]["counts"], {"la mesa roja, por favor": 1})

    def test_promote_decision_failure_is_fail_open(self):
        from backend.services.coach_chip_service import generate_coach_chip
        deps, db = self._deps()
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_COACH_CHIPS": "1",
                                          "PEDAGOGY_ENGINE_PROMOTE_BACK": "1"}), \
             mock.patch("backend.services.pedagogy.promote_back.decide_promote_back",
                        side_effect=RuntimeError("boom")):
            chip = generate_coach_chip(deps, _BOOTSTRAP, "student-1", "sess-1", 0)
        self.assertIsNotNone(chip)          # chip still returned
        self.assertNotIn("promote", chip)   # without promotion


class AskModuleTestCase(unittest.TestCase):
    def test_build_prompt_has_anti_answer_dump_and_scope(self):
        from backend.services.pedagogy.ask import build_ask_prompt
        msgs = build_ask_prompt("how do I say hello?", [{"role": "user", "content": "hola"}],
                                ["expression:greetings"], {"mode": "balanced"}, {}, "text", "en")
        self.assertEqual(msgs[0]["role"], "system")
        sys = msgs[0]["content"].lower()
        self.assertIn("never", sys)
        self.assertIn("refusal", sys)
        self.assertIn("scope", sys)
        self.assertIn("expression:greetings", msgs[1]["content"])
        self.assertIn("how do I say hello?", msgs[1]["content"])

    def test_build_prompt_voice_is_terser_and_threads_ui_language(self):
        from backend.services.pedagogy.ask import build_ask_prompt
        voice = build_ask_prompt("q", [], [], {}, {}, "voice", "ko")[0]["content"]
        text = build_ask_prompt("q", [], [], {}, {}, "text", "ko")[0]["content"]
        self.assertIn("at most 1 sentence", voice)
        self.assertIn("at most 2 sentence", text)
        self.assertIn("ko", voice)

    def test_parse_coerces_kind_and_caps_length(self):
        from backend.services.pedagogy.ask import parse_ask_answer, ASK_KINDS, MAX_ANSWER_CHARS
        a = parse_ask_answer({"answer": "Try 'hola'.", "kind": "HINT"})
        self.assertEqual(a.kind, "hint")
        unknown = parse_ask_answer({"answer": "x", "kind": "bogus"})
        self.assertEqual(unknown.kind, "clarification")  # DEFAULT_KIND
        long = parse_ask_answer({"answer": "z" * (MAX_ANSWER_CHARS + 50), "kind": "hint"})
        self.assertLessEqual(len(long.answer), MAX_ANSWER_CHARS)
        self.assertTrue(ASK_KINDS)

    def test_parse_empty_answer_is_none_and_non_dict_raises(self):
        from backend.services.pedagogy.ask import parse_ask_answer
        self.assertIsNone(parse_ask_answer({"answer": "   ", "kind": "hint"}))
        with self.assertRaises(ValueError):
            parse_ask_answer("not a dict")

    def test_serialize_roundtrip(self):
        from backend.services.pedagogy.ask import AskAnswer, serialize_ask_answer
        self.assertEqual(serialize_ask_answer(AskAnswer(answer="hi", kind="hint")),
                         {"answer": "hi", "kind": "hint"})


class AskModeEnabledTestCase(unittest.TestCase):
    def test_truthy_enables(self):
        from backend.services.pedagogy.integration import ask_mode_enabled
        for v in ("1", "true", "yes", "on", "TRUE"):
            with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": v}):
                self.assertTrue(ask_mode_enabled())

    def test_absent_or_falsey_disables(self):
        from backend.services.pedagogy.integration import ask_mode_enabled
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(ask_mode_enabled())
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "0"}):
            self.assertFalse(ask_mode_enabled())


_ASK_JSON = '{"answer": "Try \\"hola\\" — your turn.", "kind": "hint"}'


class AnswerAskTestCase(unittest.TestCase):
    def _deps(self, content=_ASK_JSON, raise_on=None):
        session = dict(_SESSION); session["analysis_state"] = {}
        db = _FakeDb(session=session, chat=_CHAT, raise_on=raise_on)
        return _FakeDeps(db, _FakeOpenAI(content=content)), db

    def test_flag_off_returns_none_without_reads(self):
        from backend.services.ask_service import answer_ask
        deps, db = self._deps(raise_on={'get_practice_session'})  # would explode if read
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "0"}):
            self.assertIsNone(answer_ask(deps, _BOOTSTRAP, "student-1", "sess-1", "how do I say hi?"))

    def test_happy_path_answers_and_logs_to_ask_log_only(self):
        from backend.services.ask_service import answer_ask
        deps, db = self._deps()
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "1"}):
            out = answer_ask(deps, _BOOTSTRAP, "student-1", "sess-1", "how do I say hi?", turn_index=3)
        self.assertEqual(out["kind"], "hint")
        self.assertIn("hola", out["answer"])
        state = db.updates[-1]["analysis_state"]
        self.assertEqual(len(state["ask_log"]), 1)
        self.assertEqual(state["ask_log"][0]["question"], "how do I say hi?")
        self.assertEqual(state["ask_log"][0]["turn_index"], 3)
        # help != evidence: the events path is never touched by answer_ask
        self.assertEqual(db._events_calls, 0)

    def test_empty_question_returns_none(self):
        from backend.services.ask_service import answer_ask
        deps, db = self._deps()
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "1"}):
            self.assertIsNone(answer_ask(deps, _BOOTSTRAP, "student-1", "sess-1", "   "))

    def test_no_targets_returns_none(self):
        from backend.services.ask_service import answer_ask
        deps, db = self._deps()
        bootstrap = {"mapping": {"targetExpressions": [], "targetVocabulary": [], "focusGrammar": [],
                                 "feedbackPolicy": {"mode": "balanced"}}}
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "1"}):
            self.assertIsNone(answer_ask(deps, bootstrap, "student-1", "sess-1", "q"))

    def test_openai_failure_is_fail_open(self):
        from backend.services.ask_service import answer_ask
        deps, db = self._deps()
        deps._client = _FakeOpenAI(raise_on_create=True)
        with mock.patch.dict(os.environ, {"PEDAGOGY_ENGINE_ASK_MODE": "1"}):
            self.assertIsNone(answer_ask(deps, _BOOTSTRAP, "student-1", "sess-1", "q"))


if __name__ == '__main__':
    unittest.main()
