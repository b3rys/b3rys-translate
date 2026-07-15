import { vi } from 'vitest';

/**
 * Map-based Chrome storage mock.
 * Supports chrome.storage.sync and chrome.storage.local.
 */
function createStorageArea(
  initial: Record<string, unknown> = {},
): chrome.storage.StorageArea & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));

  return {
    _data: data,
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(data);
      }
      if (typeof keys === 'string') {
        const result: Record<string, unknown> = {};
        if (data.has(keys)) result[keys] = data.get(keys);
        return result;
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          if (data.has(k)) result[k] = data.get(k);
        }
        return result;
      }
      // Object with defaults
      const result: Record<string, unknown> = { ...keys };
      for (const [k, v] of data) {
        result[k] = v;
      }
      // Fill in defaults for missing keys
      for (const [k, v] of Object.entries(keys)) {
        if (!data.has(k)) result[k] = v;
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        data.set(k, v);
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = typeof keys === 'string' ? [keys] : keys;
      for (const k of arr) data.delete(k);
    }),
    clear: vi.fn(async () => {
      data.clear();
    }),
  } as unknown as chrome.storage.StorageArea & { _data: Map<string, unknown> };
}

export interface ChromeMockOptions {
  syncStorage?: Record<string, unknown>;
  localStorage?: Record<string, unknown>;
}

/**
 * Stub globalThis.chrome with a minimal mock suitable for testing.
 * Call in beforeEach; vitest's unstubAllGlobals() cleans up in afterEach.
 */
export function setupChromeMock(options: ChromeMockOptions = {}): {
  sync: ReturnType<typeof createStorageArea>;
  local: ReturnType<typeof createStorageArea>;
  sendMessage: ReturnType<typeof vi.fn>;
  setBadgeText: ReturnType<typeof vi.fn>;
} {
  const sync = createStorageArea(options.syncStorage);
  const local = createStorageArea(options.localStorage);
  const sendMessage = vi.fn();
  const setBadgeText = vi.fn();

  vi.stubGlobal('chrome', {
    storage: {
      sync,
      local,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    },
    action: {
      setBadgeText,
      setBadgeBackgroundColor: vi.fn(),
    },
  });

  return { sync, local, sendMessage, setBadgeText };
}
