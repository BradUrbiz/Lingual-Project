# Realtime Voice Tutor — Speculative Response (STT-lag rework) — Design

Status: Draft — behind `REALTIME_SPECULATIVE_RESPONSE` (default off). High-scrutiny voice-path change; flag-off byte-identical.
Date: 2026-07-01
Owner: Product + Engineering
Related: `backend/routes/chat.py` (realtime session mint + turn_detection config), `frontend/src/hooks/useRealtimeChat.ts` (turn-taking), `frontend/src/hooks/realtimeSpeechGate.ts` (noise-gate). Supersedes the deferred "issue #1 (lag)" note in the realtime-model-choice memory.

## 1. Goal

Cut the voice tutor's per-turn response latency. Today the session runs `semantic_vad` with `create_response: false` (`chat.py:371-375`): after the learner stops speaking, the client waits for the **full input-audio transcription** to complete, runs the noise-gate `shouldRespondToRealtimeTurn(transcript, metrics)`, and only then sends `response.create`. So every real turn pays the full STT round-trip **before the tutor starts generating**.

The rework moves `response.create` **off the STT critical path**: it fires speculatively at `speech_stopped` for audio that already looks like directed near-field speech, so the reply generates **in parallel** with STT. The existing transcript-gate becomes the arbiter — it cancels the speculative response if the transcript reveals noise.

## 2. Feasibility (settled by API research + code trace, 2026-07-01)

Confirmed against OpenAI Realtime API docs:
- **The model's audio response is generated from native audio, independent of transcription** — *"Realtime API models accept audio natively… input transcription is a separate process… may come before or after the Response events."* So `response.create` produces a reply from the committed audio **without waiting for the transcript**.
- **Transcription only starts after the input audio buffer is committed** (post-speech-stop) — so the noise-gate is inherently post-commit; the STT is on the critical path *only because* we wait for the gate before firing `response.create`.
- **Clean cancellation exists** — `response.cancel` (safe even with no response in progress; session unaffected) + `output_audio_buffer.clear` (WebRTC; cut off buffered output audio; preceded by `response.cancel`). Both already wrapped in the hook as `cancelCurrentResponse()` / `clearOutputAudioBuffer()`.

Confirmed in `useRealtimeChat.ts`:
- At `input_audio_buffer.speech_stopped` (line 980-998) **all gate metrics are already finalized**: `durationMs` is computed there; `peakRms` + `hadMicSignal` accumulate during speech via the mic-meter loop (line 501-506). So a metrics-only decision is available pre-transcript.
- `createRealtimeResponseUnlessHeld()` (line 667) already respects the pedagogy tutor-hold (S3.3/S5 coach injection). The speculative fire routes through it, so the hold is preserved.

## 3. Architecture (metrics-gated speculative + cancel)

Add a speculative `response.create` at `speech_stopped`, gated by a cheap **metrics-only pre-gate**. The existing full transcript-gate at `.completed` becomes the arbiter. Flag-gated; flag-off skips the speculative branch entirely → byte-identical.

### Components

