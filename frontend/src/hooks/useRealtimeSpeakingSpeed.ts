import { useCallback, useEffect, useState } from 'react';
import {
  getStoredRealtimeSpeakingSpeed,
  normalizeRealtimeSpeakingSpeed,
  storeRealtimeSpeakingSpeed,
} from '@/lib/realtimeSpeakingSpeed';

export function useRealtimeSpeakingSpeed() {
  const [speakingSpeed, setSpeakingSpeedState] = useState(() => getStoredRealtimeSpeakingSpeed());

  const setSpeakingSpeed = useCallback((nextSpeed: number) => {
    setSpeakingSpeedState(normalizeRealtimeSpeakingSpeed(nextSpeed));
  }, []);

  useEffect(() => {
    storeRealtimeSpeakingSpeed(speakingSpeed);
  }, [speakingSpeed]);

  return [speakingSpeed, setSpeakingSpeed] as const;
}
