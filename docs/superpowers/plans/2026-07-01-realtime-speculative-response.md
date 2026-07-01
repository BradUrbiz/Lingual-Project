# Realtime Speculative Response (STT-lag rework) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut voice-tutor per-turn latency by firing `response.create` speculatively at `speech_stopped` (for audio that passes a cheap metrics-only pre-gate) so the reply generates in parallel with STT, with the existing transcript-gate as the canceller — all behind `REALTIME_SPECULATIVE_RESPONSE` (default off).

**Architecture:** The realtime session already runs `create_response: false`, so the client sends `response.create` manually. Today it's sent only after full transcription (`.completed` gate-pass). This rework adds a speculative send at `speech_stopped` (metrics are finalized there; the model responds from native audio, independent of the transcript), and turns the `.completed` transcript-gate into an arbiter: dedupe on pass, `response.cancel` + `output_audio_buffer.clear` on fail. Flag-off is byte-identical.

**Tech Stack:** React 19 + TypeScript (Vite), Vitest (frontend), Python 3 (Flask, `backend/routes/chat.py`), Cloud Run + `cloudbuild.yaml`, OpenAI Realtime API (WebRTC).

## Global Constraints

- **Flag:** `REALTIME_SPECULATIVE_RESPONSE` (backend env, default **off**), delivered to the hook via the `/api/realtime/session` mint response field `speculativeResponse`. cloudbuild substitution `_REALTIME_SPECULATIVE_RESPONSE` default `'0'` (REPLACE-safe: absent/off live matches `'0'`).
- **Flag off ⇒ byte-identical.** The only new live behavior is inside `if (speculativeEnabledRef.current)`.
- **Metrics pre-gate is conservative + pure:** `hadMicSignal && peakRms >= DIRECTED_SPEECH_RMS_THRESHOLD && durationMs >= SPECULATIVE_MIN_DURATION_MS`. Reuse `DIRECTED_SPEECH_RMS_THRESHOLD` (0.012); new `SPECULATIVE_MIN_DURATION_MS = 400`.
- **Arbiter (at `.completed`):** pass+speculated → dedupe (no 2nd `response.create`); pass+not → serial fire (today); fail+speculated → `cancelCurrentResponse()` + `clearOutputAudioBuffer()` + delete; fail+not → delete (today). Reset the fired-flag after.
- **`speculativeFiredRef` is a boolean** (turns are linear; no itemId/response-id tracking). Reset on `speech_started`, `.failed` (let the reply ride — no cancel), and connection cleanup.
- **Pedagogy hold preserved** — speculative fire routes through `createRealtimeResponseUnlessHeld()`; only mark fired if it actually sent.
- **Commit messages:** plain, NO `Co-Authored-By`/attribution trailer.
- **Do NOT deploy/flip in this plan.** Ship inert; deploy + flip + live dogfood is a separate explicit step.
- **Tests:** backend from repo root `python3 -m unittest backend.tests.<module> -v`; frontend `cd frontend && npm run test -- --run <file>` (do NOT run the full frontend suite — pre-existing flaky `AppChatPage.avatar.test.tsx`).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `backend/routes/chat.py` (modify) | `realtime_speculative_response_enabled()` env helper (~line 288) + `speculativeResponse` field in mint return (line 651-656) | 1 |
| `backend/tests/test_realtime_chat.py` (modify) | env-helper flag unit tests | 1 |
| `cloudbuild.yaml` (modify) | `_REALTIME_SPECULATIVE_RESPONSE` substitution + `--set-env-vars` entry | 1 |
| `frontend/src/hooks/realtimeSpeechGate.ts` (modify) | pure `shouldSpeculativelyRespond(metrics)` + `SPECULATIVE_MIN_DURATION_MS` | 2 |
| `frontend/src/hooks/realtimeSpeechGate.test.ts` (modify) | pre-gate unit tests | 2 |
| `frontend/src/hooks/useRealtimeChat.ts` (modify) | refs + speech_started/stopped/completed/failed edits + `connect()` flag read | 3 |
| `frontend/src/hooks/useRealtimeChat.speculative.test.tsx` (create) | hook-flow tests (isolated gate mock + lean harness) | 3 |
| `backend/CLAUDE.md`, memory `project_realtime_model_choice.md`, `docs/school-integration/LIMITATIONS.md` (modify) | doc sync | 4 |

---

## Task 1: Backend flag (`REALTIME_SPECULATIVE_RESPONSE`)

