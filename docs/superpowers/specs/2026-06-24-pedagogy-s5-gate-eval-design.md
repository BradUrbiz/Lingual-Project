# Pedagogy Engine S5-Gate Eval — Static-Composition Adherence/Drift Instrument — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** The evaluation instrument §14 requires to decide whether **S5 (Director — between-turns re-steer)** is warranted. NOT S5 itself.
**Why now:** §14 gates S5 on *"only if S1–S4 eval shows static composition plateaus below target."* §15 names S5 the cathedral-risk mitigation (*"gated on eval, not faith"*). No holistic static-composition eval exists (the per-slice evals are narrow single-turn probes). The no-shortcut way to resolve the gate is to build the instrument and let its evidence decide.

---

## 0. TL;DR

S5 would add between-turn `session.update` re-steering to fight tutor **instruction-adherence drift** — the *"~30% voice instruction-adherence ceiling, which worsens as instructions stack"* (§6.2). The question the gate asks: **does the full static-composed engine prompt (S1–S4) hold adherence across a multi-turn conversation, or does it drift below target as turns accumulate?**

This builds a **multi-turn simulated-student ↔ static-engine-tutor harness** + a **per-turn adherence judge**, aggregates **early-window vs late-window** adherence, and emits a deterministic verdict: `static_composition_plateaus` (adhered early, degraded below target late → S5 warranted) or not (held target → S5 deferred). The deterministic scoring/aggregation/verdict is **pure + CI-tested** (zero cost); the LLM conversation + judge is **opt-in** (`RUN_PEDAGOGY_EVAL=1`), mirroring the established eval split.

The instrument's verdict (when run) decides S5 with evidence. If the run is deferred (LLM cost/key), the gate advances from *"no instrument"* to *"instrument ready; run to decide"* — and S5 stays correctly deferred until then.

---

## 1. Scope

### In scope
1. Pure `backend/tests/eval/adherence_drift.py`: the deterministic scorer/aggregator/verdict — given per-turn per-dimension adherence verdicts, compute early/late window adherence rates and the `static_composition_plateaus` boolean against named thresholds. No LLM, no I/O. CI-tested.
2. Opt-in `backend/tests/eval/test_static_composition_drift_eval.py`: the multi-turn LLM harness (compose full static engine prompt → simulated-student↔tutor loop → per-turn adherence judge → aggregate via the pure scorer → assert/report verdict). Gated `RUN_PEDAGOGY_EVAL=1`. Plus CI-gated deterministic unit tests for the scorer + the judge-verdict parser (cost-free), mirroring `test_coach_chip_eval.py`'s split.
3. A short results/decision note appended to the S5 section of `PEDAGOGY_ENGINE_S4.md` (or a new `PEDAGOGY_ENGINE_S5.md`) recording: instrument built, the verdict rule, and — if run — the measured verdict + the S5 build-vs-defer decision.

### Non-goals
- **S5 itself** (the Director / `session.update` re-steer runtime). This eval DECIDES whether to build it.
- **A production/field study.** This is a synthetic simulated-student signal, explicitly a proxy for (not a replacement of) real-student plateau evidence post-cutover. Documented as such.
- **CI-gating the LLM run.** Like every behavioral eval, the LLM loop is opt-in; only the deterministic scorer/parser gate CI.
- **New product code or flags.** This is test/eval infrastructure only — no `backend/services` change, no flag, no route.

---

## 2. Architecture — pure / opt-in split (mirrors the existing eval pattern)

