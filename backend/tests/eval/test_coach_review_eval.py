"""S3.1 behavioral eval: does the LIVE coach review AVOID false corrections?

Byte/unit tests prove the coach-review prompt is *assembled* correctly and that
``parse_coach_review`` caps/coerces the model JSON. This eval proves the model
*behaves*: it catches a seeded learner error WITHOUT "correcting" an utterance
that was already correct (the false-correction probe). It runs the real coach
pass against a seeded transcript, parses the review, and asks an LLM judge for a
three-boolean verdict (false_correction / caught_seeded_error / wins_specific).

OPT-IN ONLY. The whole TestCase is skipped unless ``RUN_PEDAGOGY_EVAL=1`` because
it burns real LLM calls. Default ``make test-backend`` runs leave it skipped.

Import boundary: OpenAI and the ``coach_review`` module are imported lazily
*inside* the behavioral test method, so importing this module never pulls OpenAI
into the import-boundary suites. The deterministic ``_coerce_judge_verdict``
parser and its CI-gated unit test below need no third-party imports at all.
"""

from __future__ import annotations

import json
import os
import unittest

# Reasoning model for both the coach pass and the judge. Reasoning models reject
# a custom temperature, so callers below pass reasoning_effort instead and never
# set temperature. Override via PEDAGOGY_EVAL_MODEL if needed.
_EVAL_MODEL = os.environ.get("PEDAGOGY_EVAL_MODEL", "gpt-5.4-mini-2026-03-17")


# Seeded transcripts: each has exactly one known learner error to catch, and at
# least one correct utterance the coach must NOT "correct" (false-correction probe).
_SCENARIOS = [
    {
        "id": "present-irregular-es",
        "targets": ["focus_grammar:present-irregular", "expression:ir-al-tienda"],
        "feedback_mode": "accuracy_first",
        "transcript": [
            {"role": "assistant", "content": "¿Adónde fuiste ayer?"},
            # Seeded error: "Yo va al tienda" should be "Yo voy a la tienda"
            # (wrong person on the irregular verb + wrong article gender).
            {"role": "user", "content": "Yo va al tienda."},
            {"role": "assistant", "content": "¿Y qué compraste?"},
            # Correct utterance — must NOT be "corrected" (the false-correction probe).
            {"role": "user", "content": "Compré pan."},
        ],
        "seeded_error": (
            'The learner said "Yo va al tienda"; the correct form is '
            '"Yo voy a la tienda" (voy, not va; la tienda, not al tienda).'
        ),
        "correct_utterance": "Compré pan.",
    },
]


_VERDICT_KEYS = ("false_correction", "caught_seeded_error", "wins_specific")
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
    ``{false_correction, caught_seeded_error, wins_specific}`` with genuine
    Python bools. A missing key, a null, or any non-boolean / unrecognized-string
    value raises a descriptive ``ValueError`` — never a silent ``True`` (the
    false-pass bug where ``bool("false")`` is ``True``).
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


def _chat_json(client, messages):
    """One reasoning-model chat completion returning the stripped JSON text.

    Reasoning models reject a custom temperature, so none is passed; the call
    uses high reasoning effort and forces a JSON object response.
    """
    response = client.chat.completions.create(
        model=_EVAL_MODEL,
        messages=messages,
        reasoning_effort="high",
        response_format={"type": "json_object"},
    )
    return (response.choices[0].message.content or "").strip()


def _judge(client, scenario, review):
    """LLM judge: returns {false_correction, caught_seeded_error, wins_specific}.

    The review is summarized into its wins and work_on items so the judge can
    grade whether the coach (a) corrected an already-correct utterance,
    (b) addressed the seeded error, and (c) gave a specific win.
    """
    rubric = (
        "You are grading a language coach's post-task review and return ONLY a "
        "JSON object with three boolean fields:\n"
        '  "false_correction": true if ANY work_on item corrects an utterance '
        f"that was already correct (the learner said {scenario['correct_utterance']!r}, "
        "which is correct and must NOT be flagged).\n"
        '  "caught_seeded_error": true if the seeded error is addressed by a '
        f"work_on item. {scenario['seeded_error']}\n"
        '  "wins_specific": true if at least one win is concrete and specific '
        "(not generic effusive praise).\n"
        "Return strictly JSON, no prose, no markdown fences."
    )
    payload = {
        "targets": scenario["targets"],
        "review": {
            "wins": [w.text for w in review.wins],
            "work_on": [
                {"utterance": i.utterance, "better": i.better, "why": i.why}
                for i in review.work_on
            ],
        },
    }
    raw = _chat_json(
        client,
        [
            {"role": "system", "content": "You are a strict pedagogy evaluator. Output only JSON."},
            {"role": "user", "content": rubric + "\n\nREVIEW:\n" + json.dumps(payload)},
        ],
    )
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return _coerce_judge_verdict(raw)


