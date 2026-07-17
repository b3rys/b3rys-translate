import type { TextBlock, TranslationMode } from '@/types';
import type { TranslateBatchResponse } from '@/utils/messaging';
import {
  BATCH_SIZE,
  VIEWPORT_BATCH_SIZE,
  PARALLEL_BATCH_COUNT,
  DATA_ATTRS,
  TRANSLATABLE_TAGS,
} from '@/utils/constants';
import { getSiteRule } from '@/utils/site-rules';
import { detectTextBlocks } from './text-detector';
import { isContextInvalidated, markContextInvalidated } from './context-invalidated';

let translateGen = 0;
const REPLACE_MODE_CLASS = 'b3rys-replace-mode';

// --- Scroll preservation ---

/**
 * Find a stable reference element near viewport top (not a translation element).
 */
function findScrollRef(): { el: Element; top: number } | null {
  const htmlEl = document.documentElement;
  let el: Element | null = document.elementFromPoint(window.innerWidth / 2, 100);
  while (
    el &&
    el !== document.body &&
    el !== htmlEl &&
    (el.hasAttribute?.('data-b3rys-translated') ||
      el.hasAttribute?.('data-b3rys-original') ||
      el.closest?.('[data-b3rys-translated]'))
  ) {
    el = el.parentElement;
  }
  if (!el || el === document.body || el === htmlEl) return null;
  return { el, top: el.getBoundingClientRect().top };
}

export function cancelTranslation(): void {
  translateGen++;
  cleanupLoaders(); // immediately remove DOM loading indicators
}

export async function translatePage(
  onProgress?: (completed: number, total: number) => void,
): Promise<'done' | 'cancelled'> {
  // Purge any CSS-hidden translations from previous toggle-off.
  // Elements are display:none so removal causes no layout shift.
  purgeAllTranslations();

  // Force scroll anchoring + hide scrollbar indicator during translation.
  // - overflow-anchor:auto → browser keeps viewport stable when translations
  //   are injected above viewport (they have overflow-anchor:none in CSS)
  // - scrollbar-width:none → hides macOS overlay scrollbar indicator
  //   during any residual scrollBy compensation (no layout shift on macOS)
  const scrollEl = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const prevAnchor = scrollEl.style.overflowAnchor;
  const prevScrollbar = scrollEl.style.scrollbarWidth;
  scrollEl.style.overflowAnchor = 'auto';
  scrollEl.style.scrollbarWidth = 'none';

  const restoreScrollStyles = () => {
    scrollEl.style.overflowAnchor = prevAnchor;
    scrollEl.style.scrollbarWidth = prevScrollbar;
  };

  const gen = ++translateGen;
  const allBlocks = detectTextBlocks();
  if (allBlocks.length === 0) {
    restoreScrollStyles();
    return 'done';
  }

  const { mainViewport, sideViewport, remaining } = classifyBlocks(allBlocks);
  const total = allBlocks.length;
  let completed = 0;

  // Phase 1a: Main content in viewport — highest priority for perceived speed
  if ((await runBatches(mainViewport, VIEWPORT_BATCH_SIZE, gen)) === 'cancelled') {
    restoreScrollStyles();
    return 'cancelled';
  }
  completed += mainViewport.length;
  onProgress?.(completed, total);

  // Phase 1b: Sidebar/nav viewport blocks
  if ((await runBatches(sideViewport, VIEWPORT_BATCH_SIZE, gen)) === 'cancelled') {
    restoreScrollStyles();
    return 'cancelled';
  }
  completed += sideViewport.length;
  onProgress?.(completed, total);

  // Phase 2: Remaining batches — parallel with concurrency limit
  if (
    (await runBatchesThrottled(remaining, BATCH_SIZE, PARALLEL_BATCH_COUNT, gen, (n) => {
      completed += n;
      onProgress?.(completed, total);
    })) === 'cancelled'
  ) {
    restoreScrollStyles();
    return 'cancelled';
  }

  restoreScrollStyles();
  return gen === translateGen ? 'done' : 'cancelled';
}

