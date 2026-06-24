# Pedagogy Engine — S4 Affect + Debrief (detailed design)

**Status:** **S4.1 BUILT behind `PEDAGOGY_ENGINE_AFFECT` (default `'0'`), NOT yet cut over** — flag absent/off in live service. Cutover is a separate post-merge step. **S4.2 (evidence-backed teacher debrief) still pending.** Sibling to `PEDAGOGY_ENGINE_S1.md`, `PEDAGOGY_ENGINE_S2.md`, `PEDAGOGY_ENGINE_S3.md`; realizes the **S4 row** of `PEDAGOGY_ENGINE.md` §14.

---

## 0. TL;DR

S4.1 closes the L3 learner-model gap by deriving a coarse **readiness tier** from a student's recent prior-session signals (turn-length trend, repair density, recent abandonment) and modulating the L5 tutor stance when the learner appears strained. The heuristic is explicitly NOT model-verified affect or WTC measurement — it mirrors the S2 coverage-tier caveat. With the flag off the prompt is **byte-identical** to today; with the flag on and readiness = neutral/settled it is also byte-identical. Only `readiness == "strained"` produces any visible prompt change, and that change is a bounded nudge within the teacher's existing policy — it never silences correction the teacher explicitly requested.

S4.2 (the evidence-backed L7 teacher debrief) is the next slice; this doc leads with the S4.1 section and leaves room for it below.

---

# S4.1 — Affect-Aware Tutoring (as built)

## 1. Goal

Thread a coarse readiness signal — derived from prior-session behavioral proxies — into the L5 feedback-policy render layer so the tutor adopts a gentler stance when the learner shows signs of strain. No new data collection, no model call, no new store. Heuristic, fail-open, byte-identical when off.

This is the "affect override in L5" item from `PEDAGOGY_ENGINE.md` §14 (S4 row) and addresses LIMITATIONS #53(j) ("No affect. The window is cumulative produce/error counts only; WTC/anxiety signals and affect-aware override are S4, not here.") for the S2 recycling caveat.

## 2. Architecture — pure / impure split (mirrors S2)

```
PURE   backend/services/pedagogy/affect.py                  (stdlib + dataclasses only)
         • AffectState(readiness, signals, reason)           frozen dataclass
         • compute_affect_state(session_signals) -> AffectState
             readiness values: "settled" | "neutral" | "strained"
             session_signals: most-recent-first list of signal dicts
         • affect_stance_lines(affect, *, correction_light=False) -> list[str]
             returns [] unless readiness == "strained"
             bounded nudge: never silences teacher-requested correction
             correction_light=True drops the correction-softening line (coach already owns it)
         • serialize_affect_state(affect) -> dict
             JSON-able snapshot for analysis_state['affect_state']

IMPURE  backend/services/practice_analytics.py
         • compute_assignment_affect_state(db, bootstrap, uid, assignment_id,
               *, current_session_id=None) -> AffectState | None
             mirrors compute_assignment_coverage_state; gate OUTSIDE the try
             (affect_enabled() off => zero reads => None); first session = neutral;
             fail-open: any exception => None, never a live-path 500
         • _affect_session_signals(prior_sessions) -> list[dict]
             builds most-recent-first signal dicts from prior session records;
             reads avg_words from raw session_summary (NOT the normalized value);
             each signal dict = {"avg_words": float, "repair_count": int,
                                 "turn_count": int, "abandoned": bool}

GATE   backend/services/pedagogy/integration.py
         • affect_enabled()                                   reads PEDAGOGY_ENGINE_AFFECT

PLAN   backend/services/pedagogy/plan.py
         • PromptPlan.affect: AffectState | None              S4.1 readiness override
         • compile_prompt_plan(bootstrap, coverage_state=None, affect_state=None) -> PromptPlan

RENDER backend/services/assignment_resolver.py
         • _build_tutor_stance(..., affect=None) -> str
             lazy-imports affect_stance_lines when readiness=="strained"
             byte-identical when affect is None / neutral / settled

SEAM   backend/services/pedagogy/integration.py
         • resolve_assignment_system_prompt(bootstrap, *, surface, coverage_state=None,
               affect_state=None) -> str
             affect_state=None unless affect_enabled(); None renders byte-identically
```

**Why this split:** the import-boundary invariant (invariant 7a) forbids `pedagogy/*.py` core modules from importing OpenAI/Canvas/resolver/compliance. `affect.py` is stdlib + dataclasses only — verified by `test_pedagogy_engine_s1.ImportBoundaryTestCase` (extended to cover `affect.py`). The DB read (`list_student_assignment_practice_sessions`) and the `affect_enabled()` gate live in the impure layer (`practice_analytics.compute_assignment_affect_state`); the deterministic heuristic lives in the pure module.

## 3. Readiness heuristic

`compute_affect_state(session_signals)` produces a coarse readiness tier from at most the most-recent `AFFECT_WINDOW_SESSIONS` prior sessions:

### Constants (frozen in tests, tunable)

