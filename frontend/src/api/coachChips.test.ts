import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postCoachChip, getCoachChips } from './coachChips';
import api from './index';

vi.mock('./index');

const mockedApi = api as unknown as { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockedApi.post = vi.fn();
  mockedApi.get = vi.fn();
});

describe('postCoachChip', () => {
  it('posts turnIndex and unwraps coachChip', async () => {
    const chip = {
      turn_index: 4,
      model: 'm',
      surface: 'text',
      utterance: 'a',
      better: 'b',
      why: 'c',
      target: null,
      confidence_caveat: false,
      generated_at: 'x',
    };
    mockedApi.post.mockResolvedValue({ data: { success: true, coachChip: chip } });
    const result = await postCoachChip('sess-1', 4);
    expect(mockedApi.post).toHaveBeenCalledWith('/practice-sessions/sess-1/coach-chip', { turnIndex: 4 });
    expect(result).toEqual(chip);
  });

  it('returns null when no chip', async () => {
    mockedApi.post.mockResolvedValue({ data: { success: true, coachChip: null } });
    expect(await postCoachChip('sess-1', 6)).toBeNull();
  });
});

describe('getCoachChips', () => {
  it('GETs the right path and unwraps coachChips', async () => {
    const chips = [
      {
        turn_index: 2,
        model: 'm',
        surface: 'voice',
        utterance: 'a',
        better: 'b',
        why: 'c',
        target: null,
        confidence_caveat: false,
        generated_at: 'x',
      },
    ];
    mockedApi.get.mockResolvedValue({ data: { success: true, coachChips: chips } });
    const result = await getCoachChips('sess-2');
    expect(mockedApi.get).toHaveBeenCalledWith('/practice-sessions/sess-2/coach-chips');
    expect(result).toEqual(chips);
  });

  it('returns [] when coachChips is absent from the response', async () => {
    mockedApi.get.mockResolvedValue({ data: { success: true } });
    expect(await getCoachChips('sess-2')).toEqual([]);
  });
});