function classifyBlocks(allBlocks: TextBlock[]): {
  mainViewport: TextBlock[];
  sideViewport: TextBlock[];
  remaining: TextBlock[];
} {
  const viewportHeight = window.innerHeight;
  const viewportBlocks: TextBlock[] = [];
  const remaining: TextBlock[] = [];

  for (const block of allBlocks) {
    const rect = block.element.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < viewportHeight) {
      viewportBlocks.push(block);
    } else {
      remaining.push(block);
    }
  }

  // Sort remaining by distance from viewport
  remaining.sort((a, b) => {
    const rectA = a.element.getBoundingClientRect();
    const rectB = b.element.getBoundingClientRect();
    const distA = Math.min(Math.abs(rectA.top), Math.abs(rectA.top - viewportHeight));
    const distB = Math.min(Math.abs(rectB.top), Math.abs(rectB.top - viewportHeight));
    return distA - distB;
  });

  // Split viewport into main content vs sidebar/nav for priority ordering
  const rule = getSiteRule();
  const MAIN_SELECTOR =
    rule?.mainContentSelector ?? 'article, main, [role="main"], [role="article"]';
  const hasMainArea = !!document.querySelector(MAIN_SELECTOR);
  const mainViewport: TextBlock[] = [];
  const sideViewport: TextBlock[] = [];

  if (hasMainArea) {
    for (const block of viewportBlocks) {
      if (block.element.closest(MAIN_SELECTOR)) {
        mainViewport.push(block);
      } else {
        sideViewport.push(block);
      }
    }
  } else {
    mainViewport.push(...viewportBlocks);
  }

  return { mainViewport, sideViewport, remaining };
}

async function runBatches(
  blocks: TextBlock[],
  batchSize: number,
  gen: number,
): Promise<'done' | 'cancelled'> {
  if (blocks.length === 0) return 'done';
  const batches = chunkArray(blocks, batchSize);
  await Promise.all(batches.map((batch) => processBatch(batch, gen)));
  if (gen !== translateGen) {
    cleanupLoaders();
    return 'cancelled';
  }
  return 'done';
}

async function runBatchesThrottled(
  blocks: TextBlock[],
  batchSize: number,
  concurrency: number,
  gen: number,
  onGroupDone: (count: number) => void,
): Promise<'done' | 'cancelled'> {
  const batches = chunkArray(blocks, batchSize);
  for (let i = 0; i < batches.length; i += concurrency) {
    if (gen !== translateGen) {
      cleanupLoaders();
      return 'cancelled';
    }
    const group = batches.slice(i, i + concurrency);
    await Promise.all(group.map((batch) => processBatch(batch, gen)));
    onGroupDone(group.reduce((sum, b) => sum + b.length, 0));
  }
  return 'done';
}

export function hasTranslationsOnPage(): boolean {
  // CSS-hidden translations don't count — they're "off" from user perspective
  if (document.body.classList.contains(HIDING_CLASS)) return false;
  return document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length > 0;
}

export function setTranslationMode(mode: TranslationMode): void {
  if (mode === 'replace') {
    document.body.classList.add(REPLACE_MODE_CLASS);
  } else {
    document.body.classList.remove(REPLACE_MODE_CLASS);
  }
}

const HIDING_CLASS = 'b3rys-hiding-translations';

/**
 * CSS-only hide with scroll preservation.
 *
 * Strategy: force overflow-anchor:auto on scrolling element so browser
 * anchoring handles most of the drift. Then measure residual drift and
 * correct with a single scrollBy if needed.
 *
 * Translation elements have overflow-anchor:none in CSS, so the browser
 * always anchors to real content.
 */
