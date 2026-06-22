"""S2 behavioral eval: does the LIVE tutor ACT on the recycling section?

Byte/unit tests prove the recycling directive is *rendered* into the prompt.
This eval proves the model *acts* on it: eliciting an uncovered target,
not over-drilling a solid one, and flagging a repeated error. It does that with
a scripted simulated student (a cheap second completion that produces
target-avoiding learner turns) and an LLM judge that returns three booleans.

OPT-IN ONLY. The whole TestCase is skipped unless ``RUN_PEDAGOGY_EVAL=1`` because
it burns real LLM calls. Default ``make test-backend`` runs leave it skipped.

Import boundary: OpenAI / ``main`` are imported lazily *inside* the test method,
so importing this module never pulls OpenAI into the import-boundary suites.
"""

from __future__ import annotations

import json
import os
import unittest

from backend.services.pedagogy.plan import compile_prompt_plan
from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt
from backend.tests.eval._recycling_scenarios import SCENARIOS

# Cheap model for both the simulated student and the judge — match the codebase's
# default cheap-completion model (backend/routes/games.py uses gpt-4o-mini).
_EVAL_MODEL = os.environ.get("PEDAGOGY_EVAL_MODEL", "gpt-4o-mini")


def _bootstrap(mode: str) -> dict:
    return {
        "systemPromptPreview": "You are a Spanish café tutor.",
        "assignment": {"taskType": "information_gap", "title": "Café"},
        "class": {"name": "Spanish I"},
        "mapping": {
            "targetExpressions": ["quisiera", "la cuenta", "gracias"],
            "feedbackPolicy": {"mode": mode},
        },
        "curriculum": {},
    }


def _chat(client, messages, *, temperature=0.4):
    """One cheap chat completion, returning the stripped message text."""
    response = client.chat.completions.create(
        model=_EVAL_MODEL,
        messages=messages,
        temperature=temperature,
    )
    return (response.choices[0].message.content or "").strip()


def _run_simulated_student(client, system_prompt, turns=4):
    """Drive a short tutor<->student exchange and return the full transcript.

    The student is a scripted learner who answers naturally in mixed
    Spanish/English but deliberately AVOIDS the target expressions (so the tutor
    has to elicit them) and keeps making a ser/estar mistake (so the tutor has a
    repeated error to flag). The tutor side runs the real assignment prompt.
    """
    student_system = (
        "You are role-playing a beginner Spanish student in a café practice chat. "
        "Reply in 1-2 short sentences, mostly English with a little broken Spanish. "
        "Do NOT use the words 'quisiera', 'la cuenta', or 'gracias'. "
        "When you use Spanish, misuse ser/estar (e.g. say 'soy cansado' for 'I am tired'). "
        "Stay in character; never break the fourth wall."
    )

    tutor_messages = [{"role": "system", "content": system_prompt}]
    student_messages = [{"role": "system", "content": student_system}]
    transcript = []

    # Tutor opens.
    tutor_turn = _chat(client, tutor_messages)
    transcript.append(("tutor", tutor_turn))
    tutor_messages.append({"role": "assistant", "content": tutor_turn})
    student_messages.append({"role": "user", "content": tutor_turn})

    for _ in range(turns):
        student_turn = _chat(client, student_messages, temperature=0.7)
        transcript.append(("student", student_turn))
        student_messages.append({"role": "assistant", "content": student_turn})
        tutor_messages.append({"role": "user", "content": student_turn})

        tutor_turn = _chat(client, tutor_messages)
        transcript.append(("tutor", tutor_turn))
        tutor_messages.append({"role": "assistant", "content": tutor_turn})
        student_messages.append({"role": "user", "content": tutor_turn})

    return transcript


def _format_transcript(transcript):
    return "\n".join(f"{role.upper()}: {text}" for role, text in transcript)


_VERDICT_KEYS = ("elicits_uncovered", "no_overdrill", "flags_error")
_TRUE_STRINGS = frozenset({"true", "yes", "1"})
_FALSE_STRINGS = frozenset({"false", "no", "0"})


