/**
 * Domain-specific rules for translation injection.
 * Handles edge cases that general heuristics can't cover safely.
 */

export interface SiteRule {
  /** Apply this hostname rule only when the current path matches. */
  pathPattern?: RegExp;
  /** Inject translation as sibling for inline elements (default: false) */
  injectAsSibling?: boolean;
  /** Override main content selector for viewport priority */
  mainContentSelector?: string;
  /** Skip elements matching these selectors */
  skipSelectors?: string[];
  /** Only detect text inside elements matching these selectors (whitelist approach) */
  onlyWithin?: string[];
  /** Only detect elements matching these CSS selectors (skip standard Phase 1+2 detection) */
  translateSelectors?: string[];
  /** Replace element content entirely with translation (used with translateSelectors) */
  forceReplace?: boolean;
  /**
   * After a translation pass, nudge the scroll container by 1px to force a
   * repaint. For virtualized / `content-visibility` lists (Substack chat) the
   * browser defers painting injected content until the next scroll — so the
   * translation is in the DOM but invisible until the user nudges the scroll.
   * Scoped per-site so it never runs anywhere it isn't needed.
   */
  repaintAfterInject?: boolean;
}

const SITE_RULES: Record<string, SiteRule> = {
  'github.com': {
    // Whitelist: only translate content areas on pages that have them (repo Code tab, PR, wiki)
    // Falls back to normal detection on pages without matching containers (Settings, etc.)
    onlyWithin: [
      '.markdown-body', // README, wiki, rendered markdown
      '.comment-body', // PR/issue comments
      '.js-comment-body', // Inline review comments
      '.blob-code-content', // Code file content (rendered markdown in previews)
    ],
    // Fallback skipSelectors: used on pages without onlyWithin containers (Settings, etc.)
    skipSelectors: ['tool-tip', '.sr-only', 'include-fragment', '[itemprop="name"]'],
  },
  'substack.com': {
    injectAsSibling: true,
    mainContentSelector: '.post-content, .body-SxXE9l, article',
    // Substack chat virtualizes messages — injected translations don't paint
    // until a scroll. Force a repaint after each pass.
    repaintAfterInject: true,
  },
  'mail.google.com': {
    // Scope detection to the reading pane. Gmail's left nav, chat panel, and
    // app chrome churn constantly; translating/re-detecting them is wasteful and
    // (before this) kept firing the observer → tripping the circuit breaker.
    // Falls through to whole-page detection if no [role="main"] is present.
    onlyWithin: ['[role="main"]'],
    mainContentSelector: '[role="main"]',
  },
  'antirez.com': {
    // antirez renders article prose inside a single <pre>. Keep PRE globally
    // skipped for code safety and opt in only the verified /news/169 structure.
    pathPattern: /^\/news\/169\/?$/,
    translateSelectors: [
      '#newslist article[data-news-id="169"] h2',
      'topcomment article.comment > pre:not(:has(code))',
    ],
  },
  'skilljar.com': {
    injectAsSibling: true,
    skipSelectors: ['.clp__enroll-btn', 'header'],
  },
};

/**
 * Get site rule for current hostname.
 * Matches exact hostname or parent domain (e.g. foo.substack.com → substack.com).
 */
export function getSiteRule(): SiteRule | null {
  const host = location.hostname;
  const path = location.pathname;

  const applicable = (rule: SiteRule | undefined): rule is SiteRule =>
    !!rule && (!rule.pathPattern || rule.pathPattern.test(path));

  // Exact match
  if (applicable(SITE_RULES[host])) return SITE_RULES[host];

  // Parent domain match (e.g. foo.substack.com → substack.com)
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (applicable(SITE_RULES[parent])) return SITE_RULES[parent];
  }

  return null;
}
