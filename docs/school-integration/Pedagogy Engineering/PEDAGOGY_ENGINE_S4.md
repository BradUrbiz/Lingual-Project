# Pedagogy Engine — S4 Affect + Debrief (detailed design)

**Status:** **S4.1 BUILT behind `PEDAGOGY_ENGINE_AFFECT` (default `'0'`), NOT yet cut over** — flag absent/off in live service. Cutover is a separate post-merge step. **S4.2 BUILT behind `PEDAGOGY_ENGINE_DEBRIEF` (default `'0'`), NOT cut over** — flag absent/off in live service. Sibling to `PEDAGOGY_ENGINE_S1.md`, `PEDAGOGY_ENGINE_S2.md`, `PEDAGOGY_ENGINE_S3.md`; realizes the **S4 row** of `PEDAGOGY_ENGINE.md` §14.

---

## 0. TL;DR

S4.1 closes the L3 learner-model gap by deriving a coarse **readiness tier** from a student's recent prior-session signals (turn-length trend, repair density, recent abandonment) and modulating the L5 tutor stance when the learner appears strained. The heuristic is explicitly NOT model-verified affect or WTC measurement — it mirrors the S2 coverage-tier caveat. With the flag off the prompt is **byte-identical** to today; with the flag on and readiness = neutral/settled it is also byte-identical. Only `readiness == "strained"` produces any visible prompt change, and that change is a bounded nudge within the teacher's existing policy — it never silences correction the teacher explicitly requested.

S4.2 (the evidence-backed L7 teacher debrief) is built behind `PEDAGOGY_ENGINE_DEBRIEF` (default `'0'`); this doc leads with the S4.1 section and documents S4.2 as built below.

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

# S4.2 — Evidence-Backed Teacher Debrief (as built)

**Status: BUILT behind `PEDAGOGY_ENGINE_DEBRIEF` (default `'0'`), NOT cut over** — flag absent/off in live service. Cutover is a separate post-merge step.

## 1. Goal

Package the evidence accumulated in `analysis_state` through S1–S4.1 into a structured, read-only post-session teacher debrief. No new data collection, no LLM call, no new store. The presenter projects an already-fetched `practice_session` record into the debrief shape, degrading gracefully on missing sub-objects.

This is the L7 teacher analytics / debrief item from `PEDAGOGY_ENGINE.md` §14 (S4 row) — the surface that addresses LIMITATIONS #53 §p ("Not yet feeding S2 recycling or the L7 teacher debrief") and §aa ("promotions[] not yet consumed by the L7 teacher debrief").

## 2. Architecture — pure presenter (no impure orchestration needed)

```
PURE   backend/services/pedagogy/debrief.py                 (stdlib only, no LLM/DB/Canvas)
         • build_session_debrief(session_record: Any) -> dict
             Total / no-raise: malformed sub-objects degrade to empty sections.
             caveats list is ALWAYS present.
         • MAX_SUGGESTIONS = 4
         • _ASK_KINDS = ("hint","translation","definition","clarification","phrase","refusal")
         • _CAVEATS = [three static honesty strings]

GATE   backend/services/pedagogy/integration.py
         • debrief_enabled()                                  reads PEDAGOGY_ENGINE_DEBRIEF

ROUTE  backend/routes/curriculum_admin.py
         • GET /api/teacher/practice-sessions/<session_id>/debrief
             Flag gate first (debrief_enabled() off → {success:false} + 200, no session read).
             session → assignment → class → teacher access via _require_assignment_teacher_access.
             Calls build_session_debrief(session_record); on unexpected exception returns a
             minimal debrief {sessionId, status, caveats: ['This debrief could not be fully assembled.']}.
         • debriefEnabled: debrief_enabled() field on three analytics payloads:
             GET /api/teacher/assignments/<id>/analytics
             GET /api/teacher/classes/<class_id>/analytics
             GET /api/teacher/classes/<class_id>/students/<uid>/analytics
             Frontend uses this flag to show/hide the debrief click-through link.
```

**Why pure-only:** unlike S3.1/S3.2/S4.1, the debrief presenter makes no external calls — it projects existing `analysis_state` + `session_summary` fields that are already materialized on the session record. No impure orchestrator layer is needed. The DB read is done by the route handler (one `get_practice_session` call); the presenter receives the record dict.

**Import boundary (invariant 7a):** `debrief.py` imports stdlib only — verified by `test_pedagogy_engine_s1.ImportBoundaryTestCase` (extended to cover `debrief.py`).

## 3. Debrief view shape

`build_session_debrief(session_record)` returns:

```jsonc
{
  "sessionId": "<str|null>",
  "status": "<str|null>",
  "startedAt": "<str|null>",
  "endedAt": "<str|null>",
  "coverage": {
    "expressionHits": {},               // target_expression_hits from session_summary
    "vocabularyHits": {},               // target_vocabulary_hits from session_summary
    "uncovered": ["<str>", ...],        // analysis_state.coverage.uncovered
    "recycle": ["<str>", ...]           // analysis_state.coverage.recycle
  },
  "uptake": {
    "selfCorrectionCount": <int>,
    "feedbackCounts": {
      "recast": <int>,
      "elicitation": <int>,
      "reviewItem": <int>
    },
    "taskCompletionCount": <int>
  },
  "repeatedErrors": [
    {"label": "<str>", "count": <int>}  // sorted descending by count, count > 0 only
  ],
  "coachReview": <dict|null>,           // analysis_state.coach_review (pass-through)
  "promotions": [<dict>, ...],          // analysis_state.promotions (pass-through)
  "helpUsage": {
    "askCount": <int>,                  // len(analysis_state.ask_log)
    "byKind": {                         // counts per ASK kind (all 6 keys always present)
      "hint": <int>, "translation": <int>, "definition": <int>,
      "clarification": <int>, "phrase": <int>, "refusal": <int>
    }
  },
  "affect": {                           // null if analysis_state.affect_state absent/malformed
    "readiness": "<str|null>",
    "reason": "<str|null>"
  },
  "suggestedNext": ["<str>", ...],      // up to MAX_SUGGESTIONS (4) non-dedup'd suggestions
  "caveats": ["<str>", ...]             // always present; 3 static honesty strings
}
```

### Honesty caveats (always present)

The three static `_CAVEATS` strings:
1. "This debrief summarizes the practice transcript. Target and error detection is heuristic, not graded scoring."
2. "Pronunciation and listening accuracy were not separately assessed."
3. "Help requests are shown as usage counts, not as evidence the learner produced the form."

### Suggested-next derivation

`_suggested_next(coverage, repeated_errors, coach_review)` builds up to `MAX_SUGGESTIONS` (4) actionable suggestions, in priority order:
1. Uncovered targets (first 3 listed).
2. Recurring errors from `repeatedErrors` (first 2).
3. `work_on` items from `coach_review` (first 2; reads `.target` then falls back to `.why`).
4. Emerging (recycle) targets (first 3 listed).

De-duplicates by exact string match; caps at `MAX_SUGGESTIONS`.

## 4. Read-only / no-LLM / no-store invariants

- **No LLM call.** `debrief.py` is stdlib-only and calls no model. The `coachReview` field is a pass-through of the already-cached `analysis_state['coach_review']` (generated by S3.1).
- **No write.** `build_session_debrief` reads from the record dict only; the route handler does not write to `analysis_state` or any collection.
- **Total / no-raise.** Every sub-object access uses defensive helpers (`_d`, `_l`, `_i`). A completely empty or malformed session record yields a valid debrief dict with empty sections and the full `caveats` list.
- **Fail-soft at the route.** If `build_session_debrief` raises unexpectedly, the route catches the exception, logs it, and returns a minimal debrief (`sessionId`, `status`, one-item `caveats`), rather than a 500.

## 5. Help ≠ evidence caveat

`helpUsage.byKind` shows how many times each Ask kind was requested during the session. This is usage data ONLY. An `askCount > 0` or a `byKind["translation"] > 0` does not indicate the learner produced the target form — it indicates they requested scaffolding. The third static caveat string makes this explicit. Do not surface help counts as learning evidence.

## 6. Auth chain

`GET /api/teacher/practice-sessions/<session_id>/debrief`:

1. `debrief_enabled()` → if off, returns `{success: false, error: "Debrief is not enabled."}` (200, no session read).
2. `deps.db.get_practice_session(session_id)` → 404 if not found.
3. `_require_assignment_teacher_access(deps, session_record.get('assignment_id'))` — resolves `session → assignment → class → teacher membership`. Raises `SchoolContextPermissionError` (403) if the authenticated user is not a teacher on the class; raises `ValueError` (404) if the assignment is not found. This is the same auth helper used by other curriculum-admin teacher routes.

## 7. `debriefEnabled` analytics-payload flag + frontend click-through

Three analytics response payloads include a top-level `debriefEnabled: debrief_enabled()` field:
- `GET /api/teacher/assignments/<assignment_id>/analytics`
- `GET /api/teacher/classes/<class_id>/analytics`
- `GET /api/teacher/classes/<class_id>/students/<student_uid>/analytics`

