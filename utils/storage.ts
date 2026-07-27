import type { EngineType } from './engines/types';
import { SELECTED_MODELS_KEY, normalizeSelectedModels, type SelectedModels } from './models';

export interface ExtensionSettings {
  selectedEngine: EngineType;
  selectedModels: SelectedModels;
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
      selectedModels?: SelectedModels;
      translationEnabled?: boolean;
    }>(['selectedEngine', SELECTED_MODELS_KEY, 'translationEnabled']),
    getApiKeys(),
  ]);
  return {
    selectedEngine: localResult.selectedEngine || 'gemini',
    selectedModels: normalizeSelectedModels(localResult.selectedModels),
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
    selectedModels?: SelectedModels;
    selectedEngine?: EngineType;
  }>(['engineApiKeys', SELECTED_MODELS_KEY, 'selectedEngine']);
  const localKeys: Partial<Record<EngineType, string>> = localData.engineApiKeys || {};

  // Existing users had provider selection only. Persist each provider's economy
  // model as the migration default while preserving any model choices already
  // saved by a newer version.
  const selectedModels = normalizeSelectedModels(localData.selectedModels);
  if (JSON.stringify(selectedModels) !== JSON.stringify(localData.selectedModels || {})) {
    await chrome.storage.local.set({ [SELECTED_MODELS_KEY]: selectedModels });
  }

  let changed = false;

  // Migrate old single-key schema
  if (syncData.geminiApiKey) {
    if (!localKeys.gemini) {
      localKeys.gemini = syncData.geminiApiKey as string;
      changed = true;
    }
    if (!localData.selectedEngine) {
      await chrome.storage.local.set({ selectedEngine: 'gemini' });
    }
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

  await dropLegacyUsageBuckets();

  // Sync is no longer used — clear anything a prior version left there (old API
  // keys, orphaned settings). Guarded so a clean profile does no write at all.
  const staleSync = await chrome.storage.sync.get(null);
  if (Object.keys(staleSync).length > 0) {
    await chrome.storage.sync.clear();
  }
}

const LEGACY_USAGE_KEYS: readonly string[] = ['gemini', 'openai', 'anthropic'];

/**
 * 사용량 집계 키가 엔진('gemini')에서 모델('gemini-3.1-flash-lite')로 바뀌었다.
 * 업그레이드한 사용자에게는 두 형식이 함께 남아, 비용 상세에 ★같은 이름의 줄이
 * 두 개★ 나온다 — 옛 엔진 버킷의 표시 이름이 새 모델 라벨과 글자까지 같기
 * 때문이다. 총액은 맞지만 사용자는 왜 쪼개졌는지 알 수 없다.
 *
 * 옛 버킷을 한 번 비운다. 합치지 않고 버리는 쪽을 골랐다 — 이건 청구서가 아니라
 * 추정 누적치이고, 합치려면 과거 사용량을 어느 모델에 귀속시킬지 정해야 하는데
 * 알 수 없는 값이라 오히려 틀린 숫자를 만든다.
 *
 * 새로 쌓이는 것은 전부 모델 키라서 이 상황은 다시 생기지 않는다. 그래서 버전
 * 플래그 없이 "엔진 이름 키가 있으면 지운다"로 충분하다.
 */
async function dropLegacyUsageBuckets(): Promise<void> {
  const { b3rys_usage_stats: stats } = await chrome.storage.local.get<{
    b3rys_usage_stats?: Record<string, unknown>;
  }>('b3rys_usage_stats');
  if (!stats) return;

  const remaining = Object.fromEntries(
    Object.entries(stats).filter(([key]) => !LEGACY_USAGE_KEYS.includes(key)),
  );
  // 지울 게 없으면 쓰지 않는다 — 깨끗한 프로필에 불필요한 write 를 남기지 않기 위해.
  if (Object.keys(remaining).length !== Object.keys(stats).length) {
    await chrome.storage.local.set({ b3rys_usage_stats: remaining });
  }
}
