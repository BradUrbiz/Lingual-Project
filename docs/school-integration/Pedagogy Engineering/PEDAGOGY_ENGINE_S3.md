# Pedagogy Engine — S3 Conversation Sidecar / Coach Track (detailed design)

**Status:** **S3.1 CUT OVER 2026-06-23** — `PEDAGOGY_ENGINE_COACH_REVIEW=1` live (rev `lingual-app-00075-7p7`, cloudbuild default bumped `0→1`). Prod burn-in verified the review renders end-to-end on the **text** surface (wins / work_on / target_coverage; caught a planted error; fail-open `null` on scaffold-free). The burn-in caught + fixed a cache-persist bug (commit `a509168`; see §"Cache persistence" below). **S3.2 CUT OVER 2026-06-24** — `PEDAGOGY_ENGINE_COACH_CHIPS=1` live (rev `lingual-app-00078-wrc`, cloudbuild default bumped `0→1`; see §"S3.2 as-built cutover" below). **S3.3 BUILT behind flag (`PEDAGOGY_ENGINE_PROMOTE_BACK=0`), NOT yet cut over** (promote-back + correction-light main tutor; see the S3.3 section below). S3.4 pending. Sibling to `PEDAGOGY_ENGINE_S1.md` + `PEDAGOGY_ENGINE_S2.md`; realizes the **S3 row** of `PEDAGOGY_ENGINE.md` §14 and the §6.1 / §6.2 coach-track architecture.
**Design spec:** `docs/superpowers/specs/2026-06-23-pedagogy-s3.1-post-task-coach-review-design.md` (approved, pre-implementation). This doc is the as-built record.

---

## 0. TL;DR

`PEDAGOGY_ENGINE.md` §6.2 specifies a **coach track**: a parallel, cheaper correction model that analyzes learner turns and surfaces findings through a learner-facing **Conversation Sidecar** (Feedback + Ask modes), eventually **promoting back** repeated/hard-target errors into the main conversation so the main tutor can go *correction-light* — the structural mitigation for the ~30% voice instruction-adherence ceiling.

That is a **subsystem cluster, not one feature.** It decomposes by **timing × direction** into independently shippable slices. **S3.1 (the post-task review)** is the foundation: it introduces the **correction model, the pedagogy rubric, the false-correction discipline, and the side-channel storage contract** — with no live timing, no two-model coordination, and no split-attention. The later slices share S3.1's pure module (`coach_review.py`), adding chip-specific pure functions that reuse the same ReviewItem dataclass, rubric constants, and anti-sycophancy/locale rules — not a verbatim reuse of the post-task prompt builder.

## 1. S3 cluster decomposition

| Slice | What | Status | Risk |
|---|---|---|---|
| **S3.1** | Post-task correction pass over the finished transcript → read-only **post-task review** panel on both surfaces | ✅ **CUT OVER 2026-06-23** (`PEDAGOGY_ENGINE_COACH_REVIEW=1` live, default `1`) | Low — no live timing, no two-model coordination, no split-attention |
| **S3.2** | Live, silent between-turn coach chips (side channel only, no promote-back) — same `coach_review.py` module/model/rubric family as S3.1, with chip-specific pure functions (`build_coach_chip_prompt` / `parse_coach_chip` / `serialize_coach_chip`) that reuse ReviewItem + rubric constants + anti-sycophancy/locale rules, per-turn instead of once at the end | ✅ **CUT OVER 2026-06-24** (`PEDAGOGY_ENGINE_COACH_CHIPS=1` live, rev `lingual-app-00078-wrc`, cloudbuild default `1`) | Medium — real-time transport |
| **S3.3** | Promote-back into the main channel + main tutor goes correction-light (the structural ~30% voice-adherence mitigation) | **BUILT behind flag (`PEDAGOGY_ENGINE_PROMOTE_BACK=0`), not cut over** | High — two-model coordination, voice injection, under/over-promotion |
| **S3.4** | Ask mode (learner-initiated quick help) — largely independent of the correction track | Pending | Low–Medium |

