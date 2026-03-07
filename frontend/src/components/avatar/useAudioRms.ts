import { useEffect, useRef } from 'react';
import {
  AUDIO_RMS_DEFAULTS,
  computeRmsFromByteTimeDomain,
  rmsToLevel,
  smoothLevel,
} from './rms';

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function useAudioRms(remoteAudioStream: MediaStream | null, enabled: boolean) {
  const rmsLevelRef = useRef(0);
  const rawRmsRef = useRef(0);

  useEffect(() => {
    if (!enabled || !remoteAudioStream) {
      rmsLevelRef.current = 0;
      rawRmsRef.current = 0;
      return;
    }

    const AudioContextCtor =
      window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;

    if (!AudioContextCtor) {
      rmsLevelRef.current = 0;
      rawRmsRef.current = 0;
      return;
    }

    let isCancelled = false;
    let rafId: number | null = null;

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(remoteAudioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = AUDIO_RMS_DEFAULTS.fftSize;

    const buffer = new Uint8Array(analyser.fftSize);
    source.connect(analyser);

    const tick = () => {
      if (isCancelled) return;

      analyser.getByteTimeDomainData(buffer);
      const rms = computeRmsFromByteTimeDomain(buffer);
      const level = rmsToLevel(rms);
      const smoothed = smoothLevel(rmsLevelRef.current, level);

      rawRmsRef.current = rms;
      rmsLevelRef.current = smoothed;

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    audioContext.resume().catch(() => {});

    return () => {
      isCancelled = true;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      rmsLevelRef.current = 0;
      rawRmsRef.current = 0;

      try {
        source.disconnect();
      } catch {
        // ignore
      }

      try {
        analyser.disconnect();
      } catch {
        // ignore
      }

      audioContext.close().catch(() => {});
    };
  }, [enabled, remoteAudioStream]);

  return { rawRmsRef, rmsLevelRef };
}
