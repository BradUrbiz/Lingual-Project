import { useState, useCallback, useRef, useEffect } from 'react';
import api from '../api';

interface RealtimeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isFinal?: boolean;
}

interface UseRealtimeChatOptions {
  onMessage?: (role: 'user' | 'assistant', content: string) => void;
  sessionParams?: unknown;
}

interface UseRealtimeChatReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  messages: RealtimeMessage[];
  remoteAudioStream: MediaStream | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  clearMessages: () => void;
}

type RealtimeContentItem = {
  type?: string;
  transcript?: string;
  text?: string;
};

type RealtimeItem = {
  id?: string;
  role?: string;
  type?: string;
  content?: RealtimeContentItem[];
};

type RealtimeServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  item?: RealtimeItem;
  session?: { input_audio_transcription?: unknown };
  response?: { id?: string };
  error?: { message?: string };
};

const ASSISTANT_TRANSCRIPT_DELTA_EVENTS = new Set([
  'response.audio_transcript.delta',
  'response.output_audio_transcript.delta',
  'response.output_text.delta',
]);

const ASSISTANT_TRANSCRIPT_DONE_EVENTS = new Set([
  'response.audio_transcript.done',
  'response.output_audio_transcript.done',
]);

const ASSISTANT_AUDIO_ACTIVE_EVENTS = new Set([
  'response.audio.delta',
  'response.output_audio.delta',
]);

const ASSISTANT_AUDIO_DONE_EVENTS = new Set([
  'response.audio.done',
  'response.output_audio.done',
  'output_audio_buffer.cleared',
]);

function extractItemText(item?: RealtimeItem): string | null {
  if (!item?.content?.length) return null;

  for (const contentPart of item.content) {
    const text = contentPart.transcript ?? contentPart.text;
    if (text && text.trim()) {
      return text;
    }
  }

  return null;
}

function resolveRole(item: RealtimeItem | undefined, fallback: 'user' | 'assistant'): 'user' | 'assistant' {
  if (item?.role === 'user') return 'user';
  if (item?.role === 'assistant') return 'assistant';
  return fallback;
}

