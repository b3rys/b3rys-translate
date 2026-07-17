import type { TextBlock } from '@/types';
import {
  TRANSLATABLE_TAGS,
  SKIP_TAGS,
  DATA_ATTRS,
  LANGUAGES,
  LANG_STORAGE_KEY,
  DEFAULT_SOURCE_LANG,
  type LanguageCode,
} from '@/utils/constants';
import { getSiteRule } from '@/utils/site-rules';

let blockCounter = 0;
let sourceScript: 'latin' | 'cjk' | 'cyrillic' = 'latin';

/** Load source language script type from storage. Called once on init. */
export async function loadSourceLanguage(): Promise<void> {
  try {
    const data = await chrome.storage.sync.get(LANG_STORAGE_KEY);
    const stored = data[LANG_STORAGE_KEY] as { source?: string } | undefined;
    const code = (stored?.source || DEFAULT_SOURCE_LANG) as LanguageCode;
    sourceScript = LANGUAGES[code]?.script ?? 'latin';
  } catch {
    sourceScript = 'latin';
  }
}

export function detectTextBlocks(root: Element = document.body): TextBlock[] {
  // Phase 0: Custom selectors (site-specific, replaces standard detection)
  const rule = getSiteRule();
  if (rule?.translateSelectors?.length) {
    return detectSelectorBlocks(root, rule.translateSelectors);
  }

  // onlyWithin: restrict detection to content areas (whitelist approach)
  // Falls back to normal detection if no matching containers exist on the page
  if (rule?.onlyWithin?.length) {
    const selector = rule.onlyWithin.join(',');
    const containers = root.querySelectorAll(selector);
    if (containers.length > 0) {
      const allBlocks: TextBlock[] = [];
      for (const container of containers) {
        const blocks = detectStandardBlocks(container as Element);
        const filtered = filterAncestorBlocks(blocks);
        const leafBlocks = detectLeafTextBlocks(container as Element);
        allBlocks.push(...filtered, ...leafBlocks);
      }
      return allBlocks;
    }
    // No matching containers → fall through to normal detection
  }

  // Phase 1: Semantic block tags (P, H1-H6, LI, TD, BLOCKQUOTE, etc.)
  const blocks = detectStandardBlocks(root);
  const filtered = filterAncestorBlocks(blocks);

  // Phase 2: Text containers missed by Phase 1 (nav menus, sidebars, bios)
  const leafBlocks = detectLeafTextBlocks(root);

  return [...filtered, ...leafBlocks];
}

/**
 * Phase 0: Detect elements matching site-specific CSS selectors.
 * Used for complex web apps (e.g. Gmail) where standard detection picks wrong elements.
 */
function detectSelectorBlocks(root: Element, selectors: string[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.hasAttribute(DATA_ATTRS.TRANSLATED) || htmlEl.hasAttribute(DATA_ATTRS.BLOCK_ID))
        continue;
      if (isElementHidden(htmlEl)) continue;
      const text = (htmlEl.textContent ?? '').trim();
      if (!text || !isLikelyEnglish(text)) continue;

      const id = `b3rys-${++blockCounter}`;
      htmlEl.setAttribute(DATA_ATTRS.BLOCK_ID, id);
      blocks.push({ id, element: htmlEl, text, html: text });
    }
  }
  return blocks;
}

// ============================================================
// Shared: TreeWalker element rejection
// ============================================================
// Both phases use the same structural rejection logic.
// FILTER_REJECT = skip element AND all its descendants.

/** Cached skip selectors from site rule (lazy, computed on first call) */
let _skipSelectorsCache: string | null | undefined;
function getSkipSelectors(): string | null {
  if (_skipSelectorsCache === undefined) {
    const rule = getSiteRule();
    _skipSelectorsCache = rule?.skipSelectors?.length ? rule.skipSelectors.join(',') : null;
  }
  return _skipSelectorsCache;
}

/** Reset cached skip selectors (for testing only) */
export function _resetSkipSelectorsCache(): void {
  _skipSelectorsCache = undefined;
}

