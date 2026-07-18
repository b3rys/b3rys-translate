import type { TextBlock, TranslationMode } from '@/types';
import type { TranslateBatchResponse, CacheLookupResponse } from '@/utils/messaging';
import { BATCH_SIZE, PIPELINE_CONCURRENCY, DATA_ATTRS, TRANSLATABLE_TAGS } from '@/utils/constants';
import { getSiteRule } from '@/utils/site-rules';
import { isFighting, recordInjection, resetFightGuard } from '@/utils/fight-guard';
import { detectTextBlocks } from './text-detector';
import { isContextInvalidated, markContextInvalidated } from './context-invalidated';
import { dbg, isDebug } from '@/utils/debug';

let translateGen = 0;
const REPLACE_MODE_CLASS = 'b3rys-replace-mode';

// Timestamp of the user's last scroll INTENT. Listens to raw input
// (wheel/touch/scroll keys), NOT 'scroll' events — our own drift corrections
// write scrollTop and fire 'scroll' too, which would masquerade as user
// scrolling and permanently disable the fight guard's scroll-driven exception
// (each batch correction would re-arm the 2.5s window).
let lastUserScrollTs = 0;
const SCROLL_DRIVEN_WINDOW_MS = 2500;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const noteUserScroll = () => {
  lastUserScrollTs = Date.now();
};
window.addEventListener('wheel', noteUserScroll, { capture: true, passive: true });
window.addEventListener('touchmove', noteUserScroll, { capture: true, passive: true });
window.addEventListener(
  'keydown',
  (e) => {
    if (SCROLL_KEYS.has(e.key)) noteUserScroll();
  },
  { capture: true, passive: true },
);

// Debug-only scroll-jump watcher: with localStorage.b3rys_debug='1', any
// abrupt viewport jump (>80px between scroll events) is reported with the
// translation phase that was active — one console screenshot pinpoints the
// culprit without pasting probe snippets.
let debugPhase = 'idle';
export function setDebugPhase(phase: string): void {
  debugPhase = phase;
}
if (isDebug()) {
  let lastY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      const d = y - lastY;
      lastY = y;
      if (Math.abs(d) > 30) {
        console.warn('[b3rys][jump] %dpx (y %d→%d) phase=%s', d, y - d, y, debugPhase);
      }
    },
    { capture: true, passive: true },
  );
}

function isScrollDriven(): boolean {
  return Date.now() - lastUserScrollTs < SCROLL_DRIVEN_WINDOW_MS;
}

// --- Scroll preservation ---

const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'IFRAME', 'CANVAS', 'PICTURE', 'SVG', 'FIGURE']);

interface ScrollAnchor {
  el: Element;
  top: number;
  /** Scroll container being pinned — null means the window scrolls. */
  scroller: HTMLElement | null;
}

/**
 * Nearest scrollable ancestor that actually overflows; null = window scroller.
 * Apps like Gmail scroll an inner div, not the document — compensating the
 * window there nudges the wrong scroller and makes the view stutter.
 */
