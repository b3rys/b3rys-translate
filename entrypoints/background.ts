import { getEngine } from '@/utils/engines';
import type { EngineType } from '@/utils/engines/types';
import type { UsageData } from '@/utils/engines/types';
import type {
  BackgroundMessage,
  TranslateBatchResponse,
  CacheLookupResponse,
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
// Cost backstop for a genuine runaway loop. Each call is a *batch* (up to
// BATCH_SIZE paragraphs / SUBTITLE_BATCH_SIZE cues), and this counter is global
// across every tab + YouTube rolling translation, so it must sit well above
// legitimate heavy use (long pages, multi-tab, a talky video). The real
// runaway-loop guard is content.ts's circuit breaker (15 starts/min); this is
// only the last-resort cost cap.
const RATE_MAX_CALLS = 150; // max API calls per window (cache hits don't count)
const recentApiCalls: number[] = [];

function checkRateLimit(): string | null {
  const now = Date.now();
  while (recentApiCalls.length > 0 && recentApiCalls[0] < now - RATE_WINDOW) {
    recentApiCalls.shift();
  }
  if (recentApiCalls.length >= RATE_MAX_CALLS) {
    return `Translation paused: ${RATE_MAX_CALLS} API calls/min limit reached. Wait a moment or reload the page to resume.`;
  }
  recentApiCalls.push(now);
  return null;
}

export default defineBackground(() => {
  loadCache();
  migrateStorage();

  // The popup can reset usage or change the cost limit by writing storage.local
  // directly. Adopt such external changes so the in-memory accumulator doesn't
  // resurrect stale totals on its next flush. Our own flush writes match
  // lastFlushedUsageJson and are ignored.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[USAGE_STATS_KEY]) return;
    const nv = changes[USAGE_STATS_KEY].newValue as UsageStats | undefined;
    const json = nv ? JSON.stringify(nv) : '';
    if (json !== lastFlushedUsageJson) {
      usageStatsCache = nv ?? {};
      lastFlushedUsageJson = json;
      usageDirty = false; // storage is now authoritative
    }
  });

  chrome.runtime.onMessage.addListener(
    (
      message: BackgroundMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (
        response: TranslateBatchResponse | CacheLookupResponse | ClearCacheResponse,
      ) => void,
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

      if (message.type === 'CACHE_LOOKUP') {
        handleCacheLookup(message.paragraphs, message.targetLang)
          .then(sendResponse)
          .catch(() => sendResponse({ translations: [] }));
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

// --- Usage/cost accounting (in-memory accumulator + debounced flush) ---
// Writing stats on every batch (2 storage writes × ~56 batches on a long page)
// was hammering storage — and in chrome.storage.sync it blew the 120/min write
// quota, after which ALL sync writes (incl. unrelated settings like the FAB
// on/off state and the Auto toggle) silently failed. Usage is per-device and
// doesn't need to be real-time, so: accumulate in memory, persist to
// storage.local at most once every few seconds. The accumulator also fixes a
// pre-existing lost-update race (6 concurrent workers each did read-add-write,
// clobbering each other → undercounted cost).
const USAGE_FLUSH_DEBOUNCE_MS = 3000; // quiet period before writing
const USAGE_FLUSH_MAX_MS = 15_000; // hard cap so a continuous burst still flushes

let usageStatsCache: UsageStats | null = null;
let usageFlushTimer: ReturnType<typeof setTimeout> | null = null;
let usageFirstDirtyAt = 0;
let usageDirty = false;
let lastFlushedUsageJson = '';

async function getUsageStats(): Promise<UsageStats> {
  if (usageStatsCache) return usageStatsCache;
  const data = await chrome.storage.local.get(USAGE_STATS_KEY);
  usageStatsCache = (data[USAGE_STATS_KEY] as UsageStats) || {};
  lastFlushedUsageJson = JSON.stringify(usageStatsCache);
  return usageStatsCache;
}

/** Accumulate a batch's usage in memory and schedule a coalesced flush. */
function recordUsage(engineType: EngineType, usage: UsageData): void {
  const stats = usageStatsCache ?? (usageStatsCache = {});
  const prev = stats[engineType] || {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    requestCount: 0,
  };
  stats[engineType] = {
    inputTokens: prev.inputTokens + usage.inputTokens,
    outputTokens: prev.outputTokens + usage.outputTokens,
    estimatedCost: prev.estimatedCost + calculateCost(engineType, usage),
    requestCount: prev.requestCount + 1,
  };
  scheduleUsageFlush();
}

function scheduleUsageFlush(): void {
  usageDirty = true;
  const now = Date.now();
  if (!usageFirstDirtyAt) usageFirstDirtyAt = now;
  if (usageFlushTimer) clearTimeout(usageFlushTimer);
  const wait = Math.max(
    0,
    Math.min(USAGE_FLUSH_DEBOUNCE_MS, USAGE_FLUSH_MAX_MS - (now - usageFirstDirtyAt)),
  );
  usageFlushTimer = setTimeout(() => void flushUsage(), wait);
}

async function flushUsage(): Promise<void> {
  if (usageFlushTimer) {
    clearTimeout(usageFlushTimer);
    usageFlushTimer = null;
  }
  if (!usageDirty || !usageStatsCache) return;
  usageDirty = false;
  usageFirstDirtyAt = 0;
  lastFlushedUsageJson = JSON.stringify(usageStatsCache);
  await chrome.storage.local.set({ [USAGE_STATS_KEY]: usageStatsCache });
  await updateUsageRatio(usageStatsCache);
}

async function getTotalCost(stats: UsageStats): Promise<number> {
  return Object.values(stats).reduce((sum, s) => sum + (s?.estimatedCost ?? 0), 0);
}

async function getCostLimit(): Promise<number | null> {
  const data = await chrome.storage.local.get(COST_LIMIT_KEY);
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
  await chrome.storage.local.set({ [USAGE_RATIO_KEY]: ratio });
}

/** Resolve the effective target language: message override > storage > default. */
async function resolveTargetLang(msgTargetLang?: string): Promise<string> {
  if (msgTargetLang) return msgTargetLang;
  const langData = await chrome.storage.local.get(LANG_STORAGE_KEY);
  const stored = langData[LANG_STORAGE_KEY] as { target?: string } | undefined;
  return stored?.target || DEFAULT_TARGET_LANG;
}

/** Cache key prefix — single source of truth for lookup and store paths. */
function cacheKeyPrefix(targetLang: string, mode?: 'page' | 'subtitle' | 'word' | 'segment') {
  return `${targetLang}:${mode === 'word' ? 'w:' : ''}`;
}

/**
 * Pure cache read — no API call, no rate-limit slot, no usage stats.
 * Returns only the hits; the content script paints them instantly and
 * sends the misses through the normal TRANSLATE_BATCH path.
 */
async function handleCacheLookup(
  paragraphs: { id: string; text: string }[],
  msgTargetLang?: string,
): Promise<CacheLookupResponse> {
  await loadCache();
  const prefix = cacheKeyPrefix(await resolveTargetLang(msgTargetLang), 'page');
  const translations: { id: string; translatedText: string }[] = [];
  for (const p of paragraphs) {
    const hit = getCached(prefix + p.text);
    if (hit !== null) translations.push({ id: p.id, translatedText: hit });
  }
  return { translations };
}

async function handleTranslateBatch(
  paragraphs: { id: string; text: string }[],
  mode?: 'page' | 'subtitle' | 'word' | 'segment',
  subtitleContext?: { original: string; translated: string }[],
  msgSourceLang?: string,
  msgTargetLang?: string,
): Promise<TranslateBatchResponse> {
  const { selectedEngine } = await chrome.storage.local.get<{
    selectedEngine?: EngineType;
  }>('selectedEngine');
  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');

  // Resolve language pair: message override > storage > defaults
  // Source language is auto-detected by LLM — only target language is configurable
  const targetLang = await resolveTargetLang(msgTargetLang);
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
      recordUsage(engineType, result.usage);
    }

    const newTotal = await getTotalCost(stats);
    return { translations: result.translations, totalCost: newTotal };
  }

  await loadCache();

  // Check cache for each paragraph (include target lang + mode in cache key)
  const cachePrefix = cacheKeyPrefix(targetLang, mode);
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

  // Accumulate usage stats (coalesced flush — see recordUsage)
  if (result.usage) {
    recordUsage(engineType, result.usage);
  }

  const newTotal = await getTotalCost(stats);

  return { translations: [...cached, ...result.translations], totalCost: newTotal };
}
