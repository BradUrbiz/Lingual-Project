import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeRmsFromByteTimeDomain } from '@/components/avatar/rms';
import type { AvatarDebugStats, AvatarDiagnostics, AvatarDirective } from '@/components/avatar/types';
import api from '../api';
import {
  assistantPromptLikelyExpectsReply,
  createEmptyRealtimeInputTurnMetrics,
  shouldRespondToRealtimeTurn,
} from './realtimeSpeechGate';
import {
  buildBaseAvatarDiagnostics,
  parseAvatarDirectiveArguments,
  shouldTriggerAvatarContextResponse,
} from './realtimeAvatar';
import { useLazyRef } from './useLazyRef';
import { normalizeRealtimeSpeakingSpeed } from '@/lib/realtimeSpeakingSpeed';

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
  speakingSpeed?: number;
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
  isTutorHoldActive: boolean;
  hasHeldTutorResponse: boolean;
  avatarDirective: AvatarDirective | null;
  avatarDirectiveSource: 'directive' | 'fallback';
  avatarDiagnostics: AvatarDiagnostics;
  error: string | null;
  connect: (sessionParamsOverride?: RealtimeSessionParams) => Promise<void>;
  disconnect: () => void;
  updateSpeakingSpeed: (speed: number) => boolean;
  startListening: () => void;
  stopListening: () => void;
  clearMessages: () => void;
  setTutorHoldActive: (active: boolean) => void;
  queueAvatarHit: (area: string) => Promise<void>;
  injectPromoteBack: (prompt: string) => void;
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
  const [isTutorHoldActive, setIsTutorHoldActive] = useState(false);
  const [hasHeldTutorResponse, setHasHeldTutorResponse] = useState(false);
  const [avatarDirective, setAvatarDirective] = useState<AvatarDirective | null>(null);
  const [avatarDebugStats, setAvatarDebugStats] = useState<AvatarDebugStats>(() => createEmptyAvatarDebugStats());
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micMeterFrameRef = useRef<number | null>(null);
  const finalizedItemsRef = useLazyRef(() => new Set<string>());
  const messageContentRef = useLazyRef(() => new Map<string, string>());
  const messageTimestampRef = useLazyRef(() => new Map<string, string>());
  const userTranscriptBufferRef = useLazyRef(() => new Map<string, string>());
  const messageOrderRef = useLazyRef(() => new Map<string, number>());
  const nextMessageOrderRef = useRef(0);
  const pendingUserOrderRef = useRef<number | null>(null);
  const pendingAssistantOrderRef = useRef<number | null>(null);
  const currentResponseIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef(false);
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isTutorHoldActiveRef = useRef(false);
  const hasHeldTutorResponseRef = useRef(false);
  const assistantTranscriptDeltaRef = useRef('');
  const assistantTranscriptFinalRef = useRef('');
  const assistantSpeechStartedAtRef = useRef<number | null>(null);
  const inputSpeechStartedAtRef = useRef<number | null>(null);
  // Authoritative start timestamp for the current user input turn. Unlike
  // `inputSpeechStartedAtRef`, this is NOT cleared by transcription.completed
  // or transcription.failed, so `input_audio_buffer.speech_stopped` can still
  // compute a non-zero duration even if the transcription result lands first.
  // Reset to 0 by speech_started, so any consumer checking `> 0` knows whether
  // a turn is in progress.
  const currentTurnStartedAtRef = useRef<number>(0);
  const currentInputTurnRef = useLazyRef(createEmptyRealtimeInputTurnMetrics);
  const directiveResetTimeoutRef = useRef<number | null>(null);
  const directiveArgumentBufferRef = useLazyRef(() => new Map<string, string>());
  const directiveCallRef = useLazyRef(() => new Map<string, { callId: string | null; name: string | null }>());
  const completedDirectiveCallsRef = useLazyRef(() => new Set<string>());
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
    const finalizedItems = finalizedItemsRef.current;
    const messageContent = messageContentRef.current;
    const messageTimestamp = messageTimestampRef.current;
    const userTranscriptBuffer = userTranscriptBufferRef.current;
    const messageOrder = messageOrderRef.current;

    finalizedItems.clear();
    messageContent.clear();
    messageTimestamp.clear();
    userTranscriptBuffer.clear();
    messageOrder.clear();
    nextMessageOrderRef.current = 0;
    pendingUserOrderRef.current = null;
    pendingAssistantOrderRef.current = null;
  }, [finalizedItemsRef, messageContentRef, messageOrderRef, messageTimestampRef, userTranscriptBufferRef]);

  const resetAssistantPerformanceState = useCallback(() => {
    assistantTranscriptDeltaRef.current = '';
    assistantTranscriptFinalRef.current = '';
    assistantSpeechStartedAtRef.current = null;
    setAssistantTranscriptDelta('');
    setAssistantTranscriptFinal('');
    setAssistantSpeechStartedAt(null);
    setAssistantSpeechEndedAt(null);
  }, []);

  const ensureMessageOrder = useCallback((itemId: string) => {
    const messageOrder = messageOrderRef.current;
    const existingOrder = messageOrder.get(itemId);
    if (existingOrder !== undefined) {
      return existingOrder;
    }

    const nextOrder = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;
    messageOrder.set(itemId, nextOrder);
    return nextOrder;
  }, [messageOrderRef]);

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

    const messageOrder = messageOrderRef.current;
    const existingOrder = messageOrder.get(itemId);
    if (existingOrder !== undefined) {
      return existingOrder;
    }

    const pendingOrderRef = role === 'user' ? pendingUserOrderRef : pendingAssistantOrderRef;
    const pendingOrder = pendingOrderRef.current;
    if (pendingOrder === null) {
      return undefined;
    }

    pendingOrderRef.current = null;
    messageOrder.set(itemId, pendingOrder);
    if (nextMessageOrderRef.current <= pendingOrder) {
      nextMessageOrderRef.current = pendingOrder + 1;
    }
    return pendingOrder;
  }, [messageOrderRef]);

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
      const messageContent = messageContentRef.current;
      const messageTimestamp = messageTimestampRef.current;
      const previousContent = messageContent.get(itemId) ?? '';
      const nextContent = mode === 'append' ? `${previousContent}${content}` : content;
      const timestamp = messageTimestamp.get(itemId) ?? new Date().toISOString();
      const sortOrder = ensureMessageOrder(itemId);

      messageContent.set(itemId, nextContent);
      messageTimestamp.set(itemId, timestamp);

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
    [ensureMessageOrder, messageContentRef, messageTimestampRef]
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
      const messageContent = messageContentRef.current;
      const finalizedItems = finalizedItemsRef.current;
      const resolvedContent = content ?? messageContent.get(resolvedItemId) ?? '';
      if (!resolvedContent.trim()) return;

      adoptPendingMessageOrder(role, resolvedItemId);
      const nextContent = upsertMessage(role, resolvedContent, resolvedItemId, 'replace', true);
      if (role === 'assistant') {
        assistantTranscriptDeltaRef.current = nextContent;
        assistantTranscriptFinalRef.current = nextContent;
        setAssistantTranscriptDelta(nextContent);
        setAssistantTranscriptFinal(nextContent);
      }
      if (!finalizedItems.has(resolvedItemId)) {
        finalizedItems.add(resolvedItemId);
        onMessageCallback?.(role, nextContent.trim());
      }
    },
    [adoptPendingMessageOrder, finalizedItemsRef, messageContentRef, onMessageCallback, upsertMessage]
  );

  const removeMessage = useCallback((itemId?: string) => {
    if (!itemId) return;

    const finalizedItems = finalizedItemsRef.current;
    const userTranscriptBuffer = userTranscriptBufferRef.current;
    const messageContent = messageContentRef.current;
    const messageTimestamp = messageTimestampRef.current;
    const messageOrder = messageOrderRef.current;

    finalizedItems.delete(itemId);
    userTranscriptBuffer.delete(itemId);
    messageContent.delete(itemId);
    messageTimestamp.delete(itemId);
    messageOrder.delete(itemId);

    setMessages((prev) => prev.filter((message) => message.id !== itemId));
  }, [finalizedItemsRef, messageContentRef, messageOrderRef, messageTimestampRef, userTranscriptBufferRef]);

  const ensureMicAnalyser = useCallback(async () => {
    if (!mediaStreamRef.current) {
      return null;
    }

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    if (!micAudioContextRef.current) {
      micAudioContextRef.current = new AudioContextCtor();
    }

    if (!micAnalyserRef.current) {
      micAnalyserRef.current = micAudioContextRef.current.createAnalyser();
      micAnalyserRef.current.fftSize = 1024;
      micAnalyserRef.current.smoothingTimeConstant = 0.18;
    }

    if (!micSourceNodeRef.current) {
      micSourceNodeRef.current = micAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      micSourceNodeRef.current.connect(micAnalyserRef.current);
    }

    if (micAudioContextRef.current.state === 'suspended') {
      await micAudioContextRef.current.resume();
    }

    return micAnalyserRef.current;
  }, []);

  const stopMicMeter = useCallback(() => {
    if (micMeterFrameRef.current !== null) {
      window.cancelAnimationFrame(micMeterFrameRef.current);
      micMeterFrameRef.current = null;
    }
  }, []);

  const startMicMeter = useCallback(async () => {
    const analyser = await ensureMicAnalyser();
    if (!analyser) {
      const currentInputTurn = currentInputTurnRef.current;
      currentInputTurn.hadMicSignal = false;
      return;
    }

    stopMicMeter();
    const waveform = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const currentAnalyser = micAnalyserRef.current;
      if (!currentAnalyser) {
        micMeterFrameRef.current = null;
        return;
      }

      currentAnalyser.getByteTimeDomainData(waveform);
      const rms = computeRmsFromByteTimeDomain(waveform);

      if (inputSpeechStartedAtRef.current !== null) {
        const currentInputTurn = currentInputTurnRef.current;
        currentInputTurn.hadMicSignal = true;
        currentInputTurn.peakRms = Math.max(currentInputTurn.peakRms, rms);
      }

      micMeterFrameRef.current = window.requestAnimationFrame(tick);
    };

    micMeterFrameRef.current = window.requestAnimationFrame(tick);
  }, [currentInputTurnRef, ensureMicAnalyser, stopMicMeter]);

  const cleanupConnection = useCallback(() => {
    stopMicMeter();

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

    if (micSourceNodeRef.current) {
      micSourceNodeRef.current.disconnect();
      micSourceNodeRef.current = null;
    }

    if (micAnalyserRef.current) {
      micAnalyserRef.current.disconnect();
      micAnalyserRef.current = null;
    }

    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close().catch(() => undefined);
      micAudioContextRef.current = null;
    }

    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }

    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setIsTutorHoldActive(false);
    setHasHeldTutorResponse(false);
    setRemoteAudioStream(null);
    isConnectedRef.current = false;
    isListeningRef.current = false;
    isSpeakingRef.current = false;
    isTutorHoldActiveRef.current = false;
    hasHeldTutorResponseRef.current = false;

    currentResponseIdRef.current = null;
    inputSpeechStartedAtRef.current = null;
    currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();
    const userTranscriptBuffer = userTranscriptBufferRef.current;
    const directiveArgumentBuffer = directiveArgumentBufferRef.current;
    const directiveCall = directiveCallRef.current;
    const completedDirectiveCalls = completedDirectiveCallsRef.current;
    userTranscriptBuffer.clear();
    directiveArgumentBuffer.clear();
    directiveCall.clear();
    completedDirectiveCalls.clear();
    pendingDirectiveContinuationRef.current = false;
    queuedAvatarContextsRef.current = [];
    pendingSpeechTurnHasDirectiveRef.current = false;
    currentSpeechTurnCountedRef.current = false;
    setAvatarDebugStats(createEmptyAvatarDebugStats());
    resetAssistantPerformanceState();
    clearAvatarDirective();
  }, [
    clearAvatarDirective,
    completedDirectiveCallsRef,
    currentInputTurnRef,
    directiveArgumentBufferRef,
    directiveCallRef,
    resetAssistantPerformanceState,
    stopMicMeter,
    userTranscriptBufferRef,
  ]);

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

  const deleteConversationItem = useCallback((itemId?: string) => {
    if (!itemId) return false;
    removeMessage(itemId);
    return sendClientEvent({
      type: 'conversation.item.delete',
      item_id: itemId,
    });
  }, [removeMessage, sendClientEvent]);

  const cancelCurrentResponse = useCallback(() => {
    sendClientEvent({ type: 'response.cancel' });
  }, [sendClientEvent]);

  const clearOutputAudioBuffer = useCallback(() => {
    sendClientEvent({ type: 'output_audio_buffer.clear' });
  }, [sendClientEvent]);

  const updateSpeakingSpeed = useCallback((speed: number) => {
    const normalizedSpeed = normalizeRealtimeSpeakingSpeed(speed);
    return sendClientEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          output: {
            speed: normalizedSpeed,
          },
        },
      },
    });
  }, [sendClientEvent]);

  const setTutorHoldActive = useCallback((active: boolean) => {
    isTutorHoldActiveRef.current = active;
    setIsTutorHoldActive(active);

    if (active) {
      if (isSpeakingRef.current || currentResponseIdRef.current) {
        cancelCurrentResponse();
        clearOutputAudioBuffer();
        pendingAssistantOrderRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      }
      return;
    }

    if (hasHeldTutorResponseRef.current) {
      hasHeldTutorResponseRef.current = false;
      setHasHeldTutorResponse(false);
      createRealtimeResponse();
    }
  }, [cancelCurrentResponse, clearOutputAudioBuffer, createRealtimeResponse]);

  const createRealtimeResponseUnlessHeld = useCallback(() => {
    if (isTutorHoldActiveRef.current) {
      hasHeldTutorResponseRef.current = true;
      setHasHeldTutorResponse(true);
      return false;
    }

    return createRealtimeResponse();
  }, [createRealtimeResponse]);

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
    createRealtimeResponseUnlessHeld();
    return true;
  }, [createRealtimeResponseUnlessHeld]);

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

    createRealtimeResponseUnlessHeld();
    return true;
  }, [createConversationItem, createRealtimeResponseUnlessHeld]);

  const injectPromoteBack = useCallback((prompt: string) => {
    // S3.3: a promote-back is an avatar-context-style system note delivered in the
    // tutor's own words. Reuse the proven queue+breakpoint-flush path; if the learner
    // is mid-speech the note stays queued and flushes at the next response.done.
    if (!prompt?.trim()) return;
    queuedAvatarContextsRef.current.push({ systemMessage: prompt });
    flushQueuedAvatarContexts();
  }, [flushQueuedAvatarContexts]);

  const completeDirectiveToolCall = useCallback((itemId: string, argsString?: string, eventCallId?: string | null, eventName?: string | null) => {
    const directiveCall = directiveCallRef.current;
    const directiveArgumentBuffer = directiveArgumentBufferRef.current;
    const completedDirectiveCalls = completedDirectiveCallsRef.current;
    const meta = directiveCall.get(itemId);
    const resolvedName = eventName ?? meta?.name ?? null;
    if (resolvedName !== DIRECTIVE_TOOL_NAME) {
      directiveArgumentBuffer.delete(itemId);
      directiveCall.delete(itemId);
      return;
    }

    const resolvedCallId = eventCallId ?? meta?.callId ?? null;
    if (resolvedCallId && completedDirectiveCalls.has(resolvedCallId)) {
      directiveArgumentBuffer.delete(itemId);
      directiveCall.delete(itemId);
      return;
    }

    const serializedArguments = argsString ?? directiveArgumentBuffer.get(itemId) ?? '';
    const directive = parseAvatarDirectiveArguments(serializedArguments);

    if (directive) {
      applyAvatarDirective(directive);
    }
    acknowledgeFunctionCall(resolvedCallId, Boolean(directive));
    if (resolvedCallId) {
      completedDirectiveCalls.add(resolvedCallId);
    }
    pendingDirectiveContinuationRef.current = true;
    maybeContinueAfterDirectiveTool();

    directiveArgumentBuffer.delete(itemId);
    directiveCall.delete(itemId);
  }, [
    acknowledgeFunctionCall,
    applyAvatarDirective,
    completedDirectiveCallsRef,
    directiveArgumentBufferRef,
    directiveCallRef,
    maybeContinueAfterDirectiveTool,
  ]);

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      const itemId = event.item_id || event.item?.id;
      const directiveArgumentBuffer = directiveArgumentBufferRef.current;
      const directiveCall = directiveCallRef.current;
      const completedDirectiveCalls = completedDirectiveCallsRef.current;
      const userTranscriptBuffer = userTranscriptBufferRef.current;

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
          directiveArgumentBuffer.clear();
          directiveCall.clear();
          completedDirectiveCalls.clear();
          pendingDirectiveContinuationRef.current = false;
          clearAvatarDirective();
          break;

        case 'conversation.item.created':
        case 'conversation.item.added':
        case 'response.output_item.added':
          reserveMessageOrder(event.item, itemId);
          if (itemId && event.item?.type === 'function_call') {
            directiveCall.set(itemId, {
              callId: event.item.call_id ?? event.call_id ?? null,
              name: event.item.name ?? event.name ?? null,
            });
            if (typeof event.item.arguments === 'string') {
              directiveArgumentBuffer.set(itemId, event.item.arguments);
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
            const previous = directiveArgumentBuffer.get(itemId) ?? '';
            directiveArgumentBuffer.set(itemId, `${previous}${event.delta ?? ''}`);
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
          if (itemId) {
            const previous = userTranscriptBuffer.get(itemId) ?? '';
            userTranscriptBuffer.set(itemId, `${previous}${event.delta ?? event.transcript ?? ''}`);
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.done':
          {
            const resolvedTranscript = event.transcript ?? userTranscriptBuffer.get(itemId ?? '') ?? '';
            if (itemId) {
              userTranscriptBuffer.delete(itemId);
            }

            const currentInputTurn = currentInputTurnRef.current;
            currentInputTurn.durationMs =
              inputSpeechStartedAtRef.current === null
                ? currentInputTurn.durationMs
                : Math.max(0, Math.round(performance.now() - inputSpeechStartedAtRef.current));
            inputSpeechStartedAtRef.current = null;

            if (shouldRespondToRealtimeTurn(resolvedTranscript, currentInputTurn)) {
              finalizeTranscript('user', resolvedTranscript, itemId);
              createRealtimeResponseUnlessHeld();
            } else {
              pendingUserOrderRef.current = null;
              deleteConversationItem(itemId);
            }
          }
          break;

        case 'conversation.item.input_audio_transcription.failed':
          pendingUserOrderRef.current = null;
          inputSpeechStartedAtRef.current = null;
          currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();
          if (event.error?.message) {
            setError(event.error.message);
          }
          break;

        case 'conversation.item.deleted':
          removeMessage(itemId);
          break;

        case 'input_audio_buffer.speech_started':
          reservePendingMessageOrder('user');
          pendingDirectiveContinuationRef.current = false;
          pendingSpeechTurnHasDirectiveRef.current = false;
          currentSpeechTurnCountedRef.current = false;
          {
            const speechStartedAt = performance.now();
            inputSpeechStartedAtRef.current = speechStartedAt;
            currentTurnStartedAtRef.current = speechStartedAt;
          }
          currentInputTurnRef.current = {
            ...createEmptyRealtimeInputTurnMetrics(),
            assistantPromptedUser: assistantPromptLikelyExpectsReply(assistantTranscriptFinalRef.current),
          };
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
          {
            const computedDuration = currentTurnStartedAtRef.current > 0
              ? Math.max(0, Math.round(performance.now() - currentTurnStartedAtRef.current))
              : 0;
            const currentInputTurn = currentInputTurnRef.current;
            // Prefer the larger of the computed duration and whatever
            // transcription.completed may have already recorded, so out-of-order
            // events never drop the duration back to 0.
            currentInputTurn.durationMs = Math.max(
              currentInputTurn.durationMs,
              computedDuration,
            );
          }
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
      createRealtimeResponseUnlessHeld,
      deleteConversationItem,
      finalizeTranscript,
      flushQueuedAvatarContexts,
      completedDirectiveCallsRef,
      currentInputTurnRef,
      directiveArgumentBufferRef,
      directiveCallRef,
      maybeContinueAfterDirectiveTool,
      removeMessage,
      reserveMessageOrder,
      reservePendingMessageOrder,
      resetAssistantPerformanceState,
      resetMessageTracking,
      userTranscriptBufferRef,
      updateAvatarDebugStats,
    ]
  );

  const connect = useCallback(async (sessionParamsOverride?: RealtimeSessionParams) => {
    cleanupConnection();

    try {
      setError(null);

      const tokenResponse = await api.post('/realtime/session', sessionParamsOverride ?? sessionParams ?? {});
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
      await startMicMeter();

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

      const connectResponse = await api.post('/realtime/connect', {
        offerSdp: offer.sdp,
        clientSecret: client_secret,
      });

      const answerSdp = connectResponse.data?.answerSdp;
      if (typeof answerSdp !== 'string' || !answerSdp.trim()) {
        throw new Error('Failed to receive realtime SDP answer');
      }

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
  }, [cleanupConnection, flushQueuedAvatarContexts, handleServerEvent, sessionParams, startMicMeter]);

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
    inputSpeechStartedAtRef.current = null;
    currentInputTurnRef.current = createEmptyRealtimeInputTurnMetrics();
    const directiveArgumentBuffer = directiveArgumentBufferRef.current;
    const directiveCall = directiveCallRef.current;
    const completedDirectiveCalls = completedDirectiveCallsRef.current;
    directiveArgumentBuffer.clear();
    directiveCall.clear();
    completedDirectiveCalls.clear();
    pendingDirectiveContinuationRef.current = false;
    clearAvatarDirective();
  }, [
    clearAvatarDirective,
    completedDirectiveCallsRef,
    currentInputTurnRef,
    directiveArgumentBufferRef,
    directiveCallRef,
    resetAssistantPerformanceState,
    resetMessageTracking,
  ]);

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
    isTutorHoldActive,
    hasHeldTutorResponse,
    avatarDirective,
    avatarDirectiveSource: avatarDirective ? 'directive' : 'fallback',
    avatarDiagnostics,
    error,
    connect,
    disconnect,
    updateSpeakingSpeed,
    startListening,
    stopListening,
    clearMessages,
    setTutorHoldActive,
    queueAvatarHit,
    injectPromoteBack,
  };
}
