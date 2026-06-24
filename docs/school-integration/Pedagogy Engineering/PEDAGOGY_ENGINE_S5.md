# Pedagogy Engine — S5 Director (as gated)

**Status:** **S5 DEFERRED — eval instrument built 2026-06-24, not yet run.** The gate is open but the verdict is unknown. Sibling to `PEDAGOGY_ENGINE_S1.md`, `PEDAGOGY_ENGINE_S2.md`, `PEDAGOGY_ENGINE_S3.md`, `PEDAGOGY_ENGINE_S4.md`; realizes (or withholds) the **S5 row** of `PEDAGOGY_ENGINE.md` §14.

---

## 0. TL;DR

S5 adds between-turns `session.update` re-steer: when the tutor's instruction adherence degrades as turns stack, a one-sentence Director call nudges it back on course. **§15 of `PEDAGOGY_ENGINE.md` is explicit — S5 is gated on eval, not faith.** The eval instrument is now built; S5 opens only if a run shows adherence plateauing below target. Until that run happens, S5 remains deferred.

---

## 1. Gate condition (from §14)

The S5 row in `PEDAGOGY_ENGINE.md` §14 reads:

> Between-turns `session.update` re-steer — **only if** S1–S4 eval shows static composition plateaus below target.

"Static composition" means the full assembled S1–S4 prompt (assignments + recycling + affect stance + correction-light), held fixed for an entire conversation (no between-turn steering). The question is whether that static composition holds instruction adherence across a multi-turn session, or drifts below target as turns stack. If it drifts — and drifts in the specific *plateau* pattern (starts strong, falls late) — S5 is warranted. If it doesn't, S5 adds latency and cost for no measurable gain, and is deferred with evidence.

---

## 2. Eval instrument

Two files implement the S5-gate eval. Both live in `backend/tests/eval/`.

### 2.1 Pure verdict module — `adherence_drift.py`

```
backend/tests/eval/adherence_drift.py
```

No LLM, no I/O, no cost. CI-tested (gates `make test-backend`). Provides the scoring primitives and the plateau verdict logic used by the opt-in harness.

**Constants:**

| Constant | Value | Meaning |
|---|---|---|
| `N_TURNS` | 8 | simulated conversation length |
| `ADHERENCE_TARGET` | 0.8 | late-window adherence floor; below this = below target |
| `DRIFT_THRESHOLD` | 0.15 | minimum early→late drop to qualify as a plateau |
| `EARLY_LATE_K` | `N_TURNS // 3` = 2 | window width (first/last K turns) |

**Adherence dimensions** (`ADHERENCE_DIMENSIONS`): the set of per-turn categories the judge scores:

| Dimension | What it measures |
|---|---|
| `target_language` | tutor stayed in the target language (no unprompted L1) |
| `elicits_targets` | tutor worked toward assignment targets, not generic chat |
| `correction_posture` | when learner erred, tutor cued self-correction (accuracy_first mode) |
| `one_focus` | tutor corrected at most one thing (no pile-up) |
| `anti_sycophancy` | brief confirmative acknowledgment, not effusive praise |
| `no_answer_dump` | tutor did not hand over the full target answer outright |

**API:**

```python
coerce_adherence_verdict(raw: Any) -> dict[str, bool]
    # Judge JSON (string or dict) → {dimension: bool} for applicable dimensions.
    # Unknown keys ignored; raises if no recognized dimension present.

score_turn(dimension_verdicts: dict) -> float
    # Fraction of in-scope dimensions upheld this turn (0..1).

aggregate_drift(
    per_turn_scores: list[float],
    *,
    early_k: int = EARLY_LATE_K,
    late_k: int = EARLY_LATE_K,
) -> {"earlyRate": float, "lateRate": float, "drift": float, "plateaus": bool}
    # Early/late adherence rates, drift, and the plateau verdict.
```

**Plateau verdict:**

```python
plateaus = (lateRate < ADHERENCE_TARGET) and (earlyRate - lateRate >= DRIFT_THRESHOLD)
```

A uniformly-low conversation (never adhering, early or late) does **not** plateau — that is a different problem (not an S5 problem) and is visible via the low `earlyRate`. The plateau pattern specifically captures "started strong, fell late."

### 2.2 Opt-in harness — `test_static_composition_drift_eval.py`

```
backend/tests/eval/test_static_composition_drift_eval.py
```

**Gated by `RUN_PEDAGOGY_EVAL=1`** (real LLM cost: `len(scenarios) × N_TURNS × 3` calls — simulated student, tutor, and judge). Skipped in CI. OpenAI + engine-render imports are lazy inside the opt-in test class so the module stays within the standard import-boundary suites.

The harness:

1. **`compose_static_engine_prompt(scenario) -> str`** — CI-gated, cost-free helper. Builds a full S1–S4 static prompt in-process (`compile_prompt_plan` + `render_assignment_prompt`) against a seeded scenario, including an S2 coverage state (prior session, all targets uncovered → recycling section renders) and an S4.1 strained affect state. No LLM call. Verified by `ComposeStaticPromptTestCase` (CI, gates `make test-backend`).

