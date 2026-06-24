# Pedagogy Engine S5 — The Director (between-turn drift re-steer) — Design

**Status:** Design / approved by controller (autonomous build per the standing directive). Next: writing-plans.
**Date:** 2026-06-24
**What:** S5 — the Director (L4 runtime): between-turn detection of tutor **instruction-adherence drift** plus an in-character **re-steer**, built behind `PEDAGOGY_ENGINE_DIRECTOR` (default off). Cutover stays gated on the S5-gate eval verdict.
**Why now:** The standing directive is to build the engine through its full defined scope. The S5-gate eval instrument is built (`docs/.../2026-06-24-pedagogy-s5-gate-eval-design.md`) but cannot be run here (no LLM key). Per the precedent set by S3.3/S3.4/S4.1/S4.2, **building behind a default-off flag is decoupled from cutover** — the eval gate governs *activation*, not code existence (§15's cathedral-risk is about *shipping unproven complexity*, not code that is inert behind a flag). So we build S5 inert; the eval verdict (when run) decides the flip.

---

## 0. TL;DR

The realtime voice tutor's instruction adherence decays as turns stack (the "~30% ceiling, worsens as instructions accumulate", §6.2). The Director is the engine layer that watches the conversation **between turns** and, when the tutor has drifted off the lesson, slips an in-character corrective note into the next turn so the tutor recovers on its own.

**v1 scope: one robust, locale-agnostic drift signal — _target-neglect_.** When the tutor spends a window of consecutive turns in generic chat without ever working toward a concrete assignment target, that is the canonical "the assignment stopped happening" failure. It is detectable by pure substring matching of target surfaces across recent tutor turns — works for all six locales, costs nothing (no LLM), and has a low false-positive rate behind a window + cooldown + per-session cap.

The Director **reuses three proven seams** rather than inventing new ones:
- the existing **between-turn coach-chip round-trip** (`POST /api/practice-sessions/<id>/coach-chip`, already fired every assistant turn on voice and every send on text) — the Director rides the same POST as a parallel, independently-gated assessment;
- the **`injectPromoteBack` channel** (S3.3 — `conversation.item.create` system message + `response.create`) for the voice re-steer;
- the **`coachNote` channel** (S3.3 — transient system message on the next text send) for the text re-steer.

Pure heuristic, fail-open, **byte-identical to today when the flag is off**.

---

## 1. Scope

### In scope
1. **Pure `backend/services/pedagogy/drift.py`** — the live detector + the act-decision (guards). stdlib-only, import-boundary-clean, CI-tested. *Independent of the offline eval module* (see §9).
2. **Impure `backend/services/director_service.py`** — `assess_drift(...)`, the fail-open orchestrator that reads the session + transcript, runs the pure detector, applies the pure decision, persists, and returns a re-steer payload. Mirrors `coach_chip_service.generate_coach_chip` structure.
3. **Route wiring** — extend `POST /api/practice-sessions/<id>/coach-chip` to also run `assess_drift` (when `director_enabled()`) and return `resteer` alongside `coachChip`. Extend the `chat.py` `coachNote` gate so a Director re-steer note is honored on text when the Director flag is on.
4. **Flag + persistence** — `director_enabled()` reading `PEDAGOGY_ENGINE_DIRECTOR`; additive `analysis_state` keys `director_state` (guard bookkeeping) + `resteers` (durable audit log); `cloudbuild.yaml` substitution `_PEDAGOGY_ENGINE_DIRECTOR:'0'`.
5. **Frontend** — `triggerCoachChip` routes a returned `resteer` through the *same* voice/text injection channels it already uses for `promote`. `postCoachChip` return shape widened to `{ chip, resteer }`.
6. **Docs** — `PEDAGOGY_ENGINE_S5.md` (Director built behind flag), `backend/CLAUDE.md`, `TASKS.md`, `LIMITATIONS.md` (v1 = target-neglect only).

### Non-goals (v1)
- **Language-drift detection** (tutor slipping into English): valuable but locale-fragile — reliable detection needs per-locale script/marker logic (Hangul/Cyrillic/Hebrew char ratio for ko/ru/he; English-marker density for es/fr; tl is Latin-script and hard). Deferred to a follow-up; the offline eval already covers the full dimension set.
- **The other adherence dimensions** (`correction_posture`, `one_focus`, `anti_sycophancy`, `no_answer_dump`): these need an LLM judge to detect reliably — that judge is the *offline* eval, not the live per-turn path.
- **A per-turn LLM judge in production** (the offline eval's approach): the live path stays heuristic for the same cost/latency reasons S2 and S4.1 are heuristic. Explicitly rejected (§2 approach 1).
- **Cutover.** This ships inert. The S5-gate eval verdict (when run) decides the flip.
- **Mid-session `session.update` of instructions.** §14 named `session.update` as the mechanism, but the codebase never wires `session.update` for instructions (only `audio.output.speed`); the proven mid-session steering channel is `conversation.item.create` + `response.create` (`injectPromoteBack`). We reuse that. (Documented deviation; see §7.)

---

## 2. Approaches considered

1. **LLM-judge-per-turn live Director** — mirror the offline eval's judge live: score all six adherence dimensions with an LLM every turn, re-steer on any drift. **Rejected:** a second LLM call every turn is exactly the "+latency/cost, prove first" the gate frets about; inconsistent with the heuristic posture of S2/S4.1; the chip already spends the per-turn LLM budget and is itself heuristic-gated.
2. **Heuristic target-neglect Director (CHOSEN)** — one robust, locale-agnostic signal (tutor abandoning concrete targets over a window), detected by pure substring matching, riding the existing round-trip + injection channels. Cheap, fail-open, low false-positive, extensible. Genuinely *is* S5 (between-turn drift detection + realtime re-steer); the signal set starts minimal (every slice did — S1 was "one behavior win") and grows.
3. **Multi-signal heuristic Director up front** (target-neglect + language-drift + …) — **rejected for v1:** language-drift is locale-fragile (catalog-style work), and the remaining dimensions need the LLM. Ship the one robust signal; add others as eval-gated follow-ups.

---

## 3. Architecture — pure / impure split (mirrors every prior slice)

```
PURE   backend/services/pedagogy/drift.py            (stdlib only — CI-tested, import-boundary enforced)
         • DriftVerdict          dataclass: drift, kind, target, reason
         • detect_target_neglect(recent_tutor_turns, concrete_targets, *, window) -> DriftVerdict
         • ResteerDecision       dataclass: resteer, reason, target, signature
         • decide_resteer(director_state, verdict, turn_index) -> (ResteerDecision, new_state)   (cooldown + per-session cap)
         • build_resteer_prompt(verdict, *, surface) -> str        (in-character corrective note)
         • serialize_resteer(decision, *, turn_index, surface, prompt) -> dict
         • constants: DRIFT_WINDOW=3, DIRECTOR_COOLDOWN_TURNS=4, DIRECTOR_MAX_RESTEERS=3

IMPURE backend/services/director_service.py          (reads session + transcript; NO LLM)
         • assess_drift(deps, bootstrap, uid, session_id, turn_index) -> dict | None
             gate director_enabled() → fail-open try → validate → get session →
             concrete targets (expr+vocab) → fetch transcript window → recent tutor turns →
             detect_target_neglect → decide_resteer → re-read-before-write persist → payload | None

ROUTE  curriculum_admin.py  POST /api/practice-sessions/<id>/coach-chip
         resolve bootstrap if (coach_chips_enabled() OR director_enabled());
         chip   = generate_coach_chip(...) if coach_chips_enabled()
         resteer = assess_drift(...)        if director_enabled()
         return { success, coachChip: chip, resteer }

ROUTE  chat.py  POST /api/chats/<id>/messages   (text re-steer transport)
         honor coachNote when: coach_note_allowed AND
           ((promote_back_enabled() AND coach_chips_enabled()) OR director_enabled())

FRONTEND AssignmentPracticeWorkspace.triggerCoachChip
         const { chip, resteer } = await postCoachChip(...)
         (chip handling unchanged)
         if (resteer?.resteer_prompt) → voice: injectPromoteBackRef; text: pendingPromoteBackRef
```

**Why a parallel service, not folded into `generate_coach_chip`:** the chip is *heuristic-gated* — it returns `None` early unless the turn had a **learner** corrective signal, to spend the LLM only when needed. Tutor drift happens **regardless of learner error**, so the Director cannot live behind that gate. It runs on every between-turn trigger (cheaply — pure heuristic, no LLM) as an independent, independently-flagged, fail-open service.

---

## 4. The detector (pure — `detect_target_neglect`)

**Inputs:**
- `recent_tutor_turns: list[str]` — the content of the most recent *assistant* turns, oldest→newest (from the transcript window; see §5).
- `concrete_targets: list[str]` — `targetExpressions + targetVocabulary` (concrete, substring-matchable). **Grammar targets are excluded** — `focusGrammar` items like "ser vs estar" are abstract labels, not literal strings the tutor utters, so substring matching them is meaningless and false-positive-prone.
- `window: int = DRIFT_WINDOW` (3).

**Rule:**
- If `len(concrete_targets) == 0` → `DriftVerdict(drift=False, ...)` (cannot detect neglect with no concrete surface; the impure layer short-circuits earlier too).
- If `len(recent_tutor_turns) < window` → `drift=False` (not enough evidence yet — early turns are not drift).
- Take the last `window` tutor turns. If **any** of them contains **any** concrete target as a case-insensitive substring → `drift=False` (the lesson is live).
- Else → `drift=True`, `kind="target_neglect"`, `target=` the first concrete target **not referenced anywhere in the window** (the most clearly neglected one; falls back to `concrete_targets[0]` if all happen to be absent), `reason="no target referenced in the last {window} tutor turns"`.

**Why a window, not a single turn:** a single off-target tutor turn is normal (rapport, scaffolding, a clarifying question). Drift is *sustained* neglect. `window=3` tutor turns ≈ the last ~3 exchanges — long enough that a brief digression doesn't trip it, short enough to catch real abandonment.

Matching is whitespace-insensitive at the edges and case-insensitive; no stemming (v1 keeps it literal and predictable — a documented limitation, not a bug).

---

## 5. The orchestrator (impure — `assess_drift`)

Mirrors `generate_coach_chip` step-for-step:

1. `from ...integration import director_enabled` — `if not director_enabled(): return None`.
2. `try:` (the whole body is fail-open — any exception logs and returns `None`; the live conversation is never blocked).
3. Validate `bootstrap and uid and session_id and turn_index is not None`.
4. `session = deps.db.get_practice_session(session_id)`; must be a dict.
5. `mapping = bootstrap["mapping"]`; `concrete_targets = string_list(targetExpressions) + string_list(targetVocabulary)`. If empty → `return None`.
6. `analysis_state = normalize_analysis_state(session["analysis_state"])`. **Dedup:** if a resteer is already logged for `turn_index` in `analysis_state["resteers"]`, return that record (one assessment outcome per turn).
7. **Transcript window** — reuse the chip's exact path: `transcript_ref → chat_id → deps.db.get_chat_session(uid, chat_id) → messages`; take the last `TRANSCRIPT_WINDOW` (6) messages; extract `content` of the `assistant`-role ones, oldest→newest, as `recent_tutor_turns`. *(Not `analysis_state["recent_turns"]` — that is maintained on the async learning-event rollup path and lags the synchronous transcript save, so it can be stale at assess time.)*
8. `surface = "voice" if "voice" in session.modality else "text"`.
9. `verdict = detect_target_neglect(recent_tutor_turns, concrete_targets)`. If `not verdict.drift → return None`.
10. `decision, new_state = decide_resteer(analysis_state.get("director_state"), verdict, turn_index)`.
11. **Re-read before write** (S3.1 lesson): `fresh = deps.db.get_practice_session(session_id)`; recompute `target_state`; re-check the per-turn dedup against the fresh `resteers`.
12. `target_state["director_state"] = new_state`. If `decision.resteer`: build `resteer_prompt = build_resteer_prompt(verdict, surface=surface)`, append a record to `target_state["resteers"]`, and set the return payload. Persist via `deps.db.update_practice_session_analysis_state(session_id, target_state, sql_engine=deps.sql_engine)`.
13. Return `{turn_index, surface, resteer: True, resteer_prompt, kind, target, reason, generated_at}` when fired, else `None`.

**No LLM, no OpenAI client.** The only I/O is two reads (session, re-read) + the transcript read + one analysis_state write (only when state changes). When the flag is off, step 1 returns immediately — zero work beyond the route's ownership read.

### `decide_resteer` guards (pure — mirrors `decide_promote_back`)
- If `not verdict.drift` → `(ResteerDecision(resteer=False, ...), state_unchanged)`.
- **Cooldown:** if `last_resteer_turn` is set and `turn_index - last_resteer_turn < DIRECTOR_COOLDOWN_TURNS` → suppress (give the prior re-steer time to land). State unchanged.
- **Per-session cap:** if `resteer_count >= DIRECTOR_MAX_RESTEERS` → suppress (don't nag). State unchanged.
- Otherwise → `resteer=True`; `new_state = {last_resteer_turn: turn_index, resteer_count: resteer_count + 1}`; `signature = f"target_neglect:{verdict.target}"`.

---

## 6. Persistence (additive `analysis_state` keys)

Two new keys in `default_analysis_state()` + `normalize_analysis_state` (practice_analytics.py), mirroring `promote_back_state` / `promotions`:
- `director_state: {}` — `{last_resteer_turn: int, resteer_count: int}`; `{}` until the first drift candidate. (`dict` guard in normalize.)
- `resteers: []` — durable audit log of fired re-steers `{turn_index, kind, target, reason, prompt, surface, generated_at}`; **never re-injected on hydration** (like `promotions`). (`list` guard in normalize.)

No new collection, no schema change — additive keys only, consistent with the migration's "no new persistence system" rule.

---

## 7. Re-steer delivery (reusing proven channels)

**Voice** — `triggerCoachChip` already calls `injectPromoteBackRef.current?.(chip.promote_prompt)` for a promote. For a resteer it calls the *same* ref with `resteer.resteer_prompt`. `injectPromoteBack` (useRealtimeChat.ts:727) pushes `{systemMessage: prompt}` to `queuedAvatarContextsRef` and flushes at the next response breakpoint — the tutor weaves the correction into its next turn in its own words. **No change to `useRealtimeChat`.**

**Text** — `triggerCoachChip` stashes `resteer.resteer_prompt` in `pendingPromoteBackRef` (same ref the promote uses); the next text send attaches it as `coachNote` (AssignmentPracticeWorkspace.tsx:1089). The backend `chat.py` gate must additionally honor a coachNote when `director_enabled()` (today it requires `promote_back_enabled() AND coach_chips_enabled()`). The note is still `[:500]`-capped and transient (one turn, never persisted into chat history).

**Both-fire edge case:** if a turn produces *both* a promote (from the chip) and a resteer, voice queues two system notes (both flush — fine); text's single `coachNote` is last-writer-wins (the resteer, set after the chip in `triggerCoachChip`). Acceptable for v1 given the cooldown makes resteers sparse and a corrective-signal turn rarely coincides with sustained target-neglect; documented in LIMITATIONS.

**`build_resteer_prompt` copy** (surface-tuned, in-character, anti-lecture):
- text: `"COACH NOTE: the last few exchanges drifted off the lesson. In your next reply, naturally create a reason for the learner to use «{target}» — weave it into the scene; don't announce it or lecture."`
- voice: same intent, phrased for the avatar-context pattern (one or two sentences, no markdown).

---

## 8. Error handling & flag discipline

- **Flag off → byte-identical:** `director_enabled()` returns immediately in `assess_drift`; the route only calls it when the flag is on; `chat.py`'s gate adds an OR-clause that is `False` when the flag is off; the frontend simply receives `resteer: null`. No prompt, no DB write, no behavior change when off — verified by a test asserting `assess_drift` returns `None` and persists nothing with the flag off.
- **Fail-open everywhere:** every layer degrades to "no re-steer" on any error — the route already returns `{success: True, coachChip: None}` on exception; `assess_drift`'s body is one big try; the frontend `triggerCoachChip` is wrapped in try/catch.
- **REPLACE-safety (cloudbuild):** `PEDAGOGY_ENGINE_DIRECTOR` is a *new* var, absent in live prod → adding it to the `--set-env-vars` REPLACE string with default `'0'` is safe (matches the live absent≈off state); no other substitution default is touched. Verify live env before any build (per the deploy memory).
- **Two reads on the live path when on:** `get_practice_session` (×2, dedup re-read) + `get_chat_session` (×1) per turn. Cheap; only when the flag is on. No LLM.

---

## 9. Why the offline eval module is NOT relocated

The S5-gate eval's pure module `backend/tests/eval/adherence_drift.py` (`coerce_adherence_verdict` / `score_turn` / `aggregate_drift` / `ADHERENCE_DIMENSIONS`) exists for the **offline LLM-judge** path. The live Director's detector is an **independent heuristic** that does not import or reuse any of it. Therefore the "a production service imports from tests/" smell does **not** arise, and relocating would only mix eval-scoring into the live engine package for a code-share that doesn't exist (YAGNI). Decision: **leave the eval module untouched**; create a fresh pure `pedagogy/drift.py` for the live detector. (This revises the earlier exploration note that assumed the service would import the eval logic.)

---

## 10. Testing

**Pure (`test_drift.py`, CI-gated, zero cost):**
- `detect_target_neglect`: no concrete targets → drift=False; fewer than `window` turns → drift=False; a target referenced in the window → drift=False; `window` turns all off-target → drift=True with the neglected target chosen; case-insensitive + whitespace-edge match.
- `decide_resteer`: no drift → no resteer, state unchanged; first drift → resteer=True, state set; within cooldown → suppressed; cap reached → suppressed; signature shape.
- `build_resteer_prompt`: contains the target, is non-empty, surface-tuned (text vs voice differ); no markdown in voice.
- import-boundary: add `pedagogy.drift` to `test_pedagogy_engine_s1.ImportBoundaryTestCase`'s enforced list (no openai/canvas/resolver/compliance import).

**Impure (`test_director_service.py`):**
- flag off → `None`, no `update_practice_session_analysis_state` call.
- flag on + drift in fakes → returns a resteer payload, persists `director_state` + appends `resteers`.
- flag on + lesson live (target in window) → `None`.
- dedup: a second call for the same `turn_index` returns the existing record, no double-append.
- fail-open: `get_practice_session` raises → `None` (no exception escapes).
- no concrete targets (grammar-only assignment) → `None`.

**Route (`test_curriculum_admin_routes.py` or the coach-chip route test):**
- director on → response carries `resteer`; chip path unchanged (chip still computed independently).
- director off → `resteer: null`.

**Chat gate (`test_realtime_chat.py` text path):**
- director on (promote/chips off) + assignment-linked coachNote → injected as a system message before the user turn.
- all re-steer flags off → coachNote ignored (existing test still passes).

**Frontend (`AssignmentPracticeWorkspace.test.tsx`):**
- `postCoachChip` mock returns `{ chip: null, resteer: {surface:'text', resteer_prompt} }` → next text send carries the coachNote.
- voice `{ chip: null, resteer: {surface:'voice', resteer_prompt} }` → `injectPromoteBack` called with the prompt.
- existing chip tests updated to the new `{ chip, resteer }` return shape (mechanical migration).

---

## 11. Files

| File | Change |
|---|---|
| `backend/services/pedagogy/drift.py` | **new** — pure detector + decision + prompt + serializer + constants |
| `backend/services/director_service.py` | **new** — impure `assess_drift` orchestrator (no LLM) |
| `backend/services/pedagogy/integration.py` | add `director_enabled()` |
| `backend/services/practice_analytics.py` | `default_analysis_state` + `normalize_analysis_state`: add `director_state`/`resteers` |
| `backend/routes/curriculum_admin.py` | extend coach-chip route: resolve bootstrap if either flag; call `assess_drift`; return `resteer` |
| `backend/routes/chat.py` | widen the `coachNote` gate with `OR director_enabled()` |
| `frontend/src/api/coachChips.ts` | `postCoachChip` returns `{ chip, resteer }`; add `Resteer` interface |
| `frontend/src/components/assignments/AssignmentPracticeWorkspace.tsx` | `triggerCoachChip`: route `resteer` through the existing voice/text channels |
| `cloudbuild.yaml` | add `_PEDAGOGY_ENGINE_DIRECTOR:'0'` (substitutions block + `--set-env-vars` REPLACE string) |
| tests | `test_drift.py`, `test_director_service.py`, route + chat-gate + frontend test updates, ImportBoundary list |
| docs | `PEDAGOGY_ENGINE_S5.md`, `backend/CLAUDE.md`, `TASKS.md`, `LIMITATIONS.md` |

---

## 12. Follow-ups (logged)
- **Run the S5-gate eval** to produce the activation verdict (needs an LLM key + deliberate cost). The verdict + real post-cutover field data decide the `PEDAGOGY_ENGINE_DIRECTOR=1` flip.
- **Language-drift signal** (per-locale: non-Latin script ratio for ko/ru/he; English-marker density for es/fr; tl deferred) — the second Director signal.
- **The LLM-judged dimensions** (`correction_posture`, `one_focus`, `anti_sycophancy`, `no_answer_dump`) — if field evidence shows they drift, a heuristic or a cost-bounded sampled-LLM detector.
- **Stemming / inflection-aware target matching** — v1 is literal substring; a learner-facing target can appear inflected (conjugated verb, pluralized noun) and be missed. Revisit if false-negatives show up.
- **Cooldown/cap tuning** — `DRIFT_WINDOW`/`DIRECTOR_COOLDOWN_TURNS`/`DIRECTOR_MAX_RESTEERS` are first-guess constants; tune against real sessions post-cutover.