function getScrollContainer(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function isB3rysOwned(el: Element): boolean {
  return (
    !!el.hasAttribute?.('data-b3rys-translated') ||
    !!el.hasAttribute?.('data-b3rys-original') ||
    !!el.closest?.('[data-b3rys-translated]')
  );
}

/**
 * Is the element pinned to the viewport (fixed/sticky ancestor chain)?
 * A pinned element never moves when content grows, so using it as a drift
 * anchor silently disables compensation — on ANY site with a sticky header,
 * not just inner-scroller apps.
 */
export function isViewportPinned(el: Element, boundary: Element | null): boolean {
  let node: Element | null = el;
  const stop = boundary ?? document.body;
  while (node && node !== stop && node !== document.documentElement) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Pick a stable anchor element INSIDE the given scroller, near the top of its
 * visible area. The old approach probed at window coordinates (center, y=100),
 * which in apps like Gmail lands on the *fixed* toolbar — an element that never
 * moves when content grows, so drift always measured 0 and no correction ever
 * ran. Probing is scroller-relative and retries deeper points until it finds an
 * element that actually lives inside the scrolled content.
 */
function findContentAnchor(scroller: HTMLElement | null): ScrollAnchor | null {
  const rect = scroller
    ? scroller.getBoundingClientRect()
    : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const x = rect.left + rect.width / 2;
  const maxY = Math.min(rect.top + rect.height, window.innerHeight);

  const visibleH = maxY - rect.top;
  const probeDepths = [60, 140, 240, 360, visibleH * 0.5, visibleH * 0.7];
  for (const dy of probeDepths) {
    const y = rect.top + dy;
    if (y >= maxY) continue;
    let el: Element | null = document.elementFromPoint(x, y);
    while (el && isB3rysOwned(el)) el = el.parentElement;
    // Media elements (lazy images!) resize after load — their rects are
    // unstable and poisoned every drift measurement on image-heavy pages.
    // Climb to the nearest text-bearing ancestor instead.
    while (el && MEDIA_TAGS.has(el.tagName)) el = el.parentElement;
    if (!el || el === document.body || el === document.documentElement) continue;
    if ((el.textContent ?? '').trim().length < 10) continue;
    // Landed on fixed chrome or an overlay outside the scroller → probe deeper
    if (scroller && !scroller.contains(el)) continue;
    // Fixed/sticky elements (site headers!) never move with content — an
    // anchor there measures drift 0 forever and disables compensation.
    if (isViewportPinned(el, scroller)) continue;
    const r = el.getBoundingClientRect();
    // GIANT containers (article wrappers spanning thousands of px) make drift
    // measurements meaningless — their top is dominated by content far above
    // the viewport. Empirically this produced drift=+6200 on a hide (should be
    // negative) → wrong-direction correction → the toggle jump. Anchor must be
    // a viewport-local block: starts near/inside the viewport, smaller than it.
    if (r.height > window.innerHeight || r.top < -8) continue;
    return { el, top: r.top, scroller };
  }
  return null;
}

/**
 * First candidate that qualifies as a viewport-local anchor: starts inside the
 * viewport and is smaller than it. Giant wrappers (e.g. the whole-article
 * container that parents Substack sibling-injected spans) pass a naive
 * "on screen" test but corrupt drift measurement — exclude them.
 */
function pickVisibleElement(candidates: Iterable<Element>): Element | null {
  const vh = window.innerHeight;
  let bestAbove: Element | null = null;
  let bestAboveTop = -Infinity;
  for (const el of candidates) {
    if (MEDIA_TAGS.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.height >= vh) continue;
    if (r.top >= -8 && r.top < vh * 0.85) return el; // in-view: best
    // Track nearest block ABOVE the viewport — image-only viewports (galleries)
    // have no in-view text; an anchor just above still pins the view correctly.
    if (r.top < -8 && r.top > bestAboveTop) {
      bestAboveTop = r.top;
      bestAbove = el;
    }
  }
  return bestAbove;
}

/** Instant (never smooth/animated) scroll adjustment on the right scroller. */
function scrollInstantBy(scroller: HTMLElement | null, delta: number): void {
  if (scroller) {
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'instant' as ScrollBehavior });
  } else {
    window.scrollTo({
      top: window.scrollY + delta,
      left: window.scrollX,
      behavior: 'instant' as ScrollBehavior,
    });
  }
}

/**
 * Pin the anchor back to its recorded viewport offset — and KEEP it pinned
 * across several ticks (now, next frames, 150ms, 400ms). One-shot correction
 * is structurally insufficient: after a mass hide/reveal, lazy-loaded images
 * above the viewport resize over the following frames and native scroll
 * anchoring nudges the view step-by-step — the layout keeps moving AFTER our
 * single measurement (observed as decelerating jump chains in the field).
 * Aborts the moment the user scrolls (their intent wins) or the anchor dies.
 */
function pinAnchor(anchor: ScrollAnchor): void {
  const startedAt = Date.now();
  const fix = (): void => {
    if (Date.now() - startedAt > 1500) return; // safety cutoff
    if (lastUserScrollTs > startedAt) return; // user took over
    if (!anchor.el.isConnected) return;
    const drift = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) > 2) {
      dbg('pin fix drift=%dpx phase=%s', Math.round(drift), debugPhase);
      scrollInstantBy(anchor.scroller, drift);
    }
  };
  fix();
  requestAnimationFrame(() => {
    fix();
    requestAnimationFrame(fix);
  });
  setTimeout(fix, 150);
  setTimeout(fix, 400);
}