2. **`StaticCompositionDriftEval`** (opt-in, `RUN_PEDAGOGY_EVAL=1`) — a simulated student↔tutor loop over `N_TURNS` turns, with a per-turn adherence judge:
   - Student turn: `_student_turn` generates an authentic novice-high learner reply via `_EVAL_MODEL` with `reasoning_effort="high"`.
   - Tutor turn: `_tutor_turn` drives the tutor via the composed static prompt, same model.
   - Judge: `_judge_turn` scores adherence dimensions for the tutor's last turn (JSON mode), fed through `coerce_adherence_verdict` → `score_turn`.
   - Aggregate: `aggregate_drift(per_turn_scores)` → verdict printed to stdout.
   - **The plateau verdict is a FINDING, not a test failure.** The test asserts only that the run completed with a well-formed verdict (`len(per_turn_scores) == N_TURNS`, `"plateaus" in result`, `isinstance(result["plateaus"], bool)`).

**Model:** `gpt-5.4-mini-2026-03-17` (the project's standard text model), `reasoning_effort="high"`.

---

## 3. CI-tested components

The following run in CI (`make test-backend`) at zero LLM cost:

- `backend/tests/eval/test_adherence_drift.py` — 16 deterministic unit tests covering `coerce_adherence_verdict` (string/bool/dict inputs, unknown keys, no-recognized-dimension error), `score_turn` (various pass/fail mixes, empty/non-dict error), and `aggregate_drift` (plateau cases, no-plateau cases, insufficient-scores error).
- `ComposeStaticPromptTestCase` in `test_static_composition_drift_eval.py` — verifies the composed prompt is non-empty, includes `TUTOR STANCE`, and includes the affect override line for a strained learner.

The opt-in `StaticCompositionDriftEval` class is skipped in CI (`@unittest.skipUnless(os.environ.get("RUN_PEDAGOGY_EVAL") == "1", ...)`).

---

## 4. Decision states

| State | Condition | Action |
|---|---|---|
| **BUILT, NOT RUN** ← current | Instrument exists; no run yet | S5 deferred. No additional work until a deliberate run. |
| **RUN → plateau** | Run completes; `plateaus == True` | S5 is warranted. Open the S5 brainstorm / design session. |
| **RUN → no plateau** | Run completes; `plateaus == False` | S5 deferred with evidence. Static composition holds; `session.update` adds cost with no demonstrated benefit. Document the `earlyRate`/`lateRate`/`drift` result in this file and in LIMITATIONS. |

**Current state: BUILT, NOT RUN → S5 DEFERRED.**

Running the eval requires a deliberate choice to incur the LLM cost (`RUN_PEDAGOGY_EVAL=1 python3 -m unittest backend.tests.eval.test_static_composition_drift_eval`). When run, update this doc and TASKS.md with the verdict.

---

## 5. Cathedral-risk note (§15 of `PEDAGOGY_ENGINE.md`)

§15 names this explicitly: "S5 is gated on eval, not faith." The between-turns Director is non-trivial infrastructure (+latency, +cost per turn, added complexity in the realtime loop). Building it without measuring whether the static composition actually plateaus would be cathedral-building — adding a layer because the architecture allows it, not because the product needs it. The gate exists to prevent that.

**Synthetic signal is a proxy.** The eval uses a simulated student and an LLM judge, both subject to the same model's behavior. This is a dev metric that converts prompt-adherence from vibes to a measurable signal; it does not prove learning outcomes (§13.2 of `PEDAGOGY_ENGINE.md`). Post-cutover field data — real students, real sessions, real error rates — is the authoritative signal. The synthetic plateau is a sufficient reason to open S5 design; its absence is a sufficient reason to defer. Neither replaces field validation.

---

## 7. Director (built behind flag, 2026-06-24)

The Director has been fully built and wired behind `PEDAGOGY_ENGINE_DIRECTOR` (cloudbuild default `'0'`). It is **NOT cut over** — the flag is absent/off in the live service. Cutover is gated on the S5-gate eval verdict (§4 above): only if a run of the opt-in harness returns `plateaus == True`.

### 7.1 What was built

**v1 = target-neglect heuristic.** The Director v1 covers one robust, locale-agnostic signal: TARGET-NEGLECT — the tutor spending a window of consecutive turns without working toward any concrete assignment target (expressions + vocabulary; grammar labels excluded from substring matching).

**Pure layer — `backend/services/pedagogy/drift.py`:**

| Symbol | Kind | Description |
|---|---|---|
| `DRIFT_WINDOW` | constant | `3` — number of consecutive tutor turns that must all miss any target to qualify as neglect |
| `DIRECTOR_COOLDOWN_TURNS` | constant | `4` — minimum turns between two re-steers (prevents nagging) |
| `DIRECTOR_MAX_RESTEERS` | constant | `3` — per-session cap on re-steer injections |
| `detect_target_neglect(recent_tutor_turns, concrete_targets, *, window)` | pure fn | Returns `DriftVerdict(drift, kind, target, reason)`; "insufficient evidence" when window not filled |
| `decide_resteer(director_state, verdict, turn_index)` | pure fn | Returns `(ResteerDecision, new_state)`; enforces cooldown + cap; never mutates input |
| `build_resteer_prompt(verdict, *, surface)` | pure fn | In-character COACH NOTE for the main tutor; terser on voice |
| `serialize_resteer(decision, *, turn_index, surface, prompt, generated_at)` | pure fn | Durable audit record for `analysis_state['resteers']` |

No OpenAI/Canvas/resolver imports — import boundary invariant (7a) holds; verified by `ImportBoundaryTestCase`.

**Impure orchestrator — `backend/services/director_service.py`:**

`assess_drift(deps, bootstrap, uid, session_id, turn_index) -> dict | None`

- Flag gate first: `director_enabled()` → returns `None` immediately when off (byte-identical to today).
- Reads the practice session, extracts `concrete_targets` from `bootstrap.mapping.targetExpressions + targetVocabulary`; returns `None` if no concrete targets.
- Reads recent tutor turns from the chat transcript (`TRANSCRIPT_WINDOW=6` messages; the synchronous source of truth — `analysis_state['recent_turns']` lags on the async event-rollup path).
- Runs the pure `detect_target_neglect` → `decide_resteer` pipeline.
- **Re-read before write** (S3.1 lesson): re-fetches `analysis_state` before appending to avoid clobbering a concurrent write.
- **Dedup**: if a `resteers[]` entry already exists for `turn_index`, returns it without a new write.
- Fail-open: any exception degrades to `None`; the live conversation is never blocked.
- No LLM call; pure heuristic.
- Persists `director_state` (cooldown/count tracking) + `resteers[]` (audit log) into `analysis_state` via `update_practice_session_analysis_state`.

On a re-steer, returns:
```python
{
    "turn_index": int,
    "surface": "voice" | "text",
    "resteer": True,
    "resteer_prompt": str,   # the COACH NOTE to inject
    "kind": "target_neglect",
    "target": str,
    "reason": str,
    "generated_at": str,     # ISO UTC
}
```

**Flag helper — `backend/services/pedagogy/integration.py`:**

`director_enabled()` reads `PEDAGOGY_ENGINE_DIRECTOR`; same `_TRUTHY = {"1", "true", "yes", "on"}` pattern as the other pedagogy flags.

**Route wiring — `POST /api/practice-sessions/<id>/coach-chip`:**

The route bootstraps `director_enabled()` alongside `coach_chips_enabled()`. If either flag is on, the route runs the corresponding assessment. The response carries both fields:
```json
{ "success": true, "coachChip": <chip or null>, "resteer": <resteer dict or null> }
```
The Director rides the existing coach-chip round-trip with no new endpoint.

**Delivery channels:**

- **Voice:** the frontend receives `resteer.resteer_prompt` and injects it into the realtime session via `injectPromoteBackRef` (the same `conversation.item.create` channel used by S3.3 promote-back).
- **Text:** the frontend merges `resteer.resteer_prompt` into `coachNote` so the main text tutor receives the directive on its next turn.

**Deviation from the original S5 spec:** the spec described `session.update` as the re-steer channel (mid-session system-prompt patch). The implementation instead uses `conversation.item.create` (the same channel as promote-back). This avoids the model-context disruption of a mid-session `session.update` and reuses the proven voice injection path. The behavioral outcome is equivalent for a one-sentence directive; a dedicated `session.update` Director is deferred.

### 7.2 Flag state

| Flag | cloudbuild default | Live state | Cutover gate |
|---|---|---|---|
| `PEDAGOGY_ENGINE_DIRECTOR` | `'0'` | absent/off | S5-gate eval `plateaus == True` |

Flip via `--update-env-vars PEDAGOGY_ENGINE_DIRECTOR=1` after the eval verdict warrants it. Rollback instant: `=0`.

When off: `assess_drift` returns `None` immediately; the route returns `resteer: null`; behavior is byte-identical to today.

---

## 6. Running the eval

```bash
# From the repo root, with OPENAI_API_KEY set:
RUN_PEDAGOGY_EVAL=1 python3 -m unittest backend.tests.eval.test_static_composition_drift_eval.StaticCompositionDriftEval -v
```

The run prints per-scenario verdict to stdout:

```
[S5-GATE] scenario=cafe-info-gap-accuracy earlyRate=0.92 lateRate=0.67 drift=0.25 plateaus=True
```

or

```
[S5-GATE] scenario=cafe-info-gap-accuracy earlyRate=0.88 lateRate=0.83 drift=0.05 plateaus=False
```

Record the result in §4 of this doc (update "Current state") and update TASKS.md accordingly.
