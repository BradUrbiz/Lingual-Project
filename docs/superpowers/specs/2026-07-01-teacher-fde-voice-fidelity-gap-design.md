# Teacher FDE — Voice Fidelity Gap Measurement — Design

Status: Draft — internal measurement instrument (backend-only), behind `PEDAGOGY_ENGINE_VOICE_FIDELITY` (default off). Not a teacher-facing feature.
Date: 2026-07-01
Owner: Product + Engineering
Related: `docs/school-integration/teacher-fde/` (Phase 1 Observability, the fast-follow "modality split"); the Alignment View (`PEDAGOGY_ENGINE_ALIGNMENT_VIEW`) and Uptake Trace (`PEDAGOGY_ENGINE_UPTAKE_TRACE`) it extends.

## 1. Goal

Phase 1's realized/uptake signal answers *"which lexical targets did the conversation elicit?"* by counting hit events. The design-partner reality is that **production happens mostly in voice** — yet the hit detector runs on ASR transcripts, which lose production two ways the identical typed turn would not (see §3). The realized/uptake view therefore **structurally under-counts the dominant modality**, and a naive voice-vs-text split built on those counts would read as an *unfair comparison* — it could tell a teacher "voice isn't producing targets" when a chunk of that gap is a measurement artifact.

This spec builds an **internal, backend-only instrument** that estimates the size of that under-count, so we can decide — with a number, not a guess — whether a voice-fidelity fix (fuzzy matching / dropout recovery) is worth building *before* the teacher-facing modality split. It is not itself the split, and it is not teacher-facing.

Its modality-attribution output (voice vs. text production counts) doubles as the **data core the eventual split will need**, so no work is wasted.

## 2. Feasibility (settled by code trace, 2026-07-01)

- **One ingestion path, one detector, modality-agnostic.** Voice and text both funnel through `POST /api/practice-sessions/<session_id>/events` → `api_report_practice_session_event` (`backend/routes/curriculum_admin.py:629-720`) → `build_derived_learning_events` (`backend/services/practice_analytics.py:2029-2254`). Detection branches only on `event_type` and operates on `payload['content']`; there is no voice/text branch. A spoken turn's transcript gets identical target-hit and recast/elicitation detection to a typed turn.
- **Per-turn modality already exists** as `payload.source ∈ {'realtime','text'}` on the primary `student.turn`/`assistant.turn` events (frontend stamps it: `AssignmentPracticeWorkspace.tsx:827` voice, `:1132/:1137` text; backend preserves the payload verbatim). The **derived** production events (`metric.target_expression_hit`, `metric.target_vocabulary_hit`) do **not** carry `source`, but share `(session_id, turn_index)` with their originating primary turn → modality is recoverable by a self-join.
- **Session-level modality is only a coarse fallback.** `PracticeSession.modality` (`text_only|voice_only|hybrid`, default `hybrid`), `voice_enabled`, `text_enabled` (`backend/db/models/practice.py:43-45`) are *capability* flags. For a `hybrid` session they cannot say which turns were spoken vs. typed. The split MUST use per-turn `payload.source`, never the session flag.
- **`turn_index` is present on voice turns.** Shared practice ref (`AssignmentPracticeWorkspace.tsx:701`): text +2/exchange (`:1101-1103`), voice +1/message (`:815-816`); derived events reuse the same `turn_index`. Confirmed persisted end-to-end by the uptake-trace cutover (rev `00095-6rw`).
- **ASR dropout is currently invisible.** `persistRealtimeMessage` early-returns on empty content (`AssignmentPracticeWorkspace.tsx:812`); `input_audio_transcription.failed` is handled (`useRealtimeChat.ts:935`) but nothing is persisted. So a spoken turn that fails transcription emits **zero** events and leaves **no trace** — it cannot be counted from existing data. Measuring it requires new (forward-looking) instrumentation.

**Verdict:** substring-miss is measurable *now* on persisted voice turns; ASR dropout is measurable only *going forward* via a new marker. Both are cheap and additive.

## 3. The two loss mechanisms (what we are measuring)

1. **ASR dropout.** A spoken turn produces no usable transcript → no `student.turn` → zero production events. Typed text has no equivalent loss mode. Invisible today; instrument it forward (§4.2). A *floor* on the gap.
2. **Substring-miss.** The exact matcher (`_count_target_expression_hits`, `practice_analytics.py:748`) is a normalized substring match. ASR transcripts drift in spelling/word-boundaries, so the matcher misses hits an identical typed string would catch. Measurable now via a fuzzy-vs-exact probe (§4.1). A *ceiling* on that mechanism (fuzzy admits some false positives).

Together they **bracket** the under-count: dropout (floor) + substring-miss (ceiling) give a defensible range to decide with.

## 4. Architecture (approach: read-time probe + forward dropout instrumentation)

Additive, fail-soft, flag-gated — mirrors the Alignment View / Uptake Trace exactly. Lexical-only, like the realized axis.

### 4.1 Pure probe — `backend/services/pedagogy/voice_fidelity.py` (new)

