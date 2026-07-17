/**
 * Circuit breaker: prevent infinite API call loops (cost protection).
 *
 * Purges expired timestamps from `recentStarts` (mutates in place),
 * then checks if the count exceeds `maxStarts`.
 */
export function checkCircuitBreaker(
  recentStarts: number[],
  now: number,
  maxStarts: number,
  windowMs: number,
): { tripped: boolean } {
  // Purge expired entries
  while (recentStarts.length > 0 && recentStarts[0] < now - windowMs) {
    recentStarts.shift();
  }

  return { tripped: recentStarts.length >= maxStarts };
}