**Files:**
- Modify: `backend/routes/chat.py` (add env helper after line 287; add field to mint return at 651-656)
- Modify: `backend/tests/test_realtime_chat.py` (append flag tests)
- Modify: `cloudbuild.yaml` (`--set-env-vars` line 60; `substitutions`)

**Interfaces:**
- Produces: `realtime_speculative_response_enabled() -> bool`; the `/api/realtime/session` success JSON gains `"speculativeResponse": <bool>` (read by the hook in Task 3).

- [ ] **Step 1: Write the failing flag tests**

Append to `backend/tests/test_realtime_chat.py` (it already imports `os`, `unittest`, `from unittest import mock`):

```python
class RealtimeSpeculativeResponseFlagTests(unittest.TestCase):
    def test_default_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            from backend.routes.chat import realtime_speculative_response_enabled
            self.assertFalse(realtime_speculative_response_enabled())

    def test_on_when_truthy(self):
        with mock.patch.dict(os.environ, {'REALTIME_SPECULATIVE_RESPONSE': '1'}):
            from backend.routes.chat import realtime_speculative_response_enabled
            self.assertTrue(realtime_speculative_response_enabled())

    def test_off_when_other(self):
        with mock.patch.dict(os.environ, {'REALTIME_SPECULATIVE_RESPONSE': 'no'}):
            from backend.routes.chat import realtime_speculative_response_enabled
            self.assertFalse(realtime_speculative_response_enabled())
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m unittest backend.tests.test_realtime_chat.RealtimeSpeculativeResponseFlagTests -v`
Expected: FAIL — `ImportError: cannot import name 'realtime_speculative_response_enabled'`.

- [ ] **Step 3: Add the env helper**

In `backend/routes/chat.py`, add after `realtime_avatar_directives_enabled()` (after line 287, before `realtime_avatar_directives_requested`):

```python
def realtime_speculative_response_enabled() -> bool:
    """Whether the realtime tutor fires response.create speculatively at speech-stop
    (metrics-gated) instead of waiting for the full input transcription. Default off.
    Reads REALTIME_SPECULATIVE_RESPONSE. Independent of the pilot-avatar gate."""
    return os.environ.get('REALTIME_SPECULATIVE_RESPONSE', '').strip().lower() in {
        '1',
        'true',
        'yes',
        'on',
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 -m unittest backend.tests.test_realtime_chat.RealtimeSpeculativeResponseFlagTests -v`
Expected: PASS (3 tests OK).

- [ ] **Step 5: Add the field to the mint success return**

In `backend/routes/chat.py`, in the mint success `jsonify` (lines 651-656), add the field:

```python
            data = response.json()
            return jsonify({
                'success': True,
                'client_secret': data.get('value'),
                'session_id': (data.get('session') or {}).get('id'),
                'expires_at': data.get('expires_at'),
                'speculativeResponse': realtime_speculative_response_enabled(),
            })
```

- [ ] **Step 6: Wire cloudbuild (REPLACE-safe)**

In `cloudbuild.yaml`, append to the end of the `--set-env-vars` string on line 60 (just after `PEDAGOGY_ENGINE_VOICE_FIDELITY=${_PEDAGOGY_ENGINE_VOICE_FIDELITY}`, keeping the closing quote):

```
,REALTIME_SPECULATIVE_RESPONSE=${_REALTIME_SPECULATIVE_RESPONSE}'
```

And add the substitution after `_PEDAGOGY_ENGINE_VOICE_FIDELITY: '0'`:

```yaml
  # Realtime speculative response (STT-lag rework) — frontend fires response.create at
  # speech-stop for metrics-passing audio, transcript-gate cancels. Default '0'
  # (REPLACE-safe: no live flag existed, so '0' is a no-op). Rollback:
  # --update-env-vars REALTIME_SPECULATIVE_RESPONSE=0.
  _REALTIME_SPECULATIVE_RESPONSE: '0'
```

- [ ] **Step 7: Verify cloudbuild parses + tests pass**

Run: `python3 -c "import yaml; yaml.safe_load(open('cloudbuild.yaml'))" && echo OK`
Expected: `OK`.
Run: `python3 -m unittest backend.tests.test_realtime_chat -v`
Expected: PASS (all realtime-chat tests, including the 3 new).

- [ ] **Step 8: Commit**

```bash
git add backend/routes/chat.py backend/tests/test_realtime_chat.py cloudbuild.yaml
git commit -m "feat(realtime): REALTIME_SPECULATIVE_RESPONSE flag + speculativeResponse mint field"
```

