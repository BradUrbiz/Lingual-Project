import { startTransition, useEffect, useRef, useState } from 'react';
import { useAudioRms } from './useAudioRms';
import { buildAvatarPerformanceFrame, resolveAvatarAffect, resolveDialogueState } from './performance';
import type { AvatarPerformanceFrame, AvatarPerformanceSource } from './types';

type UseAvatarPerformanceInput = Omit<AvatarPerformanceSource, 'now'> & {
  now?: number;
};

function resolveNow(now?: number): number {
  if (typeof now === 'number') return now;
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

export function useAvatarPerformance(source: UseAvatarPerformanceInput): AvatarPerformanceFrame {
  const [tickNow, setTickNow] = useState<number>(() => resolveNow(source.now));
  const [audioLevel, setAudioLevel] = useState(0);
  const [rawRms, setRawRms] = useState(0);
  const [lastUserSpeechStoppedAt, setLastUserSpeechStoppedAt] = useState<number | null>(null);
  const previousListeningRef = useRef(source.isListening);
  const analysisEnabled =
    source.mode === 'realtime' &&
    Boolean(source.remoteAudioStream) &&
    (source.isConnected || source.isSpeaking || source.assistantSpeechStartedAt !== null);
  const { rawRmsRef, rmsLevelRef } = useAudioRms(source.remoteAudioStream, analysisEnabled);

  useEffect(() => {
    const previousListening = previousListeningRef.current;
    if (previousListening && !source.isListening) {
      const stoppedAt = resolveNow(source.now);
      queueMicrotask(() => {
        setLastUserSpeechStoppedAt(stoppedAt);
      });
    }
    previousListeningRef.current = source.isListening;
  }, [source.isListening, source.now]);

  useEffect(() => {
    if (typeof source.now === 'number') {
      return;
    }

    let frameId: number | null = null;
    let intervalId: number | null = null;
    const isActive =
      source.isListening ||
      source.isSpeaking ||
      source.assistantSpeechStartedAt !== null ||
      source.assistantSpeechEndedAt !== null ||
      Boolean(source.assistantTranscriptDelta.trim()) ||
      Boolean(source.assistantTranscriptFinal.trim());
    const tick = () => {
      const nextNow = resolveNow();
      const nextAudioLevel = rmsLevelRef.current;
      const nextRawRms = rawRmsRef.current;
      startTransition(() => {
        setTickNow(nextNow);
        setAudioLevel(nextAudioLevel);
        setRawRms(nextRawRms);
      });
    };

    if (isActive) {
      const loop = () => {
        tick();
        frameId = window.requestAnimationFrame(loop);
      };
      loop();
    } else {
      intervalId = window.setInterval(tick, 240);
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    source.assistantSpeechEndedAt,
    source.assistantSpeechStartedAt,
    source.assistantTranscriptDelta,
    source.assistantTranscriptFinal,
    source.isListening,
    source.isSpeaking,
    source.now,
    rmsLevelRef,
    rawRmsRef,
  ]);

  const now = typeof source.now === 'number' ? source.now : tickNow;
  const plannerSource: AvatarPerformanceSource = {
    ...source,
    now,
  };
  const affect = resolveAvatarAffect(plannerSource);
  const dialogueState = resolveDialogueState(plannerSource, {
    lastUserSpeechStoppedAt,
  });

  const frame = buildAvatarPerformanceFrame({
    source: plannerSource,
    dialogueState,
    affect,
    audioLevel,
  });

  return {
    ...frame,
    debug: {
      ...frame.debug,
      rmsLevel: rawRms,
    },
  };
}
