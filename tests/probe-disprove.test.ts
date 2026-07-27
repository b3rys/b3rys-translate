import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import { CACHE_STORAGE_KEY, CACHE_MAX_ENTRIES } from '@/utils/constants';

async function importCache() {
  return await import('@/utils/translation-cache');
}

describe('PROBE: does the missing old-prefix purge cost live capacity?', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dead old-scheme entries are evicted BEFORE any live new-scheme entry', async () => {
    const now = Date.now();
    // Simulate a pre-update user: cache FULL of old-scheme keys `ko:<text>`
    const stored: [string, { translatedText: string; timestamp: number }][] = [];
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      stored.push([`ko:old-text-${i}`, { translatedText: `번역${i}`, timestamp: now }]);
    }
    setupChromeMock({ localStorage: { [CACHE_STORAGE_KEY]: stored } });

    const { loadCache, getCached, setCached, persistCache } = await importCache();
    await loadCache();

    // Post-update: every write uses the NEW scheme prefix.
    const NEW = 'ko:page:gpt-5.4-nano:';
    const liveCount = 2500;
    for (let i = 0; i < liveCount; i++) {
      setCached(`${NEW}live-${i}`, `새번역${i}`);
    }

    // Q1: did ANY live entry get evicted by the presence of dead entries?
    let liveSurvivors = 0;
    for (let i = 0; i < liveCount; i++) {
      if (getCached(`${NEW}live-${i}`) !== null) liveSurvivors++;
    }
    console.log(`[PROBE] live written=${liveCount} survived=${liveSurvivors}`);
    expect(liveSurvivors).toBe(liveCount); // zero live loss

    // Q2: how many dead entries remain, and did total size grow past the cap?
    await persistCache();
    const persisted = (
      globalThis.chrome.storage.local as unknown as { _data: Map<string, unknown> }
    )._data.get(CACHE_STORAGE_KEY) as [string, unknown][];
    const dead = persisted.filter(([k]) => !k.startsWith(NEW)).length;
    console.log(
      `[PROBE] persisted total=${persisted.length} dead=${dead} live=${persisted.length - dead} cap=${CACHE_MAX_ENTRIES}`,
    );
    expect(persisted.length).toBeLessThanOrEqual(CACHE_MAX_ENTRIES); // storage never grows past pre-existing ceiling
    expect(dead).toBe(CACHE_MAX_ENTRIES - liveCount); // dead drained 1:1 by writes
  });

  it('after CACHE_MAX_ENTRIES writes the dead entries are fully gone on their own', async () => {
    const now = Date.now();
    const stored: [string, { translatedText: string; timestamp: number }][] = [];
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      stored.push([`ko:old-text-${i}`, { translatedText: `번역${i}`, timestamp: now }]);
    }
    setupChromeMock({ localStorage: { [CACHE_STORAGE_KEY]: stored } });

    const { loadCache, setCached, persistCache } = await importCache();
    await loadCache();

    const NEW = 'ko:page:gpt-5.4-nano:';
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      setCached(`${NEW}live-${i}`, `새번역${i}`);
    }

    await persistCache();
    const persisted = (
      globalThis.chrome.storage.local as unknown as { _data: Map<string, unknown> }
    )._data.get(CACHE_STORAGE_KEY) as [string, unknown][];
    const dead = persisted.filter(([k]) => !k.startsWith(NEW)).length;
    console.log(
      `[PROBE] after ${CACHE_MAX_ENTRIES} writes: dead=${dead} total=${persisted.length}`,
    );
    expect(dead).toBe(0); // self-healing; no purge code needed
  });

  it('CONTROL: is an old-scheme key even distinguishable by shape? (colons in text)', async () => {
    // Old scheme for a paragraph that itself contains colons
    const oldKey = 'ko:Note: see the following: item';
    const newPrefixShape = /^[a-z-]+:(page|subtitle|word|segment):/;
    console.log(`[PROBE] old key matches "new shape" regex? ${newPrefixShape.test(oldKey)}`);
    // If text starts with e.g. "page: ..." the old key would masquerade as new scheme
    const ambiguous = 'ko:page: an old-scheme paragraph beginning with the word page';
    console.log(`[PROBE] ambiguous old key passes shape check? ${newPrefixShape.test(ambiguous)}`);
    expect(newPrefixShape.test(ambiguous)).toBe(true); // the "one-line fix" is a heuristic, not exact
  });
});
