/**
 * Re-render fight guard.
 *
 * Some apps own their DOM (Gmail's reading pane widgets, React hydration):
 * they re-create nodes we annotated, wiping the injected translation. If we
 * then re-translate, the app re-renders again — an endless visual fight that
 * stutters the page and marches the circuit breaker toward tripping.
 *
 * Detection is text-based (element identity dies with each re-render): the
 * same block text re-appearing untranslated repeatedly right after we injected
 * it. After FIGHT_MAX_INJECTIONS rounds within FIGHT_WINDOW_MS, yield — stop
 * touching that block for the rest of the page session.
 */

const FIGHT_WINDOW_MS = 90_000;
const FIGHT_MAX_INJECTIONS = 3;
const MAX_TRACKED = 1000;

const injections = new Map<string, number[]>();

/**
 * Record that a translation was injected for this block text.
 *
 * `scrollDriven`: the injection follows recent user scrolling. Virtualized
 * lists (Substack chat) destroy off-screen nodes and re-create them on
 * scroll-back — re-injecting there is restoration, not a fight, so it must not
 * count (or every recycled message ends up permanently yielded). A genuine
 * re-render fight (Gmail widgets) keeps cycling with NO scrolling in between,
 * so its injections still accumulate.
 */
export function recordInjection(
  text: string,
  now: number = Date.now(),
  scrollDriven = false,
): void {
  if (scrollDriven) return;
  const cutoff = now - FIGHT_WINDOW_MS;
  const recent = (injections.get(text) ?? []).filter((t) => t >= cutoff);
  recent.push(now);
  // Re-insert so Map insertion order approximates recency (cheap LRU)
  injections.delete(text);
  injections.set(text, recent);

  if (injections.size > MAX_TRACKED) {
    for (const key of injections.keys()) {
      if (injections.size <= MAX_TRACKED) break;
      injections.delete(key);
    }
  }
}

/** Has this block text been re-injected so often that we should yield? */
export function isFighting(text: string, now: number = Date.now()): boolean {
  const arr = injections.get(text);
  if (!arr) return false;
  const cutoff = now - FIGHT_WINDOW_MS;
  return arr.filter((t) => t >= cutoff).length >= FIGHT_MAX_INJECTIONS;
}

/** Test-only: clear all tracked injections. */
export function resetFightGuard(): void {
  injections.clear();
}
