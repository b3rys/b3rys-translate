import { DEBOUNCE_DELAY } from '@/utils/constants';

/** Check if an element was created by b3rys (any data-b3rys-* attr or b3rys-* class) */
function isB3rysElement(el: HTMLElement): boolean {
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-b3rys')) return true;
  }
  const cn = el.className;
  return typeof cn === 'string' && cn.includes('b3rys-');
}

export function observeDynamicContent(onNewContent: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && !isB3rysElement(node)) {
          hasNewContent = true;
          break;
        }
      }
      if (hasNewContent) break;
    }

    if (!hasNewContent) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onNewContent();
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