def _coerce_one(key, value):
    """Coerce a single judge field to a real bool, or raise ValueError.

    Genuine JSON booleans pass through. Common string forms ("true"/"yes"/"1"
    and "false"/"no"/"0") are normalized case-insensitively. Anything else —
    None, "maybe", numbers, objects — is NOT unambiguously truthy/falsey and
    must surface as an error rather than silently defaulting to a pass.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _TRUE_STRINGS:
            return True
        if token in _FALSE_STRINGS:
            return False
        raise ValueError(
            f"judge field {key!r} is an unrecognized string verdict: {value!r}"
        )
    raise ValueError(
        f"judge field {key!r} is not a recognized boolean verdict: {value!r} "
        f"(type {type(value).__name__})"
    )


def _coerce_judge_verdict(raw):
    """Deterministically parse the judge's response into three real bools.

    Accepts the raw response as a JSON string OR an already-parsed dict. Returns
    ``{elicits_uncovered, no_overdrill, flags_error}`` with genuine Python bools.
    A missing key, a null, or any non-boolean / unrecognized-string value raises
    a descriptive ``ValueError`` — never a silent ``True`` (the false-pass bug).
    """
    if isinstance(raw, str):
        parsed = json.loads(raw)
    elif isinstance(raw, dict):
        parsed = raw
    else:
        raise ValueError(
            f"judge response must be a JSON string or dict, got {type(raw).__name__}"
        )
    if not isinstance(parsed, dict):
        raise ValueError(f"judge response did not parse to an object: {parsed!r}")

    verdict = {}
    for key in _VERDICT_KEYS:
        if key not in parsed:
            raise ValueError(f"judge response missing required field {key!r}")
        verdict[key] = _coerce_one(key, parsed[key])
    return verdict


def _judge(client, scenario, transcript):
    """LLM judge: returns {elicits_uncovered, no_overdrill, flags_error} booleans.

    Only the claims the scenario actually asserts need to be reliable; the judge
    is told what each claim means so it can answer all three regardless.
    """
    claims = scenario["claims"]
    rubric = (
        "Evaluate the TUTOR's behaviour in this Spanish-tutor transcript and "
        "return ONLY a JSON object with three boolean fields:\n"
        f'  "elicits_uncovered": did the tutor prompt the student toward the '
        f'expression "{claims["elicits_uncovered"]}"? '
        "(true/false; false if that expression is not the focus)\n"
        f'  "no_overdrill": did the tutor AVOID repeatedly drilling the '
        f'already-mastered expression "{claims["no_overdrill"]}"? '
        "(true if it was not over-emphasized)\n"
        f'  "flags_error": did the tutor notice/correct the repeated error '
        f'"{claims["flags_error"]}"? (true/false; false if no such error focus)\n'
        "Return strictly JSON, no prose, no markdown fences."
    )
    raw = _chat(
        client,
        [
            {"role": "system", "content": "You are a strict pedagogy evaluator. Output only JSON."},
            {"role": "user", "content": rubric + "\n\nTRANSCRIPT:\n" + _format_transcript(transcript)},
        ],
        temperature=0.0,
    )
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return _coerce_judge_verdict(raw)


@unittest.skipUnless(
    os.environ.get("RUN_PEDAGOGY_EVAL") == "1",
    "behavioral eval is opt-in (LLM cost)",
)
class RecyclingBehavioralEvalTestCase(unittest.TestCase):
    def test_tutor_acts_on_coverage(self):
        from main import get_openai_client  # lazy; real model + cost

        client = get_openai_client()
        if client is None:
            self.skipTest("no OpenAI client available")

        for sc in SCENARIOS:
            with self.subTest(scenario=sc["name"]):
                prompt = render_assignment_prompt(
                    compile_prompt_plan(_bootstrap(sc["feedback_mode"]), coverage_state=sc["coverage"]),
                    "text",
                )
                transcript = _run_simulated_student(client, prompt, turns=4)
                verdict = _judge(client, sc, transcript)
                rendered = _format_transcript(transcript)

                if sc["claims"]["elicits_uncovered"]:
                    self.assertTrue(
                        verdict["elicits_uncovered"],
                        f"{sc['name']}: tutor did not elicit uncovered target\n{rendered}",
                    )
                if sc["claims"]["no_overdrill"]:
                    self.assertTrue(
                        verdict["no_overdrill"],
                        f"{sc['name']}: tutor over-drilled a mastered target\n{rendered}",
                    )
                if sc["claims"]["flags_error"]:
                    self.assertTrue(
                        verdict["flags_error"],
                        f"{sc['name']}: tutor did not flag the repeated error\n{rendered}",
                    )


class CoerceJudgeVerdictTestCase(unittest.TestCase):
    """Pure, deterministic tests for the verdict parser — NO LLM calls.

    Not gated behind RUN_PEDAGOGY_EVAL: it runs in the default suite and makes
    no OpenAI/main import, so it stays inside the import boundary and costs
    nothing. Guards the false-pass bug where ``bool("false")`` was ``True``.
    """

    def _all_true(self):
        return {"elicits_uncovered": True, "no_overdrill": True, "flags_error": True}

    def test_real_bools_pass_through(self):
        raw = {"elicits_uncovered": True, "no_overdrill": False, "flags_error": True}
        self.assertEqual(
            _coerce_judge_verdict(raw),
            {"elicits_uncovered": True, "no_overdrill": False, "flags_error": True},
        )

    def test_json_string_with_real_booleans(self):
        raw = '{"elicits_uncovered": true, "no_overdrill": false, "flags_error": true}'
        self.assertEqual(
            _coerce_judge_verdict(raw),
            {"elicits_uncovered": True, "no_overdrill": False, "flags_error": True},
        )

    def test_string_false_maps_to_false(self):
        # The bug case: bool("false") is True. The parser must return False.
        verdict = _coerce_judge_verdict(
            {"elicits_uncovered": "false", "no_overdrill": "true", "flags_error": "false"}
        )
        self.assertFalse(verdict["elicits_uncovered"])
        self.assertTrue(verdict["no_overdrill"])
        self.assertFalse(verdict["flags_error"])

    def test_yes_no_and_case_insensitivity(self):
        verdict = _coerce_judge_verdict(
            {"elicits_uncovered": "Yes", "no_overdrill": "NO", "flags_error": " True "}
        )
        self.assertEqual(
            verdict,
            {"elicits_uncovered": True, "no_overdrill": False, "flags_error": True},
        )

    def test_numeric_strings_map(self):
        verdict = _coerce_judge_verdict(
            {"elicits_uncovered": "1", "no_overdrill": "0", "flags_error": "1"}
        )
        self.assertEqual(
            verdict,
            {"elicits_uncovered": True, "no_overdrill": False, "flags_error": True},
        )

    def test_ambiguous_string_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "no_overdrill": "maybe"})

    def test_missing_key_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({"elicits_uncovered": True, "no_overdrill": True})

    def test_none_value_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "flags_error": None})

    def test_numeric_value_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "elicits_uncovered": 1})

    def test_non_object_json_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict("[true, false, true]")

    def test_unsupported_type_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict(42)


if __name__ == "__main__":
    unittest.main()