export function removeAllTranslations(): void {
  const scrollEl = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const prevAnchor = scrollEl.style.overflowAnchor;
  const prevScrollbar = scrollEl.style.scrollbarWidth;
  scrollEl.style.overflowAnchor = 'auto';
  scrollEl.style.scrollbarWidth = 'none';

  const ref = findScrollRef();

  document.body.classList.remove(REPLACE_MODE_CLASS);
  document.body.classList.add(HIDING_CLASS);
  cleanupLoaders();

  // Compensate residual drift (scrollbar hidden so no indicator flash)
  if (ref) {
    const drift = ref.el.getBoundingClientRect().top - ref.top;
    if (Math.abs(drift) > 1) {
      window.scrollBy(0, drift);
    }
  }

  setTimeout(() => {
    scrollEl.style.overflowAnchor = prevAnchor;
    scrollEl.style.scrollbarWidth = prevScrollbar;
  }, 500);
}

/**
 * Actual DOM cleanup — removes translation elements and restores originals.
 * Called before starting a new translation.
 * IMPORTANT: Remove DOM elements FIRST (while still display:none),
 * THEN remove the hiding class. This prevents a flash of visible translations.
 */
export function purgeAllTranslations(): void {
  // Remove translated elements while they're still hidden (no layout shift)
  document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).forEach((el) => el.remove());

  document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).forEach((el) => {
    if (el.tagName === 'SPAN' && el.attributes.length === 1 && !(el as HTMLElement).className) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    } else {
      el.removeAttribute(DATA_ATTRS.ORIGINAL);
    }
  });

  document.querySelectorAll(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((el) => {
    el.removeAttribute(DATA_ATTRS.BLOCK_ID);
  });
  cleanupLoaders();

  // Now safe to remove classes — all translated elements are already gone
  document.body.classList.remove(HIDING_CLASS);
  document.body.classList.remove(REPLACE_MODE_CLASS);
}

// --- Batch processing ---

async function processBatch(batch: TextBlock[], gen: number): Promise<void> {
  if (gen !== translateGen) return;

  const loaders = batch.map((block) => showLoading(block.element));

  try {
    const response: TranslateBatchResponse = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      paragraphs: batch.map((b) => ({ id: b.id, text: b.html })),
    });

    loaders.forEach((loader) => loader.remove());
    if (gen !== translateGen) return;

    if (response.error) {
      if (response.apiKeyError || response.costLimitExceeded) {
        translateGen++; // Cancel all in-flight batches
        await chrome.storage.local.set({ apiKeyErrorMessage: response.error });
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        return;
      }
      batch.forEach((block) => showError(block.element, response.error!));
      return;
    }

    const blockMap = new Map(batch.map((b) => [b.id, b]));
    const ref = findScrollRef();
    for (const result of response.translations) {
      const block = blockMap.get(result.id);
      if (block) {
        injectTranslation(block.element, result.translatedText);
      }
    }
    // Compensate residual drift (scrollbar hidden by translatePage)
    if (ref) {
      const drift = ref.el.getBoundingClientRect().top - ref.top;
      if (Math.abs(drift) > 1) {
        window.scrollBy(0, drift);
      }
    }
  } catch (err) {
    loaders.forEach((loader) => loader.remove());
    if (gen !== translateGen) return;
    if (isContextInvalidated(err)) {
      translateGen++;
      markContextInvalidated();
      return;
    }
    const msg = err instanceof Error ? err.message : 'Translation failed';
    batch.forEach((block) => showError(block.element, msg));
  }
}

function cleanupLoaders(): void {
  document.querySelectorAll('[data-b3rys-loader]').forEach((el) => el.remove());
}

// --- Translation injection ---

const INLINE_MAX_LENGTH = 60;

/**
 * Find the deepest descendant element whose textContent matches the block text.
 * Used to locate the text label inside flex containers (e.g. GitHub ActionList).
 * Returns null if no suitable descendant found (caller uses container as fallback).
 */