| Constant | Value | Meaning |
|---|---|---|
| `AFFECT_WINDOW_SESSIONS` | 3 | max prior sessions examined |
| `MIN_SESSIONS_FOR_AFFECT` | 2 | fewer → neutral (insufficient evidence) |
| `REPAIR_DENSITY_HIGH` | 0.6 | repairs/turn threshold for "high" density |
| `ABANDONMENT_STRAIN_MIN` | 2 | ≥ this many abandoned sessions → strain signal |
| `TURN_TREND_FALL_RATIO` | 0.7 | latest avg_words < 0.7 × earlier mean → "falling" |

### Readiness values

| Value | Condition | Prompt effect |
|---|---|---|
| `"neutral"` | insufficient sessions OR mixed signals | byte-identical (no affect lines) |
| `"settled"` | flat/rising trend + low repair density + 0 abandonments | byte-identical (no affect lines) |
| `"strained"` | any of: falling turn length, high repair density, ≥ 2 recent abandonments | gentler stance lines injected |

**Neutral is the safe default.** Insufficient data (< `MIN_SESSIONS_FOR_AFFECT`) → neutral, not strained. The heuristic errs toward no-change.

### Signal dict contract

`_affect_session_signals` builds the input from prior session records. Each signal dict:

```python
{
    "avg_words": float,       # average student words per turn (raw session_summary field)
    "repair_count": int,      # recast + elicitation + sum(repeated_error_counts.values())
    "turn_count": int,        # student_turn_count from normalized summary
    "abandoned": bool,        # status=="abandoned" OR "abandon" in ended_reason
}
```

`avg_words` is read from the raw `session_summary` value rather than the normalized summary because the normalizer recomputes `average_student_words_per_turn` from `total_student_words / student_turn_count`, losing a pre-computed value stored directly on the record.

## 4. L5 override semantics

`affect_stance_lines(affect, *, correction_light=False)` returns `[]` unless `readiness == "strained"`. When strained it returns up to three lines:

1. Warmth + patience lead ("warm and patient, lead with brief encouragement, allow extra silence before stepping in").
2. Accept shorter turns ("do not press for long production").
3. Soften correction (dropped when `correction_light=True` — the S3.3 correction-light flag is on, so the coach track already owns correction; the affect nudge must not contradict it).

**Bounded nudge invariants:**
- **Never silences teacher-requested correction** — the three stance lines modulate *how* correction is delivered, not *whether*. A teacher who chose `accuracy_first` still gets errors addressed; the affect lines ask for gentler recasts and longer escalation windows, not silence.
- **Byte-identical when off or neutral/settled** — `affect_stance_lines` returns `[]` for non-strained affect; `_build_tutor_stance` in `assignment_resolver.py` only appends lines when the list is non-empty; so a disabled or neutral state produces zero diff in the final prompt string.
- **`correction_light` interaction** — when S3.3 promote-back is active (`correction_light=True`), the third line (correction softening) is dropped from the affect block to avoid contradicting the coach track's correction authority. The first two lines (warmth + shorter turns) still apply.

## 5. Data contract — `analysis_state['affect_state']`

Sits beside S2's `analysis_state['coverage']` and the S3 keys. `default_analysis_state()` / `normalize_analysis_state()` in `practice_analytics.py` carry an `affect_state` key, default `None`.

`serialize_affect_state(affect)` produces:

```jsonc
{
  "readiness": "settled" | "neutral" | "strained",
  "signals": {
    "turn_length_trend": "falling" | "rising" | "flat" | "unknown",
    "repair_density": "low" | "moderate" | "high" | "unknown",
    "abandonment_recent": <int>,        // count of abandoned sessions in the window
    "prior_sessions_seen": <int>        // how many sessions were examined
  },
  "reason": "<str>"                     // human-readable explanation of the readiness tier
}
```

The snapshot is written to `analysis_state['affect_state']` at session-create time (alongside S2 coverage), NOT generated-on-read. It is computed once per session from the state at session start and does not update mid-session. (Within-session readiness gating is a deferred follow-up — see §7.)

## 6. Flag & rollout (REPLACE-safe)

New flag **`PEDAGOGY_ENGINE_AFFECT`** (default `'0'`), independent of all other pedagogy flags.

- **REPLACE-safe:** the deploy uses `--set-env-vars=REPLACE`, which replaces the whole env set. The flag MUST be listed in `cloudbuild.yaml` AND its substitution default MUST match the live value. Currently **ABSENT (off) in live service**, so default `'0'` is REPLACE-safe. (Same wiring discipline as S3.3/S3.4.)
- **Cutover:** `gcloud run services update lingual-app --project=lingu-480600 --region us-central1 --update-env-vars PEDAGOGY_ENGINE_AFFECT=1` → text burn-in (drive sessions for a strained student → verify gentler stance lines appear in the assembled prompt, via the `/debug/plan-preview` or prompt-log; verify neutral/settled students see byte-identical prompt) → bump cloudbuild default `'0'→'1'` for durability.
- **Rollback:** instant via `--update-env-vars PEDAGOGY_ENGINE_AFFECT=0` (prompt reverts to byte-identical current behavior).

