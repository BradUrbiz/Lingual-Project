import type { AvatarExpressionId, AvatarMotionRef } from './types';
import type { Live2DManifest, Live2DMotionRef } from './live2dManifest';

export type WeightedBankChoice<T> = {
  bankId: string;
  candidate: T;
  candidateKey: string;
};

export function chooseWeightedIndex(weights: number[]) {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = Math.random() * totalWeight;
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return index;
    }
  }
  return Math.max(0, weights.length - 1);
}

export function chooseExpressionFromBanks(
  expressionIds: AvatarExpressionId[],
  availableExpressions: string[],
  manifest: Live2DManifest,
  history: Map<string, number>,
  lastExpressionKey: string | null,
  now: number
): WeightedBankChoice<string> | null {
  for (const expressionId of expressionIds) {
    const bank = manifest.namedExpressions[expressionId];
    if (!bank) continue;

    const rawCandidates = bank.candidates
      .map((candidate, index) => ({
        candidate,
        weight: bank.weights?.[index] ?? 1,
      }))
      .filter(({ candidate }) => availableExpressions.includes(candidate));

    if (!rawCandidates.length) continue;

    const freshPool = rawCandidates.filter(({ candidate }) => {
      const lastAt = history.get(candidate) ?? 0;
      return now - lastAt >= bank.cooldownMs && candidate !== lastExpressionKey;
    });
    const fallbackPool = rawCandidates.filter(({ candidate }) => candidate !== lastExpressionKey);
    const pool = freshPool.length ? freshPool : (fallbackPool.length ? fallbackPool : rawCandidates);
    const selected = pool[chooseWeightedIndex(pool.map((candidate) => candidate.weight))];

    return {
      bankId: expressionId,
      candidate: selected.candidate,
      candidateKey: selected.candidate,
    };
  }

  return null;
}

export function chooseMotionFromBanks(
  motionRefs: AvatarMotionRef[],
  availableGroups: Record<string, number>,
  manifest: Live2DManifest,
  history: Map<string, number>,
  lastMotionKey: string | null,
  now: number
): WeightedBankChoice<Live2DMotionRef> | null {
  for (const motionRef of motionRefs) {
    const bank = manifest.namedMotions[motionRef];
    if (!bank) continue;

    const rawCandidates = bank.candidates
      .map((candidate, index) => ({
        candidate,
        weight: bank.weights?.[index] ?? candidate.weight ?? 1,
      }))
      .filter(({ candidate }) => {
        const count = availableGroups[candidate.group];
        if (typeof count !== 'number' || count <= 0) {
          return false;
        }
        const index = candidate.index ?? 0;
        return index >= 0 && index < count;
      });

    if (!rawCandidates.length) continue;

    const freshPool = rawCandidates.filter(({ candidate }) => {
      const candidateKey = `${candidate.group}:${candidate.index ?? 0}`;
      const lastAt = history.get(candidateKey) ?? 0;
      return now - lastAt >= bank.cooldownMs && candidateKey !== lastMotionKey;
    });
    const fallbackPool = rawCandidates.filter(({ candidate }) => `${candidate.group}:${candidate.index ?? 0}` !== lastMotionKey);
    const pool = freshPool.length ? freshPool : (fallbackPool.length ? fallbackPool : rawCandidates);
    const selected = pool[chooseWeightedIndex(pool.map((candidate) => candidate.weight))];
    const candidateKey = `${selected.candidate.group}:${selected.candidate.index ?? 0}`;

    return {
      bankId: motionRef,
      candidate: selected.candidate,
      candidateKey,
    };
  }

  return null;
}
