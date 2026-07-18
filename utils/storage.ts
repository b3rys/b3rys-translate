import type { EngineType } from './engines/types';

export interface ExtensionSettings {
  selectedEngine: EngineType;
  engineApiKeys: Partial<Record<EngineType, string>>;
  translationEnabled: boolean;
}

/** API keys are stored in chrome.storage.local (not synced to Google servers). */
export async function getApiKeys(): Promise<Partial<Record<EngineType, string>>> {
  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');
  return engineApiKeys || {};
}

export async function getSettings(): Promise<ExtensionSettings> {
  const [localResult, engineApiKeys] = await Promise.all([
    chrome.storage.local.get<{
      selectedEngine?: EngineType;
      translationEnabled?: boolean;
    }>(['selectedEngine', 'translationEnabled']),
    getApiKeys(),
  ]);
  return {
    selectedEngine: localResult.selectedEngine || 'gemini',
    engineApiKeys,
    translationEnabled: localResult.translationEnabled !== false,
  };
}

export async function saveEngineApiKey(engine: EngineType, key: string): Promise<void> {
  const keys = await getApiKeys();
  keys[engine] = key;
  await chrome.storage.local.set({ engineApiKeys: keys });
}

export async function setSelectedEngine(engine: EngineType): Promise<void> {
  await chrome.storage.local.set({ selectedEngine: engine });
}

export async function setTranslationEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ translationEnabled: enabled });
}

/**
 * One-time migration of legacy API keys, then a sync cleanup.
 *
 * The extension now stores EVERYTHING in chrome.storage.local — settings and
 * usage alike. chrome.storage.sync's write quota (120/min, 1800/hour) can't
 * absorb our write volume (usage stats were written per batch), and once it
 * trips EVERY sync write silently fails, taking unrelated settings (FAB on/off,
 * Auto toggle, engine, language) down with it. So sync is no longer used.
 *
 * 1. Old API keys that lived in sync (geminiApiKey / engineApiKeys) → local.
 * 2. Wipe any settings a prior version left orphaned in sync.
 */
export async function migrateStorage(): Promise<void> {
  const syncData = await chrome.storage.sync.get(['geminiApiKey', 'engineApiKeys']);
  const localData = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');
  const localKeys: Partial<Record<EngineType, string>> = localData.engineApiKeys || {};

  let changed = false;

  // Migrate old single-key schema
  if (syncData.geminiApiKey) {
    if (!localKeys.gemini) {
      localKeys.gemini = syncData.geminiApiKey as string;
      changed = true;
    }
    await chrome.storage.local.set({ selectedEngine: 'gemini' });
  }

  // Migrate multi-engine keys from sync → local
  if (syncData.engineApiKeys) {
    const syncKeys = syncData.engineApiKeys as Partial<Record<EngineType, string>>;
    for (const [engine, key] of Object.entries(syncKeys)) {
      if (key && !localKeys[engine as EngineType]) {
        localKeys[engine as EngineType] = key;
        changed = true;
      }
    }
  }

  if (changed) {
    await chrome.storage.local.set({ engineApiKeys: localKeys });
  }

  // Sync is no longer used — clear anything a prior version left there (old API
  // keys, orphaned settings). Guarded so a clean profile does no write at all.
  const staleSync = await chrome.storage.sync.get(null);
  if (Object.keys(staleSync).length > 0) {
    await chrome.storage.sync.clear();
  }
}