/**
 * Run a DOM mutation while keeping the given scroller's view visually pinned.
 * ALL translation-related mutations (loaders in/out, injections, errors) must
 * go through this — un-compensated mutations above the viewport are exactly
 * what makes the page stutter while the user scrolls.
 */
function withScrollCompensation(
  scroller: HTMLElement | null,
  mutate: () => void,
  fallbackCandidates?: Iterable<Element>,
): void {
  let anchor = findContentAnchor(scroller);
  if (anchor) {
    const ae = anchor.el as HTMLElement;
    dbg(
      'anchor(probe) <%s class="%s"> top=%d h=%d phase=%s',
      ae.tagName,
      (ae.className || '').toString().slice(0, 40),
      Math.round(anchor.top),
      Math.round(ae.getBoundingClientRect().height),
      debugPhase,
    );
  } else {
    dbg('anchor probe MISS phase=%s (fallback=%s)', debugPhase, fallbackCandidates ? 'yes' : 'no');
  }
  if (!anchor && fallbackCandidates) {
    // Probing can miss (empty gutters, comment UIs, overlays). When OUR content
    // is on screen, anchor to it — an un-anchored mass hide/reveal is exactly
    // the "view suddenly jumps to a different part of the page" bug.
    const el = pickVisibleElement(fallbackCandidates);
    if (el) {
      anchor = { el, top: el.getBoundingClientRect().top, scroller };
      dbg(
        'anchor(fallback) <%s class="%s"> top=%d phase=%s',
        el.tagName,
        ((el as HTMLElement).className || '').toString().slice(0, 40),
        Math.round(anchor.top),
        debugPhase,
      );
    }
  }
  mutate();
  if (anchor) pinAnchor(anchor);
}

export function cancelTranslation(): void {
  translateGen++;
  cleanupLoaders(); // immediately remove DOM loading indicators
  releaseUntranslatedClaims();
}

/**
 * Release detection "claims" that never became translations.
 *
 * BLOCK_ID is stamped at DETECTION time — before the API call lands. When a
 * pass is cancelled (SPA content swap → 'replaced' → cancel → restart), blocks
 * that were claimed but not yet injected keep their BLOCK_ID, and re-detection
 * rejects them forever ([R1]) — stranded untranslated on screen with nothing
 * left to ever pick them up (the "some messages translated, some not" bug on
 * virtualized lists). Stripping BLOCK_ID from claim-only elements lets the
 * restart re-detect and translate them; elements with a landed translation
 * keep their ID (duplicate-prevention stays intact).
 */
function releaseUntranslatedClaims(): void {
  document.querySelectorAll(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((el) => {
    const landed =
      el.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) !== null ||
      el.nextElementSibling?.hasAttribute(DATA_ATTRS.TRANSLATED) === true;
    if (!landed) el.removeAttribute(DATA_ATTRS.BLOCK_ID);
  });
}

/**
 * Outcome of a translation pass:
 * - 'done':      completed; at least one block was found/injected
 * - 'cancelled': superseded mid-flight (newer pass or content swap)
 * - 'empty':     detection found no new blocks — a genuine no-op. Callers must
 *                NOT treat this as a "start" for circuit-breaker purposes, or a
 *                busy page (Gmail) trips the breaker with nothing to translate.
 */
export type TranslationResult = 'done' | 'cancelled' | 'empty';

