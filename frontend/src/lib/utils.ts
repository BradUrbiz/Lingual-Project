import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSpeakingMinutes(seconds: number | null | undefined): string {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 0;
  if (value <= 0) return '0';
  if (value < 60) return '<1';
  return String(Math.round(value / 60));
}
