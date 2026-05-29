export const DEFAULT_REALTIME_SPEAKING_SPEED = 1;
export const REALTIME_SPEAKING_SPEED_STORAGE_KEY = 'lingual:realtime:speakingSpeed';

export type RealtimeSpeakingSpeedOption = {
  speed: number;
  labelKey: string;
};

export const REALTIME_SPEAKING_SPEED_OPTIONS: RealtimeSpeakingSpeedOption[] = [
  { speed: 0.85, labelKey: 'app.learn.chat.speed.slow' },
  { speed: 1, labelKey: 'app.learn.chat.speed.normal' },
  { speed: 1.15, labelKey: 'app.learn.chat.speed.fast' },
  { speed: 1.3, labelKey: 'app.learn.chat.speed.veryFast' },
];

export function normalizeRealtimeSpeakingSpeed(value: unknown): number {
  const numericValue =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_REALTIME_SPEAKING_SPEED;
  }

  return REALTIME_SPEAKING_SPEED_OPTIONS.some(
    (option) => Math.abs(option.speed - numericValue) < 0.001,
  )
    ? Number(numericValue.toFixed(2))
    : DEFAULT_REALTIME_SPEAKING_SPEED;
}

function resolveDefaultStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

export function getStoredRealtimeSpeakingSpeed(storage: Storage | undefined = resolveDefaultStorage()): number {
  try {
    return normalizeRealtimeSpeakingSpeed(storage?.getItem(REALTIME_SPEAKING_SPEED_STORAGE_KEY));
  } catch {
    return DEFAULT_REALTIME_SPEAKING_SPEED;
  }
}

export function storeRealtimeSpeakingSpeed(speed: number, storage: Storage | undefined = resolveDefaultStorage()): void {
  try {
    storage?.setItem(REALTIME_SPEAKING_SPEED_STORAGE_KEY, String(normalizeRealtimeSpeakingSpeed(speed)));
  } catch {
    // Local storage can be unavailable in privacy-restricted browser contexts.
  }
}
