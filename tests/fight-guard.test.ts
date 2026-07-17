import { describe, it, expect, beforeEach } from 'vitest';
import { recordInjection, isFighting, resetFightGuard } from '@/utils/fight-guard';

const T0 = 1_000_000;

beforeEach(() => {
  resetFightGuard();
});

describe('fight-guard', () => {
  it('does not flag a block injected once or twice', () => {
    recordInjection('Reply all', T0);
    expect(isFighting('Reply all', T0 + 1000)).toBe(false);
    recordInjection('Reply all', T0 + 1000);
    expect(isFighting('Reply all', T0 + 2000)).toBe(false);
  });

  it('flags a block re-injected 3 times within the window (app re-render fight)', () => {
    recordInjection('Smart reply chip', T0);
    recordInjection('Smart reply chip', T0 + 2000);
    recordInjection('Smart reply chip', T0 + 4000);
    expect(isFighting('Smart reply chip', T0 + 5000)).toBe(true);
  });

  it('forgets injections outside the window (no permanent blacklist from slow passes)', () => {
    recordInjection('Slow content', T0);
    recordInjection('Slow content', T0 + 2000);
    // Third injection long after the first two expired
    recordInjection('Slow content', T0 + 200_000);
    expect(isFighting('Slow content', T0 + 201_000)).toBe(false);
  });

  it('tracks texts independently', () => {
    for (const t of [T0, T0 + 1000, T0 + 2000]) recordInjection('fighting block', t);
    recordInjection('calm block', T0);
    expect(isFighting('fighting block', T0 + 3000)).toBe(true);
    expect(isFighting('calm block', T0 + 3000)).toBe(false);
  });
});
