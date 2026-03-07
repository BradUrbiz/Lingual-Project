import { describe, expect, it, vi } from 'vitest';
import { LINGUAL_TUTOR_LIVE2D_MANIFEST } from './live2dManifest';
import { chooseExpressionFromBanks, chooseMotionFromBanks } from './live2dSelection';

describe('live2dSelection', () => {
  it('rotates expression candidates when the last one is still on cooldown', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const history = new Map<string, number>([['exp_04', 1_000]]);
    const choice = chooseExpressionFromBanks(
      ['warm_smile'],
      ['exp_04', 'exp_06'],
      LINGUAL_TUTOR_LIVE2D_MANIFEST,
      history,
      'exp_04',
      1_400
    );

    expect(choice?.bankId).toBe('warm_smile');
    expect(choice?.candidate).toBe('exp_06');
    vi.restoreAllMocks();
  });

  it('resolves symbolic motion refs against the available raw motion groups', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const choice = chooseMotionFromBanks(
      ['react_head_curious', 'speaking_base'],
      { '': 6, Idle: 1 },
      LINGUAL_TUTOR_LIVE2D_MANIFEST,
      new Map<string, number>(),
      null,
      2_000
    );

    expect(choice?.bankId).toBe('react_head_curious');
    expect(choice?.candidate).toMatchObject({ group: '', index: 3 });
    vi.restoreAllMocks();
  });
});
