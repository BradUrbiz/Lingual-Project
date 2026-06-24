# Pedagogy Engine S5-Gate Eval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the §14-mandated instrument to decide S5 (Director): a multi-turn simulated-student ↔ static-engine-tutor harness + per-turn adherence judge measuring early-vs-late instruction-adherence drift, with a deterministic verdict that decides S5 build-vs-defer.

**Architecture:** A pure scorer/aggregator/verdict module (`backend/tests/eval/adherence_drift.py`, CI-tested, zero cost) + an opt-in LLM harness (`backend/tests/eval/test_static_composition_drift_eval.py`, `RUN_PEDAGOGY_EVAL=1`) that composes the full S1–S4 static engine prompt in-process, runs an N-turn simulated conversation, judges each tutor turn, and aggregates via the pure module. Mirrors the established `test_coach_chip_eval.py` split (deterministic parser CI-gated, LLM behavioral opt-in).

**Tech Stack:** Python 3 (stdlib + unittest); OpenAI (lazy, opt-in only). No product-code change, no flag, no route.

## Global Constraints

- **Test/eval infra ONLY** — no change to `backend/services`, no flag, no route, no DB. Lives under `backend/tests/eval/`.
- **Pure core is CI-gated + cost-free**; the LLM harness is **opt-in** (`@unittest.skipUnless(os.environ.get("RUN_PEDAGOGY_EVAL") == "1", ...)`). Default `make test-backend` must stay green and spend ZERO LLM cost.
- **Import boundary:** `adherence_drift.py` imports stdlib only (`json`, `typing`). The opt-in test imports OpenAI + the engine compose functions LAZILY inside the test method (never at module top) so importing the test module pulls no OpenAI/engine-render into the import-boundary suites.
- **Model:** all three LLM roles (simulated student, tutor, judge) use `gpt-5.4-mini-2026-03-17`, `reasoning_effort="high"`, no temperature (reasoning models reject it). NEVER gpt-4o-mini. Fixed, no env override (per the existing eval convention).
- **Constants (named, frozen in tests):** `N_TURNS=8`, `ADHERENCE_TARGET=0.8`, `DRIFT_THRESHOLD=0.15`, `EARLY_LATE_K=N_TURNS//3` (=2). `ADHERENCE_DIMENSIONS = (target_language, elicits_targets, correction_posture, one_focus, anti_sycophancy, no_answer_dump)`.
- **Verdict rule:** `plateaus = (lateRate < ADHERENCE_TARGET) and (earlyRate - lateRate >= DRIFT_THRESHOLD)`.
- **The opt-in test does NOT hard-fail on `plateaus=True`** — a plateau is a finding to act on, not a test failure. It asserts the run completed and the verdict is well-formed, and reports the rates.
- **Judge-verdict parser raises on ambiguity** (no silent `bool("false")` pass).
- **Commits:** no `Co-Authored-By` trailer. Commit to `main`.

---

### Task 1: Pure scorer/aggregator/verdict (`adherence_drift.py`) + CI unit tests

**Files:**
- Create: `backend/tests/eval/adherence_drift.py`
- Create: `backend/tests/eval/test_adherence_drift.py` (CI-gated, no LLM)

**Interfaces:**
- Produces: `ADHERENCE_DIMENSIONS`, constants (`N_TURNS`, `ADHERENCE_TARGET`, `DRIFT_THRESHOLD`, `EARLY_LATE_K`); `coerce_adherence_verdict(raw) -> dict[str,bool]`; `score_turn(dimension_verdicts: dict) -> float`; `aggregate_drift(per_turn_scores: list, *, early_k=EARLY_LATE_K, late_k=EARLY_LATE_K) -> dict`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/eval/test_adherence_drift.py`:

```python
"""CI-gated, cost-free tests for the S5-gate adherence/drift scorer. No LLM."""
import unittest

from backend.tests.eval.adherence_drift import (
    ADHERENCE_TARGET,
    aggregate_drift,
    coerce_adherence_verdict,
    score_turn,
)


class ScoreTurnTestCase(unittest.TestCase):
    def test_all_upheld_is_one(self):
        self.assertEqual(score_turn({"target_language": True, "one_focus": True}), 1.0)

    def test_none_upheld_is_zero(self):
        self.assertEqual(score_turn({"target_language": False, "one_focus": False}), 0.0)

    def test_partial_fraction(self):
        self.assertEqual(score_turn({"target_language": True, "one_focus": False}), 0.5)

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            score_turn({})
        with self.assertRaises(ValueError):
            score_turn("nope")