export async function translatePage(
  onProgress?: (completed: number, total: number) => void,
): Promise<TranslationResult> {
  // Purge CSS-hidden translations left over from a previous toggle-off
  // (they're display:none, so removal causes no layout shift). ONLY then —
  // purging unconditionally strips every BLOCK_ID and rips live translations
  // out, turning every incremental pass into a full re-detect + re-inject of
  // the whole page: massive visible churn, and the breaker counts each pass
  // as productive work.
  if (document.body.classList.contains(HIDING_CLASS)) {
    setDebugPhase('purge');
    purgeAllTranslations();
  }

  // Force scroll anchoring during translation — the browser keeps the viewport
  // stable when translations are injected above it (translation elements have
  // overflow-anchor:none, so anchoring sticks to real content).
  // ⚠️ Do NOT touch scrollbar-width here: with "always show scrollbars"
  // (classic, not overlay) toggling it changes the viewport width, rewraps the
  // whole page, and made the view jump up/down on EVERY toggle — the 500ms
  // deferred restore then jumped it a second time, uncompensated.
  const scrollEl = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const prevAnchor = scrollEl.style.overflowAnchor;
  scrollEl.style.overflowAnchor = 'auto';

  const restoreScrollStyles = () => {
    scrollEl.style.overflowAnchor = prevAnchor;
  };

  const gen = ++translateGen;
  // Fight guard: blocks the app keeps re-rendering (wiping our injection) are
  // yielded after a few rounds — retranslating them just fights the app's
  // renderer (visible stutter + breaker pressure). Filtered blocks make the
  // pass 'empty' when nothing else is new, keeping the breaker quiet.
  const allBlocks = detectTextBlocks().filter((b) => !isFighting(b.text));
  if (allBlocks.length === 0) {
    restoreScrollStyles();
    return 'empty'; // nothing new to translate — a no-op pass
  }

  const total = allBlocks.length;
  let completed = 0;

  // Phase 0: cached paragraphs paint instantly — no API call, no rate-limit
  // slot. Only genuine misses continue into the batched API phases below.
  const misses = await injectCachedTranslations(allBlocks, gen);
  if (gen !== translateGen) {
    restoreScrollStyles();
    return 'cancelled';
  }
  completed += total - misses.length;
  if (completed > 0) onProgress?.(completed, total);
  if (misses.length === 0) {
    restoreScrollStyles();
    return 'done';
  }

  const { mainViewport, sideViewport, remaining } = classifyBlocks(misses);

  // One priority-ordered POOL (not a fixed batch array). Initial order:
  // main-viewport → side-viewport → remaining (distance-sorted). The pipeline
  // re-sorts the not-yet-dispatched blocks whenever the user scrolls, so the
  // queue follows the eyes instead of being a fixed snapshot from start.
  const ordered = [...mainViewport, ...sideViewport, ...remaining];

  const result = await runPipeline(ordered, PIPELINE_CONCURRENCY, gen, (n) => {
    completed += n;
    onProgress?.(completed, total);
  });

  restoreScrollStyles();
  if (result === 'done' && getSiteRule()?.repaintAfterInject) {
    forceRepaint(misses[0]?.element);
  }
  return result;
}

/**
 * Nudge the scroll container 1px and back to force a repaint. Some virtualized /
 * content-visibility lists (Substack chat) leave injected translations unpainted
 * until the next real scroll. Site-scoped via `repaintAfterInject` — never runs
 * elsewhere. The +1 happens now (triggers the container's scroll/intersection
 * handling), the restore on the next frame keeps the net position unchanged.
 */
function forceRepaint(sample: Element | undefined): void {
  const target = ((sample && getScrollContainer(sample)) ??
    document.scrollingElement ??
    document.documentElement) as HTMLElement;
  const y = target.scrollTop;
  if (y === 0 && target.scrollHeight <= target.clientHeight) return; // nothing to nudge
  target.scrollTo({ top: y + 1, behavior: 'instant' as ScrollBehavior });
  requestAnimationFrame(() => {
    target.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  });
}

/** Distance of an element from the current viewport (0 = on screen). */
function viewportDistance(el: Element): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return Math.min(Math.abs(rect.top), Math.abs(rect.top - vh));
}

/** Leading+trailing throttle: runs at most once per `ms`, and once more after. */
function throttle(fn: () => void, ms: number): () => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn();
    } else if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn();
      }, wait);
    }
  };
}

/**
 * Drain a priority POOL of blocks with a fixed pool of `concurrency` workers.
 *
 * - No phase barriers: a worker pulls the next-nearest blocks the instant it's
 *   free, so the pool stays saturated (vs. the old Phase 1a→1b→2 idling).
 * - Scroll-following: a throttled scroll handler re-sorts the pending blocks by
 *   *current* viewport distance, so whatever the user scrolls to is translated
 *   next — the queue tracks the eyes rather than a start-time snapshot.
 * - Bounded concurrency avoids the old unbounded viewport burst (rate-limit safe).
 */