function rejectIfSkippable(el: HTMLElement): number | null {
  // [R1] Already processed (translated or detected in this run)
  if (el.hasAttribute(DATA_ATTRS.TRANSLATED) || el.hasAttribute(DATA_ATTRS.BLOCK_ID)) {
    return NodeFilter.FILTER_REJECT;
  }
  // [R2] Not visible on page
  if (isElementHidden(el)) {
    return NodeFilter.FILTER_REJECT;
  }
  // [R3] Non-translatable tag (SCRIPT, STYLE, CODE, PRE, INPUT, etc.)
  if (SKIP_TAGS.has(el.tagName)) {
    return NodeFilter.FILTER_REJECT;
  }
  // [R4] Site-rule skipSelectors — skip element + all descendants
  const skipSel = getSkipSelectors();
  if (skipSel && el.matches(skipSel)) {
    return NodeFilter.FILTER_REJECT;
  }
  return null;
}

// ============================================================
// Shared: Text content filter pipeline
// ============================================================
// "Translate everything by default, skip only with explicit rules."
// Returns true → skip (don't translate).

function shouldSkipText(el: HTMLElement, text: string, phase: 1 | 2): boolean {
  // Too short — single characters (e.g. "X", "·")
  if (text.length < 2) return true;

  // [F1] URL text — bare URLs ("youtube.com/...", "https://...")
  if (isUrlLike(text)) return true;

  // [F2] Non-source-language text — already in target language or other script
  if (!isLikelyEnglish(text)) return true;

  // [F5] Phase 2: container wrapping Phase 1 blocks (prevent duplicate)
  if (phase === 2 && el.querySelector(`[${DATA_ATTRS.BLOCK_ID}]`)) return true;

  return false;
}

// ============================================================
// Phase 1: Semantic block detection
// ============================================================
// Targets: TRANSLATABLE_TAGS (P, H1-H6, LI, TD, TH, BLOCKQUOTE, etc.)
// Text extraction: getDirectText/getDirectHTML — excludes nested block children,
//   includes inline markup (a, code, strong, em, etc.)

function detectStandardBlocks(root: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const rejected = rejectIfSkippable(el);
      if (rejected !== null) return rejected;

      if (TRANSLATABLE_TAGS.has(el.tagName)) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as HTMLElement;
    const text = getDirectText(el).trim();
    if (shouldSkipText(el, text, 1)) continue;

    const id = `b3rys-${++blockCounter}`;
    el.setAttribute(DATA_ATTRS.BLOCK_ID, id);
    const html = getDirectHTML(el).trim();
    blocks.push({ id, element: el, text, html });
  }

  return blocks;
}

// ============================================================
// Phase 2: Text container detection (nav, sidebar, bio, etc.)
// ============================================================
// Targets: DIV, SPAN that are:
//   - Leaf elements (children.length === 0), OR
//   - Elements with only inline children (A, SPAN, STRONG, etc.)
// Catches text that Phase 1 misses because it's not in semantic tags.
// Phase 1 blocks are REJECT-ed to prevent duplicate detection.
// HTML is sent as plain textContent (no innerHTML) for safety.

/** Inline tags allowed as direct children in Phase 2 candidates */
const PHASE2_INLINE_TAGS = new Set([
  'A',
  'SPAN',
  'STRONG',
  'EM',
  'B',
  'I',
  'BR',
  'CODE',
  'SMALL',
  'SUB',
  'SUP',
  'MARK',
  'KBD',
  'ABBR',
  'TIME',
]);

function hasOnlyInlineChildren(el: HTMLElement): boolean {
  for (const child of el.children) {
    if (!PHASE2_INLINE_TAGS.has(child.tagName)) return false;
    // Recursive: <a> wrapping block content (cards) isn't truly inline
    if (!hasOnlyInlineChildren(child as HTMLElement)) return false;
  }
  return true;
}

/**
 * Composite-cell container: element children that read as separate visual cells
 * (e.g. a news row: date | category | title). Their textContents concatenate
 * with no whitespace, so translating the container as ONE unit produces run-on
 * garbage ("Jul 14, 2026Product Introducing…" → "2026년 7월 14일제품…").
 * Each cell must be its own translation unit instead.
 *
 * Detected structurally (no layout reads — deterministic in tests):
 *   1. ≥2 direct element children carrying their own text
 *   2. no loose text directly inside the container (a real sentence has some,
 *      e.g. <p>Hello <strong>world</strong> again</p>)
 *   3. at least one adjacent text-bearing pair whose texts would join without
 *      any whitespace boundary — the "glue" that breaks translation
 */