export function findTextLabel(container: HTMLElement, blockText: string): HTMLElement | null {
  const target = blockText.trim().replace(/\s+/g, ' ');
  if (!target) return null;

  let deepest: HTMLElement | null = null;
  const walk = (el: HTMLElement) => {
    for (const child of el.children) {
      const childEl = child as HTMLElement;
      if (childEl.tagName === 'SVG' || childEl.tagName === 'IMG') continue;
      const childText = (childEl.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (childText && target.includes(childText)) {
        deepest = childEl;
        walk(childEl);
      }
    }
  };

  walk(container);
  return deepest;
}

export function injectTranslation(element: HTMLElement, translatedText: string): void {
  removePriorTranslation(element);

  const text = element.textContent?.trim() ?? '';
  const sanitized = sanitizeHTML(translatedText);
  // Detect truncation BEFORE modifying DOM (computed styles may change after)
  const truncated = isContentTruncated(element);

  if (isNavItem(element, text)) return injectNavItem(element, sanitized, text);

  const rule = getSiteRule();
  if (isSiblingTarget(rule, element)) return injectAsSibling(element, sanitized, truncated);
  if (rule?.forceReplace) return injectForceReplace(element, sanitized);

  injectBlock(element, sanitized, text, truncated);
}

function removePriorTranslation(element: HTMLElement): void {
  element.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).forEach((el) => el.remove());
  const nextSib = element.nextElementSibling;
  if (nextSib?.hasAttribute(DATA_ATTRS.TRANSLATED)) nextSib.remove();
}

function isNavItem(element: HTMLElement, text: string): boolean {
  if (text.length > INLINE_MAX_LENGTH) return false;
  // Only treat LI/A-in-LI as nav items when inside <nav> — content LIs get block treatment
  if (element.tagName === 'LI') return !!element.closest('nav');
  if (element.tagName === 'A' && element.parentElement?.tagName === 'LI')
    return !!element.closest('nav');
  return false;
}

function isSiblingTarget(rule: ReturnType<typeof getSiteRule>, element: HTMLElement): boolean {
  if (!rule?.injectAsSibling) return false;
  if (TRANSLATABLE_TAGS.has(element.tagName)) return false;
  const display = getComputedStyle(element).display;
  if (display.startsWith('inline')) return true;
  // Flex item children get blockified — check parent display
  const parentDisplay = element.parentElement
    ? getComputedStyle(element.parentElement).display
    : '';
  return /^(flex|inline-flex|grid|inline-grid)$/.test(parentDisplay);
}

/** Short nav items (LI, A inside LI): inline inside label */
function injectNavItem(element: HTMLElement, sanitized: string, text: string): void {
  markOriginalContent(element);
  const span = document.createElement('span');
  span.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
  span.className = 'b3rys-translation-inline';

  const temp = document.createElement('div');
  temp.innerHTML = sanitized;
  if (temp.children.length === 1 && temp.children[0].tagName === 'A') {
    span.textContent = (temp.children[0].textContent ?? '').trim();
  } else {
    span.innerHTML = sanitized;
  }

  const link = element.tagName === 'LI' ? element.querySelector('a') : element;
  const target = link ?? element;
  const labelEl = findTextLabel(target as HTMLElement, text);
  (labelEl ?? target).appendChild(span);
}

/** Non-standard inline elements (span, etc.): inject as sibling or inline child */
function injectAsSibling(element: HTMLElement, sanitized: string, truncated: boolean): void {
  element.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
  const span = document.createElement('span');
  span.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
  span.innerHTML = sanitized;

  const elDisplay = getComputedStyle(element).display;
  const parent = element.parentElement;
  const parentDisplay = parent ? getComputedStyle(parent).display : '';
  const isFlexChild = /^(flex|inline-flex|grid|inline-grid)$/.test(parentDisplay);
  const isFlexContainer = /^(flex|inline-flex|grid|inline-grid)$/.test(elDisplay);

  if (isFlexContainer) {
    // Element IS a flex/grid container (e.g. stat-item, faq-label) —
    // inject inside the child with the most text content
    const textChild = findLargestTextChild(element);
    span.className = 'b3rys-translation-inline';
    if (textChild) {
      textChild.appendChild(span);
    } else {
      element.appendChild(span);
    }
  } else if (isFlexChild) {
    // Parent is flex — inject inside element as inline
    span.className = 'b3rys-translation-inline';
    element.appendChild(span);
  } else {
    span.className = 'b3rys-translation';
    if (truncated) applyTruncationStyles(span);
    element.after(span);
  }
}