```
PURE   backend/tests/eval/adherence_drift.py            (stdlib only — CI-tested, zero cost)
         • ADHERENCE_DIMENSIONS: the per-turn adherence checks (see §4)
         • score_turn(dimension_verdicts: dict[str,bool]) -> float     (fraction upheld, 0..1)
         • aggregate_drift(per_turn_scores: list[float], *, early_k, late_k)
               -> {earlyRate, lateRate, drift, plateaus}               (the verdict; see §5)
         • coerce_adherence_verdict(raw) -> dict[str,bool]             (judge JSON → bools; raises on ambiguity)

OPT-IN backend/tests/eval/test_static_composition_drift_eval.py        (RUN_PEDAGOGY_EVAL=1; real LLM cost)
         • compose_static_engine_prompt(scenario) -> str               (compile_prompt_plan(coverage,affect)→render)
         • the simulated-student↔tutor turn loop (N turns)
         • per-turn adherence judge (LLM) → coerce_adherence_verdict → score_turn
         • aggregate_drift over the conversation → report + assert the verdict
       (+ CI-gated deterministic TestCase for score_turn / aggregate_drift / coerce_adherence_verdict — NO LLM)
```

`compose_static_engine_prompt` builds the maximal static composition in-process from the pure engine functions (verified to work without a DB): a seeded `bootstrap` + an S2 `CoverageState` (some targets uncovered/recycled) + an S4.1 `AffectState(readiness="strained")`, through `compile_prompt_plan(bootstrap, coverage_state=, affect_state=)` → `render_assignment_prompt(plan, surface, correction_light=...)`. This is the "tutor system prompt" under test — the full S1–S4 stack as one string.

**Model:** all LLM calls (simulated student, tutor, judge) use `gpt-5.4-mini-2026-03-17`, `reasoning_effort="high"` (the project text-LLM convention; the eval must not silently run a different/forbidden model). Three roles, one model.

---

## 3. The harness loop

For each seeded scenario (proficiency + assignment targets + a drift-prone learner persona):
1. **Compose** the static engine tutor prompt (§2).
2. **Converse** for `N_TURNS` (default 8): alternating
   - *Simulated student* LLM: role-plays a learner of the scenario's proficiency with a persona instructed to behave realistically (short answers, occasional code-switching to English, plausible target-language errors) — NOT to be adversarial, just authentic. It sees only the conversation so far (never the tutor's system prompt).
   - *Tutor* LLM: driven by the composed engine prompt + conversation so far.
3. **Judge each tutor turn** (per-turn adherence judge, LLM): given the tutor's system prompt's intent (summarized adherence dimensions), the conversation context, and the tutor turn, return a JSON object of booleans — one per adherence dimension (§4).
4. **Score**: `score_turn` → fraction of dimensions upheld for that turn.
5. **Aggregate**: `aggregate_drift` over the per-turn scores → early/late rates + `plateaus` verdict.

Cost bound: `len(scenarios) × N_TURNS × 3` LLM calls (student + tutor + judge per turn). Keep `scenarios ≤ 2`, `N_TURNS = 8` → ≤ 48 calls per scenario-set. Documented in the test docstring.

---

## 4. Adherence dimensions (what the judge scores per tutor turn)

Drawn directly from the engine's composed instructions (the things S5's re-steer would re-assert if they drift):

