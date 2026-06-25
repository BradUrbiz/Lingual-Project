import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import { useRealtimeChat } from './useRealtimeChat';

vi.mock('../api', () => ({
  default: {
    post: vi.fn(),
  },
}));

const apiPostMock = vi.mocked(api.post);

let latestHookState: ReturnType<typeof useRealtimeChat> | null = null;
let sentClientEvents: Array<Record<string, unknown>> = [];
let activeDataChannel: MockRTCDataChannel | null = null;

class MockRTCDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  send(payload: string) {
    sentClientEvents.push(JSON.parse(payload) as Record<string, unknown>);
  }

  close() {
    this.readyState = 'closed';
    this.onclose?.(new Event('close'));
  }

  open() {
    this.readyState = 'open';
    this.onopen?.(new Event('open'));
  }

  emitServerEvent(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

class MockRTCPeerConnection {
  ontrack: ((event: RTCTrackEvent) => void) | null = null;

  addTrack() {
    return undefined;
  }

  createDataChannel() {
    activeDataChannel = new MockRTCDataChannel();
    return activeDataChannel as unknown as RTCDataChannel;
  }

  async createOffer() {
    return {
      type: 'offer' as const,
      sdp: 'mock-offer-sdp',
    };
  }

  async setLocalDescription() {
    return undefined;
  }

  async setRemoteDescription() {
    return undefined;
  }

  close() {
    return undefined;
  }
}

function HookHarness() {
  const hookState = useRealtimeChat();

  useEffect(() => {
    latestHookState = hookState;
  }, [hookState]);

  return null;
}

describe('useRealtimeChat directive continuation', () => {
  beforeEach(() => {
    latestHookState = null;
    sentClientEvents = [];
    activeDataChannel = null;

    apiPostMock.mockReset();
    apiPostMock.mockImplementation(async (url: string, body?: unknown) => {
      if (url === '/realtime/session') {
        return {
          data: {
            client_secret: 'test-client-secret',
          },
        } as Awaited<ReturnType<typeof api.post>>;
      }

      if (url === '/realtime/connect') {
        expect(body).toEqual({
          offerSdp: 'mock-offer-sdp',
          clientSecret: 'test-client-secret',
        });
        return {
          data: {
            answerSdp: 'mock-answer-sdp',
          },
        } as Awaited<ReturnType<typeof api.post>>;
      }

      throw new Error(`Unexpected api.post call: ${url}`);
    });

    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);

    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [
            {
              stop: vi.fn(),
            },
          ],
        })),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the microphone with echo cancellation, noise suppression, and auto gain', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    const getUserMediaMock = vi.mocked(window.navigator.mediaDevices.getUserMedia);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it('waits for response.done before continuing a directive tool call and ignores duplicate done events', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    expect(activeDataChannel).not.toBeNull();

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'response.created',
        response: { id: 'resp_1' },
      });
      activeDataChannel?.emitServerEvent({
        type: 'response.output_item.added',
        item_id: 'item_1',
        item: {
          id: 'item_1',
          type: 'function_call',
          name: 'emit_avatar_directive',
          call_id: 'call_1',
        },
      });
      activeDataChannel?.emitServerEvent({
        type: 'response.function_call_arguments.done',
        item_id: 'item_1',
        arguments: JSON.stringify({ motionRef: 'speaking_base' }),
        call_id: 'call_1',
        name: 'emit_avatar_directive',
      });
    });

    expect(sentClientEvents).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: JSON.stringify({ ok: true }),
        },
      },
    ]);

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'response.output_item.done',
        item_id: 'item_1',
        item: {
          id: 'item_1',
          type: 'function_call',
          name: 'emit_avatar_directive',
          call_id: 'call_1',
          arguments: JSON.stringify({ motionRef: 'speaking_base' }),
        },
      });
    });

    expect(sentClientEvents).toHaveLength(1);

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'response.done',
      });
    });

    expect(sentClientEvents).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: JSON.stringify({ ok: true }),
        },
      },
      {
        type: 'response.create',
      },
    ]);
  });

  it('deletes ignored stray user turns instead of creating a response', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'input_audio_buffer.speech_started',
      });
      activeDataChannel?.emitServerEvent({
        type: 'input_audio_buffer.speech_stopped',
      });
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.done',
        item_id: 'user_1',
        transcript: 'okay',
      });
    });

    expect(sentClientEvents).toContainEqual({
      type: 'conversation.item.delete',
      item_id: 'user_1',
    });

    expect(sentClientEvents).not.toContainEqual({
      type: 'response.create',
    });
  });

  it('creates a response for accepted learner turns after transcription completes', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'input_audio_buffer.speech_started',
      });
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.done',
        item_id: 'user_2',
        transcript: 'Can you help me practice ordering coffee?',
      });
    });

    expect(sentClientEvents).toContainEqual({
      type: 'response.create',
    });
  });

  it('updates realtime tutor speaking speed through the data channel', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    let didSend = false;
    act(() => {
      didSend = latestHookState?.updateSpeakingSpeed(1.3) ?? false;
    });

    expect(didSend).toBe(true);
    expect(sentClientEvents).toContainEqual({
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          output: {
            speed: 1.3,
          },
        },
      },
    });
  });

  it('injectPromoteBack queues a system coach note and flushes at the breakpoint', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    // At breakpoint: connected, not listening, not speaking, no active response
    act(() => {
      latestHookState?.injectPromoteBack('COACH NOTE: try voy');
    });

    // Should have sent conversation.item.create with a system message and then response.create
    const item = sentClientEvents.find((p) => p.type === 'conversation.item.create') as Record<string, unknown> | undefined;
    const itemContent = (item?.item as Record<string, unknown> | undefined)?.content as Array<Record<string, unknown>> | undefined;
    expect(itemContent?.[0]?.text).toBe('COACH NOTE: try voy');
    expect(sentClientEvents.some((p) => p.type === 'response.create')).toBe(true);
  });

  it('holds accepted learner turns until the student releases the tutor hold', async () => {
    render(<HookHarness />);

    await act(async () => {
      await latestHookState?.connect();
    });

    act(() => {
      activeDataChannel?.open();
    });

    await waitFor(() => {
      expect(latestHookState?.isConnected).toBe(true);
    });

    act(() => {
      latestHookState?.setTutorHoldActive(true);
    });

    act(() => {
      activeDataChannel?.emitServerEvent({
        type: 'input_audio_buffer.speech_started',
      });
      activeDataChannel?.emitServerEvent({
        type: 'conversation.item.input_audio_transcription.done',
        item_id: 'user_3',
        transcript: 'I want to say one more thing about the restaurant.',
      });
    });

    expect(sentClientEvents).not.toContainEqual({
      type: 'response.create',
    });
    expect(latestHookState?.hasHeldTutorResponse).toBe(true);

    act(() => {
      latestHookState?.setTutorHoldActive(false);
    });

    expect(sentClientEvents).toContainEqual({
      type: 'response.create',
    });
    expect(latestHookState?.hasHeldTutorResponse).toBe(false);
  });
});
