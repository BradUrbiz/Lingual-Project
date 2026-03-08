import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarDebugStats, AvatarDiagnostics, AvatarDirective } from '@/components/avatar/types';
import api from '../api';
import {
  buildBaseAvatarDiagnostics,
  parseAvatarDirectiveArguments,
  shouldTriggerAvatarContextResponse,
} from './realtimeAvatar';

interface RealtimeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isFinal?: boolean;
  sortOrder: number;
}

type RealtimeSessionParams = {
  uiLanguage?: string;
  practice?: unknown;
  [key: string]: unknown;
};

interface UseRealtimeChatOptions {
  onMessage?: (role: 'user' | 'assistant', content: string) => void;
  sessionParams?: RealtimeSessionParams;
}

interface UseRealtimeChatReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  messages: RealtimeMessage[];
  remoteAudioStream: MediaStream | null;
  assistantTranscriptDelta: string;
  assistantTranscriptFinal: string;
  assistantSpeechStartedAt: number | null;
  assistantSpeechEndedAt: number | null;
  avatarDirective: AvatarDirective | null;
  avatarDirectiveSource: 'directive' | 'fallback';
  avatarDiagnostics: AvatarDiagnostics;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  clearMessages: () => void;
  queueAvatarHit: (area: string) => Promise<void>;
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
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: RealtimeContentItem[];
};

type RealtimeServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  item?: RealtimeItem;
  session?: { input_audio_transcription?: unknown };
  response?: { id?: string };
  error?: { message?: string };
};

