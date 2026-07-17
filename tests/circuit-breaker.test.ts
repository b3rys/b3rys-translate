import { describe, it, expect } from 'vitest';
import { checkCircuitBreaker } from '@/utils/circuit-breaker';

const MAX_STARTS = 15;
const WINDOW_MS = 60_000;

describe('checkCircuitBreaker', () => {
  it('returns tripped: false on empty array (first call)', () => {
    const starts: number[] = [];
    const result = checkCircuitBreaker(starts, Date.now(), MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(false);
  });

  it('trips when exactly max entries within window', () => {
    const now = Date.now();
    const starts = Array.from({ length: MAX_STARTS }, (_, i) => now - i * 100);
    const result = checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(true);
  });

  it('purges expired timestamps and does not trip', () => {
    const now = Date.now();
    // All timestamps are outside the window
    const starts = Array.from({ length: MAX_STARTS }, (_, i) => now - WINDOW_MS - 1000 - i * 100);
    const result = checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(false);
    expect(starts.length).toBe(0); // all purged
  });

  it('purges expired entries and counts only valid ones', () => {
    const now = Date.now();
    // 10 expired + 5 valid = under threshold
    const expired = Array.from({ length: 10 }, (_, i) => now - WINDOW_MS - 1000 - i * 100);
    const valid = Array.from({ length: 5 }, (_, i) => now - i * 100);
    const starts = [...expired, ...valid];
    const result = checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(false);
    expect(starts.length).toBe(5); // only valid remain
  });

  it('trips with max consecutive starts within window', () => {
    const now = Date.now();
    // 15 starts within the last second
    const starts = Array.from({ length: MAX_STARTS }, (_, i) => now - i * 10);
    const result = checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(true);
  });

  it('does not trip after manual reset (FAB click simulation)', () => {
    const now = Date.now();
    const starts = Array.from({ length: MAX_STARTS }, (_, i) => now - i * 100);

    // Verify tripped first
    expect(checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS).tripped).toBe(true);

    // Simulate FAB click: manual reset
    starts.length = 0;

    const result = checkCircuitBreaker(starts, now, MAX_STARTS, WINDOW_MS);
    expect(result.tripped).toBe(false);
  });
});
