/**
 * Debug logging — OFF by default (console stays clean for users).
 *
 * Enable in DevTools:   localStorage.b3rys_debug = '1'  → refresh
 * Disable:              delete localStorage.b3rys_debug → refresh
 *
 * When enabled, translation-pipeline logs AND the scroll-jump watcher
 * (translator.ts) report to the console — one screenshot pinpoints issues.
 */
let enabled = false;
try {
  enabled = localStorage.getItem('b3rys_debug') === '1';
} catch {
  // storage unavailable (sandboxed frames) — stay silent
}

export function isDebug(): boolean {
  return enabled;
}

export function dbg(...args: unknown[]): void {
  if (enabled) console.log('[b3rys]', ...args);
}