| Dimension | Upheld when the tutor turn… |
|---|---|
| `target_language` | stays in the target language per the language-mix policy (doesn't drift into English unprompted) |
| `elicits_targets` | works toward the assignment's target expressions/grammar (not generic chat) |
| `correction_posture` | matches the `feedbackPolicy.mode` (e.g. `accuracy_first` → cues self-correction; `fluency_first` → stays light) |
| `one_focus` | corrects at most one thing (no error-pile-up) |
| `anti_sycophancy` | gives a brief confirmative acknowledgment, not effusive praise |
| `no_answer_dump` | doesn't hand the learner the full target answer outright |

The judge returns `{dimension: bool}` for the dimensions in scope for the scenario (e.g. `correction_posture` only when there's a learner error that turn). The deterministic `coerce_adherence_verdict` parses the judge JSON into real bools (raises on ambiguity — the `bool("false")` false-pass guard, copied from `_coerce_judge_verdict`).

---

## 5. Scoring, drift, and the verdict (pure — `aggregate_drift`)

- `per_turn_scores`: list of `score_turn` results (one per judged tutor turn), in order.
- `earlyRate` = mean of the first `early_k` scores; `lateRate` = mean of the last `late_k` scores, where `early_k = late_k = EARLY_LATE_K = N_TURNS // 3` (= 2 at N=8): the first 2 judged-turn scores vs the last 2.
- `drift` = `earlyRate − lateRate`.
- **`plateaus`** = `(lateRate < ADHERENCE_TARGET) and (drift >= DRIFT_THRESHOLD)`.

Constants (named, frozen in tests): `N_TURNS = 8`, `ADHERENCE_TARGET = 0.8`, `DRIFT_THRESHOLD = 0.15`, `EARLY_LATE_K = N_TURNS // 3`.

**Interpretation:** `plateaus = True` → the static prompt held adherence early but degraded below target as instructions/turns stacked → a between-turn re-steer (S5) would plausibly recover it → **S5 warranted**. `plateaus = False` → either it held target throughout (static composition suffices) or it was never adhering (a different, non-S5 problem — flagged in the report, not auto-attributed to S5).

---

## 6. The S5 decision (what the controller does with the verdict)

- **Built, not run** (no LLM key/cost available now): record that the instrument exists and is ready; S5 stays deferred pending a run. This is the honest gate state — and matches the project posture that LLM eval runs are deliberate (all behavioral evals are opt-in).
- **Run → `plateaus = True` on ≥1 scenario:** S5 is warranted → open the S5 brainstorm→spec→plan→implement next, citing the eval evidence.
- **Run → `plateaus = False`:** S5 **deferred with evidence** → documented in the S5 section. Revisit when real post-cutover field data is available (the synthetic signal is a proxy, not the last word).

Either way the gate is resolved by the right procedure (an instrument + a rule), not by assertion.

---

## 7. Error handling & cost discipline

- The opt-in test is skipped unless `RUN_PEDAGOGY_EVAL=1` (zero default cost). A missing `OPENAI_API_KEY` at run time surfaces as a clear skip/error, not a false pass.
- The deterministic scorer/parser never call the network and are CI-gated.
- Cost is bounded and documented (§3). Scenarios and turn count are small, named constants.
- The judge-verdict parser raises on ambiguity (no silent `bool("false")` pass).

---

## 8. Testing

- **CI-gated, cost-free** (`test_static_composition_drift_eval.py`, ungated TestCase): `score_turn` (all-upheld → 1.0; none → 0.0; partial fraction), `aggregate_drift` (a fabricated early-high/late-low score list → `plateaus=True`; flat-high → `plateaus=False`; never-adhering → `plateaus=False` with low earlyRate), `coerce_adherence_verdict` (real bools / string forms / ambiguous-raises / missing-key-raises), and `compose_static_engine_prompt` produces a non-empty prompt containing the tutor-stance + target sections (a pure assembly check, no LLM).
- **Opt-in, LLM** (`RUN_PEDAGOGY_EVAL=1`): the full multi-turn loop runs and **reports** earlyRate/lateRate/drift/plateaus per scenario; it asserts the run completed and produced a verdict (it does NOT hard-fail on `plateaus=True` — a plateau is a finding to act on, not a test failure; the assertion is that the instrument ran and the verdict is well-formed).
- The pure module is import-boundary-trivial (stdlib only); it lives under `tests/eval/` so it's not part of the engine package.

---

## 9. Follow-ups (logged)
- **Run the instrument** to produce the actual S5 verdict (needs an LLM key + the deliberate cost).
- **Real post-cutover field plateau evidence** — the synthetic eval is a proxy; once S3.3/S3.4/S4.1/S4.2 are cut over and real students use the full static composition, field adherence data is the authoritative gate input.
- If S5 is warranted: the S5 Director slice (between-turn `session.update` re-steer) — its own brainstorm→spec→plan.
