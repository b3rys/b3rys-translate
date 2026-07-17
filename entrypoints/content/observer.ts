import { DEBOUNCE_DELAY, DATA_ATTRS } from '@/utils/constants';
import type { ContentChangeKind } from '@/utils/translation-state';

// 'added':    new content appeared; previously detected blocks are intact.
//             Safe to handle incrementally — cancelling in-flight work would
//             only waste already-paid API calls (e.g. Gmail's app chrome
//             churns constantly while a long mail is still translating).
// 'replaced': elements we already detected (BLOCK_ID) were removed — a real
//             content swap / SPA navigation. In-flight results are stale.

/** Check if an element was created by b3rys (any data-b3rys-* attr or b3rys-* class) */
function isB3rysElement(el: HTMLElement): boolean {
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-b3rys')) return true;
  }
  const cn = el.className;
  return typeof cn === 'string' && cn.includes('b3rys-');
}

/**
 * Did the site remove a subtree containing blocks we had detected?
 * Our own cleanup only ever removes nodes WE created (translation spans,
 * loaders) — BLOCK_ID lives on the site's original elements, so a removed
 * node carrying one means the site swapped its content out.
 */
function removedDetectedBlock(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.hasAttribute(DATA_ATTRS.TRANSLATED) || node.hasAttribute(DATA_ATTRS.LOADER)) {
    return false; // our own cleanup, not a site swap
  }
  return (
    node.hasAttribute(DATA_ATTRS.BLOCK_ID) ||
    node.querySelector(`[${DATA_ATTRS.BLOCK_ID}]`) !== null
  );
}

export function observeDynamicContent(onNewContent: (kind: ContentChangeKind) => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 'replaced' outranks 'added' within one debounce window
  let pendingKind: ContentChangeKind | null = null;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.removedNodes) {
        if (removedDetectedBlock(node)) {
          pendingKind = 'replaced';
          break;
        }
      }
      if (pendingKind === 'replaced') break;
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && !isB3rysElement(node)) {
          pendingKind = pendingKind ?? 'added';
          break;
        }
      }
    }

    if (pendingKind === null) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const kind = pendingKind ?? 'added';
      pendingKind = null;
      onNewContent(kind);
    }, DEBOUNCE_DELAY);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
