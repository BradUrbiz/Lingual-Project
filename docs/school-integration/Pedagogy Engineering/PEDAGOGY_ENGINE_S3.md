# Pedagogy Engine — S3 Conversation Sidecar / Coach Track (detailed design)

**Status:** **S3.1 BUILT 2026-06-23**, behind `PEDAGOGY_ENGINE_COACH_REVIEW` (cloudbuild default `'0'`, NOT yet cut over). S3.2 / S3.3 / S3.4 pending. Sibling to `PEDAGOGY_ENGINE_S1.md` + `PEDAGOGY_ENGINE_S2.md`; realizes the **S3 row** of `PEDAGOGY_ENGINE.md` §14 and the §6.1 / §6.2 coach-track architecture.
**Design spec:** `docs/superpowers/specs/2026-06-23-pedagogy-s3.1-post-task-coach-review-design.md` (approved, pre-implementation). This doc is the as-built record.

---

## 0. TL;DR

`PEDAGOGY_ENGINE.md` §6.2 specifies a **coach track**: a parallel, cheaper correction model that analyzes learner turns and surfaces findings through a learner-facing **Conversation Sidecar** (Feedback + Ask modes), eventually **promoting back** repeated/hard-target errors into the main conversation so the main tutor can go *correction-light* — the structural mitigation for the ~30% voice instruction-adherence ceiling.

That is a **subsystem cluster, not one feature.** It decomposes by **timing × direction** into independently shippable slices. **S3.1 (the post-task review)** is the foundation: it introduces the **correction model, the pedagogy rubric, the false-correction discipline, and the side-channel storage contract** — with no live timing, no two-model coordination, and no split-attention. The later slices reuse S3.1's pure module verbatim.

## 1. S3 cluster decomposition

| Slice | What | Status | Risk |
|---|---|---|---|
| **S3.1** | Post-task correction pass over the finished transcript → read-only **post-task review** panel on both surfaces | ✅ **BUILT 2026-06-23** (flag default off, not cut over) | Low — no live timing, no two-model coordination, no split-attention |
| **S3.2** | Live, silent between-turn coach chips (side channel only, no promote-back) — invokes the **same** `coach_review.py` schema + model + prompt builder, per-turn instead of once at the end | Pending | Medium — real-time transport |
| **S3.3** | Promote-back into the main channel + main tutor goes correction-light (the structural ~30% voice-adherence mitigation) | Pending | High — two-model coordination, voice injection, under/over-promotion |
| **S3.4** | Ask mode (learner-initiated quick help) — largely independent of the correction track | Pending | Low–Medium |

S3.2 reuses this slice's `coach_review.py` schema + model + prompt builder verbatim; the pure module is designed to be called with a single-turn transcript slice without change. That design constraint is why S3.1's correction work lives in a pure module rather than inline in the orchestrator.

---

# S3.1 — Post-Task Coach Review (as built)

## 2. Goal

At the end of an assignment-linked practice session, produce a **model-verified, learner-facing review** — a brief "what went well" plus a prioritized "work on these" list tied to the learner's actual utterances and the assignment's targets — rendered in a read-only panel on both the voice and text practice surfaces. Generated lazily, cached, fail-open, behind a flag.