`affect_enabled()` in `backend/services/pedagogy/integration.py` reads `PEDAGOGY_ENGINE_AFFECT`, mirroring `recycling_enabled()` / `coach_chips_enabled()` etc.

## 7. Fail-open invariants

Every failure path degrades to `affect_state=None` (prompt byte-identical to today) — never a 500, never a blocked session:
- Flag off → `compute_assignment_affect_state` returns `None` immediately, zero reads.
- Not assignment-linked / missing bootstrap, uid, or assignment_id → `None`.
- `list_student_assignment_practice_sessions` raises → `except Exception` → `None`; `logger.exception` records it.
- `compute_affect_state` itself is pure / no-raises on normal input.
- First session (no prior sessions) → `compute_affect_state([])` → `MIN_SESSIONS_FOR_AFFECT` not met → `neutral` → `[]` stance lines → byte-identical.

## 8. Testing

**Deterministic units (gate `make test-backend`)** — `backend/tests/test_pedagogy_engine_s4.py`:
- `compute_affect_state`: strained on falling trend; strained on high repair density; strained on ≥ 2 abandonments; neutral on insufficient sessions; neutral on mixed signals; settled on stable + low repair + no abandonment.
- `affect_stance_lines`: returns `[]` for None; returns `[]` for neutral; returns `[]` for settled; returns 3 lines for strained; returns 2 lines for strained + `correction_light=True`.
- `serialize_affect_state`: round-trips through all three readiness values.
- `compute_assignment_affect_state`: flag-off → None (zero reads); fail-open (raising db → None); first session (empty prior) → neutral; current session excluded from prior evidence.
- `_affect_session_signals`: correct avg_words from raw summary; correct repair_count from feedback_counts + repeated; correct abandoned flag.
- **Extended `ImportBoundaryTestCase`** asserts `affect.py` imports no OpenAI/Canvas/resolver/compliance.

## 9. Deferred follow-ups

**(a) Silence-length signal not captured.** Silence duration (pause length before a learner turn begins) is a direct WTC/anxiety proxy (Input C). The `learning_events` `created_at` is **server-receipt time**, not the moment the learner started speaking — server-side clock ≈ receipt time, not silence onset. Capturing true silence length requires an **additive client-side timestamp** (the client records the tutor-turn-end time; the next event carries it as `client_turn_start_ms`). This is a clean additive change that does not break any existing event consumers and does not require a schema migration — but it requires frontend work. Deferred to a follow-up.

**(b) Within-session gating deferred.** The current affect signal is computed once at session start from prior-session history. A within-session adaptation (e.g. escalating gentleness if the student's turn length drops sharply mid-session) would require reading signals from `learning_events` as they arrive. Deferred — session-start affect already catches the "chronic strain" pattern; acute within-session strain is the next level of precision.

**(c) S4.2 evidence-backed teacher debrief.** The L7 teacher analytics surface — packaging `analysis_state` evidence (coverage, coach_review, affect_state, promotions, ask_log) into an evidence-backed post-session debrief for the teacher — is the companion slice. The analysis_state keys built through S4.1 are structured for this; the debrief presenter is not yet built. See §S4.2 below.

---

# S4.2 — Evidence-Backed Teacher Debrief (pending)

**Status: PENDING — not yet designed or built.** Placeholder for the L7 teacher analytics surface that packages the evidence accumulated through S1–S4.1 into a structured, post-session teacher debrief.

Key design questions to resolve before building:
- Which `analysis_state` keys surface to the teacher? (coverage tiers, coach_review target_coverage, affect readiness, promotions, ask_log summary)
- What is the teacher-facing URL / UX surface? (a separate `/teacher/sessions/<id>/debrief` panel? part of the existing analytics dashboard?)
- What caveats does the debrief carry? (heuristic coverage ≠ verified mastery; affect is a behavioral proxy; model-verified `coach_review` is the one evidence-backed component)
- Does `serialize_plan_preview` (L8) data wire into the debrief, or is L8 a separate teacher-preview-only surface?

---

## Relationship to existing docs

- `PEDAGOGY_ENGINE.md` §14 S4 row — updated to mark **S4.1 BUILT behind `PEDAGOGY_ENGINE_AFFECT` (default `'0'`, NOT cut over)**; S4.2 debrief still pending.
- `docs/school-integration/TASKS.md` — S4.1 `[x]` BUILT + `[ ]` cutover added; S4 debrief item updated.
- `docs/school-integration/LIMITATIONS.md` — #53 S4.1 sub-items added (heuristic, silence-length not captured, within-teacher-policy-only modulation).
- `backend/CLAUDE.md` — pedagogy line updated with `affect.py`, `affect_enabled()`, `compute_assignment_affect_state`, `PEDAGOGY_ENGINE_AFFECT` flag state.
