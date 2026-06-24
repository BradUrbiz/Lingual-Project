"""S5-gate behavioral eval: does the full STATIC-composed engine prompt (S1–S4)
hold instruction-adherence across a multi-turn conversation, or drift below
target as turns stack? Reports earlyRate/lateRate/drift/plateaus per scenario.

The verdict decides whether S5 (between-turn re-steer) is warranted. A plateau is
a FINDING (acted on by the controller), not a test failure — the opt-in test
asserts only that the run completed with a well-formed verdict.

OPT-IN: StaticCompositionDriftEval is skipped unless RUN_PEDAGOGY_EVAL=1 (real LLM
cost: len(scenarios) * N_TURNS * 3 calls). The deterministic compose check below is
CI-gated and costs nothing. OpenAI + engine-render imports are LAZY inside the
opt-in test so this module stays inside the import-boundary suites.

See docs/superpowers/specs/2026-06-24-pedagogy-s5-gate-eval-design.md.
"""

from __future__ import annotations

import json
import os
import unittest

from backend.tests.eval.adherence_drift import (
    N_TURNS,
    aggregate_drift,
    coerce_adherence_verdict,
    score_turn,
)

_EVAL_MODEL = "gpt-5.4-mini-2026-03-17"

# Seeded scenarios: proficiency + assignment targets + a drift-prone (NOT adversarial)
# learner persona. Keep small to bound cost.
_SCENARIOS = [
    {
        "id": "cafe-info-gap-accuracy",
        "proficiency": "novice-high Spanish learner",
        "persona": (
            "You are a real novice-high Spanish learner doing a cafe role-play. Answer in "
            "Spanish but keep turns short, occasionally slip into English when stuck, and make "
            "natural beginner errors (gender, ser/estar, verb endings). Do NOT be adversarial; "
            "just behave like an authentic learner. One short turn at a time."
        ),
        "targets": {
            "targetExpressions": ["la cuenta", "para llevar"],
            "targetVocabulary": ["mesa"],
            "focusGrammar": ["ser vs estar"],
            "feedbackPolicy": {"mode": "accuracy_first"},
        },
        "learning_locale": "es-ES",
        "opener": "Hola, ¿en qué puedo ayudarte hoy?",
    },
]


def compose_static_engine_prompt(scenario: dict) -> str:
    """Compose the FULL static S1–S4 engine prompt for a scenario, in-process.

    Pure (no LLM, no DB): builds a bootstrap + an S2 coverage state (some targets
    uncovered/recycled) + an S4.1 strained affect state, then
    compile_prompt_plan(...) -> render_assignment_prompt(...). Engine-render imports
    are local so the module-level import surface stays clean.
    """
    from backend.services.pedagogy.affect import AffectState
    from backend.services.pedagogy.coverage import compute_coverage_state
    from backend.services.pedagogy.plan import compile_prompt_plan
    from backend.services.pedagogy.render.assignment_prompt import render_assignment_prompt

    targets = scenario["targets"]
    bootstrap = {
        "systemPromptPreview": f"You are a {scenario['learning_locale']} speaking tutor for a cafe scenario.",
        "assignment": {"title": "Cafe order", "taskType": "information_gap"},
        "mapping": targets,
        "curriculum": {},
        "class": {"learningLocale": scenario["learning_locale"]},
    }
    # An S2 coverage state that exercises recycling. Signature is positional:
    # compute_coverage_state(target_surfaces, hit_counts, error_counts, prior_session_count).
    # prior_session_count MUST be > 0 (0 returns an empty no-op state); all-zero hit_counts
    # tiers every target "not_attempted" → uncovered → the recycling section renders.
    all_targets = [*targets.get("targetExpressions", []), *targets.get("targetVocabulary", [])]
    coverage = compute_coverage_state(
        all_targets,
        {t: 0 for t in all_targets},  # hit_counts: all uncovered
        {},                            # error_counts
        2,                             # prior_session_count (>0 → not the first-session no-op)
    ) if all_targets else None
    affect = AffectState(readiness="strained", signals={}, reason="short turns + slips")
    plan = compile_prompt_plan(bootstrap, coverage_state=coverage, affect_state=affect)
    return render_assignment_prompt(plan, "text", correction_light=False)


class ComposeStaticPromptTestCase(unittest.TestCase):
    """CI-gated, cost-free: the composed prompt is non-empty and carries the engine sections."""

    def test_compose_includes_engine_sections(self):
        prompt = compose_static_engine_prompt(_SCENARIOS[0])
        self.assertTrue(prompt.strip())
        self.assertIn("TUTOR STANCE", prompt)
        # affect override line present (strained)
        self.assertIn("low readiness", prompt.lower())


