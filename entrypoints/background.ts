import { getEngine } from '@/utils/engines';
import type { EngineType } from '@/utils/engines/types';
import type { UsageData } from '@/utils/engines/types';
import type {
  BackgroundMessage,
  TranslateBatchResponse,
  ClearCacheResponse,
} from '@/utils/messaging';
import {
  loadCache,
  getCached,
  setCached,
  persistCache,
  clearCache,
} from '@/utils/translation-cache';
import { migrateStorage } from '@/utils/storage';
import {
  ENGINE_PRICING,
  USAGE_STATS_KEY,
  COST_LIMIT_KEY,
  USAGE_RATIO_KEY,
  LANG_STORAGE_KEY,
  DEFAULT_SOURCE_LANG,
  DEFAULT_TARGET_LANG,
} from '@/utils/constants';

interface EngineUsageStats {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  requestCount: number;
}

type UsageStats = Partial<Record<EngineType, EngineUsageStats>>;

// Rate limiter: prevent excessive API calls from any source (cost protection)
const RATE_WINDOW = 60_000; // 1 minute
const RATE_MAX_CALLS = 50; // max API calls per window (cache hits don't count)
const recentApiCalls: number[] = [];

function checkRateLimit(): string | null {
  const now = Date.now();
  while (recentApiCalls.length > 0 && recentApiCalls[0] < now - RATE_WINDOW) {
    recentApiCalls.shift();
  }
  if (recentApiCalls.length >= RATE_MAX_CALLS) {
    return `Rate limit: ${RATE_MAX_CALLS} API calls/min exceeded. Possible runaway loop detected. Reload the page to reset.`;
  }
  recentApiCalls.push(now);
  return null;
}

export default defineBackground(() => {
  loadCache();
  migrateStorage();

  chrome.runtime.onMessage.addListener(
    (
      message: BackgroundMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: TranslateBatchResponse | ClearCacheResponse) => void,
    ) => {
      if (message.type === 'OPEN_POPUP') {
        chrome.action.openPopup().catch(() => {
          // Fallback: some Chrome versions don't support openPopup
        });
        return false;
      }

      if (message.type === 'CLEAR_CACHE') {
        clearCache()
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;
      }

      if (message.type === 'TRANSLATE_BATCH') {
        handleTranslateBatch(
          message.paragraphs,
          message.mode,
          message.subtitleContext,
          message.sourceLang,
          message.targetLang,
        )
          .then(sendResponse)
          .catch((err) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const isApiKeyError =
              /api.?key|authenticat|unauthorized|forbidden|expired|invalid.*(key|credentials)|40[13]/i.test(
                errorMsg,
              );
            sendResponse({
              translations: [],
              error: errorMsg,
              apiKeyError: isApiKeyError,
            });
          });
        return true;
      }
    },
  );
});

function calculateCost(engineType: EngineType, usage: UsageData): number {
  const pricing = ENGINE_PRICING[engineType];
  if (!pricing) return 0;
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output
  );
}

async function getUsageStats(): Promise<UsageStats> {
  const data = await chrome.storage.sync.get(USAGE_STATS_KEY);
  return (data[USAGE_STATS_KEY] as UsageStats) || {};
}

async function getTotalCost(stats: UsageStats): Promise<number> {
  return Object.values(stats).reduce((sum, s) => sum + (s?.estimatedCost ?? 0), 0);
}

async function getCostLimit(): Promise<number | null> {
  const data = await chrome.storage.sync.get(COST_LIMIT_KEY);
  const val = data[COST_LIMIT_KEY];
  // null/undefined = no limit; number (including 0) = limit set
  return typeof val === 'number' ? val : null;
}

async function updateUsageRatio(stats: UsageStats): Promise<void> {
  const costLimit = await getCostLimit();
  const totalCost = await getTotalCost(stats);
  let ratio: number;
  if (costLimit === null) {
    ratio = -1; // no limit → hide gauge
  } else if (costLimit === 0) {
    ratio = 1; // $0 limit → always full (blocked)
  } else {
    ratio = Math.min(totalCost / costLimit, 1);
  }
  await chrome.storage.sync.set({ [USAGE_RATIO_KEY]: ratio });
}

