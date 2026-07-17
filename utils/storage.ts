import type { EngineType } from './engines/types';
import { USAGE_STATS_KEY, COST_LIMIT_KEY, USAGE_RATIO_KEY } from './constants';

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
  const [syncResult, engineApiKeys] = await Promise.all([
    chrome.storage.sync.get<{
      selectedEngine?: EngineType;
      translationEnabled?: boolean;
    }>(['selectedEngine', 'translationEnabled']),
    getApiKeys(),
  ]);
  return {
    selectedEngine: syncResult.selectedEngine || 'gemini',
    engineApiKeys,
    translationEnabled: syncResult.translationEnabled !== false,
  };
}

export async function saveEngineApiKey(engine: EngineType, key: string): Promise<void> {
  const keys = await getApiKeys();
  keys[engine] = key;
  await chrome.storage.local.set({ engineApiKeys: keys });
}

export async function setSelectedEngine(engine: EngineType): Promise<void> {
  await chrome.storage.sync.set({ selectedEngine: engine });
}

export async function setTranslationEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.sync.set({ translationEnabled: enabled });
}

/**
 * Migrate API keys to chrome.storage.local for security.
 * 1. Old single-key schema (geminiApiKey in sync) → local
 * 2. Multi-engine keys in sync → local, then delete from sync
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
    await chrome.storage.sync.remove('geminiApiKey');
    await chrome.storage.sync.set({ selectedEngine: 'gemini' });
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
    // Delete API keys from sync storage (no longer synced to Google)
    await chrome.storage.sync.remove('engineApiKeys');
  }

  if (changed) {
    await chrome.storage.local.set({ engineApiKeys: localKeys });
  }

  // Migrate usage stats from local → sync
  const usageKeys = [USAGE_STATS_KEY, COST_LIMIT_KEY, USAGE_RATIO_KEY];
  const localUsageData = await chrome.storage.local.get(usageKeys);
  const keysToMigrate: Record<string, unknown> = {};
  const keysToRemove: string[] = [];

  for (const key of usageKeys) {
    if (localUsageData[key] !== undefined) {
      keysToMigrate[key] = localUsageData[key];
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.sync.set(keysToMigrate);
    await chrome.storage.local.remove(keysToRemove);
  }
}