S3.2 shares `coach_review.py`'s module, model, and rubric family with chip-specific pure functions (`build_coach_chip_prompt` / `parse_coach_chip` / `serialize_coach_chip`) that reuse the ReviewItem dataclass, rubric constants, and anti-sycophancy/locale rules — not a verbatim reuse of the post-task prompt builder. The pure-module boundary is why S3.1's correction work lives there rather than inline in the orchestrator.

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
           11. re-read session, snapshot serialize_coach_review(review) into analysis_state['coach_review']
               via deps.db.update_practice_session_analysis_state(session_id, state, sql_engine=deps.sql_engine)
           12. return serialized review
            (steps 5–11 wrapped in try/except -> return None; logger.exception; never raises)
        -> {success: True, coachReview: <obj> | null}
  -> Panel renders: loading -> review | empty
```

First open pays the LLM latency (~2–5s) behind a "Generating your review…" state; subsequent opens hit the cache (step 2, no second LLM call).

### 6.1 Cache persistence (post-cutover fix, commit `a509168`)

Step 11 originally wrote via `update_practice_session`. Under the **live retirement flags** (`WRITE_FIRESTORE_ANALYTICS=0` + `DUAL_WRITE_ANALYTICS_EVENTS=1`) that path **self-disables** — its standalone session UPDATE is subsumed by the per-turn `write_turn`, so a flag-on guard short-circuits it. But the coach-review cache write is a **post-task** write with no turn to ride on, so the snapshot was silently dropped and the review **regenerated on every read** (the prod burn-in caught this: two reads returned different `generated_at`). Fix: a dedicated `database.update_practice_session_analysis_state` → `dual_write_analytics.write_session_analysis_state` — a targeted `UPDATE practice_sessions SET analysis_state=…` keyed by `legacy_firestore_id`, **not** gated on the events flag, fail-closed (2000ms); a 0-row update (legacy Firestore-only session) **warns rather than raises**, preserving the fail-open contract (the learner still gets a correct, merely-uncached review). The per-turn self-disable seam is untouched. **S3.2 (per-turn chips) must use this same path, not `update_practice_session`, for any post-hoc `analysis_state` write.**

## 7. Backend detail

### 7.1 `coach_review.py` (pure)
- Dataclasses as in §5, plus an `is_empty()` helper on `CoachReview` (no wins and no work_on).
- `build_coach_review_prompt`: system message states the coach role, the one-focus/anti-sycophancy posture, the surface terseness (voice → terser), and that explanations must be in `ui_language`; the user message carries the transcript (learner + tutor turns), the resolved targets, and the `feedback_policy.mode`. Instructs strict JSON matching the contract.
- `parse_coach_review`: validates types, coerces missing/extra fields, **caps `work_on`** per §7.3, drops items lacking a learner `utterance`, normalizes `target` against the known target surfaces, and on the voice surface honors `confidence_caveat`. Raises `ValueError` on structurally-unusable JSON (caught by the orchestrator → `None`).

### 7.2 `coach_review_service.py` (impure)
- `generate_coach_review(deps, bootstrap, uid, session_id) -> dict | None` per §6. Flag gate **before any of the service's reads** (flag-off ⇒ the service does zero reads/LLM; the route additionally gates bootstrap, so a flag-off request runs only the cheap ownership lookup). The whole compute body is `try/except Exception: return None` with `logger.exception`. Reuses `deps.get_openai_client()`, `deps.db.get_chat_session`, `deps.db.get_practice_session`, `deps.db.update_practice_session`.
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

Every failure path resolves to `None` / empty — never a 500, never a blocked session: flag off · not assignment-linked · no `chat_id` · empty/thin transcript · OpenAI error/timeout/rate-limit · malformed model JSON (`parse_coach_review` raises → caught). The panel always has a graceful empty state. When the flag is off the route gate skips bootstrap and the service gate precedes its reads/LLM, so a flag-off request runs only the cheap session-ownership lookup — no bootstrap, transcript, or LLM.

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

---

# S3.2 — Live Between-Turn Coach Chips (as built)

## S3.2-0. As-built cutover record (2026-06-24)

**Cutover sequence:** deployed inert (rev `lingual-app-00076-xfp`, flag `'0'`) → flipped live `--update-env-vars PEDAGOGY_ENGINE_COACH_CHIPS=1` (rev `00077-d8t`) → during burn-in found the live-chip gate does not fire for Spanish (see Spanish catalog below) → added a Spanish feedback catalog (`practice_analytics._detect_feedback_event_types`) + fixed a bare-"otra vez" false positive → bumped cloudbuild default `0→1` (commit `bc0cbb7`) → rebuilt and deployed (rev `lingual-app-00078-wrc`, image `bc0cbb7`, `PEDAGOGY_ENGINE_COACH_CHIPS=1` durable). All commits pushed to origin/main @ `bc0cbb7`. Rollback instant: `--update-env-vars PEDAGOGY_ENGINE_COACH_CHIPS=0`.

**Spanish feedback catalog (commits `8d44340` + fix `883e8f1`):** `practice_analytics._detect_feedback_event_types` previously carried only generic-English and French pattern catalogs, so Spanish tutor recasts derived no `feedback.*` events → the chip heuristic gate never fired for `es`. Added `SPANISH_ASSISTANT_FEEDBACK_PATTERNS` + `_detect_locale_key` `'es'` + an optional `spanish_catalog` param on `_catalog_patterns`. Now en/fr/es have native feedback catalogs; **ko/ru/he/tl still fall back to generic-English** (no native catalog for those locales) — their live chips rely on generic-English markers or the `metric.repeated_error` path until native catalogs are added. This shared analytics heuristic also feeds S2 coverage + learning_events.

**Burn-in status (honest — do NOT overclaim):** In prod the S3.2 *infrastructure* is confirmed — deploy healthy, the full flow fires in correct order (events → `POST /coach-chip` 200), fail-open holds (no 500s), hydration `GET /coach-chips` returns 200, and the FeedbackSidecar renders its empty state. **A positive chip render was NOT captured in prod:** the live-chip gate depends on the feedback heuristic matching the tutor's (stochastic) correction phrasing; the Spanish test turns drew tutor replies that did not match the finite Spanish recast patterns (e.g. "Casi: … usa quisiera. Di:" vs. patterns like "pequeño ajuste"/"mejor usar"/"se dice"), and the playwright session was then disrupted by a co-resident process. Detection + chip render/merge/hydration are unit-verified (8 Spanish-catalog tests; Task 12 render + race tests). Net: chip generation is heuristic-bounded by design (live heuristic blind spots; S3.1 post-task review is the full-transcript safety net); recommend monitoring real Spanish-session chip rate post-launch and expanding the feedback catalogs as real tutor phrasings are observed.

## S3.2-1. Goal

Between-turn "chips": a silent, heuristic-gated per-turn analysis that surfaces a brief correction or encouragement chip to the learner in the conversation sidecar **after each tutor turn**, without modifying the main tutor's behavior. Chips are additive only (no promote-back — that is S3.3); the main tutor is unchanged.

This is the "live, between-turn side channel" half of §6.2's Feedback mode. It shares the same `coach_review.py` module, model, and rubric family as S3.1, using chip-specific pure functions (`build_coach_chip_prompt` / `parse_coach_chip` / `serialize_coach_chip`) that reuse ReviewItem + rubric constants + anti-sycophancy/locale rules — NOT a verbatim reuse of the post-task prompt builder — called with a single-turn transcript slice instead of the full post-task transcript.

**CUT OVER 2026-06-24 (rev `lingual-app-00078-wrc`, cloudbuild default `'1'`). Rollback: `--update-env-vars PEDAGOGY_ENGINE_COACH_CHIPS=0`.**

## S3.2-2. Scope & decisions

**In scope:**
- Per-turn heuristic gate: a chip is generated only when the current or immediately preceding turn carries a corrective signal (`feedback.recast`, `feedback.elicitation`, `feedback.review_item`, or `metric.repeated_error` at turn N or N+1).
- A structured `coach_chip` artifact stored on `practice_sessions.analysis_state['coach_chips']` (invariant 9 — no new store). Chips are appended per turn; a reload shows the accumulated list.
- `POST /api/practice-sessions/<id>/coach-chip` endpoint: generates a chip for the just-completed turn, persists it via `update_practice_session_analysis_state`, and returns it.
- Voice chips fire after the tutor turn at the between-turn breakpoint (the legal window where the learner is not actively speaking).
- Flag-gated rollout (`PEDAGOGY_ENGINE_COACH_CHIPS`, default off), fail-open (chip generation failure → `null`; the session is never blocked).

**Non-goals (deferred):**
- **Promote-back** into the main conversation; main tutor going correction-light → S3.3.
- **Ask mode** → S3.4.
- The S3.1 post-task review is unaffected; S3.2 chips are additive alongside it.

## S3.2-3. Architecture — pure / impure split (mirrors S3.1)

```
PURE   backend/services/pedagogy/coach_review.py        (same module as S3.1 — chip functions added)
         • build_coach_chip_prompt / parse_coach_chip / serialize_coach_chip   (new functions in the module)

