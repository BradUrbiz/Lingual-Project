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
    apiPostMock.mockImplementation(async (url: string) => {
      if (url === '/realtime/session') {
        return {
          data: {
            client_secret: 'test-client-secret',
          },
        } as Awaited<ReturnType<typeof api.post>>;
      }

      if (url === '/realtime/connect') {
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
});