async function runPipeline(
  blocks: TextBlock[],
  concurrency: number,
  gen: number,
  onBatchDone: (count: number) => void,
): Promise<'done' | 'cancelled'> {
  let pending = blocks.slice();
  dbg('pipeline start: %d blocks, gen=%d', pending.length, gen);

  // Drop a block whose node left the DOM (virtualized lists remove off-screen
  // nodes; a detached rect is (0,0) and would sort as "nearest", starving the
  // blocks the user actually sees). Strip BLOCK_ID so if the SAME node is
  // re-attached later it re-detects cleanly (otherwise [R1] would reject it
  // forever), and count it toward progress so the gauge still reaches 100%.
  const dropDetached = (b: TextBlock): void => {
    b.element.removeAttribute(DATA_ATTRS.BLOCK_ID);
    onBatchDone(1);
  };

  // Re-order not-yet-dispatched blocks toward the current viewport. Distance is
  // measured ONCE per block (n rect reads, one layout flush) then cached — a
  // naive comparator would call getBoundingClientRect O(n log n) times.
  const resort = throttle(() => {
    if (gen !== translateGen) return;
    const alive: TextBlock[] = [];
    for (const b of pending) {
      if (b.element.isConnected) alive.push(b);
      else dropDetached(b);
    }
    pending = alive;
    const dist = new Map<TextBlock, number>();
    for (const b of pending) dist.set(b, viewportDistance(b.element));
    pending.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
  }, 180);
  window.addEventListener('scroll', resort, { passive: true });

  try {
    const worker = async (): Promise<void> => {
      while (pending.length > 0) {
        if (gen !== translateGen) return;
        // Pull nearest blocks first, skipping any that got detached since sort
        const batch: TextBlock[] = [];
        while (batch.length < BATCH_SIZE && pending.length > 0) {
          const b = pending.shift()!;
          if (b.element.isConnected) batch.push(b);
          else dropDetached(b);
        }
        if (batch.length === 0) continue;
        setDebugPhase('batch-inject');
        await processBatch(batch, gen);
        if (gen !== translateGen) return;
        dbg('batch done (%d blocks), pending=%d', batch.length, pending.length);
        onBatchDone(batch.length);
      }
    };
    const poolSize = Math.max(1, Math.min(concurrency, Math.ceil(pending.length / BATCH_SIZE)));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } finally {
    window.removeEventListener('scroll', resort);
  }

  if (gen !== translateGen) {
    cleanupLoaders();
    dbg('pipeline cancelled (gen changed)');
    return 'cancelled';
  }
  dbg('pipeline done');
  return 'done';
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

/**
 * Phase 0: inject cache hits for the given blocks and return the misses.
 * A pure cache read in the background — repeat visits paint instantly and
 * only new paragraphs consume API calls / rate-limit slots.
 * Lookup failure is non-fatal: everything falls back to the normal batch path.
 */
async function injectCachedTranslations(blocks: TextBlock[], gen: number): Promise<TextBlock[]> {
  try {
    const response: CacheLookupResponse = await chrome.runtime.sendMessage({
      type: 'CACHE_LOOKUP',
      paragraphs: blocks.map((b) => ({ id: b.id, text: b.html })),
    });
    if (gen !== translateGen) return [];

    const hits = new Map((response?.translations ?? []).map((t) => [t.id, t.translatedText]));
    if (hits.size === 0) return blocks;

    // Inject in CHUNKS, yielding to the main thread between them. A fully
    // cached page (toggle off→on) can mean hundreds of injections — doing them
    // in one synchronous loop froze the UI for seconds (spinner stopped,
    // clicks dead) until the loop finished.
    //
    // BULK-REVEAL: when the page has no visible translations yet (toggle-on or
    // fresh revisit), inject everything with HIDING_CLASS on — hidden spans
    // cause ZERO layout shifts, so chunks run without per-chunk reflow or
    // scroll correction (that stepwise correction was the visible stutter).
    // One class removal at the end reveals everything in a single layout pass.
    const hitBlocks = blocks.filter((b) => hits.has(b.id));
    dbg('cache pre-inject: %d hits / %d blocks', hitBlocks.length, blocks.length);

    setDebugPhase('cache-pre-inject');
    const bulkReveal =
      hitBlocks.length > 30 && document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) === null;
    if (bulkReveal) document.body.classList.add(HIDING_CLASS);

    try {
      // TIME-budgeted slices, not count-based: per-block cost varies wildly by
      // page (computed-style reads, style recalc), so a fixed count (40) blew
      // the 16ms frame on heavy pages (claude.com ≈ 500 blocks) → stutter on
      // every chunk. Spend at most FRAME_BUDGET_MS per frame, then yield —
      // heavy pages just take more frames, each one stays smooth.
      // Hidden (bulk-reveal) injection can't jank anything visible — spend a
      // much bigger budget so a fully-cached 500-block page paints in ~1s
      // instead of 3-4s (users read that spinner as "re-translating").
      const FRAME_BUDGET_MS = bulkReveal ? 28 : 8;
      let i = 0;
      while (i < hitBlocks.length) {
        if (gen !== translateGen) return [];
        const sliceEnd = performance.now() + FRAME_BUDGET_MS;
        const injectSlice = () => {
          while (i < hitBlocks.length && performance.now() < sliceEnd) {
            const block = hitBlocks[i++];
            injectTranslation(block.element, hits.get(block.id)!);
            recordInjection(block.text, Date.now(), isScrollDriven());
          }
        };
        if (bulkReveal) {
          injectSlice(); // hidden — no layout impact, no compensation needed
        } else {
          withScrollCompensation(
            getScrollContainer(hitBlocks[i].element),
            injectSlice,
            hitBlocks.map((b) => b.element),
          );
        }
        if (i < hitBlocks.length) {
          // Yield via race(rAF, timer): rAF alone stalls in hidden AND
          // occluded windows (macOS occlusion throttling) — observed as a
          // fully-cached pass crawling at a few blocks/second. The timer
          // guarantees progress; rAF wins when the tab is actually painting.
          await new Promise((r) => {
            const t = setTimeout(r, 40);
            requestAnimationFrame(() => {
              clearTimeout(t);
              r(undefined);
            });
          });
        }
      }
    } finally {
      if (bulkReveal) {
        // Single reveal: one layout pass, one drift correction.
        setDebugPhase('bulk-reveal');
        const first = hitBlocks[0];
        withScrollCompensation(
          first ? getScrollContainer(first.element) : null,
          () => {
            document.body.classList.remove(HIDING_CLASS);
          },
          hitBlocks.map((b) => b.element),
        );
      }
    }
    if (gen !== translateGen) return [];
    return blocks.filter((b) => !hits.has(b.id));
  } catch {
    return blocks; // cache lookup is an optimization, never a blocker
  }
}

