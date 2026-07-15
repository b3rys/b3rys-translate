import { CACHE_MAX_ENTRIES, CACHE_TTL_MS, CACHE_STORAGE_KEY } from './constants';

interface CacheEntry {
  translatedText: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
let loaded = false;

export async function loadCache(): Promise<void> {
  if (loaded) return;
  try {
    const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const stored = result[CACHE_STORAGE_KEY] as [string, CacheEntry][] | undefined;
    if (Array.isArray(stored)) {
      const now = Date.now();
      for (const [key, entry] of stored) {
        if (now - entry.timestamp < CACHE_TTL_MS) {
          cache.set(key, entry);
        }
      }
    }
  } catch {
    // Storage unavailable — proceed with empty cache
  }
  loaded = true;
}

export function getCached(text: string): string | null {
  const entry = cache.get(text);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= CACHE_TTL_MS) {
    cache.delete(text);
    return null;
  }
  // Move to end for LRU ordering
  cache.delete(text);
  cache.set(text, entry);
  return entry.translatedText;
}

export function setCached(text: string, translatedText: string): void {
  // Evict oldest if at capacity
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, { translatedText, timestamp: Date.now() });
}

export async function clearCache(): Promise<void> {
  cache.clear();
  loaded = false;
  try {
    await chrome.storage.local.remove(CACHE_STORAGE_KEY);
  } catch {
    // Storage unavailable — skip
  }
}

export async function persistCache(): Promise<void> {
  try {
    const entries = Array.from(cache.entries());
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: entries });
  } catch {
    // Storage unavailable — skip persistence
  }
}