async function handleTranslateBatch(
  paragraphs: { id: string; text: string }[],
  mode?: 'page' | 'subtitle' | 'word' | 'segment',
  subtitleContext?: { original: string; translated: string }[],
  msgSourceLang?: string,
  msgTargetLang?: string,
): Promise<TranslateBatchResponse> {
  const { selectedEngine } = await chrome.storage.sync.get<{
    selectedEngine?: EngineType;
  }>('selectedEngine');
  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');

  // Resolve language pair: message override > storage > defaults
  // Source language is auto-detected by LLM — only target language is configurable
  let targetLang = msgTargetLang;
  if (!targetLang) {
    const langData = await chrome.storage.sync.get(LANG_STORAGE_KEY);
    const stored = langData[LANG_STORAGE_KEY] as { target?: string } | undefined;
    targetLang = stored?.target || DEFAULT_TARGET_LANG;
  }
  const sourceLang = msgSourceLang || DEFAULT_SOURCE_LANG;
  const lang = { sourceLang, targetLang };

  const engineType: EngineType = selectedEngine || 'gemini';

  const apiKey = engineApiKeys?.[engineType];

  if (!apiKey) {
    return {
      translations: [],
      error: `API key not set. Open extension popup to enter your ${engineType} API key.`,
      apiKeyError: true,
    };
  }

  // Cost limit check before making API call
  const stats = await getUsageStats();
  const currentTotal = await getTotalCost(stats);
  const costLimit = await getCostLimit();

  if (costLimit !== null && currentTotal >= costLimit) {
    return {
      translations: [],
      error: `Cost limit ($${costLimit.toFixed(2)}) reached. Total spent: $${currentTotal.toFixed(4)}. Increase or clear limit in popup.`,
      costLimitExceeded: true,
      totalCost: currentTotal,
    };
  }

  // Segment mode: skip caching, send directly to engine
  if (mode === 'segment') {
    const rateLimitError = checkRateLimit();
    if (rateLimitError) {
      return { translations: [], error: rateLimitError };
    }
    const engine = getEngine(engineType);
    const result = await engine.translate(apiKey, paragraphs, 'segment', undefined, lang);

    if (result.usage) {
      const prev = stats[engineType] || {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        requestCount: 0,
      };
      const cost = calculateCost(engineType, result.usage);
      const updated: EngineUsageStats = {
        inputTokens: prev.inputTokens + result.usage.inputTokens,
        outputTokens: prev.outputTokens + result.usage.outputTokens,
        estimatedCost: prev.estimatedCost + cost,
        requestCount: prev.requestCount + 1,
      };
      stats[engineType] = updated;
      await chrome.storage.sync.set({ [USAGE_STATS_KEY]: stats });
      await updateUsageRatio(stats);
    }

    const newTotal = await getTotalCost(stats);
    return { translations: result.translations, totalCost: newTotal };
  }

  await loadCache();

  // Check cache for each paragraph (include target lang + mode in cache key)
  const cachePrefix = `${targetLang}:${mode === 'word' ? 'w:' : ''}`;
  const cached: { id: string; translatedText: string }[] = [];
  const uncached: { id: string; text: string }[] = [];

  for (const p of paragraphs) {
    const hit = getCached(cachePrefix + p.text);
    if (hit !== null) {
      cached.push({ id: p.id, translatedText: hit });
    } else {
      uncached.push(p);
    }
  }

  // All cached — already saved on first translation, skip
  if (uncached.length === 0) {
    return { translations: cached, totalCost: currentTotal };
  }

  // Rate limit check before API call (cache hits are free, only count real API calls)
  const rateLimitError = checkRateLimit();
  if (rateLimitError) {
    return { translations: cached, error: rateLimitError };
  }

  // Dispatch to selected engine
  const engine = getEngine(engineType);
  const result = await engine.translate(apiKey, uncached, mode ?? 'page', subtitleContext, lang);

  // Store new translations in cache
  for (const t of result.translations) {
    const original = uncached.find((p) => p.id === t.id);
    if (original) {
      setCached(cachePrefix + original.text, t.translatedText);
    }
  }
  persistCache();

  // Accumulate usage stats
  if (result.usage) {
    const prev = stats[engineType] || {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      requestCount: 0,
    };
    const cost = calculateCost(engineType, result.usage);
    const updated: EngineUsageStats = {
      inputTokens: prev.inputTokens + result.usage.inputTokens,
      outputTokens: prev.outputTokens + result.usage.outputTokens,
      estimatedCost: prev.estimatedCost + cost,
      requestCount: prev.requestCount + 1,
    };
    stats[engineType] = updated;
    await chrome.storage.sync.set({ [USAGE_STATS_KEY]: stats });
    await updateUsageRatio(stats);
  }

  const newTotal = await getTotalCost(stats);

  return { translations: [...cached, ...result.translations], totalCost: newTotal };
}