This is the "accumulated post-task review queue" half of §6.2's Feedback mode (§6.1 step 5: *bundle non-critical errors → post-task summary*). It is the system's **first model-verified analysis** — distinct from the heuristic `learning_events` and the S2 coverage tiers (which are count-based proxies, NOT model-judged — see LIMITATIONS #7/#8 and #53(g)).

## 3. Scope & decisions

**In scope:**
- One **fresh correction-model pass** over the persisted session transcript (not a re-packaging of heuristic `learning_events`).
- A structured `coach_review` artifact stored on `practice_sessions.analysis_state['coach_review']` (invariant 9 — **no new store**).
- A `GET /api/practice-sessions/<id>/coach-review` endpoint that **generates-if-absent** and caches.
- A read-only `PostTaskReviewPanel` shown at session end on both surfaces (voice realtime + text).
- Flag-gated rollout (`PEDAGOGY_ENGINE_COACH_REVIEW`, default off), deterministic unit tests, an opt-in behavioral eval.

**Non-goals (deferred):**
- The **live sidecar chrome** / between-turn chips → S3.2.
- **Promote-back** into the main conversation; main tutor staying correction-light → S3.3.
- **Ask mode** → S3.4.
- **Raw-tutor-mode / free-chat sessions** — no engine targets, no pedagogy guarantees (§5 / LIMITATIONS #53(c)) → `generate_coach_review` returns `None`; the panel renders the empty state. Same gating posture as S2 recycling.
- **Overwriting heuristic analytics.** `coach_review` is *additive*: it never mutates `learning_events`, `session_summary`, or S2 `coverage`.
- **Cross-consumption** of `coach_review` by S2 recycling or the L7 teacher debrief — structured to make that easy later, but S3.1 builds only the learner-facing surface.
- **Cost accounting** folded into `cost_summary` (only provenance fields recorded).
- **`session.ended`-event-driven generation** — the frontend does not reliably fire `session.ended` (voice ends by `disconnect()`; text is open-ended), so generation is **read-triggered** (§6).

## 4. Architecture — pure / impure split (mirrors S2)

```
PURE   backend/services/pedagogy/coach_review.py        (stdlib only — import-boundary clean)
         • CoachReview, ReviewItem, ReviewWin, TargetCoverageItem dataclasses; is_empty() helper
         • build_coach_review_prompt(transcript, targets, feedback_policy, surface, ui_language) -> list[message]
         • parse_coach_review(raw_json, *, feedback_mode, surface) -> CoachReview   (validate/coerce/cap; raises on malformed)
         • serialize_coach_review(review) -> dict
         • work_on depth caps keyed by feedback_mode (fluency_first -> fewer; accuracy_first -> more)

IMPURE backend/services/coach_review_service.py          (orchestrator — imports OpenAI/db)
         • generate_coach_review(deps, bootstrap, uid, session_id) -> dict | None
         • COACH_REVIEW_MODEL = "gpt-5.4-mini-2026-03-17", reasoning_effort="high"

GATE   backend/services/pedagogy/integration.py
         • coach_review_enabled()  (reads PEDAGOGY_ENGINE_COACH_REVIEW; mirrors recycling_enabled())

ROUTE  backend/routes/curriculum_admin.py
         • GET /api/practice-sessions/<session_id>/coach-review  ->  thin wrapper over generate_coach_review

FRONT  frontend/src/api/coachReview.ts                          • getCoachReview(sessionId)
       frontend/src/components/learning/PostTaskReviewPanel.tsx (new, read-only — loading/review/empty)
       frontend/src/components/learning/ReviewLauncher.tsx      (new — open/close + canReview gate)
         • mounts in AssignmentPracticeWorkspace.tsx — shown when !isConnected after a session ends (reviewSessionId)
```

**Why this split:** the import-boundary invariant (`test_pedagogy_engine_s1.ImportBoundaryTestCase`) forbids the `pedagogy/*.py` core modules (`plan`, `routing`, `coverage`, and now `coach_review`) from importing OpenAI / Canvas / resolver / compliance. So the **rubric, prompt template, schema, validation, and depth-capping are pure** (`coach_review.py`); the **transcript fetch + OpenAI call + db snapshot + fail-open wrapping** live in the impure orchestrator (`coach_review_service.py`) — exactly as S2 split `coverage.py` (pure) from its impure aggregator. The test asserts `coach_review.py` imports no OpenAI/Canvas/resolver/compliance.

## 5. Data contract — `analysis_state['coach_review']`

Sits beside S2's `analysis_state['coverage']`. `default_analysis_state()` / `normalize_analysis_state()` (`practice_analytics.py`) carry a `coach_review` key, default `None` (generated on first read when the flag is on).

```jsonc
{
  "generated_at": "<iso8601>",            // stamped by the impure layer
  "model": "gpt-5.4-mini-2026-03-17",     // provenance — marks this as MODEL-VERIFIED (unlike heuristic events)
  "surface": "voice" | "text",
  "wins": [                               // brief, SPECIFIC, anti-sycophancy (concrete not effusive); 1–2 items
    { "text": "You used the past tense correctly when describing your weekend." }
  ],
  "work_on": [                            // prioritized; capped by feedback_mode (§7.3)
    {
      "utterance": "Yo va al tienda",            // learner's ACTUAL words, quoted from transcript (target language)
      "better": "Yo voy a la tienda",            // corrected form (target language)
      "why": "'ir' is irregular: yo voy; and 'tienda' is feminine -> la.",   // explanation in ui_language
      "target": "focus_grammar:present-irregular" | null,   // ties to an assignment target surface when applicable
      "confidence_caveat": false           // true => pronunciation/listening claim softened on low-ASR-confidence audio (voice only)
    }
  ],
  "target_coverage": [                    // which assignment targets were used well vs need work (reuses S2 surface labels)
    { "surface": "expression:ordering food", "status": "used" | "attempted" | "not_attempted" }
  ]
}
```

**Contract invariants:**
- **Locale-parametric.** Utterances/corrections quoted verbatim in the target language; `why` explanations render in the learner's `ui_language`. No hard-coded language (honors the project's language-agnostic rule).
- **Model-verified provenance.** The `model` field marks `coach_review` as the system's first model-verified analysis, distinct from the heuristic `learning_events` (LIMITATIONS #7/#8) and S2 coverage (#53(g)).
- **Additive.** Writing `coach_review` never mutates other `analysis_state` keys.

## 6. Data flow — generate-on-read

```
Learner ends an assignment practice session (AssignmentPracticeWorkspace -> handleEndSession)
  -> workspace captures the ending session id into reviewSessionId; ReviewLauncher shows when !isConnected
  -> learner opens it -> PostTaskReviewPanel mounts -> getCoachReview(sessionId)
     -> GET /api/practice-sessions/<id>/coach-review
        -> generate_coach_review(deps, bootstrap, uid, session_id):
            1. coach_review_enabled()?  no -> return None              (zero reads/LLM when flag off)
            2. load session; cached analysis_state['coach_review']?  yes -> return it   (no LLM call)
            3. assignment-linked + engine targets resolvable?  no -> return None
            4. transcript_ref.chat_id present?  no -> return None
            5. fetch transcript: db.get_chat_session(uid, chat_id).messages
            6. min-turns floor (>=1 substantive learner turn)?  no -> return None
            7. resolve targets + feedback_policy from bootstrap (same path S2 uses)
            8. msgs = build_coach_review_prompt(...)   [pure]
            9. client.chat.completions.create(model=COACH_REVIEW_MODEL, reasoning_effort='high',
                                              response_format={'type':'json_object'}, messages=msgs)
           10. review = parse_coach_review(json.loads(resp), feedback_mode=..., surface=...)   [pure]
           11. snapshot serialize_coach_review(review) into analysis_state['coach_review']
               via deps.db.update_practice_session(session_id, {...}, sql_engine=deps.sql_engine)
           12. return serialized review
            (steps 5–11 wrapped in try/except -> return None; logger.exception; never raises)
        -> {success: True, coachReview: <obj> | null}
  -> Panel renders: loading -> review | empty
```

First open pays the LLM latency (~2–5s) behind a "Generating your review…" state; subsequent opens hit the cache (step 2, no second LLM call).

## 7. Backend detail

### 7.1 `coach_review.py` (pure)
- Dataclasses as in §5, plus an `is_empty()` helper on `CoachReview` (no wins and no work_on).
- `build_coach_review_prompt`: system message states the coach role, the one-focus/anti-sycophancy posture, the surface terseness (voice → terser), and that explanations must be in `ui_language`; the user message carries the transcript (learner + tutor turns), the resolved targets, and the `feedback_policy.mode`. Instructs strict JSON matching the contract.
- `parse_coach_review`: validates types, coerces missing/extra fields, **caps `work_on`** per §7.3, drops items lacking a learner `utterance`, normalizes `target` against the known target surfaces, and on the voice surface honors `confidence_caveat`. Raises `ValueError` on structurally-unusable JSON (caught by the orchestrator → `None`).

### 7.2 `coach_review_service.py` (impure)
- `generate_coach_review(deps, bootstrap, uid, session_id) -> dict | None` per §6. Flag gate **before any read** (so flag-off does zero work). The whole compute body is `try/except Exception: return None` with `logger.exception`. Reuses `deps.get_openai_client()`, `deps.db.get_chat_session`, `deps.db.get_practice_session`, `deps.db.update_practice_session`.
- `COACH_REVIEW_MODEL = "gpt-5.4-mini-2026-03-17"`, `reasoning_effort="high"` — per the project text-LLM convention (`reasoning_effort` composes with `response_format={'type':'json_object'}`).

### 7.3 Depth modulation (no new knob)
Reuses the teacher's existing `feedbackPolicy.mode`:
- `fluency_first` → `work_on` capped at 2; lighter tone.
- `balanced` → capped at 3.
- `accuracy_first` → capped at 4; more explicit corrections.

`wins` is always 1–2 (anti-sycophancy: specific, not effusive).

### 7.4 Gating helper
`coach_review_enabled()` in `backend/services/pedagogy/integration.py`, mirroring `recycling_enabled()` — reads `PEDAGOGY_ENGINE_COACH_REVIEW` (`'1'`/truthy on, absent/empty off). **Independent of the recycling flag.**

### 7.5 Endpoint
`GET /api/practice-sessions/<session_id>/coach-review` in `curriculum_admin.py`, auth-scoped to the owning student. Resolves the assignment bootstrap (same resolver path session-create uses), calls `generate_coach_review`, returns `{success, coachReview}`. **Never 500s on a generation failure** (returns `coachReview: null`).

## 8. Frontend detail

- **`api/coachReview.ts`** — `getCoachReview(sessionId): Promise<CoachReview | null>` via the shared axios `api` client.
- **`components/learning/PostTaskReviewPanel.tsx`** — read-only. Props `{ sessionId }`. States: `loading` ("Generating your review…"), `review` (wins list + work-on cards: utterance → better + why + optional caveat + target chip + target-coverage strip), `empty` (`null` → "No review available for this session.").
- **`components/learning/ReviewLauncher.tsx`** — a small, file-agnostic launcher (props `{ sessionId, canReview, label }`) holding open/close state, rendering `PostTaskReviewPanel` on click; renders nothing without a session / when not reviewable.
- **Mount in `AssignmentPracticeWorkspace.tsx`** (the component owning the assignment practice session — **not** the legacy B2C `AppChatPage.tsx`):
  - The workspace captures the **ending session id** into a `reviewSessionId` state inside `handleEndSession` (the explicit "End session" finish path — NOT `endActivePracticeSession`, which is the abandon-to-restart/resume path), and gates the launcher on `!isConnected`.
  - This offers the review **only after an explicit session end** — never mid-session — so generate-on-read cannot cache a partial transcript. (The workspace does not locally flip session `status` to `completed` on end, so an explicit captured id is used rather than a status check.)
- **Frontend tests (vitest):** `PostTaskReviewPanel` renders all three states; `ReviewLauncher` renders nothing without a session / when not reviewable and opens the panel on click; the `getCoachReview` wrapper.

## 9. Fail-open invariants (§0.1)

Every failure path resolves to `None` / empty — never a 500, never a blocked session: flag off · not assignment-linked · no `chat_id` · empty/thin transcript · OpenAI error/timeout/rate-limit · malformed model JSON (`parse_coach_review` raises → caught). The panel always has a graceful empty state. The gate runs **before** any read, so flag-off is truly zero-cost.

## 10. Flag & rollout — strangler-fig (same cadence as S1/S2)

New flag **`PEDAGOGY_ENGINE_COACH_REVIEW`** (default off), independent of `PEDAGOGY_ENGINE_RECYCLING`:
1. Land code behind the flag, default `'0'`; wire it into `cloudbuild.yaml` `--set-env-vars` + `substitutions` (`_PEDAGOGY_ENGINE_COACH_REVIEW: '0'`). **REPLACE semantics:** the deploy uses `--set-env-vars`, which replaces the whole env set, so the var MUST be listed AND its substitution default MUST match the live value — currently **ABSENT (off)**, so default `'0'` is REPLACE-safe.
2. Deploy inert (flag `'0'`) → verify health.
3. Flip live: `gcloud run services update lingual-app --project=lingu-480600 --region us-central1 --update-env-vars PEDAGOGY_ENGINE_COACH_REVIEW=1`.
4. Burn-in → bump cloudbuild default `'0'→'1'` for durability.
5. **Rollback:** instant via `--update-env-vars PEDAGOGY_ENGINE_COACH_REVIEW=0` (or revision-based `update-traffic`).

## 11. Testing & eval

**Deterministic units (gate `make test-backend`)** — `backend/tests/test_pedagogy_engine_s3.py`:
- `parse_coach_review`: coercion, capping by `feedback_mode`, drop-item-without-utterance, garbage-in raises, `confidence_caveat` handling, `target` normalization.
- `build_coach_review_prompt`: targets present, voice terseness vs text, `ui_language` threaded.
- `generate_coach_review` (fake db/client à la S2's `_RaisingDb`/`_FakeDeps`): flag-off no-read; fail-open (raising db/client → `None`); cached-return (no 2nd LLM call); assignment-only gate; missing-`chat_id` → `None`; min-turns floor.
- **Extended `ImportBoundaryTestCase`** asserts `coach_review.py` imports no OpenAI/Canvas/resolver/compliance.

**Behavioral eval (opt-in `RUN_PEDAGOGY_EVAL=1`, NOT CI)** — `backend/tests/eval/`:
- Seeded-error transcripts at defined proficiency/error profiles → real `gpt-5.4-mini-2026-03-17` → LLM-judge on **false-correction rate** (the §13.2 system-validation metric, measured here for the first time), seeded-error catch rate, and anti-sycophancy (wins specific not effusive). Reuses the S2 eval scaffolding + deterministic `_coerce_judge_verdict` parser. The eval model is **pinned** (no env override) so it cannot accidentally run on a forbidden model.

**Live verify (playwright):** one assignment session per surface (voice + text) → end → open review → confirm model-verified wins/work-on render; confirm flag-off → empty state.

## 12. As-built narrowing vs the design (LIMITATIONS #53 S3.1)

S3.1 ships **single-pass, post-task only, assignment-linked only**; `why` explanations in `ui_language`; **not yet feeding S2 recycling or the L7 teacher debrief** (additive + structured for that later, but the cross-consumption is not wired); and reviewability is bound to the explicit **"End session" finish path** — restart/resume reviewability of an earlier session is a fast-follow. See `LIMITATIONS.md` #53 sub-items (m)–(r).

## 13. Relationship to existing docs (doc-sync targets)

- `PEDAGOGY_ENGINE.md` §14 — S3 row: "S3.1 shipped (post-task review, model-verified); S3.2/S3.3/S3.4 pending."
- `docs/school-integration/TASKS.md` — S3.1 build + flag-wiring/doc-sync items (complete) + S3.1 cutover + S3.2/S3.3/S3.4 (pending).
- `docs/school-integration/LIMITATIONS.md` — #53 sub-items (m)–(r) (the S3.1 constraints).
- `backend/CLAUDE.md` — `pedagogy/` line: add `coach_review.py` (pure) + note `coach_review_service.py` (impure orchestrator) + the `PEDAGOGY_ENGINE_COACH_REVIEW` flag (default off).
- Design spec: `docs/superpowers/specs/2026-06-23-pedagogy-s3.1-post-task-coach-review-design.md`.

## 14. Open questions / future hooks

- **S3.2 reuse:** the live coach track invokes the same `coach_review.py` prompt builder + schema + model per-turn; S3.1's pure module is designed to be called with a single-turn transcript slice without change.
- **S2 / L7 cross-consumption:** `coach_review` is structured (`target_coverage`, model-verified) so S2 recycling could later prefer it over heuristic coverage, and L7 could present it to teachers. Deferred — not built in S3.1.
- **`session.ended` pre-warm:** generation could optionally be pre-warmed when a `session.ended` event *does* fire, so the first read is instant. Deferred optimization; the GET endpoint remains the source of truth.