---

## Task 2: Pure metrics pre-gate `shouldSpeculativelyRespond`

**Files:**
- Modify: `frontend/src/hooks/realtimeSpeechGate.ts` (add constant + function)
- Modify: `frontend/src/hooks/realtimeSpeechGate.test.ts` (add tests)

**Interfaces:**
- Consumes: `RealtimeInputTurnMetrics` (existing type in the same file), `DIRECTED_SPEECH_RMS_THRESHOLD` (existing const, 0.012).
- Produces: `export function shouldSpeculativelyRespond(metrics: RealtimeInputTurnMetrics): boolean` and `export const SPECULATIVE_MIN_DURATION_MS = 400`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/hooks/realtimeSpeechGate.test.ts` (add the import to the existing top import block):

```typescript
// add to the existing import from './realtimeSpeechGate':
//   shouldSpeculativelyRespond, SPECULATIVE_MIN_DURATION_MS

describe('shouldSpeculativelyRespond', () => {
  const near = (over: Partial<import('./realtimeSpeechGate').RealtimeInputTurnMetrics> = {}) => ({
    ...createEmptyRealtimeInputTurnMetrics(),
    hadMicSignal: true,
    peakRms: 0.03,
    durationMs: 800,
    ...over,
  });

  it('accepts directed near-field speech of sufficient duration', () => {
    expect(shouldSpeculativelyRespond(near())).toBe(true);
  });

  it('rejects far-field / quiet audio (peakRms below threshold)', () => {
    expect(shouldSpeculativelyRespond(near({ peakRms: 0.005 }))).toBe(false);
  });

  it('rejects audio shorter than the duration floor', () => {
    expect(shouldSpeculativelyRespond(near({ durationMs: SPECULATIVE_MIN_DURATION_MS - 1 }))).toBe(false);
  });

  it('rejects when there was no mic signal (cannot assess near-field)', () => {
    expect(shouldSpeculativelyRespond(near({ hadMicSignal: false }))).toBe(false);
  });

  it('accepts exactly at the duration floor', () => {
    expect(shouldSpeculativelyRespond(near({ durationMs: SPECULATIVE_MIN_DURATION_MS }))).toBe(true);
  });

  it('accepts exactly at the RMS threshold', () => {
    expect(shouldSpeculativelyRespond(near({ peakRms: 0.012 }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test -- --run src/hooks/realtimeSpeechGate.test.ts`
Expected: FAIL — `shouldSpeculativelyRespond` / `SPECULATIVE_MIN_DURATION_MS` are not exported.

- [ ] **Step 3: Implement the pre-gate**

In `frontend/src/hooks/realtimeSpeechGate.ts`, add near `DIRECTED_SPEECH_RMS_THRESHOLD` (line 156):

```typescript
export const SPECULATIVE_MIN_DURATION_MS = 400;
```

And add the exported function (place it just before `createEmptyRealtimeInputTurnMetrics`, ~line 293):

```typescript
/**
 * Metrics-only pre-gate for the speculative-response optimization: decide at
 * `speech_stopped` (before any transcript exists) whether the audio already looks
 * like directed near-field speech worth responding to speculatively. Deliberately
 * conservative — requires an ACTUAL near-field mic signal (not the full gate's
 * benefit-of-the-doubt) so noise-shaped audio falls back to the serial transcript-gate.
 */
export function shouldSpeculativelyRespond(metrics: RealtimeInputTurnMetrics): boolean {
  return metrics.hadMicSignal
    && metrics.peakRms >= DIRECTED_SPEECH_RMS_THRESHOLD
    && metrics.durationMs >= SPECULATIVE_MIN_DURATION_MS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test -- --run src/hooks/realtimeSpeechGate.test.ts`
Expected: PASS (all existing gate tests + the 6 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/realtimeSpeechGate.ts frontend/src/hooks/realtimeSpeechGate.test.ts
git commit -m "feat(realtime): pure shouldSpeculativelyRespond metrics pre-gate"
```

---

## Task 3: Hook wiring (speculative fire + arbiter)

**Files:**
- Modify: `frontend/src/hooks/useRealtimeChat.ts` (refs; `connect()` flag read; `speech_started`/`speech_stopped`/`.completed`/`.failed` handlers)
- Create: `frontend/src/hooks/useRealtimeChat.speculative.test.tsx`

**Interfaces:**
- Consumes: `shouldSpeculativelyRespond` (Task 2); `tokenResponse.data.speculativeResponse` (Task 1); existing `createRealtimeResponseUnlessHeld`, `cancelCurrentResponse`, `clearOutputAudioBuffer`, `deleteConversationItem`, `finalizeTranscript`, `shouldRespondToRealtimeTurn`, `currentInputTurnRef`.
- Produces: (internal) the speculative turn-taking behavior, gated by the mint flag.

- [ ] **Step 1: Add the import + refs (no test yet — refs are wired by Step 3's flow tests)**

In `frontend/src/hooks/useRealtimeChat.ts`, find the existing `import { … } from './realtimeSpeechGate';` statement near the top and **add only `shouldSpeculativelyRespond`** to its imported symbols — leave every other symbol and the statement's shape exactly as-is. Do NOT add any new type import (the hook already types metrics via `createEmptyRealtimeInputTurnMetrics`'s return).

Add two refs next to the other input-turn refs (near line 200, beside `inputSpeechStartedAtRef`):

```typescript
  const speculativeEnabledRef = useRef(false);
  const speculativeFiredRef = useRef(false);
```

- [ ] **Step 2: Read the flag in `connect()`**

In `connect()` (line 1059), destructure the new field and set the ref:

```typescript
      const tokenResponse = await api.post('/realtime/session', sessionParamsOverride ?? sessionParams ?? {});
      const { client_secret, speculativeResponse } = tokenResponse.data;
      speculativeEnabledRef.current = speculativeResponse === true;

      if (!client_secret) {
        throw new Error('Failed to get session token');
      }
```

- [ ] **Step 3: Speculative fire at `speech_stopped` + resets + arbiter**

**(3a)** In the `input_audio_buffer.speech_started` handler (line 948, first statement of the case), reset the fired-flag:

```typescript
        case 'input_audio_buffer.speech_started':
          speculativeFiredRef.current = false;
          reservePendingMessageOrder('user');
```
(Insert `speculativeFiredRef.current = false;` as the first line of the case; keep the rest unchanged.)

**(3b)** In the `input_audio_buffer.speech_stopped` handler, after the `durationMs` block (after line 994, inside the case, before `isListeningRef.current = false`), add the speculative fire:

```typescript
            currentInputTurn.durationMs = Math.max(
              currentInputTurn.durationMs,
              computedDuration,
            );
          }
          if (
            speculativeEnabledRef.current
            && !speculativeFiredRef.current
            && shouldSpeculativelyRespond(currentInputTurnRef.current)
          ) {
            // Fire the response NOW, in parallel with STT; the transcript-gate at
            // `.completed` cancels it if this turns out to be noise. Respect the
            // pedagogy tutor-hold: only mark fired if it actually sent.
            if (createRealtimeResponseUnlessHeld()) {
              speculativeFiredRef.current = true;
            }
          }
          isListeningRef.current = false;
```

**(3c)** Replace the `.completed`/`.done` arbiter block (lines 927-933) with the dedupe/cancel arbiter:

```typescript
            if (shouldRespondToRealtimeTurn(resolvedTranscript, currentInputTurn)) {
              finalizeTranscript('user', resolvedTranscript, itemId);
              if (!speculativeFiredRef.current) {
                createRealtimeResponseUnlessHeld();
              }
            } else {
              pendingUserOrderRef.current = null;
              if (speculativeFiredRef.current) {
                cancelCurrentResponse();
                clearOutputAudioBuffer();
              }
              deleteConversationItem(itemId);
            }
            speculativeFiredRef.current = false;
```
(This replaces the existing `if (shouldRespondToRealtimeTurn(...)) { finalizeTranscript(...); createRealtimeResponseUnlessHeld(); } else { pendingUserOrderRef.current = null; deleteConversationItem(itemId); }` block, keeping the surrounding `{ ... }` scope and the trailing `break;`.)

**(3d)** In the `.failed` handler (line 940, after `currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();`), reset the flag WITHOUT cancelling — let a speculative reply ride:

```typescript
          currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();
          // A speculative reply already in flight is left to ride: a transcription
          // failure is orthogonal to whether the audio was real speech.
          speculativeFiredRef.current = false;
          onUserTranscriptLostCallback?.();
```

**Note:** `cancelCurrentResponse`, `clearOutputAudioBuffer`, `createRealtimeResponseUnlessHeld`, `deleteConversationItem`, `finalizeTranscript` are already in `handleServerEvent`'s dependency array (they are used elsewhere in the callback), and `shouldSpeculativelyRespond` is a module import + the refs are stable — so **no dependency-array change is required.** Verify `tsc -b` is clean after editing.

- [ ] **Step 4: Write the hook-flow tests (isolated file with gate mock)**

Create `frontend/src/hooks/useRealtimeChat.speculative.test.tsx`:

```tsx
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import { useRealtimeChat } from './useRealtimeChat';
import { shouldRespondToRealtimeTurn, shouldSpeculativelyRespond } from './realtimeSpeechGate';

// Mock the gate so the flow tests control the two decisions directly (the metrics
// that drive the real gate come from a mic-analyser loop that does not run in jsdom).
vi.mock('./realtimeSpeechGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtimeSpeechGate')>();
  return {
    ...actual,
    shouldRespondToRealtimeTurn: vi.fn(actual.shouldRespondToRealtimeTurn),
    shouldSpeculativelyRespond: vi.fn(actual.shouldSpeculativelyRespond),
  };
});

vi.mock('../api', () => ({ default: { post: vi.fn() } }));
const apiPostMock = vi.mocked(api.post);

let latestHookState: ReturnType<typeof useRealtimeChat> | null = null;
let sentClientEvents: Array<Record<string, unknown>> = [];
let activeDataChannel: MockRTCDataChannel | null = null;

class MockRTCDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  send(payload: string) { sentClientEvents.push(JSON.parse(payload) as Record<string, unknown>); }
  close() { this.readyState = 'closed'; this.onclose?.(new Event('close')); }
  open() { this.readyState = 'open'; this.onopen?.(new Event('open')); }
  emitServerEvent(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}
class MockRTCPeerConnection {
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  addTrack() { return undefined; }
  createDataChannel() { activeDataChannel = new MockRTCDataChannel(); return activeDataChannel as unknown as RTCDataChannel; }
  async createOffer() { return { type: 'offer' as const, sdp: 'mock-offer-sdp' }; }
  async setLocalDescription() { return undefined; }
  async setRemoteDescription() { return undefined; }
  close() { return undefined; }
}

function Harness() {
  const state = useRealtimeChat();
  useEffect(() => { latestHookState = state; }, [state]);
  return null;
}

function mintReturns(speculativeResponse: boolean) {
  apiPostMock.mockImplementation(async (url: string) => {
    if (url === '/realtime/session') {
      return { data: { client_secret: 'sec', speculativeResponse } } as Awaited<ReturnType<typeof api.post>>;
    }
    if (url === '/realtime/connect') {
      return { data: { answerSdp: 'mock-answer-sdp' } } as Awaited<ReturnType<typeof api.post>>;
    }
    throw new Error(`Unexpected api.post: ${url}`);
  });
}

async function connectAndOpen() {
  render(<Harness />);
  await act(async () => { await latestHookState?.connect(); });
  act(() => { activeDataChannel?.open(); });
  await waitFor(() => { expect(latestHookState?.isConnected).toBe(true); });
}

function driveTurn(transcript: string) {
  act(() => {
    activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    activeDataChannel?.emitServerEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'u1',
      transcript,
    });
  });
}

const creates = () => sentClientEvents.filter((e) => e.type === 'response.create');
const cancels = () => sentClientEvents.filter((e) => e.type === 'response.cancel');
const clears = () => sentClientEvents.filter((e) => e.type === 'output_audio_buffer.clear');

describe('useRealtimeChat speculative response', () => {
  beforeEach(() => {
    latestHookState = null;
    sentClientEvents = [];
    activeDataChannel = null;
    apiPostMock.mockReset();
    vi.mocked(shouldRespondToRealtimeTurn).mockReset();
    vi.mocked(shouldSpeculativelyRespond).mockReset();
    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fires exactly once (speculative, no duplicate) when pre-gate and gate both pass', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();
    driveTurn('quiero un cafe por favor');
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('cancels + clears when it speculated but the transcript-gate rejects', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(false);
    await connectAndOpen();
    driveTurn('...background noise...');
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(1);
    expect(clears()).toHaveLength(1);
  });

  it('serial-fires (no speculation) when the pre-gate fails but the gate passes', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(false);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();
    driveTurn('gracias');
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('never speculates when the flag is off (byte-identical to today)', async () => {
    mintReturns(false);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true); // would pass if consulted
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();
    driveTurn('hola');
    // exactly one create, and it came from the serial `.completed` path, not speech_stopped
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('lets a speculative reply ride on transcription failure (no cancel)', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    await connectAndOpen();
    act(() => {
      activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
      activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.failed',
        item_id: 'u1',
        error: { message: 'no transcript' },
      });
    });
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run the flow tests + type-check**

Run: `cd frontend && npm run test -- --run src/hooks/useRealtimeChat.speculative.test.tsx`
Expected: PASS (5 tests). Then confirm the existing hook tests still pass:
Run: `cd frontend && npm run test -- --run src/hooks/useRealtimeChat.test.tsx`
Expected: PASS. Then: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useRealtimeChat.ts frontend/src/hooks/useRealtimeChat.speculative.test.tsx
git commit -m "feat(realtime): speculative response at speech-stop with transcript-gate arbiter (flag-gated)"
```

---

## Task 4: Doc sync

**Files:**
- Modify: `backend/CLAUDE.md` (realtime flag-state note)
- Modify: `docs/school-integration/LIMITATIONS.md` (new lettered entry after `(ww)` → `(xx)`)

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a realtime flag-state note to `backend/CLAUDE.md`**

In `backend/CLAUDE.md`, in the "Request flows" section (the `**Realtime:**` bullet under "## Request flows"), append after the existing realtime sentence:

```
A latency optimization is available behind `REALTIME_SPECULATIVE_RESPONSE` (env, default off, **BUILT / not cut over**): when on, the `/api/realtime/session` mint returns `speculativeResponse: true` and the frontend (`useRealtimeChat`) fires `response.create` speculatively at `speech_stopped` for audio that passes a metrics-only pre-gate (`shouldSpeculativelyRespond`), generating the reply in parallel with STT; the existing transcript noise-gate cancels it (`response.cancel` + `output_audio_buffer.clear`) if it turns out to be noise. Flag off ⇒ byte-identical (serial wait-for-transcript). Spec/plan `docs/superpowers/{specs,plans}/2026-07-01-realtime-speculative-response*.md`. Rollback `--update-env-vars REALTIME_SPECULATIVE_RESPONSE=0`.
```

- [ ] **Step 2: Add a `LIMITATIONS.md` entry**

In `docs/school-integration/LIMITATIONS.md`, append a new entry (current last is `(ww)` from the voice-fidelity work, so this is `(xx)`; match the file's indentation):

```markdown
    **(xx) The realtime speculative-response optimization carries a residual noise-blip risk** (behind `REALTIME_SPECULATIVE_RESPONSE`, default off). When on, the tutor's reply fires at speech-stop before the transcript noise-gate has verdict; a false-positive that slips the metrics pre-gate (`hadMicSignal` + `peakRms ≥ 0.012` + `durationMs ≥ 400`) can emit a brief sliver of tutor audio before `response.cancel`/`output_audio_buffer.clear` land. The pre-gate makes this rare (noise is typically far-field/short and transcribes fast→empty, so the cancel usually wins the race), but it is not zero — the accepted tradeoff for lower latency. Flag off ⇒ the serial wait-for-transcript path, no blip. Turn-END silence latency (semantic_vad eagerness) is unaddressed by design (tuning it hurts L2 learners who pause mid-utterance).
```

- [ ] **Step 3: Verify references + commit**

Run: `ls docs/superpowers/specs/2026-07-01-realtime-speculative-response-design.md docs/superpowers/plans/2026-07-01-realtime-speculative-response.md && grep -c REALTIME_SPECULATIVE_RESPONSE cloudbuild.yaml backend/CLAUDE.md`
Expected: both files listed; `cloudbuild.yaml` ≥ 2, `backend/CLAUDE.md` ≥ 1.

```bash
git add backend/CLAUDE.md docs/school-integration/LIMITATIONS.md
git commit -m "docs(realtime): sync speculative-response flag-state + limitation (xx)"
```

---

## Notes for the executor

- **Full frontend gate + hook tests before finishing:** `cd frontend && npm run test -- --run src/hooks/realtimeSpeechGate.test.ts src/hooks/useRealtimeChat.test.tsx src/hooks/useRealtimeChat.speculative.test.tsx` and `npx tsc -b`. Backend: `python3 -m unittest backend.tests.test_realtime_chat -v`.
- **Do NOT deploy or flip the flag.** Ship inert. Deploy + `--update-env-vars REALTIME_SPECULATIVE_RESPONSE=1` + **live voice dogfooding** (confirm faster tutor start + no spurious blips on quiet/background) is a separate explicit step. `SPECULATIVE_MIN_DURATION_MS` (400ms) is the tuning knob to validate live.
- **REPLACE-safety:** before any prod build, confirm every `cloudbuild.yaml` substitution default matches live env, per the standing rule.