export function useRealtimeChat(options?: UseRealtimeChatOptions): UseRealtimeChatReturn {
  const onMessageCallback = options?.onMessage;
  const sessionParams = options?.sessionParams;
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const finalizedItemsRef = useRef<Set<string>>(new Set());
  const messageContentRef = useRef<Map<string, string>>(new Map());
  const messageTimestampRef = useRef<Map<string, string>>(new Map());
  const currentResponseIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef(false);

  const resetMessageTracking = useCallback(() => {
    finalizedItemsRef.current.clear();
    messageContentRef.current.clear();
    messageTimestampRef.current.clear();
  }, []);

  const upsertMessage = useCallback(
    (
      role: 'user' | 'assistant',
      content: string,
      itemId: string,
      mode: 'append' | 'replace',
      isFinal = false
    ) => {
      const previousContent = messageContentRef.current.get(itemId) ?? '';
      const nextContent = mode === 'append' ? `${previousContent}${content}` : content;
      const timestamp = messageTimestampRef.current.get(itemId) ?? new Date().toISOString();

      messageContentRef.current.set(itemId, nextContent);
      messageTimestampRef.current.set(itemId, timestamp);

      setMessages((prev) => {
        const existingIndex = prev.findIndex((message) => message.id === itemId);
        if (existingIndex === -1) {
          return [...prev, { id: itemId, role, content: nextContent, timestamp, isFinal }];
        }

        const currentMessage = prev[existingIndex];
        if (
          currentMessage.role === role &&
          currentMessage.content === nextContent &&
          currentMessage.isFinal === isFinal
        ) {
          return prev;
        }

        const nextMessages = [...prev];
        nextMessages[existingIndex] = {
          ...currentMessage,
          role,
          content: nextContent,
          isFinal,
        };
        return nextMessages;
      });

      return nextContent;
    },
    []
  );

  const appendTranscript = useCallback(
    (role: 'user' | 'assistant', delta: string, itemId?: string) => {
      if (!itemId || delta.length === 0) return;
      upsertMessage(role, delta, itemId, 'append', false);
    },
    [upsertMessage]
  );

  const finalizeTranscript = useCallback(
    (role: 'user' | 'assistant', content?: string, itemId?: string) => {
      const resolvedItemId = itemId || `${role}-${Date.now()}`;
      const resolvedContent = content ?? messageContentRef.current.get(resolvedItemId) ?? '';
      if (!resolvedContent.trim()) return;

      const nextContent = upsertMessage(role, resolvedContent, resolvedItemId, 'replace', true);
      if (!finalizedItemsRef.current.has(resolvedItemId)) {
        finalizedItemsRef.current.add(resolvedItemId);
        onMessageCallback?.(role, nextContent.trim());
      }
    },
    [onMessageCallback, upsertMessage]
  );

  const cleanupConnection = useCallback(() => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }

    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setRemoteAudioStream(null);

    currentResponseIdRef.current = null;
    isSpeakingRef.current = false;
  }, []);

  const sendClientEvent = useCallback((payload: Record<string, unknown>) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const cancelCurrentResponse = useCallback(() => {
    sendClientEvent({ type: 'response.cancel' });
  }, [sendClientEvent]);

  const clearOutputAudioBuffer = useCallback(() => {
    sendClientEvent({ type: 'output_audio_buffer.clear' });
  }, [sendClientEvent]);

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      const itemId = event.item_id || event.item?.id;

      if (ASSISTANT_TRANSCRIPT_DELTA_EVENTS.has(event.type)) {
        appendTranscript('assistant', event.delta ?? event.transcript ?? '', itemId);
        return;
      }

      if (ASSISTANT_TRANSCRIPT_DONE_EVENTS.has(event.type)) {
        finalizeTranscript('assistant', event.transcript, itemId);
        return;
      }

      if (ASSISTANT_AUDIO_ACTIVE_EVENTS.has(event.type)) {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setIsSpeaking(true);
        }
        return;
      }

      if (ASSISTANT_AUDIO_DONE_EVENTS.has(event.type)) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        return;
      }

      switch (event.type) {
        case 'session.created':
          finalizedItemsRef.current.clear();
          break;

        case 'response.created':
          currentResponseIdRef.current = event.response?.id || null;
          break;

        case 'response.output_item.done': {
          const role = resolveRole(event.item, 'assistant');
          const text = extractItemText(event.item);
          if (text) {
            finalizeTranscript(role, text, itemId);
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.delta':
          appendTranscript('user', event.delta ?? event.transcript ?? '', itemId);
          break;

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.done':
          finalizeTranscript('user', event.transcript, itemId);
          break;

        case 'conversation.item.input_audio_transcription.failed':
          if (event.error?.message) {
            setError(event.error.message);
          }
          break;

        case 'input_audio_buffer.speech_started':
          setIsListening(true);
          if (isSpeakingRef.current) {
            cancelCurrentResponse();
            clearOutputAudioBuffer();
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          setIsListening(false);
          break;

        case 'response.done':
          currentResponseIdRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          break;

        case 'error':
          setError(event.error?.message || 'Unknown error');
          currentResponseIdRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          break;
      }
    },
    [appendTranscript, cancelCurrentResponse, clearOutputAudioBuffer, finalizeTranscript]
  );

  const connect = useCallback(async () => {
    cleanupConnection();

    try {
      setError(null);

      const tokenResponse = await api.post('/realtime/session', sessionParams ?? {});
      const { client_secret } = tokenResponse.data;

      if (!client_secret) {
        throw new Error('Failed to get session token');
      }

      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? null;
        audioEl.srcObject = stream;
        setRemoteAudioStream(stream);
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      dc.onopen = () => {
        setIsConnected(true);
      };

      dc.onmessage = (event) => {
        try {
          handleServerEvent(JSON.parse(event.data) as RealtimeServerEvent);
        } catch {
          setError('Received an invalid realtime event.');
        }
      };

      dc.onclose = () => {
        setIsConnected(false);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch('https://api.openai.com/v1/realtime?model=gpt-realtime-mini', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client_secret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error(`Failed to connect: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });
    } catch (err) {
      cleanupConnection();
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      console.error('Realtime connection error:', err);
    }
  }, [cleanupConnection, handleServerEvent, sessionParams]);

  const disconnect = useCallback(() => {
    cleanupConnection();
  }, [cleanupConnection]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const startListening = useCallback(() => {
    sendClientEvent({ type: 'input_audio_buffer.clear' });
  }, [sendClientEvent]);

  const stopListening = useCallback(() => {
    sendClientEvent({ type: 'input_audio_buffer.commit' });
  }, [sendClientEvent]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    resetMessageTracking();
  }, [resetMessageTracking]);

  return {
    isConnected,
    isListening,
    isSpeaking,
    messages,
    remoteAudioStream,
    error,
    connect,
    disconnect,
    startListening,
    stopListening,
    clearMessages,
  };
}