IMPURE backend/services/coach_chip_service.py           (new impure orchestrator — imports OpenAI/db)
         • generate_coach_chip(deps, bootstrap, uid, session_id, turn_index) -> dict | None

GATE   backend/services/pedagogy/integration.py
         • coach_chips_enabled()  (reads PEDAGOGY_ENGINE_COACH_CHIPS; mirrors coach_review_enabled())

ROUTE  backend/routes/curriculum_admin.py
         • POST /api/practice-sessions/<session_id>/coach-chip  ->  thin wrapper over generate_coach_chip
```

**Pure / impure discipline:** `build_coach_chip_prompt`, `parse_coach_chip`, and `serialize_coach_chip` are pure functions added to the existing `pedagogy/coach_review.py` (stdlib only, import-boundary clean). The impure orchestrator (`coach_chip_service.py`) handles the per-turn heuristic check, the single-turn transcript slice, the OpenAI call (same model + reasoning effort as S3.1), and the `analysis_state` snapshot via `update_practice_session_analysis_state` (the same dedicated path the S3.1 cache-persist fix introduced — not `update_practice_session`, which self-disables under the live `DUAL_WRITE_ANALYTICS_EVENTS=1`).

## S3.2-4. Heuristic gate

A chip is generated only when the turn carries a corrective signal. The gate is a **necessary condition, not a sufficient one**: it bounds live coverage to turns where the heuristic stream already detected an error, elicitation, or repeated mistake. Turns the heuristic stream misses receive no chip — the S3.1 post-task review is the full-transcript safety net for heuristic blind spots.

Gating signals (checked at turn N or the immediately preceding turn N+1 context):
- `feedback.recast`
- `feedback.elicitation`
- `feedback.review_item`
- `metric.repeated_error`

## S3.2-5. Data contract — `analysis_state['coach_chips']`

Sits beside S3.1's `analysis_state['coach_review']` and S2's `analysis_state['coverage']`.

```jsonc
// analysis_state['coach_chips'] is a FLAT LIST — no "chips" wrapper
[
  {
    "turn_index": 7,
    "generated_at": "<iso8601>",
    "model": "gpt-5.4-mini-2026-03-17",
    "surface": "voice" | "text",
    "utterance": "<learner's actual words, target language>",
    "better": "<corrected form, target language>",
    "why": "<explanation in ui_language>",
    "target": "focus_grammar:present-irregular" | null,
    "confidence_caveat": false
  }
]
```

New chips are appended; the list accumulates across the session. Cache persistence to be verified during cutover burn-in (a second chip on a later turn appends; reload shows persisted chips).

## S3.2-6. Fail-open invariants

Every failure path resolves to `null` / no chip — never a 500, never a blocked session: flag off · heuristic gate miss · not assignment-linked · no transcript slice · OpenAI error/timeout · malformed JSON. The same `update_practice_session_analysis_state` path used by S3.1 ensures the write does not self-disable under the live analytics flags.

## S3.2-7. As-built narrowing vs. the design (LIMITATIONS #53 S3.2)

See `LIMITATIONS.md` #53 sub-items (s)–(v).

---

## 13. Relationship to existing docs (doc-sync targets)

- `PEDAGOGY_ENGINE.md` §14 — S3 row: "S3.1 shipped (post-task review, model-verified); S3.2 CUT OVER 2026-06-24 (live chips, `PEDAGOGY_ENGINE_COACH_CHIPS=1`, default `1`); S3.3 BUILT behind flag (`PEDAGOGY_ENGINE_PROMOTE_BACK=0`), not cut over; S3.4 pending."
- `docs/school-integration/TASKS.md` — S3.1 build + flag-wiring/doc-sync items (complete) + S3.1 cutover + S3.2 build item (complete) + S3.2 cutover (complete) + S3.3 build item (complete, behind flag) + S3.3 cutover (pending) + S3.4 (pending).
- `docs/school-integration/LIMITATIONS.md` — #53 sub-items (m)–(r) (the S3.1 constraints) + sub-items (s)–(v) (the S3.2 constraints) + sub-items (w)–(aa) (the S3.3 constraints).
- `backend/CLAUDE.md` — `pedagogy/` line: chip pure functions in `coach_review.py` + `coach_chip_service.py` (impure orchestrator) + `PEDAGOGY_ENGINE_COACH_CHIPS` flag (LIVE, default `'1'`, cut over 2026-06-24) + `promote_back.py` (pure decision module) + `PEDAGOGY_ENGINE_PROMOTE_BACK` flag (BUILT, default `'0'`, not cut over).
- Design spec: `docs/superpowers/specs/2026-06-23-pedagogy-s3.1-post-task-coach-review-design.md`.

## 14. Open questions / future hooks

- **S3.2 cutover:** DONE 2026-06-24 (rev `lingual-app-00078-wrc`, cloudbuild default `'1'`). See §S3.2-0 for the full cutover sequence, Spanish catalog, and burn-in status. Post-launch: monitor Spanish-session chip rate and expand feedback catalogs as real tutor phrasings are observed; add native catalogs for ko/ru/he/tl when sufficient tutor-phrase samples exist.
- **S3.3 cutover (pending):** deploy inert (flag `'0'`, verify prompt byte-identical) → `gcloud run services update ... --update-env-vars PEDAGOGY_ENGINE_PROMOTE_BACK=1` → text burn-in (drive a repeated error past threshold → confirm correction-light tutor + in-thread promote-back) → bump cloudbuild default `0→1` for durability → doc-sync the cutover. Voice burn-in limited by the WebRTC-mic constraint (shared with S3.1/S3.2). Rollback: `--update-env-vars PEDAGOGY_ENGINE_PROMOTE_BACK=0`.
- **S2 / L7 cross-consumption:** `coach_review` is structured (`target_coverage`, model-verified) so S2 recycling could later prefer it over heuristic coverage, and L7 could present it to teachers. Deferred — not built in S3.1. Note: S3.3's `promotions[]` list on `analysis_state` is also structured for future S2/L7 consumption — not wired yet (LIMITATIONS #53(aa)).
- **`session.ended` pre-warm:** generation could optionally be pre-warmed when a `session.ended` event *does* fire, so the first read is instant. Deferred optimization; the GET endpoint remains the source of truth.

---

# S3.3 — Promote-Back + Correction-Light (as built)

**Status: BUILT behind `PEDAGOGY_ENGINE_PROMOTE_BACK` (default `'0'`). NOT cut over — flag is off in prod. Cutover is a separate post-merge step (see §14 above).**

## S3.3-1. Goal

When the coach chip stream detects a repeated or hard-target error, **promote it back** into the main tutor's context so the main tutor can address it directly — and simultaneously put the main tutor into a **correction-light stance** (dropping the correction ladder for the session) so correction authority moves to the coach track rather than competing. This is the structural mitigation for the ~30% voice instruction-adherence ceiling: the promote-back message is injected in-character (voice: avatar-context pattern; text: a `coachNote` prepended to the learner's next turn) so the main tutor receives it as part of its normal context, not as an out-of-band interrupt.

## S3.3-2. Architecture — pure / impure split

```
PURE   backend/services/pedagogy/promote_back.py          (stdlib only — import-boundary clean)
         • PromoteDecision{promote, signature, reason} dataclass
         • decide_promote_back(promote_state, chip, feedback_policy, turn_index)
             -> (PromoteDecision, updated_promote_state dict)
         • build_promote_prompt(chip, surface) -> str   (in-character inject string)
         • Recurrence counter + mode-modulated thresholds:
             fluency_first ≥3 · balanced ≥2 · accuracy_first ≥2
         • Three guards: cooldown (no promote on consecutive turns),
             per-session cap (≤3 promotes/session), reset-on-promote (counter resets)