def _chat(client, messages, *, json_mode=False):
    """One reasoning-model completion → stripped text. No temperature (reasoning model)."""
    kwargs = {"model": _EVAL_MODEL, "messages": messages, "reasoning_effort": "high"}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    return (resp.choices[0].message.content or "").strip()


def _student_turn(client, scenario, history):
    """Simulated learner's next turn (target-language, short, authentic errors)."""
    msgs = [
        {"role": "system", "content": scenario["persona"]},
        {"role": "user", "content":
            "Continue the conversation as the learner. Here is the dialogue so far "
            "(tutor=assistant, you=learner):\n" + json.dumps(history) +
            "\nReply with ONLY your next short learner turn, no quotes."},
    ]
    return _chat(client, msgs)


def _tutor_turn(client, system_prompt, history):
    """Tutor's next turn, driven by the composed static engine prompt."""
    msgs = [{"role": "system", "content": system_prompt}]
    for turn in history:
        msgs.append({"role": turn["role"], "content": turn["content"]})
    return _chat(client, msgs)


def _judge_turn(client, scenario, history, tutor_turn):
    """Per-turn adherence judge → {dimension: bool} for the in-scope dimensions."""
    rubric = (
        "You are a strict pedagogy evaluator. Grade the tutor's LAST turn for instruction "
        "adherence and return ONLY a JSON object. Include a boolean for each dimension that "
        "is APPLICABLE to this turn (omit a dimension that does not apply):\n"
        '  "target_language": tutor stayed in the target language (no unprompted English).\n'
        '  "elicits_targets": tutor worked toward the assignment targets, not generic chat.\n'
        '  "correction_posture": IF the learner made an error, the tutor cued self-correction '
        "(accuracy_first mode); omit if no error this turn.\n"
        '  "one_focus": tutor corrected at most one thing (no pile-up).\n'
        '  "anti_sycophancy": brief confirmative acknowledgment, not effusive praise.\n'
        '  "no_answer_dump": tutor did not hand over the full target answer outright.\n'
        f"Assignment targets: {json.dumps(scenario['targets'])}. Target language: {scenario['learning_locale']}.\n"
        "Strict JSON, no prose, no markdown."
    )
    payload = {"dialogue": history, "tutor_last_turn": tutor_turn}
    raw = _chat(
        client,
        [
            {"role": "system", "content": "Output only JSON."},
            {"role": "user", "content": rubric + "\n\n" + json.dumps(payload)},
        ],
        json_mode=True,
    )
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return coerce_adherence_verdict(raw)


@unittest.skipUnless(
    os.environ.get("RUN_PEDAGOGY_EVAL") == "1",
    "opt-in behavioral eval (LLM cost)",
)
class StaticCompositionDriftEval(unittest.TestCase):
    def test_static_composition_adherence_drift(self):
        from openai import OpenAI  # lazy; real model + cost

        client = OpenAI()
        for scenario in _SCENARIOS:
            with self.subTest(scenario=scenario["id"]):
                system_prompt = compose_static_engine_prompt(scenario)
                history = [{"role": "assistant", "content": scenario["opener"]}]
                per_turn_scores = []
                for _ in range(N_TURNS):
                    student = _student_turn(client, scenario, history)
                    history.append({"role": "user", "content": student})
                    tutor = _tutor_turn(client, system_prompt, history)
                    history.append({"role": "assistant", "content": tutor})
                    verdict = _judge_turn(client, scenario, history, tutor)
                    per_turn_scores.append(score_turn(verdict))

                result = aggregate_drift(per_turn_scores)
                # Report (visible with `-v` / on failure). A plateau is a FINDING.
                print(
                    f"\n[S5-GATE] scenario={scenario['id']} "
                    f"earlyRate={result['earlyRate']:.2f} lateRate={result['lateRate']:.2f} "
                    f"drift={result['drift']:.2f} plateaus={result['plateaus']}"
                )
                # Assert only that the run produced a well-formed verdict — NOT that
                # plateaus is False (the verdict is the deliverable, not a pass/fail).
                self.assertEqual(len(per_turn_scores), N_TURNS)
                self.assertIn("plateaus", result)
                self.assertIsInstance(result["plateaus"], bool)


if __name__ == "__main__":
    unittest.main()