@unittest.skipUnless(
    os.environ.get("RUN_PEDAGOGY_EVAL") == "1",
    "opt-in behavioral eval (LLM cost)",
)
class CoachReviewBehavioralEval(unittest.TestCase):
    def test_false_correction_rate_and_catch_rate(self):
        from openai import OpenAI  # lazy; real model + cost
        from backend.services.pedagogy.coach_review import (
            build_coach_review_prompt,
            parse_coach_review,
        )

        client = OpenAI()
        false_corrections = 0
        caught = 0
        for sc in _SCENARIOS:
            with self.subTest(scenario=sc["id"]):
                msgs = build_coach_review_prompt(
                    sc["transcript"],
                    sc["targets"],
                    {"mode": sc["feedback_mode"]},
                    "text",
                    "en",
                )
                raw = _chat_json(client, msgs)
                review = parse_coach_review(
                    json.loads(raw),
                    feedback_mode=sc["feedback_mode"],
                    surface="text",
                    known_targets=sc["targets"],
                )
                verdict = _judge(client, sc, review)
                false_corrections += int(verdict["false_correction"])
                caught += int(verdict["caught_seeded_error"])

        # The coach must not invent corrections, and must catch the seeded errors.
        self.assertEqual(false_corrections, 0, "coach produced a false correction")
        self.assertEqual(caught, len(_SCENARIOS), "coach missed a seeded error")


class CoerceJudgeVerdictTestCase(unittest.TestCase):
    """Pure, deterministic tests for the verdict parser — NO LLM calls.

    Not gated behind RUN_PEDAGOGY_EVAL: it runs in the default suite and makes
    no OpenAI/coach_review import, so it stays inside the import boundary and
    costs nothing. Guards the false-pass bug where ``bool("false")`` was ``True``.
    """

    def _all_true(self):
        return {"false_correction": True, "caught_seeded_error": True, "wins_specific": True}

    def test_real_bools_pass_through(self):
        raw = {"false_correction": True, "caught_seeded_error": False, "wins_specific": True}
        self.assertEqual(
            _coerce_judge_verdict(raw),
            {"false_correction": True, "caught_seeded_error": False, "wins_specific": True},
        )

    def test_json_string_with_real_booleans(self):
        raw = '{"false_correction": true, "caught_seeded_error": false, "wins_specific": true}'
        self.assertEqual(
            _coerce_judge_verdict(raw),
            {"false_correction": True, "caught_seeded_error": False, "wins_specific": True},
        )

    def test_string_false_maps_to_false(self):
        # The bug case: bool("false") is True. The parser must return False.
        verdict = _coerce_judge_verdict(
            {"false_correction": "false", "caught_seeded_error": "true", "wins_specific": "false"}
        )
        self.assertFalse(verdict["false_correction"])
        self.assertTrue(verdict["caught_seeded_error"])
        self.assertFalse(verdict["wins_specific"])

    def test_yes_no_and_case_insensitivity(self):
        verdict = _coerce_judge_verdict(
            {"false_correction": "Yes", "caught_seeded_error": "NO", "wins_specific": " True "}
        )
        self.assertEqual(
            verdict,
            {"false_correction": True, "caught_seeded_error": False, "wins_specific": True},
        )

    def test_numeric_strings_map(self):
        verdict = _coerce_judge_verdict(
            {"false_correction": "1", "caught_seeded_error": "0", "wins_specific": "1"}
        )
        self.assertEqual(
            verdict,
            {"false_correction": True, "caught_seeded_error": False, "wins_specific": True},
        )

    def test_ambiguous_string_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "caught_seeded_error": "maybe"})

    def test_missing_key_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({"false_correction": True, "caught_seeded_error": True})

    def test_none_value_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "wins_specific": None})

    def test_numeric_value_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict({**self._all_true(), "false_correction": 1})

    def test_non_object_json_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict("[true, false, true]")

    def test_unsupported_type_raises(self):
        with self.assertRaises(ValueError):
            _coerce_judge_verdict(42)


if __name__ == "__main__":
    unittest.main()
