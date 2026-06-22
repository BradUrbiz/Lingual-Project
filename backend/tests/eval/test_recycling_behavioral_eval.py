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
    verdict = json.loads(raw)
    return {
        "elicits_uncovered": bool(verdict.get("elicits_uncovered")),
        "no_overdrill": bool(verdict.get("no_overdrill")),
        "flags_error": bool(verdict.get("flags_error")),
    }


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


if __name__ == "__main__":
    unittest.main()