type AvatarContextResponse = {
  systemMessage?: string;
  reactionIntent?: string;
  subtitleText?: string;
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

const DIRECTIVE_TOOL_NAME = 'emit_avatar_directive';

function createEmptyAvatarDebugStats(): AvatarDebugStats {
  return {
    directiveEventCount: 0,
    avatarHitCount: 0,
    assistantSpeechTurnCount: 0,
    directiveSpeechTurnCount: 0,
    fallbackSpeechTurnCount: 0,
  };
}

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
  const [assistantTranscriptDelta, setAssistantTranscriptDelta] = useState('');
  const [assistantTranscriptFinal, setAssistantTranscriptFinal] = useState('');
  const [assistantSpeechStartedAt, setAssistantSpeechStartedAt] = useState<number | null>(null);
  const [assistantSpeechEndedAt, setAssistantSpeechEndedAt] = useState<number | null>(null);
  const [avatarDirective, setAvatarDirective] = useState<AvatarDirective | null>(null);
  const [avatarDebugStats, setAvatarDebugStats] = useState<AvatarDebugStats>(() => createEmptyAvatarDebugStats());
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const finalizedItemsRef = useRef<Set<string>>(new Set());
  const messageContentRef = useRef<Map<string, string>>(new Map());
  const messageTimestampRef = useRef<Map<string, string>>(new Map());
  const messageOrderRef = useRef<Map<string, number>>(new Map());
  const nextMessageOrderRef = useRef(0);
  const pendingUserOrderRef = useRef<number | null>(null);
  const pendingAssistantOrderRef = useRef<number | null>(null);
  const currentResponseIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef(false);
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const assistantTranscriptDeltaRef = useRef('');
  const assistantSpeechStartedAtRef = useRef<number | null>(null);
  const directiveResetTimeoutRef = useRef<number | null>(null);
  const directiveArgumentBufferRef = useRef<Map<string, string>>(new Map());
  const directiveCallRef = useRef<Map<string, { callId: string | null; name: string | null }>>(new Map());
  const completedDirectiveCallsRef = useRef<Set<string>>(new Set());
  const pendingDirectiveContinuationRef = useRef(false);
  const queuedAvatarContextsRef = useRef<AvatarContextResponse[]>([]);
  const pendingSpeechTurnHasDirectiveRef = useRef(false);
  const currentSpeechTurnCountedRef = useRef(false);

  const updateAvatarDebugStats = useCallback((updater: (current: AvatarDebugStats) => AvatarDebugStats) => {
    setAvatarDebugStats((current) => updater(current));
  }, []);

  const clearAvatarDirective = useCallback(() => {
    if (directiveResetTimeoutRef.current !== null) {
      window.clearTimeout(directiveResetTimeoutRef.current);
      directiveResetTimeoutRef.current = null;
    }
    setAvatarDirective(null);
  }, []);

  const applyAvatarDirective = useCallback((directive: AvatarDirective | null) => {
    if (!directive) return;

    if (directiveResetTimeoutRef.current !== null) {
      window.clearTimeout(directiveResetTimeoutRef.current);
      directiveResetTimeoutRef.current = null;
    }

    pendingSpeechTurnHasDirectiveRef.current = true;
    updateAvatarDebugStats((current) => ({
      ...current,
      directiveEventCount: current.directiveEventCount + 1,
    }));
    setAvatarDirective(directive);

    if (directive.holdMs) {
      directiveResetTimeoutRef.current = window.setTimeout(() => {
        setAvatarDirective(null);
        directiveResetTimeoutRef.current = null;
      }, directive.holdMs);
    }
  }, [updateAvatarDebugStats]);

  const resetMessageTracking = useCallback(() => {
    finalizedItemsRef.current.clear();
    messageContentRef.current.clear();
    messageTimestampRef.current.clear();
    messageOrderRef.current.clear();
    nextMessageOrderRef.current = 0;
    pendingUserOrderRef.current = null;
    pendingAssistantOrderRef.current = null;
  }, []);

  const resetAssistantPerformanceState = useCallback(() => {
    assistantTranscriptDeltaRef.current = '';
    assistantSpeechStartedAtRef.current = null;
    setAssistantTranscriptDelta('');
    setAssistantTranscriptFinal('');
    setAssistantSpeechStartedAt(null);
    setAssistantSpeechEndedAt(null);
  }, []);

  const ensureMessageOrder = useCallback((itemId: string) => {
    const existingOrder = messageOrderRef.current.get(itemId);
    if (existingOrder !== undefined) {
      return existingOrder;
    }

    const nextOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;
    messageOrderRef.current.set(itemId, nextOrder);
    return nextOrder;
  }, []);

  const reservePendingMessageOrder = useCallback((role: 'user' | 'assistant') => {
    const pendingOrderRef = role === 'user' ? pendingUserOrderRef : pendingAssistantOrderRef;
    if (pendingOrderRef.current !== null) {
      return pendingOrderRef.current;
    }

    const nextOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;
    pendingOrderRef.current = nextOrder;
    return nextOrder;
  }, []);

  const adoptPendingMessageOrder = useCallback((role: 'user' | 'assistant', itemId?: string) => {
    if (!itemId) return;

    const existingOrder = messageOrderRef.current.get(itemId);
    if (existingOrder !== undefined) {
      return existingOrder;
    }

    const pendingOrderRef = role === 'user' ? pendingUserOrderRef : pendingAssistantOrderRef;
    const pendingOrder = pendingOrderRef.current;
    if (pendingOrder === null) {
      return undefined;
    }

    pendingOrderRef.current = null;
    messageOrderRef.current.set(itemId, pendingOrder);
    if (nextMessageOrderRef.current <= pendingOrder) {
      nextMessageOrderRef.current = pendingOrder + 1;
    }
    return pendingOrder;
  }, []);

  const reserveMessageOrder = useCallback((item?: RealtimeItem, itemId?: string) => {
    const resolvedItemId = itemId ?? item?.id;
    if (!resolvedItemId) return;
    if (item?.type && item.type !== 'message') return;
    const role = resolveRole(item, 'assistant');
    adoptPendingMessageOrder(role, resolvedItemId);
    ensureMessageOrder(resolvedItemId);
  }, [adoptPendingMessageOrder, ensureMessageOrder]);

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
      const sortOrder = ensureMessageOrder(itemId);

      messageContentRef.current.set(itemId, nextContent);
      messageTimestampRef.current.set(itemId, timestamp);

      setMessages((prev) => {
        const existingIndex = prev.findIndex((message) => message.id === itemId);
        if (existingIndex === -1) {
          return [...prev, { id: itemId, role, content: nextContent, timestamp, isFinal, sortOrder }]
            .sort((first, second) => first.sortOrder - second.sortOrder);
        }

        const currentMessage = prev[existingIndex];
        if (
          currentMessage.role === role &&
          currentMessage.content === nextContent &&
          currentMessage.isFinal === isFinal &&
          currentMessage.sortOrder === sortOrder
        ) {
          return prev;
        }

        const nextMessages = [...prev];
        nextMessages[existingIndex] = {
          ...currentMessage,
          role,
          content: nextContent,
          isFinal,
          sortOrder,
        };
        return nextMessages;
      });

      return nextContent;
    },
    [ensureMessageOrder]
  );

  const appendTranscript = useCallback(
    (role: 'user' | 'assistant', delta: string, itemId?: string) => {
      if (!itemId || delta.length === 0) return;
      adoptPendingMessageOrder(role, itemId);
      const nextContent = upsertMessage(role, delta, itemId, 'append', false);
      if (role === 'assistant') {
        assistantTranscriptDeltaRef.current = nextContent;
        setAssistantTranscriptDelta(nextContent);
      }
    },
    [adoptPendingMessageOrder, upsertMessage]
  );

  const finalizeTranscript = useCallback(
    (role: 'user' | 'assistant', content?: string, itemId?: string) => {
      const resolvedItemId = itemId || `${role}-${Date.now()}`;
      const resolvedContent = content ?? messageContentRef.current.get(resolvedItemId) ?? '';
      if (!resolvedContent.trim()) return;

      adoptPendingMessageOrder(role, resolvedItemId);
      const nextContent = upsertMessage(role, resolvedContent, resolvedItemId, 'replace', true);
      if (role === 'assistant') {
        assistantTranscriptDeltaRef.current = nextContent;
        setAssistantTranscriptDelta(nextContent);
        setAssistantTranscriptFinal(nextContent);
      }
      if (!finalizedItemsRef.current.has(resolvedItemId)) {
        finalizedItemsRef.current.add(resolvedItemId);
        onMessageCallback?.(role, nextContent.trim());
      }
    },
    [adoptPendingMessageOrder, onMessageCallback, upsertMessage]
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
    isConnectedRef.current = false;
    isListeningRef.current = false;
    isSpeakingRef.current = false;

    currentResponseIdRef.current = null;
    directiveArgumentBufferRef.current.clear();
    directiveCallRef.current.clear();
    completedDirectiveCallsRef.current.clear();
    pendingDirectiveContinuationRef.current = false;
    queuedAvatarContextsRef.current = [];
    pendingSpeechTurnHasDirectiveRef.current = false;
    currentSpeechTurnCountedRef.current = false;
    setAvatarDebugStats(createEmptyAvatarDebugStats());
    resetAssistantPerformanceState();
    clearAvatarDirective();
  }, [clearAvatarDirective, resetAssistantPerformanceState]);

  const sendClientEvent = useCallback((payload: Record<string, unknown>) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const createConversationItem = useCallback((item: Record<string, unknown>) => {
    return sendClientEvent({
      type: 'conversation.item.create',
      item,
    });
  }, [sendClientEvent]);

  const createRealtimeResponse = useCallback(() => {
    return sendClientEvent({ type: 'response.create' });
  }, [sendClientEvent]);

  const cancelCurrentResponse = useCallback(() => {
    sendClientEvent({ type: 'response.cancel' });
  }, [sendClientEvent]);

  const clearOutputAudioBuffer = useCallback(() => {
    sendClientEvent({ type: 'output_audio_buffer.clear' });
  }, [sendClientEvent]);

  const acknowledgeFunctionCall = useCallback((callId: string | null, ok: boolean) => {
    if (!callId) return;
    createConversationItem({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify({ ok }),
    });
  }, [createConversationItem]);

  const maybeContinueAfterDirectiveTool = useCallback(() => {
    if (!pendingDirectiveContinuationRef.current || currentResponseIdRef.current) {
      return false;
    }

    pendingDirectiveContinuationRef.current = false;
    createRealtimeResponse();
    return true;
  }, [createRealtimeResponse]);

  const flushQueuedAvatarContexts = useCallback(() => {
    if (!shouldTriggerAvatarContextResponse({
      isConnected: isConnectedRef.current,
      isListening: isListeningRef.current,
      isSpeaking: isSpeakingRef.current,
      currentResponseId: currentResponseIdRef.current,
    })) {
      return false;
    }

    const queuedItems = queuedAvatarContextsRef.current.splice(0);
    if (!queuedItems.length) {
      return false;
    }

    for (const item of queuedItems) {
      if (!item.systemMessage?.trim()) continue;
      createConversationItem({
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: item.systemMessage,
          },
        ],
      });
    }

    createRealtimeResponse();
    return true;
  }, [createConversationItem, createRealtimeResponse]);

  const completeDirectiveToolCall = useCallback((itemId: string, argsString?: string, eventCallId?: string | null, eventName?: string | null) => {
    const meta = directiveCallRef.current.get(itemId);
    const resolvedName = eventName ?? meta?.name ?? null;
    if (resolvedName !== DIRECTIVE_TOOL_NAME) {
      directiveArgumentBufferRef.current.delete(itemId);
      directiveCallRef.current.delete(itemId);
      return;
    }

    const resolvedCallId = eventCallId ?? meta?.callId ?? null;
    if (resolvedCallId && completedDirectiveCallsRef.current.has(resolvedCallId)) {
      directiveArgumentBufferRef.current.delete(itemId);
      directiveCallRef.current.delete(itemId);
      return;
    }

    const serializedArguments = argsString ?? directiveArgumentBufferRef.current.get(itemId) ?? '';
    const directive = parseAvatarDirectiveArguments(serializedArguments);

    if (directive) {
      applyAvatarDirective(directive);
    }
    acknowledgeFunctionCall(resolvedCallId, Boolean(directive));
    if (resolvedCallId) {
      completedDirectiveCallsRef.current.add(resolvedCallId);
    }
    pendingDirectiveContinuationRef.current = true;
    maybeContinueAfterDirectiveTool();

    directiveArgumentBufferRef.current.delete(itemId);
    directiveCallRef.current.delete(itemId);
  }, [acknowledgeFunctionCall, applyAvatarDirective, maybeContinueAfterDirectiveTool]);

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
          const startedAt = Date.now();
          isSpeakingRef.current = true;
          assistantSpeechStartedAtRef.current = startedAt;
          if (!currentSpeechTurnCountedRef.current) {
            currentSpeechTurnCountedRef.current = true;
            const usedDirective = pendingSpeechTurnHasDirectiveRef.current;
            updateAvatarDebugStats((current) => ({
              ...current,
              assistantSpeechTurnCount: current.assistantSpeechTurnCount + 1,
              directiveSpeechTurnCount: current.directiveSpeechTurnCount + (usedDirective ? 1 : 0),
              fallbackSpeechTurnCount: current.fallbackSpeechTurnCount + (usedDirective ? 0 : 1),
            }));
          }
          setIsSpeaking(true);
          setAssistantSpeechStartedAt(startedAt);
          setAssistantSpeechEndedAt(null);
        }
        return;
      }

      if (ASSISTANT_AUDIO_DONE_EVENTS.has(event.type)) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setAssistantSpeechEndedAt(Date.now());
        flushQueuedAvatarContexts();
        return;
      }

      switch (event.type) {
        case 'session.created':
          resetMessageTracking();
          resetAssistantPerformanceState();
          directiveArgumentBufferRef.current.clear();
          directiveCallRef.current.clear();
          completedDirectiveCallsRef.current.clear();
          pendingDirectiveContinuationRef.current = false;
          clearAvatarDirective();
          break;

        case 'conversation.item.created':
        case 'conversation.item.added':
        case 'response.output_item.added':
          reserveMessageOrder(event.item, itemId);
          if (itemId && event.item?.type === 'function_call') {
            directiveCallRef.current.set(itemId, {
              callId: event.item.call_id ?? event.call_id ?? null,
              name: event.item.name ?? event.name ?? null,
            });
            if (typeof event.item.arguments === 'string') {
              directiveArgumentBufferRef.current.set(itemId, event.item.arguments);
            }
          }
          break;

        case 'response.created':
          reservePendingMessageOrder('assistant');
          currentResponseIdRef.current = event.response?.id || null;
          currentSpeechTurnCountedRef.current = false;
          assistantTranscriptDeltaRef.current = '';
          assistantSpeechStartedAtRef.current = null;
          setAssistantTranscriptDelta('');
          setAssistantTranscriptFinal('');
          setAssistantSpeechStartedAt(null);
          setAssistantSpeechEndedAt(null);
          break;

        case 'response.function_call_arguments.delta':
          if (itemId) {
            const previous = directiveArgumentBufferRef.current.get(itemId) ?? '';
            directiveArgumentBufferRef.current.set(itemId, `${previous}${event.delta ?? ''}`);
          }
          break;

        case 'response.function_call_arguments.done':
          if (itemId) {
            completeDirectiveToolCall(
              itemId,
              event.arguments ?? event.item?.arguments,
              event.call_id ?? event.item?.call_id ?? null,
              event.name ?? event.item?.name ?? null
            );
          }
          break;

        case 'response.output_item.done':
          if (event.item?.type === 'function_call' && itemId) {
            completeDirectiveToolCall(
              itemId,
              event.item.arguments,
              event.item.call_id ?? event.call_id ?? null,
              event.item.name ?? event.name ?? null
            );
            break;
          }

          {
            const role = resolveRole(event.item, 'assistant');
            const text = extractItemText(event.item);
            if (text) {
              finalizeTranscript(role, text, itemId);
            }
          }
          break;

        case 'conversation.item.input_audio_transcription.delta':
          appendTranscript('user', event.delta ?? event.transcript ?? '', itemId);
          break;

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.done':
          finalizeTranscript('user', event.transcript, itemId);
          break;

        case 'conversation.item.input_audio_transcription.failed':
          pendingUserOrderRef.current = null;
          if (event.error?.message) {
            setError(event.error.message);
          }
          break;

        case 'input_audio_buffer.speech_started':
          reservePendingMessageOrder('user');
          pendingDirectiveContinuationRef.current = false;
          pendingSpeechTurnHasDirectiveRef.current = false;
          currentSpeechTurnCountedRef.current = false;
          isListeningRef.current = true;
          setIsListening(true);
          resetAssistantPerformanceState();
          if (isSpeakingRef.current) {
            cancelCurrentResponse();
            clearOutputAudioBuffer();
            pendingAssistantOrderRef.current = null;
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          reserveMessageOrder(undefined, itemId);
          isListeningRef.current = false;
          setIsListening(false);
          flushQueuedAvatarContexts();
          break;

        case 'response.done':
          currentResponseIdRef.current = null;
          if (!assistantTranscriptDeltaRef.current.trim()) {
            pendingAssistantOrderRef.current = null;
          }
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          if (assistantSpeechStartedAtRef.current === null && assistantTranscriptDeltaRef.current.trim()) {
            setAssistantSpeechEndedAt(Date.now());
          }
          if (maybeContinueAfterDirectiveTool()) {
            break;
          }
          flushQueuedAvatarContexts();
          break;

        case 'error':
          setError(event.error?.message || 'Unknown error');
          currentResponseIdRef.current = null;
          pendingDirectiveContinuationRef.current = false;
          pendingAssistantOrderRef.current = null;
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          break;
      }
    },
    [
      appendTranscript,
      cancelCurrentResponse,
      clearAvatarDirective,
      clearOutputAudioBuffer,
      completeDirectiveToolCall,
      finalizeTranscript,
      flushQueuedAvatarContexts,
      maybeContinueAfterDirectiveTool,
      reserveMessageOrder,
      reservePendingMessageOrder,
      resetAssistantPerformanceState,
      resetMessageTracking,
      updateAvatarDebugStats,
    ]
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
        isConnectedRef.current = true;
        setIsConnected(true);
        flushQueuedAvatarContexts();
      };

      dc.onmessage = (event) => {
        try {
          handleServerEvent(JSON.parse(event.data) as RealtimeServerEvent);
        } catch {
          setError('Received an invalid realtime event.');
        }
      };

      dc.onclose = () => {
        isConnectedRef.current = false;
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
  }, [cleanupConnection, flushQueuedAvatarContexts, handleServerEvent, sessionParams]);

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
    resetAssistantPerformanceState();
    directiveArgumentBufferRef.current.clear();
    directiveCallRef.current.clear();
    completedDirectiveCallsRef.current.clear();
    pendingDirectiveContinuationRef.current = false;
    clearAvatarDirective();
  }, [clearAvatarDirective, resetAssistantPerformanceState, resetMessageTracking]);

  const queueAvatarHit = useCallback(async (area: string) => {
    if (!area.trim()) return;

    updateAvatarDebugStats((current) => ({
      ...current,
      avatarHitCount: current.avatarHitCount + 1,
    }));

    try {
      const response = await api.post('/realtime/avatar-context', {
        area,
        practice: sessionParams?.practice ?? null,
        mode: 'realtime',
      });

      const payload = response.data as AvatarContextResponse;
      if (!payload.systemMessage?.trim()) {
        return;
      }

      queuedAvatarContextsRef.current.push(payload);
      flushQueuedAvatarContexts();
    } catch (avatarContextError) {
      console.error('Failed to queue avatar context:', avatarContextError);
    }
  }, [flushQueuedAvatarContexts, sessionParams, updateAvatarDebugStats]);

  const avatarDiagnostics = useMemo(
    () =>
      buildBaseAvatarDiagnostics({
        hasRemoteAudio: Boolean(remoteAudioStream),
        isListening,
        isSpeaking,
        hasPendingAssistantTranscript: Boolean(assistantTranscriptDelta.trim() || assistantTranscriptFinal.trim()),
        lastExplicitDirective: avatarDirective,
        directiveRequested: sessionParams?.avatarDirectives === true,
        stats: avatarDebugStats,
      }),
    [assistantTranscriptDelta, assistantTranscriptFinal, avatarDebugStats, avatarDirective, isListening, isSpeaking, remoteAudioStream, sessionParams]
  );

  return {
    isConnected,
    isListening,
    isSpeaking,
    messages,
    remoteAudioStream,
    assistantTranscriptDelta,
    assistantTranscriptFinal,
    assistantSpeechStartedAt,
    assistantSpeechEndedAt,
    avatarDirective,
    avatarDirectiveSource: avatarDirective ? 'directive' : 'fallback',
    avatarDiagnostics,
    error,
    connect,
    disconnect,
    startListening,
    stopListening,
    clearMessages,
    queueAvatarHit,
  };
}