`build_voice_fidelity(events: list[dict], target_surfaces: list[str], *, fuzzy_threshold: float = 0.85) -> dict`

- **Pure** (stdlib + sibling pedagogy only — import-boundary invariant 7a). Uses `difflib` from stdlib for the fuzzy pass. No DB/LLM/IO.
- Groups events by `session_id`. From each session separates:
  - **primary voice turns**: `event_type == 'student.turn'` with `payload.source == 'realtime'`, carrying `payload.content` + `turn_index`.
  - **exact production hits**: `metric.target_expression_hit` (`payload.expression`) / `metric.target_vocabulary_hit` (`payload.word`), each with `turn_index` + `count`. These are production's real (exact-matcher) output — used as the exact baseline, **not** recomputed.
  - **dropout markers**: `metric.voice_transcript_lost` (see §4.2), counted.
- **Modality attribution (the split's data core).** For every production hit event, resolve modality by the sibling primary turn at the same `(session_id, turn_index)`: `source=='realtime'` → voice, `'text'` → text, unresolved → `unknown`. Tally count-weighted `{voice, text, unknown}`.
- **Substring-miss estimate.** For each voice `student.turn` and each surface in `target_surfaces`, compute a fuzzy match on the turn content: normalize (lowercase; strip punctuation, preserving unicode letters); slide an *N-token* window (N = target token count) over the turn tokens; `difflib.SequenceMatcher(None, target_norm, window_norm).ratio()`; `fuzzy_hit` iff `max ratio >= fuzzy_threshold`. Count a `(turn, surface)` as a **miss** iff `fuzzy_hit` is true AND **no** persisted exact hit for that surface exists at that `(session_id, turn_index)`. This uses production's own exact output as the baseline, so no re-implementation of the exact matcher (avoids the import-boundary and drift problems). The estimate is an **upper bound** (fuzzy admits false positives).
- **Returns:**
  ```
  {
    "fuzzyThreshold": 0.85,
    "voiceTurns": int,                       # count of voice student.turn events observed
    "modalitySplit": {"voice": int, "text": int, "unknown": int},   # count-weighted productions
    "substringMissEstimate": int,            # ceiling: voice productions the exact matcher likely dropped
    "dropoutTurns": int,                     # spoken turns with no transcript (forward-looking floor)
    "perTarget": [ {"surface": str, "voice": int, "text": int, "substringMiss": int} ]  # ordered by target_surfaces, only surfaces with >=1 production or >=1 miss
  }
  ```
- Tolerates malformed events (missing `content`/`turn_index`/`payload` → skip that event, never raise).

### 4.2 ASR-dropout instrumentation (the one emission-path change)

- **Frontend (voice path).** When a spoken *user* turn yields no usable transcript (transcription `failed`, or empty transcript where speech was detected), emit a minimal, **content-less** `metric.voice_transcript_lost` event through the existing `queuePracticeEvent` → `/events` route: `{ event_type: 'metric.voice_transcript_lost', turn_index, payload: { source: 'realtime' } }`. No utterance content (there is none). Fail-soft: a failed emit never blocks the turn or the session.
  - Hook point: the failed/empty-transcription handling around `useRealtimeChat.ts:935` and the early-return in `persistRealtimeMessage` (`AssignmentPracticeWorkspace.tsx:812`) — the exact trigger is pinned during implementation; the contract is "one marker per spoken user turn that produced no persisted `student.turn`."
- **Ships unconditionally (inert telemetry), NOT behind the read flag.** Rationale: the marker is a new event type that nothing else consumes, so it is provably inert to all existing aggregation; and forward dropout data must accumulate for us to measure it (gating the emit off would defeat the measurement, and the harness needs it to fire too). This is the one voice-path change and the highest-scrutiny item — the implementation MUST include a test proving `metric.voice_transcript_lost` leaves `session_summary` and all existing analytics byte-identical.
- **Backend.** The `/events` route already persists a primary event of whatever `event_type` it is handed; confirm `metric.voice_transcript_lost` persists cleanly and is ignored by `apply_learning_event_to_session` (`practice_analytics.py:1740-2026`) and `build_derived_learning_events`. No new backend write method.

### 4.3 Flag-gated read surface

- **Integration flag:** `voice_fidelity_enabled() -> bool` reading `PEDAGOGY_ENGINE_VOICE_FIDELITY` (default off) in `backend/services/pedagogy/integration.py`, using the `_TRUTHY` idiom, mirroring `uptake_trace_enabled()`.
- **Route enrichment:** in `api_get_assignment_plan_preview` (`backend/routes/curriculum_admin.py`), inside the existing `realized` branch, when `voice_fidelity_enabled()` is true AND sessions exist: read `deps.db.list_assignment_learning_events(assignment_id, event_types=['student.turn', 'metric.target_expression_hit', 'metric.target_vocabulary_hit', 'metric.voice_transcript_lost'])`, then `preview['realized']['voiceFidelity'] = build_voice_fidelity(events, lexical_surfaces)` (`lexical_surfaces` = the same expression+vocabulary surfaces already computed for the realized/uptake joins). Wrap in its **own nested** `try/except → uptake-style` fail-soft so a probe failure degrades `voiceFidelity` to absent without touching `realized` or `uptake`.
- **No frontend.** The number is read via the route (authenticated teacher, assignment-scoped). The response block is **counts only — never utterance content**.

## 5. Data flow

teacher opens plan-preview `?realized=1` → realized branch builds → (flag on) route fetches the superset of event types in one `list_assignment_learning_events` call → `build_voice_fidelity` (pure) → nested `voiceFidelity` block on `realized`. Independently, live voice sessions emit `metric.voice_transcript_lost` markers on dropout, which accumulate and are counted on the next read.

## 6. How we get a real number (privacy gate)

- **Build + unit-test on crafted events** — no data needed.
- **First real read: our own test class via the voice harness.** Generate voice turns in the Testing Class (test accounts we own — no learner-privacy issue) with the voice test harness, then flip the flag and read `voiceFidelity` via the route. Honest caveat: TTS-injected audio is cleaner than a classroom, so harness dropout is a **floor**, not representative.
- **Any aggregate over real prod voice needs explicit user go** (the standing "do not pull learner data without an explicit go" gate). The probe reads `student.turn` *content* to compute the fuzzy pass; even though the block returns only counts, the computation touches learner utterances, so the flag stays **off in prod** until authorized, and any prod read is count-only, no content echoed.

## 7. Error handling

Fail-soft throughout (observability posture): the route's nested `try/except` degrades `voiceFidelity` to absent on any failure; the pure function skips malformed events; the dropout emit never blocks a turn. Nothing 500s. With the flag off, the realized/uptake payload is **byte-identical** to today. The dropout marker is inert to existing aggregation.

## 8. Honesty caveats (recorded with the number, and destined for LIMITATIONS.md)

- **The realized/uptake signal under-counts voice production** (this instrument exists to quantify that). Independent of this build, that fact warrants a LIMITATIONS entry: since real practice skews voice, the live view under-represents the dominant modality.
- **`substringMissEstimate` is a ceiling** — fuzzy matching admits false positives (a near-miss utterance that wasn't the target).
- **`dropoutTurns` is a forward-looking floor** — it counts only dropouts after this ships, and harness-measured rates understate real classroom audio.
- **Modality attribution is exact** (per-turn `source`), but `unknown` absorbs any production whose sibling turn can't be resolved; a non-zero `unknown` is itself a data-quality signal.
- Lexical-only (expression + vocabulary), like the realized axis; grammar remains "not yet measurable."

## 9. Testing

- **Pure unit** (`backend/tests/test_pedagogy_voice_fidelity.py`): fuzzy-catches-but-exact-missing → counts a substring miss; exact hit present → no miss; text turns excluded from voice metrics; modality self-join correct for `voice_only`, `text_only`, and `hybrid` (mixed-source) sessions; `unknown` bucket when sibling turn absent; dropout markers counted; count-weighting; `perTarget` ordering + surface filtering; malformed events skipped. Plus an **import-boundary** assertion (voice_fidelity.py imports stdlib + sibling pedagogy only) — add `import backend.services.pedagogy.voice_fidelity` to the `ImportBoundaryTestCase` probe in `test_pedagogy_engine_s1.py`.
- **Route test** (`backend/tests/test_teacher_plan_preview_route.py`): flag-on attaches `realized.voiceFidelity`; flag-off omits the KEY (`assertNotIn`); no-sessions omits it; fail-soft (read raises) → `voiceFidelity` absent while `realized`/`uptake` survive, no 500.
- **Inertness test**: emitting `metric.voice_transcript_lost` leaves `session_summary` and existing analytics aggregates byte-identical (the high-scrutiny guarantee for the one voice-path change).
- **Frontend test** (`AssignmentPracticeWorkspace.test.tsx` or the realtime hook test): a failed/empty user transcription enqueues exactly one `metric.voice_transcript_lost` event with the turn's `turn_index` and no content; a successful transcription enqueues none.

## 10. Flag & deploy

- New flag `PEDAGOGY_ENGINE_VOICE_FIDELITY`, default **off**. Add to `cloudbuild.yaml` `--set-env-vars` with substitution `_PEDAGOGY_ENGINE_VOICE_FIDELITY` default `'0'` (REPLACE-safe: matches absent/off live). The dropout instrumentation ships **live/unconditional** (inert telemetry — §4.2). Ship the read surface inert; flip the flag only to read (test class first). Instant rollback via `--update-env-vars PEDAGOGY_ENGINE_VOICE_FIDELITY=0`.

## 11. Out of scope (YAGNI)

- **No teacher-facing UI** — internal number only; the honest caveat rides the future split build.
- **No fidelity *fix*** — fuzzy-match adoption in the real detector, or dropout recovery, is the decision this instrument *informs*, not this build.
- **No first-classing of `source` onto derived events** — a clean-up for the future split, not needed to measure (the self-join covers it and covers history).
- **No per-student output** — assignment-aggregate only, consistent with the alignment view's grade-backdoor guardrail.
- **No grammar** — no per-target grammar hit event exists.
