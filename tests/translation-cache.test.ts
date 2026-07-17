import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import { CACHE_STORAGE_KEY, CACHE_TTL_MS, CACHE_MAX_ENTRIES } from '@/utils/constants';

// We need fresh module state for each test because the cache module
// uses module-level Map and loaded flag.
async function importCache() {
  const mod = await import('@/utils/translation-cache');
  return mod;
}

describe('translation-cache', () => {
  beforeEach(() => {
    vi.resetModules();
    setupChromeMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getCached returns null before loadCache', async () => {
    const { getCached } = await importCache();
    expect(getCached('hello')).toBeNull();
  });

  it('setCached + getCached roundtrip', async () => {
    const { setCached, getCached } = await importCache();
    setCached('hello', '안녕하세요');
    expect(getCached('hello')).toBe('안녕하세요');
  });

  it('getCached returns null for missing key', async () => {
    const { setCached, getCached } = await importCache();
    setCached('hello', '안녕하세요');
    expect(getCached('world')).toBeNull();
  });

  it('loadCache restores from chrome.storage.local', async () => {
    const now = Date.now();
    const stored: [string, { translatedText: string; timestamp: number }][] = [
      ['foo', { translatedText: 'bar', timestamp: now }],
    ];
    setupChromeMock({
      localStorage: { [CACHE_STORAGE_KEY]: stored },
    });

    const { loadCache, getCached } = await importCache();
    await loadCache();
    expect(getCached('foo')).toBe('bar');
  });

  it('loadCache skips expired entries', async () => {
    const expired = Date.now() - CACHE_TTL_MS - 1000;
    const stored: [string, { translatedText: string; timestamp: number }][] = [
      ['old', { translatedText: 'ancient', timestamp: expired }],
    ];
    setupChromeMock({
      localStorage: { [CACHE_STORAGE_KEY]: stored },
    });

    const { loadCache, getCached } = await importCache();
    await loadCache();
    expect(getCached('old')).toBeNull();
  });

  it('getCached expires entries past TTL', async () => {
    const { setCached, getCached } = await importCache();
    setCached('temp', '임시');

    // Mock Date.now to jump ahead past TTL
    const originalNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + CACHE_TTL_MS + 1000);
    expect(getCached('temp')).toBeNull();
    vi.restoreAllMocks();
  });

  it('setCached evicts oldest entry at capacity', async () => {
    const { setCached, getCached } = await importCache();

    // Fill cache to capacity
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      setCached(`key-${i}`, `val-${i}`);
    }

    // Add one more — first entry should be evicted
    setCached('overflow', 'new');
    expect(getCached('key-0')).toBeNull();
    expect(getCached('overflow')).toBe('new');
  });

  it('persistCache saves to chrome.storage.local', async () => {
    const mock = setupChromeMock();
    const { setCached, persistCache } = await importCache();
    setCached('hello', '안녕');
    await persistCache();
    expect(mock.local.set).toHaveBeenCalled();
  });
});