class AggregateDriftTestCase(unittest.TestCase):
    def test_early_high_late_low_plateaus(self):
        # first 2 high (1.0), last 2 low (0.5): lateRate .5 < .8 AND drift .5 >= .15 → plateaus
        out = aggregate_drift([1.0, 1.0, 0.8, 0.7, 0.6, 0.6, 0.5, 0.5])
        self.assertAlmostEqual(out["earlyRate"], 1.0)
        self.assertAlmostEqual(out["lateRate"], 0.5)
        self.assertGreaterEqual(out["drift"], 0.15)
        self.assertTrue(out["plateaus"])

    def test_flat_high_does_not_plateau(self):
        out = aggregate_drift([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
        self.assertFalse(out["plateaus"])  # lateRate .9 >= target

    def test_never_adhering_does_not_plateau(self):
        # late is low but early was ALSO low → no drift → not an S5 problem
        out = aggregate_drift([0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4])
        self.assertFalse(out["plateaus"])  # drift ~0 < threshold
        self.assertLess(out["earlyRate"], ADHERENCE_TARGET)

    def test_too_few_scores_raises(self):
        with self.assertRaises(ValueError):
            aggregate_drift([1.0, 1.0])  # need >= early_k+late_k = 4 by default... (early_k=late_k=2)

    def test_custom_window(self):
        out = aggregate_drift([1.0, 1.0, 1.0, 0.0], early_k=1, late_k=1)
        self.assertAlmostEqual(out["earlyRate"], 1.0)
        self.assertAlmostEqual(out["lateRate"], 0.0)


class CoerceAdherenceVerdictTestCase(unittest.TestCase):
    def test_real_bools(self):
        self.assertEqual(
            coerce_adherence_verdict({"target_language": True, "one_focus": False}),
            {"target_language": True, "one_focus": False},
        )

    def test_json_string(self):
        self.assertEqual(
            coerce_adherence_verdict('{"target_language": true}'),
            {"target_language": True},
        )

    def test_string_false_maps_false(self):
        self.assertFalse(coerce_adherence_verdict({"one_focus": "false"})["one_focus"])

    def test_ignores_unknown_dimension_keys(self):
        # only ADHERENCE_DIMENSIONS keys are kept
        out = coerce_adherence_verdict({"target_language": True, "bogus": True})
        self.assertEqual(out, {"target_language": True})

    def test_no_recognized_dimension_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict({"bogus": True})

    def test_ambiguous_value_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict({"target_language": "maybe"})

    def test_non_object_raises(self):
        with self.assertRaises(ValueError):
            coerce_adherence_verdict("[true]")
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m unittest backend.tests.eval.test_adherence_drift -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.tests.eval.adherence_drift'`.

- [ ] **Step 3: Create `backend/tests/eval/adherence_drift.py`**

```python
"""Pure scorer/aggregator/verdict for the S5-gate static-composition adherence eval.

No LLM, no I/O — CI-tested, zero cost. The opt-in LLM harness
(test_static_composition_drift_eval.py) feeds per-turn judge verdicts through
``coerce_adherence_verdict`` → ``score_turn`` → ``aggregate_drift`` to produce the
S5 gate verdict. See docs/superpowers/specs/2026-06-24-pedagogy-s5-gate-eval-design.md.
"""

from __future__ import annotations

import json
from typing import Any

# Adherence dimensions the per-turn judge scores (a subset is in-scope per turn).
ADHERENCE_DIMENSIONS = (
    "target_language",
    "elicits_targets",
    "correction_posture",
    "one_focus",
    "anti_sycophancy",
    "no_answer_dump",
)

N_TURNS = 8
ADHERENCE_TARGET = 0.8
DRIFT_THRESHOLD = 0.15
EARLY_LATE_K = N_TURNS // 3  # = 2 at N_TURNS=8

_TRUE_STRINGS = frozenset({"true", "yes", "1"})
_FALSE_STRINGS = frozenset({"false", "no", "0"})


def _coerce_one(key: str, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _TRUE_STRINGS:
            return True
        if token in _FALSE_STRINGS:
            return False
        raise ValueError(f"adherence field {key!r} is an unrecognized verdict: {value!r}")
    raise ValueError(f"adherence field {key!r} is not a boolean verdict: {value!r}")


def coerce_adherence_verdict(raw: Any) -> dict[str, bool]:
    """Judge JSON (string or dict) → {dimension: bool} for the dimensions present.

    Only ``ADHERENCE_DIMENSIONS`` keys are kept (unknown keys ignored). Raises on a
    non-object, an ambiguous/non-boolean value, or if NO recognized dimension is
    present (a verdict with zero scorable dimensions is a judge failure, not a pass).
    """
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, dict):
        raise ValueError(f"adherence verdict did not parse to an object: {parsed!r}")
    verdict: dict[str, bool] = {}
    for key in ADHERENCE_DIMENSIONS:
        if key in parsed:
            verdict[key] = _coerce_one(key, parsed[key])
    if not verdict:
        raise ValueError(f"adherence verdict had no recognized dimension: {parsed!r}")
    return verdict


def score_turn(dimension_verdicts: Any) -> float:
    """Fraction of the in-scope dimensions upheld this turn (0..1).

    Empty / non-dict raises — a turn with no scorable dimension is a harness bug,
    not a zero score.
    """
    if not isinstance(dimension_verdicts, dict) or not dimension_verdicts:
        raise ValueError("score_turn requires a non-empty dimension-verdict dict")
    upheld = sum(1 for v in dimension_verdicts.values() if v is True)
    return upheld / len(dimension_verdicts)


def aggregate_drift(
    per_turn_scores: Any, *, early_k: int = EARLY_LATE_K, late_k: int = EARLY_LATE_K
) -> dict[str, Any]:
    """Early/late adherence rates + drift + the plateau verdict.

    ``plateaus`` is True when adherence held early but fell below target late:
    ``lateRate < ADHERENCE_TARGET and (earlyRate - lateRate) >= DRIFT_THRESHOLD``.
    A uniformly-low conversation (never adhering) does NOT plateau — that is a
    different (non-S5) problem and is reported via the low earlyRate.
    """
    scores = [float(s) for s in per_turn_scores]
    if len(scores) < early_k + late_k:
        raise ValueError(f"need >= {early_k + late_k} turn scores, got {len(scores)}")
    early = scores[:early_k]
    late = scores[-late_k:]
    early_rate = sum(early) / len(early)
    late_rate = sum(late) / len(late)
    drift = early_rate - late_rate
    plateaus = (late_rate < ADHERENCE_TARGET) and (drift >= DRIFT_THRESHOLD)
    return {"earlyRate": early_rate, "lateRate": late_rate, "drift": drift, "plateaus": plateaus}
```

- [ ] **Step 4: Run to verify they pass**

Run: `python3 -m unittest backend.tests.eval.test_adherence_drift -v`
Expected: PASS (all scorer/aggregator/parser cases).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/eval/adherence_drift.py backend/tests/eval/test_adherence_drift.py
git commit -m "feat(pedagogy): S5-gate eval pure scorer (adherence/drift verdict)"
```

---

### Task 2: Opt-in multi-turn harness (`test_static_composition_drift_eval.py`)

**Files:**
- Create: `backend/tests/eval/test_static_composition_drift_eval.py`

**Interfaces:**
- Consumes: `adherence_drift` (Task 1); the engine compose functions (`compile_prompt_plan`, `render_assignment_prompt`, `AffectState`) imported LAZILY inside the test.
- Produces: `compose_static_engine_prompt(scenario) -> str` (module-level pure helper, no LLM — usable by the CI test); the opt-in `StaticCompositionDriftEval` TestCase; a CI-gated `ComposeStaticPromptTestCase` (no LLM).

- [ ] **Step 1: Write the failing test (CI-gated compose assembly check first)**

Create `backend/tests/eval/test_static_composition_drift_eval.py` starting with the imports, the scenario, `compose_static_engine_prompt`, and the CI-gated assembly test:

```python
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
    ADHERENCE_DIMENSIONS,
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
```

- [ ] **Step 2: Run to verify the CI test passes (and the module imports cleanly)**

Run: `python3 -m unittest backend.tests.eval.test_static_composition_drift_eval -v`
Expected: PASS — `ComposeStaticPromptTestCase` green; `StaticCompositionDriftEval` skipped (RUN_PEDAGOGY_EVAL unset).

- [ ] **Step 3: Add the opt-in multi-turn harness**

Append the LLM harness to the same file:

```python
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
```

- [ ] **Step 4: Run to verify (CI path stays green; opt-in stays skipped)**

Run: `python3 -m unittest backend.tests.eval.test_static_composition_drift_eval -v`
Expected: PASS — `ComposeStaticPromptTestCase` green; `StaticCompositionDriftEval` skipped. (Confirm no OpenAI import at module load: `python3 -c "import backend.tests.eval.test_static_composition_drift_eval, sys; print('openai' in sys.modules)"` → `False`.)

- [ ] **Step 5: Commit**

```bash
git add backend/tests/eval/test_static_composition_drift_eval.py
git commit -m "feat(pedagogy): S5-gate eval opt-in multi-turn adherence-drift harness"
```

---

### Task 3: Decision note + doc-sync (the S5 gate state)

**Files:**
- Create: `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE_S5.md` — the S5 doc home (one-doc-per-S-phase convention, consistent with S3/S4): the gate, the instrument, the verdict rule, and the current decision state.
- Modify: `docs/school-integration/Pedagogy Engineering/PEDAGOGY_ENGINE.md` §14 — annotate the S5 row with the instrument's existence + the gate state.
- Modify: `docs/school-integration/TASKS.md` — add an S5-gate item (`[x]` instrument built + `[ ]` run-and-decide).
- Modify: `backend/CLAUDE.md` — note the S5-gate eval under the eval-harness description (the `backend/tests/eval/` set + that the LLM run is opt-in).

**Interfaces:** none (docs).

- [ ] **Step 1: Write the S5 doc section**

Create or extend the S5 doc home (follow the `PEDAGOGY_ENGINE_S4.md` style). Record: §14 gates S5 on a static-composition plateau; the instrument is `backend/tests/eval/adherence_drift.py` (pure verdict) + `test_static_composition_drift_eval.py` (opt-in harness); the verdict rule (`plateaus` definition + constants); the decision states (built-not-run → S5 deferred; run+plateau → S5 warranted; run+no-plateau → S5 deferred-with-evidence); and that the synthetic signal is a proxy pending real post-cutover field data.

- [ ] **Step 2: Update §14, TASKS.md, backend/CLAUDE.md**

§14 S5 row: append "(eval instrument built `2026-06-24` — `backend/tests/eval/test_static_composition_drift_eval.py`; run with `RUN_PEDAGOGY_EVAL=1` to produce the gate verdict; S5 remains deferred until a plateau is shown)". TASKS.md: the S5-gate item. backend/CLAUDE.md: one line under the eval-harness note.

- [ ] **Step 3: Run the full backend suite (no regression, zero LLM cost)**

Run: `make test-backend 2>&1 | grep -E "^Ran|^OK|^FAILED"`
Expected: `OK` — the new pure tests run in CI; the opt-in harness stays skipped.

- [ ] **Step 4: Commit**

```bash
git add "docs/school-integration/" backend/CLAUDE.md
git commit -m "docs(pedagogy): S5 gate state + eval instrument (run-to-decide)"
```

---

## Self-Review (controller, post-write)

**Spec coverage:** §2 architecture → Tasks 1,2; §3 harness loop → Task 2; §4 adherence dimensions → Tasks 1 (constant) + 2 (judge rubric); §5 scoring/verdict → Task 1; §6 decision → Task 3 (doc); §7 cost/error → Task 2 (skipUnless + lazy import); §8 testing → Tasks 1,2. No gaps.

**Type consistency:** `coerce_adherence_verdict → dict[str,bool]` (Task 1) feeds `score_turn(dict) → float` (Task 1), list of which feeds `aggregate_drift(list) → {earlyRate,lateRate,drift,plateaus}` (Task 1); the harness (Task 2) calls them in that order. `compose_static_engine_prompt(scenario) -> str` used by both the CI compose test and the opt-in loop. `N_TURNS`/`ADHERENCE_DIMENSIONS` imported from Task 1 into Task 2. Consistent.

**Placeholder scan:** Task 3 leaves the S5-doc-home as "extend PEDAGOGY_ENGINE_S4.md or create PEDAGOGY_ENGINE_S5.md" — resolve to: create `PEDAGOGY_ENGINE_S5.md` (per the one-doc-per-S-phase convention, consistent with S3/S4). All code steps carry complete code.
