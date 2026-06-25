"""Direct unit tests for generate_coach_chip gate logic.

FakeDeps stubs all deps.db methods the function calls so we can exercise the
heuristic gate (corrective event / shortfall / floor) without any real DB or
OpenAI connection.
"""
import json
import os
import unittest
from unittest import mock


# ---------------------------------------------------------------------------
# Helpers / fake infrastructure
# ---------------------------------------------------------------------------

_CANNED_CHIP_JSON = json.dumps({
    "chip": {
        "utterance": "I want a coffee",
        "better": "Quisiera un café",
        "why": "Use Spanish",
        "target": "Quisiera un café, por favor.",
        "confidence_caveat": False,
    }
})


class _FakeCompletionChoice:
    def __init__(self, content):
        self.message = type("M", (), {"content": content})()


class _FakeCompletions:
    def __init__(self, response_content, *, call_recorder):
        self._resp = response_content
        self._recorder = call_recorder

    def create(self, **kwargs):
        self._recorder.append(kwargs)
        return type("R", (), {"choices": [_FakeCompletionChoice(self._resp)]})()


class _FakeOpenAIClient:
    def __init__(self, response_content=_CANNED_CHIP_JSON):
        self.calls = []
        self.chat = type("C", (), {
            "completions": _FakeCompletions(response_content, call_recorder=self.calls)
        })()


class _FakeDb:
    """Stubs every deps.db method that generate_coach_chip touches."""

    def __init__(self, *, session, events, chat_messages):
        self._session = session
        self._events = events
        self._chat_messages = chat_messages
        self.state_writes = []

    def get_practice_session(self, session_id):
        return dict(self._session)

    def list_session_learning_events(self, session_id):
        return list(self._events)

    def get_chat_session(self, uid, chat_id):
        return {"messages": list(self._chat_messages)}

    def update_practice_session_analysis_state(self, session_id, state, sql_engine=None):
        self.state_writes.append(dict(state))


class _FakeDeps:
    def __init__(self, *, session, events=None, chat_messages=None, openai_client=None):
        self.db = _FakeDb(
            session=session,
            events=events or [],
            chat_messages=chat_messages or [],
        )
        self._openai_client = openai_client
        self.sql_engine = None

    def get_openai_client(self):
        return self._openai_client


def _make_session(
    *,
    locale="es-ES",
    analysis_state=None,
    analysis_state_extra=None,
):
    state = {
        "recent_turns": [],
        "last_student_turn": {"content": "", "turn_index": None},
        "coverage": None,
        "coach_review": None,
        "coach_chips": [],
        "coach_chip_last_eval_turn": None,
        "promote_back_state": {},
        "promotions": [],
        "ask_log": [],
        "affect_state": None,
        "director_state": {},
        "resteers": [],
    }
    if analysis_state is not None:
        state.update(analysis_state)
    if analysis_state_extra:
        state.update(analysis_state_extra)
    return {
        "student_uid": "stu-1",
        "assignment_id": "asg-1",
        "ui_language": "en",
        "modality": "text",
        "transcript_ref": {"chat_id": "chat-1"},
        "curriculum_snapshot": {
            "package": {
                "learningLocale": locale,
            }
        },
        "analysis_state": state,
    }


def _make_bootstrap(targets=None):
    return {
        "mapping": {
            "targetExpressions": targets if targets is not None else ["Quisiera un café, por favor."],
            "targetVocabulary": [],
            "focusGrammar": [],
        }
    }


# ---------------------------------------------------------------------------
# A learner turn that is an English-fallback (triggers shortfall for es locale)
# ---------------------------------------------------------------------------
_ENGLISH_FALLBACK_TURN = {
    "role": "user",
    "content": "I want a coffee please and what is the price here",
}

# A learner turn in real Spanish (not a shortfall)
_SPANISH_REAL_TURN = {
    "role": "user",
    "content": "Quisiera un café, por favor. ¿Cuánto cuesta?",
}