/** Force replace targets (e.g. Gmail .bqe/.y2 spans) */
function injectForceReplace(element: HTMLElement, sanitized: string): void {
  markOriginalContent(element);
  const span = document.createElement('span');
  span.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
  span.innerHTML = sanitized;
  span.className = 'b3rys-translation';
  span.style.marginTop = '0';
  element.appendChild(span);
}

/** Block elements (p, h1-h6, div, etc.): inject inside */
function injectBlock(
  element: HTMLElement,
  sanitized: string,
  text: string,
  truncated: boolean,
): void {
  markOriginalContent(element);
  const span = document.createElement('span');
  span.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
  span.innerHTML = sanitized;

  const alwaysBlock = /^(H[1-6]|P|BLOCKQUOTE|LABEL)$/.test(element.tagName);
  if (!alwaysBlock && text.length <= INLINE_MAX_LENGTH) {
    span.className = 'b3rys-translation-inline';
  } else {
    span.className = 'b3rys-translation';
  }

  if (truncated) applyTruncationStyles(span);

  // Flex/grid container: find the deepest text element and inject there.
  // This handles nested flex layouts (e.g. Skilljar curriculum: LI > icon + wrapper > div)
  // by placing translation right next to the text, not at a parent flex level.
  const elStyle = getComputedStyle(element);
  const elDisplay = elStyle.display;
  if (/^(flex|inline-flex|grid|inline-grid)$/.test(elDisplay)) {
    const flexTarget = findTextLabel(element, text) ?? findLargestTextChild(element);
    if (flexTarget && flexTarget !== element) {
      span.className =
        !alwaysBlock && text.length <= INLINE_MAX_LENGTH
          ? 'b3rys-translation-inline'
          : 'b3rys-translation';
      flexTarget.appendChild(span);
      return;
    }
  }

  // Single-link container (e.g. <div><a class="btn">...</a></div>):
  // inject inside the <a> so translation stays visually bound to the button
  // Only for non-semantic containers (DIV, SPAN) — LI/P/etc. handle their own injection
  const soleLink = !TRANSLATABLE_TAGS.has(element.tagName) ? getSoleLink(element) : null;
  if (soleLink) {
    span.className = 'b3rys-translation';
    soleLink.appendChild(span);
    return;
  }

  // Nowrap elements (buttons, badge-like links): force line break for translation
  // Skip if truncated — truncation handler already sets appropriate nowrap styles
  // Skip inside <nav> — nav items should stay inline
  const insideNav = !!element.closest('nav');
  if (
    !insideNav &&
    !truncated &&
    (elStyle.whiteSpace === 'nowrap' || elStyle.whiteSpace === 'pre')
  ) {
    span.className = 'b3rys-translation';
    span.style.whiteSpace = 'normal';
    span.style.display = 'block';
    const br = document.createElement('br');
    br.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
    element.appendChild(br);
  }

  element.appendChild(span);
}

/**
 * Tags whose text content should not count toward a child's "visible" text length.
 * Mirrors TEXT_BOUNDARY_TAGS from text-detector.ts — interactive/sectioning elements
 * whose text shouldn't bleed into parent translation units.
 */
const BOUNDARY_TAGS = new Set(['BUTTON', 'FORM', 'DIALOG', 'DETAILS', 'TEMPLATE', 'NAV']);

/** Get text length excluding BOUNDARY_TAGS descendants (recursive) */
function getVisibleTextLength(el: Element): number {
  let len = 0;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      len += (child.textContent ?? '').trim().length;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (!BOUNDARY_TAGS.has((child as Element).tagName)) {
        len += getVisibleTextLength(child as Element);
      }
    }
  }
  return len;
}

/**
 * If element's only meaningful child is a single <a>, return it.
 * Used to inject translation inside button-like links instead of outside.
 */
function getSoleLink(element: HTMLElement): HTMLAnchorElement | null {
  const children = Array.from(element.children);
  const links = children.filter((c) => c.tagName === 'A') as HTMLAnchorElement[];
  if (links.length !== 1) return null;
  // All other children must be empty/whitespace-only (no visible text)
  const otherChildren = children.filter((c) => c.tagName !== 'A');
  if (otherChildren.some((c) => (c.textContent ?? '').trim().length > 0)) return null;
  return links[0];
}

