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

// Split-dispatch steps so tests can assert `creates()` BETWEEN speech_stopped and
// .completed — that's the only way to tell "fired early (speculative)" apart from
// "fired at .completed (serial)", since the arbiter's dedupe collapses both into a
// single `response.create` by the end of the turn.
function emitSpeechStarted(itemId = 'u1') {
  act(() => {
    activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_started', item_id: itemId });
  });
}

function emitSpeechStopped(itemId = 'u1') {
  act(() => {
    activeDataChannel?.emitServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: itemId });
  });
}

function emitCompleted(transcript: string, itemId = 'u1') {
  act(() => {
    activeDataChannel?.emitServerEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: itemId,
      transcript,
    });
  });
}

function emitFailed(itemId = 'u1') {
  act(() => {
    activeDataChannel?.emitServerEvent({
      type: 'conversation.item.input_audio_transcription.failed',
      item_id: itemId,
      error: { message: 'no transcript' },
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
    emitSpeechStarted();
    emitSpeechStopped();
    // Fired EARLY, at speech_stopped — before any transcript exists.
    expect(creates()).toHaveLength(1);
    emitCompleted('quiero un cafe por favor');
    // The gate pass at `.completed` is DEDUPED against the early fire, not a 2nd create.
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('cancels + clears when it speculated but the transcript-gate rejects', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(false);
    await connectAndOpen();
    emitSpeechStarted();
    emitSpeechStopped();
    expect(creates()).toHaveLength(1);
    emitCompleted('...background noise...');
    expect(cancels()).toHaveLength(1);
    expect(clears()).toHaveLength(1);
  });

  it('serial-fires (no speculation) when the pre-gate fails but the gate passes', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(false);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();
    emitSpeechStarted();
    emitSpeechStopped();
    // No early fire: the pre-gate said no.
    expect(creates()).toHaveLength(0);
    // But the flag was on, so the pre-gate WAS consulted.
    expect(vi.mocked(shouldSpeculativelyRespond)).toHaveBeenCalled();
    emitCompleted('gracias');
    // Fires serially, at `.completed`.
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('never speculates when the flag is off (byte-identical to today)', async () => {
    mintReturns(false);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true); // would pass if consulted
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();
    emitSpeechStarted();
    emitSpeechStopped();
    expect(creates()).toHaveLength(0);
    // Proves the `speculativeEnabledRef` gate short-circuits before the pre-gate
    // is ever consulted, not merely that its result happened to be ignored.
    expect(vi.mocked(shouldSpeculativelyRespond)).not.toHaveBeenCalled();
    emitCompleted('hola');
    // Exactly one create, and it came from the serial `.completed` path, not speech_stopped.
    expect(creates()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
  });

  it('lets a speculative reply ride on transcription failure (no cancel)', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    await connectAndOpen();
    emitSpeechStarted();
    emitSpeechStopped();
    expect(creates()).toHaveLength(1);
    emitFailed();
    expect(cancels()).toHaveLength(0);
  });

  it('respects the tutor hold: speculative fire is suppressed while held, and the held response fires exactly once on release', async () => {
    mintReturns(true);
    vi.mocked(shouldSpeculativelyRespond).mockReturnValue(true);
    vi.mocked(shouldRespondToRealtimeTurn).mockReturnValue(true);
    await connectAndOpen();

    act(() => {
      latestHookState?.setTutorHoldActive(true);
    });

    emitSpeechStarted();
    emitSpeechStopped();
    // The pre-gate passed, but the hold means `createRealtimeResponseUnlessHeld()`
    // did not actually send — so nothing should have gone out yet, and
    // `speculativeFiredRef` must NOT have been marked true from a held call.
    expect(creates()).toHaveLength(0);

    emitCompleted('quiero un cafe por favor');
    // Because the speculative attempt never actually sent, the `.completed` path
    // is not deduped away either — it also just re-registers the hold, and still
    // sends nothing while held.
    expect(creates()).toHaveLength(0);

    act(() => {
      latestHookState?.setTutorHoldActive(false);
    });
    // Releasing the hold fires the held response exactly once — no double-fire
    // from both the speculative attempt and the serial attempt having queued.
    expect(creates()).toHaveLength(1);
  });
});