The frontend uses this flag to conditionally render the "View session debrief" click-through link on session rows in the teacher analytics pages. When `debriefEnabled` is `false`, the link is hidden (no dead link). When `true`, clicking navigates to the session debrief route, which calls `GET /api/teacher/practice-sessions/<session_id>/debrief` and renders `SessionDebriefPage`.

## 8. Flag & rollout (REPLACE-safe)

New flag **`PEDAGOGY_ENGINE_DEBRIEF`** (default `'0'`), independent of all other pedagogy flags.

- **REPLACE-safe:** the deploy uses `--set-env-vars=REPLACE`. The flag is now wired in `cloudbuild.yaml` (`--set-env-vars` + `_PEDAGOGY_ENGINE_DEBRIEF: '0'` substitution). Currently **ABSENT (off) in live service**, so default `'0'` is REPLACE-safe.
- **Cutover:** `gcloud run services update lingual-app --project=lingu-480600 --region us-central1 --update-env-vars PEDAGOGY_ENGINE_DEBRIEF=1` → verify the debrief link appears on a session row in teacher analytics → click through and confirm the debrief view loads → bump cloudbuild default `'0'→'1'` for durability.
- **Rollback:** instant via `--update-env-vars PEDAGOGY_ENGINE_DEBRIEF=0` (link disappears, endpoint returns flag-off response, no behavior change).

`debrief_enabled()` in `backend/services/pedagogy/integration.py` reads `PEDAGOGY_ENGINE_DEBRIEF`, mirroring all prior flag helpers.

## 9. Testing

**Deterministic units (gate `make test-backend`)** — `backend/tests/test_pedagogy_engine_s4.py`:
- `build_session_debrief`: full record → all sections populated; empty record → all sections empty + caveats present; malformed sub-objects degrade gracefully; `suggestedNext` capped at `MAX_SUGGESTIONS`; `helpUsage.byKind` always has all 6 keys.
- `_suggested_next`: priority ordering (uncovered first, then errors, then coach_review, then recycle); dedup by exact string; cap.
- `debrief_enabled()`: flag-off returns `False`; `PEDAGOGY_ENGINE_DEBRIEF=1` returns `True`.
- Route: flag-off → `{success: false}` no session read; session not found → 404; non-teacher → 403; valid teacher → `{success: true, debrief: {...}}`.
- **Extended `ImportBoundaryTestCase`** asserts `debrief.py` imports no OpenAI/Canvas/resolver/compliance.

## 10. Deferred follow-ups

**(a) ASR/pronunciation confidence not captured.** The debrief includes a static disclaimer ("Pronunciation and listening accuracy were not separately assessed.") because ASR confidence scores are not persisted into `learning_events` or `session_summary`. There are no per-claim pronunciation caveats — the disclaimer applies globally. Capturing ASR confidence would require the voice client to emit it as a learning event field; deferred.

**(b) `promotions[]` and `ask_log` shown but not aggregated.** The debrief passes through `analysis_state['promotions']` and shows `helpUsage` counts, but does not aggregate them into assignment-level or class-level teacher analytics views. Per-assignment "how often were targets promoted?" and "what expressions did students ask about most?" require a new aggregation layer; deferred.

**(c) `coachReview` is model-verified; other sections are heuristic.** `coachReview` is a pass-through of the S3.1 correction-model output (provenance: `model` field). All other sections (`coverage`, `uptake`, `repeatedErrors`) are derived from heuristic `session_summary` counts. The debrief does not currently visually distinguish model-verified from heuristic evidence — a future UI enhancement could badge `coachReview` differently.

**(d) Within-session affect not captured.** The `affect` field reflects the session-start snapshot from `analysis_state['affect_state']` (computed from prior-session history). No within-session affect update is performed. This mirrors the S4.1 deferred follow-up (c).

---

## Relationship to existing docs

- `PEDAGOGY_ENGINE.md` §14 S4 row — updated to mark **S4.2 BUILT behind `PEDAGOGY_ENGINE_DEBRIEF` (default `'0'`, NOT cut over)**; S4 is now fully built behind flags (affect + debrief).
- `docs/school-integration/TASKS.md` — S4.2 `[x]` BUILT + `[ ]` cutover added.
- `docs/school-integration/LIMITATIONS.md` — #53 S4.2 sub-items added (debrief is a read-only presenter of heuristic evidence; ASR/pronunciation confidence not captured → static disclaimer; help-usage shown as counts only).
- `backend/CLAUDE.md` — pedagogy line updated with `debrief.py`, `debrief_enabled()`, the route endpoint, and `PEDAGOGY_ENGINE_DEBRIEF` flag state.