/** Find the direct child element with the most visible text content */
function findLargestTextChild(element: HTMLElement): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestLen = 0;
  for (const child of element.children) {
    const len = getVisibleTextLength(child);
    if (len > bestLen) {
      bestLen = len;
      best = child as HTMLElement;
    }
  }
  return best;
}

function applyTruncationStyles(span: HTMLElement): void {
  span.style.overflow = 'hidden';
  span.style.textOverflow = 'ellipsis';
  span.style.whiteSpace = 'nowrap';
  span.style.display = 'block';
  span.style.marginTop = '0';
}

/**
 * Check if element or its direct children have CSS text truncation.
 * Requires BOTH text-overflow: ellipsis AND overflow: hidden/clip —
 * text-overflow alone has no visual effect per CSS spec.
 */
function isContentTruncated(element: HTMLElement): boolean {
  if (hasActiveTruncation(element)) return true;
  for (const child of element.children) {
    if (hasActiveTruncation(child as HTMLElement)) return true;
  }
  return false;
}

function hasActiveTruncation(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.textOverflow !== 'ellipsis') return false;
  return style.overflow === 'hidden' || style.overflow === 'clip';
}

/**
 * Mark element's original children so they can be hidden in replace mode.
 * - Element children: add data-b3rys-original attribute directly (preserves flex layout)
 * - Text nodes: wrap in <span data-b3rys-original> (text nodes can't have attributes)
 */
function markOriginalContent(element: HTMLElement): void {
  if (element.querySelector(`:scope > [${DATA_ATTRS.ORIGINAL}]`)) return;

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.hasAttribute(DATA_ATTRS.TRANSLATED) || el.hasAttribute(DATA_ATTRS.LOADER)) continue;
      el.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      const wrapper = document.createElement('span');
      wrapper.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
      element.insertBefore(wrapper, child);
      wrapper.appendChild(child);
    }
  }
}

// --- HTML Sanitization ---

const ALLOWED_TAGS = new Set([
  'A',
  'CODE',
  'STRONG',
  'EM',
  'B',
  'I',
  'BR',
  'SPAN',
  'SUB',
  'SUP',
  'MARK',
  'SMALL',
  'KBD',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
};
const SAFE_CSS_PROPS = new Set([
  'color',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'font-weight',
  'font-style',
  'background-color',
]);

function sanitizeHTML(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (!ALLOWED_TAGS.has(el.tagName)) {
        const text = document.createTextNode(el.textContent ?? '');
        node.replaceChild(text, child);
      } else {
        // Sanitize style attribute: keep only safe CSS properties
        const style = el.getAttribute('style');
        if (style) {
          const safe = style
            .split(';')
            .map((d) => d.trim())
            .filter((d) => {
              const prop = d.split(':')[0]?.trim().toLowerCase();
              return prop && SAFE_CSS_PROPS.has(prop);
            })
            .join('; ');
          if (safe) el.setAttribute('style', safe);
          else el.removeAttribute('style');
        }
        // Remove disallowed attributes (except style, handled above)
        const allowed = ALLOWED_ATTRS[el.tagName] ?? new Set<string>();
        for (const attr of Array.from(el.attributes)) {
          if (attr.name === 'style') continue;
          if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
        }
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') ?? '';
          if (href.startsWith('javascript:') || href.startsWith('data:')) {
            el.removeAttribute('href');
          }
        }
        sanitizeNode(el);
      }
    }
  }
}

function showLoading(element: HTMLElement): HTMLElement {
  const loader = document.createElement('span');
  loader.className = 'b3rys-loading';
  loader.setAttribute('data-b3rys-loader', 'true');
  element.appendChild(loader);
  return loader;
}

function showError(element: HTMLElement, message: string): void {
  const errorEl = document.createElement('span');
  errorEl.className = 'b3rys-error';
  errorEl.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
  errorEl.textContent = `번역 실패: ${message}`;
  element.appendChild(errorEl);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