GATE   backend/services/pedagogy/integration.py
         • promote_back_enabled()  (reads PEDAGOGY_ENGINE_PROMOTE_BACK; two-flag invariant:
           returns True ONLY when BOTH PEDAGOGY_ENGINE_PROMOTE_BACK=1 AND PEDAGOGY_ENGINE_COACH_CHIPS=1)

WIRING rides the existing S3.2 chip round-trip (no new endpoint, no 2nd LLM call):
         • coach_chip_service.py — after generating a chip, calls decide_promote_back;
           the PromoteDecision is merged into the chip dict as promote / promote_prompt / promote_reason
         • Voice surface (AssignmentPracticeWorkspace): if chip.promote=true, injects
           promote_prompt into the realtime session via injectPromoteBack(prompt) using
           the avatar-context pattern (in-character, not an out-of-band interrupt)
         • Text surface (chat.py): if chip.promote=true, prepends a coachNote to the
           learner's next turn message body (next-turn injection)
```

**No new endpoint and no second LLM call.** The promote decision is purely algorithmic (`promote_back.py` is stdlib-only) and rides the existing chip POST/GET round-trip. The chip gains three new fields: `promote` (bool), `promote_prompt` (str | null — the in-character inject string), `promote_reason` (str | null — the matched error signature, for logging/debrief).

## S3.3-3. Data contract additions

`analysis_state` gains two new keys alongside `coach_review` and `coach_chips`:

```jsonc
// analysis_state['promote_back_state'] — mutable per-session promote tracker
{
  "recurrence_counts": {"<error_signature>": <int>},  // per-error hit counter
  "last_promote_turn": <int> | null,                   // for cooldown guard
  "session_promote_count": <int>                       // for per-session cap guard
}