export function isCompositeCells(el: HTMLElement): boolean {
  const textKids = (Array.from(el.children) as HTMLElement[]).filter(
    (c) => (c.textContent ?? '').trim().length > 0,
  );
  if (textKids.length < 2) return false;

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) return false;
  }

  for (let i = 0; i < textKids.length - 1; i++) {
    const a = textKids[i].textContent ?? '';
    const b = textKids[i + 1].textContent ?? '';
    if (/\s$/.test(a) || /^\s/.test(b)) continue; // own edges provide a boundary
    if (hasWhitespaceBetween(el, textKids[i], textKids[i + 1])) continue;
    return true;
  }
  return false;
}

/** Any whitespace text node between siblings a and b (exclusive)? */
function hasWhitespaceBetween(parent: HTMLElement, a: Element, b: Element): boolean {
  let between = false;
  for (const node of parent.childNodes) {
    if (node === a) {
      between = true;
      continue;
    }
    if (node === b) break;
    if (between && node.nodeType === Node.TEXT_NODE && /\s/.test(node.textContent ?? '')) {
      return true;
    }
  }
  return false;
}

function detectLeafTextBlocks(root: Element): TextBlock[] {
  const blocks: TextBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const rejected = rejectIfSkippable(el);
      if (rejected !== null) return rejected;

      // [F7] TABLE subtrees — Phase 2 targets nav/sidebar, not table data
      if (el.tagName === 'TABLE') return NodeFilter.FILTER_REJECT;

      if (
        el.tagName === 'DIV' ||
        el.tagName === 'SPAN' ||
        el.tagName === 'A' ||
        el.tagName === 'BUTTON' ||
        el.tagName === 'TIME'
      ) {
        if (el.children.length === 0) return NodeFilter.FILTER_ACCEPT;
        // Composite cells (date | category | title rows) must not merge into
        // one unit — SKIP descends so each cell is detected on its own.
        if (hasOnlyInlineChildren(el) && !isCompositeCells(el)) {
          return NodeFilter.FILTER_ACCEPT;
        }
      }

      return NodeFilter.FILTER_SKIP;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as HTMLElement;
    // Skip if ancestor already detected in this Phase 2 run (parent covers this text)
    if (el.parentElement?.closest(`[${DATA_ATTRS.BLOCK_ID}]`)) continue;
    const text = el.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    if (shouldSkipText(el, text, 2)) continue;

    const id = `b3rys-${++blockCounter}`;
    el.setAttribute(DATA_ATTRS.BLOCK_ID, id);
    blocks.push({ id, element: el, text, html: text });
  }

  return blocks;
}

// ============================================================
// Text extraction (Phase 1 only)
// ============================================================

/**
 * Tags that getDirectText/getDirectHTML won't recurse into.
 * These are interactive or sectioning elements whose text shouldn't bleed
 * into the parent's translation unit (e.g. buttons/dialogs inside an LI).
 * Unlike SKIP_TAGS, TreeWalker still enters these normally.
 */
const TEXT_BOUNDARY_TAGS = new Set(['BUTTON', 'FORM', 'DIALOG', 'DETAILS', 'TEMPLATE', 'NAV']);

/**
 * Is this child element a boundary for parent text collection?
 * Semantic blocks, skip/interactive tags, and composite-cell containers all
 * form their own translation units — their text must not bleed into the parent.
 */
function isTextCollectionBoundary(child: HTMLElement): boolean {
  const tag = child.tagName;
  return (
    TRANSLATABLE_TAGS.has(tag) ||
    SKIP_TAGS.has(tag) ||
    TEXT_BOUNDARY_TAGS.has(tag) ||
    isCompositeCells(child)
  );
}

/** Get text content excluding boundary children (recursive) */
function getDirectText(el: HTMLElement): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (isTextCollectionBoundary(child as HTMLElement)) continue;
      text += getDirectText(child as HTMLElement);
    }
  }
  return text;
}

/** Selector string for stripping SKIP_TAGS descendants from HTML */
const SKIP_TAGS_SELECTOR = Array.from(SKIP_TAGS).join(',');

/** Attributes to preserve in HTML sent to translation API (tag → attr names) */
const API_KEEP_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href']),
};

