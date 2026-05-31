import { startTransition, useEffect, useReducer, useRef } from 'react';
import { useAudioRms } from './useAudioRms';
import { buildAvatarPerformanceFrame, resolveAvatarAffect, resolveDialogueState } from './performance';
import { buildSpeechMouthTarget, smoothSpeechMouthDrive } from './speechMouth';
import type { AvatarPerformanceFrame, AvatarPerformanceSource } from './types';

type UseAvatarPerformanceInput = Omit<AvatarPerformanceSource, 'now'> & {
  now?: number;
};

type AvatarRuntimeState = {
  tickNow: number;
  feedAudioLevel: number;
  mouthDrive: number;
  rawRms: number;
};

function resolveNow(now?: number): number {
  if (typeof now === 'number') return now;
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function avatarRuntimeReducer(_state: AvatarRuntimeState, nextState: AvatarRuntimeState) {
  return nextState;
}

export function useAvatarPerformance(source: UseAvatarPerformanceInput): AvatarPerformanceFrame {
  const [runtimeState, setRuntimeState] = useReducer(avatarRuntimeReducer, source.now, (now) => ({
    tickNow: resolveNow(now),
    feedAudioLevel: 0,
    mouthDrive: 0,
    rawRms: 0,
  }));
  const previousListeningRef = useRef(source.isListening);
  const lastUserSpeechStoppedAtRef = useRef<number | null>(null);
  const mouthDriveRef = useRef(0);
  const previousListening = previousListeningRef.current;
  if (previousListening !== source.isListening) {
    if (previousListening && !source.isListening) {
      lastUserSpeechStoppedAtRef.current = resolveNow(source.now);
    }
    previousListeningRef.current = source.isListening;
  }

  const analysisEnabled =
    source.mode === 'realtime' &&
    Boolean(source.remoteAudioStream) &&
    (source.isConnected || source.isSpeaking || source.assistantSpeechStartedAt !== null);
  const { rawRmsRef, rmsLevelRef } = useAudioRms(source.remoteAudioStream, analysisEnabled);

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
      const nextFeedAudioLevel = rmsLevelRef.current;
      const nextRawRms = rawRmsRef.current;
      const plannerSource: AvatarPerformanceSource = {
        mode: source.mode,
        isConnected: source.isConnected,
        isListening: source.isListening,
        isSpeaking: source.isSpeaking,
        remoteAudioStream: source.remoteAudioStream,
        assistantTranscriptDelta: source.assistantTranscriptDelta,
        assistantTranscriptFinal: source.assistantTranscriptFinal,
        assistantSpeechStartedAt: source.assistantSpeechStartedAt,
        assistantSpeechEndedAt: source.assistantSpeechEndedAt,
        avatarDirective: source.avatarDirective,
        now: nextNow,
      };
      const dialogueState = resolveDialogueState(plannerSource, {
        lastUserSpeechStoppedAt: lastUserSpeechStoppedAtRef.current,
      });
      const affect = resolveAvatarAffect(plannerSource);
      const transcript =
        plannerSource.avatarDirective?.subtitleText?.trim()
        || plannerSource.assistantTranscriptDelta.trim()
        || plannerSource.assistantTranscriptFinal.trim();
      const mouthTarget = buildSpeechMouthTarget({
        audioLevel: nextFeedAudioLevel,
        rawRms: nextRawRms,
        transcript,
        affect,
        dialogueState,
        now: nextNow,
        assistantSpeechStartedAt: source.assistantSpeechStartedAt,
      });
      const nextMouthDrive = smoothSpeechMouthDrive(
        mouthDriveRef.current,
        mouthTarget,
        dialogueState,
      );
      mouthDriveRef.current = nextMouthDrive;

      startTransition(() => {
        setRuntimeState({
          tickNow: nextNow,
          feedAudioLevel: nextFeedAudioLevel,
          mouthDrive: nextMouthDrive,
          rawRms: nextRawRms,
        });
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
    source.isConnected,
    source.isListening,
    source.isSpeaking,
    source.mode,
    source.now,
    source.avatarDirective,
    source.remoteAudioStream,
    rmsLevelRef,
    rawRmsRef,
  ]);

  const now = typeof source.now === 'number' ? source.now : runtimeState.tickNow;
  const plannerSource: AvatarPerformanceSource = {
    ...source,
    now,
  };
  const affect = resolveAvatarAffect(plannerSource);
  const dialogueState = resolveDialogueState(plannerSource, {
    lastUserSpeechStoppedAt: lastUserSpeechStoppedAtRef.current,
  });

  const frame = buildAvatarPerformanceFrame({
    source: plannerSource,
    dialogueState,
    affect,
    audioLevel: runtimeState.mouthDrive,
    feedAudioLevel: runtimeState.feedAudioLevel,
    rawRmsLevel: runtimeState.rawRms,
  });
  return frame;
}