1. **Metrics pre-gate (pure, new)** — `shouldSpeculativelyRespond(metrics: RealtimeInputTurnMetrics): boolean` in `frontend/src/hooks/realtimeSpeechGate.ts`. Conservative, metrics-only (NO transcript):
   ```
   hadMicSignal && peakRms >= DIRECTED_SPEECH_RMS_THRESHOLD && durationMs >= SPECULATIVE_MIN_DURATION_MS
   ```
   `DIRECTED_SPEECH_RMS_THRESHOLD` reuses the existing constant (0.012). `SPECULATIVE_MIN_DURATION_MS` is a new tunable constant (default **400**). Requiring *actual* near-field signal (`hadMicSignal`, not the gate's `!hadMicSignal` benefit-of-the-doubt) keeps it conservative: any uncertainty → don't speculate → serial fallback. Pure/total — same shape as `shouldRespondToRealtimeTurn`.

2. **Speculative fire** — in the `speech_stopped` handler (`useRealtimeChat.ts:980`), after the metrics are finalized: if `speculativeEnabledRef.current` (flag) AND `shouldSpeculativelyRespond(currentInputTurn)` → call `createRealtimeResponseUnlessHeld()` and, only if it returned true (not held), set `speculativeFiredRef.current = true`. If the pre-gate fails or the turn is held, do nothing (serial path stands). (Turns are linear — one VAD turn at a time — so a boolean marks "this turn speculative-fired"; no itemId/response-id tracking is needed, and the input item may not even have an id yet at `speech_stopped`.)

3. **Arbiter** — in the `.completed`/`.done` handler (`useRealtimeChat.ts:910-933`), run the existing `shouldRespondToRealtimeTurn(resolvedTranscript, currentInputTurn)` exactly as today, then branch on whether a speculative response was fired for this item:
   | transcript-gate | speculated? | action |
   |---|---|---|
   | pass | yes | **dedupe** — `finalizeTranscript` only; do NOT call `createRealtimeResponseUnlessHeld` again |
   | pass | no | `finalizeTranscript` + `createRealtimeResponseUnlessHeld()` (today's serial behavior) |
   | fail | yes | **cancel** — `cancelCurrentResponse()` + `clearOutputAudioBuffer()` + `deleteConversationItem(itemId)` (itemId from the `.completed` event) |
   | fail | no | `deleteConversationItem(itemId)` (today's behavior) |
   Set `speculativeFiredRef.current = false` after arbitration.

4. **`speculativeFiredRef` lifecycle** — a `useRef<boolean>` marking whether the current turn speculative-fired. Set true at the speculative fire (2); read + cleared at the arbiter (3); reset to `false` at `input_audio_buffer.speech_started` (new turn) and in the connection cleanup/`clearMessages` paths. On `input_audio_transcription.failed` with a speculative response in flight: **let it ride** (reset the flag, no cancel) — a transcription failure is orthogonal to whether the audio was real speech, and the metrics pre-gate already judged it directed; cancelling would drop a likely-valid reply. (The voice-fidelity dropout marker on `.failed` is independent and unaffected.)

   *Message-ordering note:* the learner's display order is reserved at `speech_started`/`speech_stopped` (before the speculative fire), and the assistant reserves its order when its transcript starts — so the learner's turn keeps the lower `sortOrder` and the UI ordering is preserved even though the tutor now generates before the learner transcript is finalized.

5. **Flag delivery** — backend env `REALTIME_SPECULATIVE_RESPONSE` (default off):
   - `realtime_speculative_response_enabled() -> bool` in `chat.py`, mirroring `realtime_avatar_directives_enabled()` (`chat.py:279`).
   - The `/api/realtime/session` success response gains `speculativeResponse: realtime_speculative_response_enabled()`.
   - The hook reads `tokenResponse.data.speculativeResponse` in `connect()` (line 1058-1061) and stores it in `speculativeEnabledRef` (default false). Adding a response field is safe — the frontend destructures `client_secret` only.
   - `cloudbuild.yaml`: substitution `_REALTIME_SPECULATIVE_RESPONSE` default `'0'` + env wiring (REPLACE-safe: absent/off live matches `'0'`).

## 4. Data flow

`speech_started` (reset ref, start metrics) → learner speaks (mic meter accumulates peakRms/hadMicSignal) → `speech_stopped` (durationMs finalized → metrics pre-gate → maybe speculative `response.create` + record itemId) → **[tutor generates in parallel]** ‖ **[server commits + transcribes]** → `.completed` (transcript-gate arbitrates: dedupe / cancel / serial-fire). Flag off → the `speech_stopped` speculative branch is skipped; the flow is exactly today's.

## 5. Error handling / safety

- **Flag off ⇒ byte-identical.** The only new live behavior is inside `if (speculativeEnabledRef.current)`.
- **Fail-safe pre-gate.** No mic signal / quiet / short audio → don't speculate → serial fallback (never worse than today).
- **`response.cancel` is documented safe** even if the response already finished (returns an error, session unaffected). `output_audio_buffer.clear` cuts unplayed buffered audio.
- **Pedagogy hold preserved** — speculative fire goes through `createRealtimeResponseUnlessHeld`; a held turn defers exactly as today.
- **`interrupt_response: true` unchanged** — a new learner utterance still interrupts an in-flight (speculative) response.
- **Residual blip risk (disclosed):** if a false-positive slips the metrics pre-gate and the tutor's audio starts before the transcript-gate's cancel lands, a brief sliver may play. The pre-gate (near-field + duration) is designed to make this rare; pure noise transcribes fast/empty → cancel typically wins the race. This is the accepted tradeoff of the chosen approach.

## 6. Testing

- **Pure unit** (`frontend/src/hooks/realtimeSpeechGate.test.ts` or a new sibling): `shouldSpeculativelyRespond` — near-field + duration ≥ floor → true; far-field (low peakRms) → false; short (< floor) → false; `hadMicSignal: false` → false; boundary at `DIRECTED_SPEECH_RMS_THRESHOLD` and `SPECULATIVE_MIN_DURATION_MS`.
- **Hook-flow** (`useRealtimeChat.test.tsx`, via `MockDataChannel.emitServerEvent`): drive `speech_started` → `speech_stopped` (with a mic-metrics setup) → `input_audio_transcription.completed`, and assert the emitted client events:
  - flag on + pre-gate pass + gate pass → exactly **one** `response.create` (fired at speech_stopped, not duplicated at completed);
  - flag on + pre-gate pass + gate fail → `response.create` then `response.cancel` + `output_audio_buffer.clear`;
  - flag on + pre-gate fail → no speculative `response.create`; a `response.create` only if the gate passes at completed (serial);
  - flag off → behavior identical to today (no early `response.create`);
  - `.failed` after a speculative fire → no `response.cancel` (let it ride).
- **Live voice dogfooding** before cutover — the latency win + blip check can only be felt live (drive a real voice session, confirm faster tutor start + no spurious blips on quiet/background).

## 7. Flag & deploy

New env `REALTIME_SPECULATIVE_RESPONSE`, default **off**. cloudbuild substitution `_REALTIME_SPECULATIVE_RESPONSE` default `'0'` (REPLACE-safe). Ship inert; cut over separately (deploy → flip → live dogfood the latency + blip), then bump the cloudbuild default only if it holds up. Rollback: `--update-env-vars REALTIME_SPECULATIVE_RESPONSE=0` (instant, server-side, no redeploy).

## 8. Out of scope (YAGNI)

- **Turn-END silence latency** (semantic_vad `eagerness`) — inherent to knowing the learner finished; tuning it more eager hurts L2 learners who pause mid-utterance. Not touched.
- **Server-VAD switch / threshold tuning** — would trade semantic turn-end intelligence for a knob; not needed.
- **Holding/buffering output audio for zero-blip** — not feasible on a live WebRTC audio track; the metrics pre-gate is the chosen blip mitigation instead.
- **Latency instrumentation/telemetry** — the flag enables a live A/B; a metrics pipeline is a separate follow-up if we want quantified numbers.