export function hasTranslationsOnPage(): boolean {
  // CSS-hidden translations don't count — they're "off" from user perspective
  if (document.body.classList.contains(HIDING_CLASS)) return false;
  return document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length > 0;
}

export function setTranslationMode(mode: TranslationMode): void {
  if (mode === 'replace') {
    wrapLooseTextForReplace(); // lazy — only replace mode re-parents text nodes
    document.body.classList.add(REPLACE_MODE_CLASS);
  } else {
    document.body.classList.remove(REPLACE_MODE_CLASS);
    unwrapLooseTextWrappers();
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
  scrollEl.style.overflowAnchor = 'auto';

  // Pin the scroller that actually holds the translations being hidden.
  // ⚠️ Fallback anchor candidates must SURVIVE the mutation: the translation
  // spans themselves go display:none (rect collapses to 0), which turned the
  // drift measurement into garbage and jumped the view on every toggle-off.
  // Anchor to their PARENT original elements instead — those stay visible.
  const translatedEls = document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`);
  const firstTranslated = translatedEls[0] ?? null;
  const scroller = firstTranslated ? getScrollContainer(firstTranslated) : null;
  const anchorCandidates = Array.from(translatedEls).map((el) => el.parentElement ?? el);
  setDebugPhase('hide(toggle-off)');
  dbg('hide start scrollY=%d translations=%d', Math.round(window.scrollY), translatedEls.length);
  withScrollCompensation(
    scroller,
    () => {
      document.body.classList.remove(REPLACE_MODE_CLASS);
      document.body.classList.add(HIDING_CLASS);
      cleanupLoaders();
    },
    anchorCandidates,
  );
  dbg('hide end scrollY=%d', Math.round(window.scrollY));

  setTimeout(() => {
    scrollEl.style.overflowAnchor = prevAnchor;
  }, 500);
}

/**
 * Actual DOM cleanup — removes translation elements and restores originals.
 * Called before starting a new translation.
 * IMPORTANT: Remove DOM elements FIRST (while still display:none),
 * THEN remove the hiding class. This prevents a flash of visible translations.
 */
export function purgeAllTranslations(): void {
  // User-initiated removal: re-injecting these texts later is legitimate, not a
  // re-render fight. Without this reset, toggling the FAB on/off a few times
  // marked every block as "fighting" and the FAB went dead (empty passes).
  resetFightGuard();

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

  // Every DOM mutation below is compensated against the batch's own scroller —
  // un-compensated loader/error/injection churn above the viewport is what
  // made pages stutter while the user scrolled (esp. inner-scroller apps).
  const scroller = getScrollContainer(batch[0].element);

  const batchEls = batch.map((b) => b.element);
  let loaders: HTMLElement[] = [];
  withScrollCompensation(
    scroller,
    () => {
      loaders = batch.map((block) => showLoading(block.element));
    },
    batchEls,
  );

  try {
    const response: TranslateBatchResponse = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      paragraphs: batch.map((b) => ({ id: b.id, text: b.html })),
    });

    if (gen !== translateGen) {
      withScrollCompensation(
        scroller,
        () => loaders.forEach((loader) => loader.remove()),
        batchEls,
      );
      return;
    }

    if (response.error) {
      if (response.apiKeyError || response.costLimitExceeded) {
        withScrollCompensation(
          scroller,
          () => loaders.forEach((loader) => loader.remove()),
          batchEls,
        );
        translateGen++; // Cancel all in-flight batches
        await chrome.storage.local.set({ apiKeyErrorMessage: response.error });
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
        return;
      }
      withScrollCompensation(
        scroller,
        () => {
          loaders.forEach((loader) => loader.remove());
          batch.forEach((block) => showError(block.element, response.error!));
        },
        batchEls,
      );
      return;
    }

    const blockMap = new Map(batch.map((b) => [b.id, b]));
    withScrollCompensation(
      scroller,
      () => {
        loaders.forEach((loader) => loader.remove());
        for (const result of response.translations) {
          const block = blockMap.get(result.id);
          if (block) {
            injectTranslation(block.element, result.translatedText);
            recordInjection(block.text, Date.now(), isScrollDriven());
          }
        }
      },
      batchEls,
    );
  } catch (err) {
    if (isContextInvalidated(err)) {
      loaders.forEach((loader) => loader.remove());
      translateGen++;
      markContextInvalidated();
      return;
    }
    if (gen !== translateGen) {
      withScrollCompensation(
        scroller,
        () => loaders.forEach((loader) => loader.remove()),
        batchEls,
      );
      return;
    }
    const msg = err instanceof Error ? err.message : 'Translation failed';
    withScrollCompensation(
      scroller,
      () => {
        loaders.forEach((loader) => loader.remove());
        batch.forEach((block) => showError(block.element, msg));
      },
      batchEls,
    );
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
  const dest = (labelEl ?? target) as HTMLElement;
  markOriginalContent(element, dest);
  dest.appendChild(span);
}

/** Non-standard inline elements (span, etc.): inject as sibling or inline child */
function injectAsSibling(element: HTMLElement, sanitized: string, truncated: boolean): void {
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
    const dest = textChild ?? element;
    markOriginalContent(element, dest);
    dest.appendChild(span);
  } else if (isFlexChild) {
    // Parent is flex — inject inside element as inline
    span.className = 'b3rys-translation-inline';
    markOriginalContent(element);
    element.appendChild(span);
  } else {
    // Translation is a real sibling *outside* element — hide the whole element.
    span.className = 'b3rys-translation';
    if (truncated) applyTruncationStyles(span);
    element.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
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
      markOriginalContent(element, flexTarget);
      flexTarget.appendChild(span);
      return;
    }
  }

  // Single-link container (e.g. <div><a class="btn">...</a></div> or a
  // TOC/card row <li><a class="grid-card">…</a></li>).
  //
  // Card-style links are flex/grid containers (icon column + text column):
  // appending the span directly to the <a> makes it a NEW grid item in the
  // narrow icon track → one-character-per-line vertical text. And appending to
  // the semantic wrapper (LI) leaves the translation outside the card's text
  // column. So: whenever the sole child is a flex/grid <a> — regardless of
  // wrapper tag — inject inside the link's text-bearing child. Non-card sole
  // links keep the old rule (non-semantic wrappers only).
  const soleLink = getSoleLink(element);
  const soleLinkIsCard =
    soleLink !== null &&
    /^(flex|inline-flex|grid|inline-grid)$/.test(getComputedStyle(soleLink).display);
  if (soleLink && (soleLinkIsCard || !TRANSLATABLE_TAGS.has(element.tagName))) {
    span.className = 'b3rys-translation';
    const linkDest = (findTextLabel(soleLink, text) ??
      findLargestTextChild(soleLink)) as HTMLElement | null;
    // Fallback to the wrapper (full-width block), NEVER the grid <a> itself —
    // that's the vertical-text path.
    const dest = linkDest ?? element;
    markOriginalContent(element, dest);
    dest.appendChild(span);
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

  markOriginalContent(element);
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
 * Mark original content so it can be hidden in replace mode, while keeping the
 * branch that will hold the translation visible.
 *
 * The translation span may be injected into a *descendant* of `element` (e.g. a
 * flex/grid text child, or a sole <a>). If we blindly marked `element`'s direct
 * children, that descendant's marked ancestor would be `display:none` in replace
 * mode and take the translation down with it. So when a `target` is given, we
 * walk element → target and mark only the *siblings* along that path, leaving the
 * ancestor chain to the translation visible.
 *
 * - Element children: add data-b3rys-original attribute directly (preserves flex layout)
 * - Text nodes: wrap in <span data-b3rys-original> (text nodes can't have attributes)
 *
 * parallel (A+가) mode is unaffected — the hide rule is scoped to
 * `body.b3rys-replace-mode`, so these attributes are inert there.
 */
function markOriginalContent(element: HTMLElement, target?: HTMLElement): void {
  const dest = target && element.contains(target) ? target : element;

  // Invariant: the branch from `element` down to `dest` stays visible in replace
  // mode; every *other* original node is marked and hidden. Clearing ORIGINAL on
  // the path makes this self-correcting if a prior run marked an ancestor.
  let node: HTMLElement = element;
  while (node !== dest) {
    const next = Array.from(node.children).find((c) => c === dest || c.contains(dest)) as
      | HTMLElement
      | undefined;
    markSiblingOriginals(node, next);
    if (!next) return; // path broke unexpectedly — stop rather than mis-mark
    next.removeAttribute(DATA_ATTRS.ORIGINAL);
    node = next;
  }
  dest.removeAttribute(DATA_ATTRS.ORIGINAL);
  markSiblingOriginals(dest, undefined);
}

/**
 * Mark a parent's original ELEMENT children, skipping the on-path child.
 *
 * ⚠️ Text nodes are deliberately NOT wrapped here. Wrapping a framework-owned
 * text node (moving it into our span) breaks React's child references — its
 * next reconciliation throws `insertBefore … is not a child of this node` and
 * the whole site crashes to its error boundary (Substack apps). Attributes on
 * elements are tolerated by frameworks; node re-parenting is not. Loose text
 * is wrapped lazily ONLY when the user enters replace(가) mode — the default
 * parallel mode never touches site text nodes at all.
 */
function markSiblingOriginals(parent: HTMLElement, exclude?: HTMLElement): void {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (el === exclude) continue;
    if (
      el.hasAttribute(DATA_ATTRS.TRANSLATED) ||
      el.hasAttribute(DATA_ATTRS.LOADER) ||
      el.hasAttribute(DATA_ATTRS.ORIGINAL)
    )
      continue;
    el.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
  }
}

/**
 * Replace(가) mode needs loose text nodes hidden too (CSS can't target text
 * nodes). Wrap them ONLY while replace mode is active, and unwrap on the way
 * out — minimizing the window where framework-owned text nodes are re-parented.
 * Wrapping walks up from each translation span to its BLOCK_ID host, wrapping
 * loose text at every level (mirrors the old injection-time marking).
 */
function wrapLooseTextForReplace(): void {
  document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).forEach((span) => {
    let node: HTMLElement | null = span.parentElement;
    while (node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          const wrapper = document.createElement('span');
          wrapper.setAttribute(DATA_ATTRS.ORIGINAL, 'true');
          node.insertBefore(wrapper, child);
          wrapper.appendChild(child);
        }
      }
      if (node.hasAttribute(DATA_ATTRS.BLOCK_ID)) break;
      node = node.parentElement;
    }
  });
}

/** Undo wrapLooseTextForReplace (bare single-attribute wrappers only). */
function unwrapLooseTextWrappers(): void {
  document.querySelectorAll(`span[${DATA_ATTRS.ORIGINAL}]`).forEach((el) => {
    if (el.attributes.length === 1 && !(el as HTMLElement).className) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
  });
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
