export type AgeRange = {
  /** Canonical English label — the stable value used for selection matching. */
  label: string;
  /** i18n key for display; translate via t(). */
  i18nKey: string;
  midpoint: number;
};

export const AGE_RANGES: AgeRange[] = [
  { label: 'Under 12', i18nKey: 'profile.ageRange.under12', midpoint: 10 },
  { label: '12 – 17', i18nKey: 'profile.ageRange.12to17', midpoint: 14 },
  { label: '18 – 24', i18nKey: 'profile.ageRange.18to24', midpoint: 21 },
  { label: '25 – 30', i18nKey: 'profile.ageRange.25to30', midpoint: 27 },
  { label: '31 – 39', i18nKey: 'profile.ageRange.31to39', midpoint: 35 },
  { label: '40 – 49', i18nKey: 'profile.ageRange.40to49', midpoint: 44 },
  { label: '50 – 59', i18nKey: 'profile.ageRange.50to59', midpoint: 54 },
  { label: '60+', i18nKey: 'profile.ageRange.60plus', midpoint: 65 },
];

export function ageToRangeLabel(age: number | null | undefined): string {
  if (!age) return '';
  if (age < 12) return 'Under 12';
  if (age <= 17) return '12 – 17';
  if (age <= 24) return '18 – 24';
  if (age <= 30) return '25 – 30';
  if (age <= 39) return '31 – 39';
  if (age <= 49) return '40 – 49';
  if (age <= 59) return '50 – 59';
  return '60+';
}

/** Resolves a stored age to the i18n key for its range label. Returns '' when unset. */
export function ageToRangeI18nKey(age: number | null | undefined): string {
  const label = ageToRangeLabel(age);
  return AGE_RANGES.find((r) => r.label === label)?.i18nKey ?? '';
}