// analysis_state['promotions'] — flat list, one entry per promote decision
[
  {
    "turn_index": <int>,
    "error_signature": "<str>",
    "promote_prompt": "<str>",
    "surface": "voice" | "text"
  }
]
```

Chip fields added by S3.3 (merged into the `coach_chips` list entry):
- `promote`: `true` if this chip triggered a promote-back, `false` otherwise
- `promote_prompt`: the in-character inject string (null when promote=false)
- `promote_reason`: the matched error signature (null when promote=false)

## S3.3-4. Correction-light stance

When `promote_back_enabled()` is true, `render_assignment_prompt` (and `resolve_assignment_system_prompt` for voice) receives `correction_light=True` and drops the correction-ladder section from the tutor stance. The main tutor is no longer instructed to correct directly — correction authority moves to the coach track's promote-back injection. This is a **two-flag safety invariant**: correction-light only engages when BOTH `PEDAGOGY_ENGINE_PROMOTE_BACK=1` AND `PEDAGOGY_ENGINE_COACH_CHIPS=1` are live (`promote_back_enabled()` enforces this). With the flag off (default `'0'`), the prompt is byte-identical to today — no behavior change whatsoever.

## S3.3-5. Fail-open invariants

Every failure path resolves to `promote=false` on the chip — never a 500, never a blocked session. `decide_promote_back` is a pure stdlib function (no I/O, no raises on normal input). If the chip generation itself fails, no promote decision runs (fail-open from S3.2). If the promote state write fails, the session continues without updated tracking state (the per-session cap guard will still fire from the last persisted state). The two-flag invariant means correction-light cannot engage without the chip side-channel also being live.

## S3.3-6. As-built narrowing (LIMITATIONS #53 S3.3)

See `LIMITATIONS.md` #53 sub-items (w)–(aa).
