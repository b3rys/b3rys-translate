export const ENGINE_ENDPOINTS = {
  gemini:
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
} as const;

export const ENGINE_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  openai: 'gpt-4.1-nano',
  anthropic: 'claude-haiku-4-5-20251001',
} as const;

/** Logged at content-script startup so the running bundle can be identified
 * in DevTools (stale bundles after a rebuild look identical otherwise). */
export const BUILD_TAG = '0.5.6';

export const BATCH_SIZE = 15;
export const VIEWPORT_BATCH_SIZE = 5;
// Worker-pool size for the page-translation pipeline. One ordered queue
// (viewport batches first) drained by this many concurrent workers — no phase
// barriers. Kept modest so a burst can't blow past the background rate limiter
// (150 calls/min); for normal pages total calls stay well under that.
export const PIPELINE_CONCURRENCY = 6;
export const MAX_TEXT_LENGTH = 5000;
export const DEBOUNCE_DELAY = 500;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_BASE = 1000;

export const TRANSLATABLE_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DT',
  'DD',
  'SUMMARY',
  'CAPTION',
  'LABEL',
]);

export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'VAR',
  'SVG',
  'MATH',
  'CANVAS',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'FOOTER',
]);

export const DATA_ATTRS = {
  TRANSLATED: 'data-b3rys-translated',
  BLOCK_ID: 'data-b3rys-id',
  LOADER: 'data-b3rys-loader',
  ORIGINAL: 'data-b3rys-original',
} as const;

// YouTube subtitle constants
export const SUBTITLE_BATCH_SIZE = 20;
export const SUBTITLE_LOOK_AHEAD_SEC = 120; // Translate cues within N seconds ahead
export const SUBTITLE_CHECK_INTERVAL = 2000; // Rolling translator poll interval (ms)

export const YT_SELECTORS = {
  CAPTION_WINDOW: '.caption-window',
  CAPTION_SEGMENT: '.ytp-caption-segment',
  CAPTION_VISUAL_LINE: '.caption-visual-line',
  CAPTION_WINDOW_CONTAINER: '.ytp-caption-window-container',
} as const;

export const YT_TRANSLATED_ATTR = 'data-b3rys-subtitle-translated';
export const YT_TRANSLATION_CLASS = 'b3rys-subtitle-translation';

// Translation cache constants
// 4000 entries ≈ 1–2MB — big pages alone can be 500+ blocks (claude.com
// tutorials = 514) and YouTube adds hundreds of cues, so 1000 caused constant
// LRU eviction churn: the largest page's entries were pushed out between
// toggles and re-translated (paid) every time.
export const CACHE_MAX_ENTRIES = 4000;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CACHE_STORAGE_KEY = 'b3rys_translation_cache';

// USD per 1M tokens
export const ENGINE_PRICING: Record<string, { input: number; output: number; unit: 'tokens' }> = {
  gemini: { input: 0.25, output: 1.5, unit: 'tokens' },
  openai: { input: 0.1, output: 0.4, unit: 'tokens' },
  anthropic: { input: 1.0, output: 5.0, unit: 'tokens' },
};

// Usage stats storage key
export const USAGE_STATS_KEY = 'b3rys_usage_stats';
export const COST_LIMIT_KEY = 'b3rys_cost_limit';
export const USAGE_RATIO_KEY = 'b3rys_usage_ratio';

// Supported languages
export type LanguageCode = 'en' | 'ko' | 'ja' | 'zh' | 'de' | 'fr' | 'es' | 'pt' | 'it' | 'ru';

export const LANGUAGES: Record<
  LanguageCode,
  { name: string; nativeName: string; script: 'latin' | 'cjk' | 'cyrillic' }
> = {
  en: { name: 'English', nativeName: 'English', script: 'latin' },
  ko: { name: 'Korean', nativeName: '한국어', script: 'cjk' },
  ja: { name: 'Japanese', nativeName: '日本語', script: 'cjk' },
  zh: { name: 'Chinese', nativeName: '中文', script: 'cjk' },
  de: { name: 'German', nativeName: 'Deutsch', script: 'latin' },
  fr: { name: 'French', nativeName: 'Français', script: 'latin' },
  es: { name: 'Spanish', nativeName: 'Español', script: 'latin' },
  pt: { name: 'Portuguese', nativeName: 'Português', script: 'latin' },
  it: { name: 'Italian', nativeName: 'Italiano', script: 'latin' },
  ru: { name: 'Russian', nativeName: 'Русский', script: 'cyrillic' },
};

export const DEFAULT_SOURCE_LANG: LanguageCode = 'en';
export const DEFAULT_TARGET_LANG: LanguageCode = 'ko';

export const LANG_STORAGE_KEY = 'b3rys_language_pair';

// Hosts where page translation is disabled (complex web apps)
export const SKIP_HOSTS = new Set([
  'calendar.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'drive.google.com',
]);