_TUTOR_TURN = {
    "role": "assistant",
    "content": "¡Muy bien! ¿Algo más?",
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class FlagOffNoCorrective(unittest.TestCase):
    """Flag OFF: generate_coach_chip must behave byte-identically (no LLM call, returns None)."""

    def test_flag_off_no_corrective_signal_no_chip(self):
        """With flag OFF and no corrective event, even an English-fallback turn must
        not open the gate — returns None without calling the LLM."""
        client = _FakeOpenAIClient()
        deps = _FakeDeps(
            session=_make_session(locale="es-ES"),
            events=[],  # no corrective events
            chat_messages=[_TUTOR_TURN, _ENGLISH_FALLBACK_TURN],
            openai_client=client,
        )
        from backend.services.coach_chip_service import generate_coach_chip
        with mock.patch.dict(os.environ, {
            "PEDAGOGY_ENGINE_COACH_CHIPS": "1",
            "PEDAGOGY_ENGINE_CHIP_FAST_GATE": "0",
        }):
            result = generate_coach_chip(deps, _make_bootstrap(), "stu-1", "sess-1", 0)

        self.assertIsNone(result)
        self.assertEqual(len(client.calls), 0, "LLM must not be called when gate is off")


class FlagOnShortfall(unittest.TestCase):
    """Flag ON + English-fallback learner turn opens the gate via shortfall signal."""

    def test_flag_on_shortfall_opens_gate_turn1(self):
        """An English-fallback turn on an es-ES session should trigger an LLM eval
        on turn 0 even with no corrective learning_event."""
        client = _FakeOpenAIClient()
        deps = _FakeDeps(
            session=_make_session(locale="es-ES"),
            events=[],
            chat_messages=[_TUTOR_TURN, _ENGLISH_FALLBACK_TURN],
            openai_client=client,
        )
        from backend.services.coach_chip_service import generate_coach_chip
        with mock.patch.dict(os.environ, {
            "PEDAGOGY_ENGINE_COACH_CHIPS": "1",
            "PEDAGOGY_ENGINE_CHIP_FAST_GATE": "1",
            "PEDAGOGY_ENGINE_PROMOTE_BACK": "0",
        }):
            result = generate_coach_chip(deps, _make_bootstrap(), "stu-1", "sess-1", 0)

        self.assertEqual(len(client.calls), 1, "LLM must be called when shortfall gate opens")
        # Result is a dict (chip was returned since canned JSON is valid)
        self.assertIsInstance(result, dict)
        self.assertEqual(result["turn_index"], 0)


class FlagOnFloor(unittest.TestCase):
    """Flag ON + floor: after FLOOR_TURN_GAP turns without eval + real target-language
    turn, gate opens; coach_chip_last_eval_turn advances even when parse returns None."""

    def test_flag_on_floor_opens_after_gap_and_advances_last_eval_turn(self):
        """With last_eval_turn=0 and current turn_index=2, gap=2 >= FLOOR_TURN_GAP=2,
        and a real Spanish turn (produced_target_language=True) → gate opens.
        Even if parse_coach_chip returns None (canned response with no chip key),
        coach_chip_last_eval_turn must be advanced to turn_index=2."""
        # Return JSON with no 'chip' key → parse_coach_chip returns None
        client = _FakeOpenAIClient(response_content=json.dumps({"chip": None}))
        deps = _FakeDeps(
            session=_make_session(
                locale="es-ES",
                analysis_state={"coach_chip_last_eval_turn": 0},
            ),
            events=[],
            chat_messages=[
                _TUTOR_TURN,
                _SPANISH_REAL_TURN,
                _TUTOR_TURN,
                _SPANISH_REAL_TURN,  # latest learner turn = real Spanish
            ],
            openai_client=client,
        )
        from backend.services.coach_chip_service import generate_coach_chip
        with mock.patch.dict(os.environ, {
            "PEDAGOGY_ENGINE_COACH_CHIPS": "1",
            "PEDAGOGY_ENGINE_CHIP_FAST_GATE": "1",
            "PEDAGOGY_ENGINE_PROMOTE_BACK": "0",
        }):
            result = generate_coach_chip(deps, _make_bootstrap(), "stu-1", "sess-1", 2)

        # LLM was called (gate opened)
        self.assertEqual(len(client.calls), 1, "LLM must be called when floor gate opens")
        # parse_coach_chip returned None → generate_coach_chip returns None
        self.assertIsNone(result)
        # But last_eval_turn must have been advanced
        self.assertTrue(len(deps.db.state_writes) > 0, "state must be written even on None parse")
        last_state = deps.db.state_writes[-1]
        self.assertEqual(last_state.get("coach_chip_last_eval_turn"), 2,
                         "coach_chip_last_eval_turn must advance to turn_index=2 on a no-chip eval")

    def test_flag_on_floor_suppressed_within_gap(self):
        """With last_eval_turn=1 and current turn_index=2, gap=1 < FLOOR_TURN_GAP=2 →
        floor does NOT open; and no shortfall (real Spanish) + no corrective event →
        no LLM call, returns None."""
        client = _FakeOpenAIClient()
        deps = _FakeDeps(
            session=_make_session(
                locale="es-ES",
                analysis_state={"coach_chip_last_eval_turn": 1},
            ),
            events=[],
            chat_messages=[_TUTOR_TURN, _SPANISH_REAL_TURN],
            openai_client=client,
        )
        from backend.services.coach_chip_service import generate_coach_chip
        with mock.patch.dict(os.environ, {
            "PEDAGOGY_ENGINE_COACH_CHIPS": "1",
            "PEDAGOGY_ENGINE_CHIP_FAST_GATE": "1",
            "PEDAGOGY_ENGINE_PROMOTE_BACK": "0",
        }):
            result = generate_coach_chip(deps, _make_bootstrap(), "stu-1", "sess-1", 2)

        self.assertIsNone(result)
        self.assertEqual(len(client.calls), 0, "LLM must not be called when floor gap < FLOOR_TURN_GAP")


if __name__ == "__main__":
    unittest.main()