/** Clean element for API: strip SKIP_TAGS descendants and non-essential attributes */
function cleanForAPI(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(SKIP_TAGS_SELECTOR).forEach((n) => n.remove());
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    const elem = node as HTMLElement;
    const keep = API_KEEP_ATTRS[elem.tagName] ?? new Set<string>();
    for (const attr of Array.from(elem.attributes)) {
      if (!keep.has(attr.name)) elem.removeAttribute(attr.name);
    }
  }
  return clone.outerHTML;
}

/** Get HTML content excluding boundary children (preserves inline markup) */
function getDirectHTML(el: HTMLElement): string {
  let html = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      html += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      if (isTextCollectionBoundary(childEl)) continue;
      html += cleanForAPI(childEl);
    }
  }
  return html;
}

// ============================================================
// Visibility
// ============================================================

/**
 * Check if element is hidden.
 * offsetParent === null is unreliable (also null for position:fixed/sticky, display:contents).
 * Fallback: getClientRects + display:contents special-case.
 */
function isElementHidden(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return false;
  if (el.tagName === 'BODY' || el.tagName === 'HTML') return false;
  if (el.getClientRects().length > 0) return false;
  // display:contents: no box (offsetParent=null, no rects) but children visible
  if (getComputedStyle(el).display === 'contents') return false;
  return true;
}

// ============================================================
// Heuristic functions
// ============================================================

/** [F1] URL detection — skip bare URLs to avoid duplicate "translation" */
function isUrlLike(text: string): boolean {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (!/\s/.test(t) && /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return true;
  return false;
}

/** [F2] Language detection — check if text is likely in the source language */
function isLikelySourceLang(text: string): boolean {
  const totalLetters = text.replace(/[\s\d\p{P}]/gu, '').length;
  if (totalLetters === 0) return false;

  if (sourceScript === 'cjk') {
    // CJK: count CJK Unified Ideographs + Hiragana + Katakana + Hangul
    const cjkChars = text.replace(/[^\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/g, '').length;
    return cjkChars / totalLetters > 0.4;
  }

  if (sourceScript === 'cyrillic') {
    const cyrillicChars = text.replace(/[^\u0400-\u04ff]/g, '').length;
    return cyrillicChars / totalLetters > 0.4;
  }

  // Latin: ASCII letter ratio > 60%
  const asciiLetters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '').length;
  return asciiLetters / totalLetters > 0.6;
}

/** @deprecated Use isLikelySourceLang. Kept for backward compat in tests. */
function isLikelyEnglish(text: string): boolean {
  return isLikelySourceLang(text);
}

// (Removed: isMostlyLinks, LINKS_EXEMPT_TAGS, SKIP_ROLES, isInsideSkippedAncestor
//  — "translate everything" approach eliminates heuristic filters)

// ============================================================
// Post-processing
// ============================================================

/** Sort blocks: viewport-visible first, then by distance from viewport */
export function sortBlocksByViewportPriority(blocks: TextBlock[]): TextBlock[] {
  const viewportHeight = window.innerHeight;
  return [...blocks].sort((a, b) => {
    const rectA = a.element.getBoundingClientRect();
    const rectB = b.element.getBoundingClientRect();
    const inViewA = rectA.bottom > 0 && rectA.top < viewportHeight;
    const inViewB = rectB.bottom > 0 && rectB.top < viewportHeight;
    if (inViewA && !inViewB) return -1;
    if (!inViewA && inViewB) return 1;
    const distA = inViewA
      ? rectA.top
      : Math.min(Math.abs(rectA.top), Math.abs(rectA.top - viewportHeight));
    const distB = inViewB
      ? rectB.top
      : Math.min(Math.abs(rectB.top), Math.abs(rectB.top - viewportHeight));
    return distA - distB;
  });
}

/** Remove blocks that are ancestors of other detected blocks (prevent duplicate translation) */
function filterAncestorBlocks(blocks: TextBlock[]): TextBlock[] {
  const elements = new Set(blocks.map((b) => b.element));
  return blocks.filter((block) => {
    for (const el of elements) {
      if (el !== block.element && block.element.contains(el)) {
        block.element.removeAttribute(DATA_ATTRS.BLOCK_ID);
        return false;
      }
    }
    return true;
  });
}
