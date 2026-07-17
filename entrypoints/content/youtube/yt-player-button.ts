import type { SubtitleDisplayMode } from './subtitle-overlay';

export type YtButtonState = 'idle' | 'loading' | 'active' | 'error' | 'info';

export interface YtPlayerButton {
  setState(state: YtButtonState, title?: string): void;
  setMode(mode: SubtitleDisplayMode): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

const LABEL_IDLE = 'A가';
const LABEL_LOADING = '···';

const MODE_LABELS: Record<SubtitleDisplayMode, string> = {
  both: 'A가',
  en: 'A',
  ko: '가',
};

const MODE_TITLES: Record<SubtitleDisplayMode, string> = {
  both: '원문+번역 (클릭: 원문만)',
  en: '원문만 (클릭: 번역만)',
  ko: '번역만 (클릭: 끄기)',
};

const TITLES: Record<YtButtonState, string> = {
  idle: 'b3rys 번역 자막',
  loading: '번역 중...',
  active: '원문+번역 (클릭: 원문만)',
  error: '번역 실패 (클릭: 재시도)',
  info: '자막 번역 불가',
};

/**
 * Inject a translate button into YouTube's player controls bar (.ytp-right-controls).
 * Waits for the controls to appear via MutationObserver if not yet in DOM.
 */
export function injectYtPlayerButton(onClick: () => void): Promise<YtPlayerButton> {
  return new Promise((resolve) => {
    let resolved = false;

    const tryInject = (): boolean => {
      const controls = document.querySelector('.ytp-right-controls');
      if (!controls) return false;

      // Remove stale button from previous injection
      controls.querySelector('.b3rys-yt-btn')?.remove();

      const btn = document.createElement('button');
      btn.className = 'b3rys-yt-btn';
      btn.setAttribute('data-b3rys-state', 'idle');
      btn.title = TITLES.idle;
      btn.textContent = LABEL_IDLE;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      });

      // Insert at the start of right controls (safe — no insertBefore pitfalls)
      controls.prepend(btn);
      console.log('[b3rys] Player translate button injected');

      if (!resolved) {
        resolved = true;
        resolve({
          setState(state: YtButtonState, title?: string) {
            btn.setAttribute('data-b3rys-state', state);
            btn.title = title ?? TITLES[state];
            btn.textContent = state === 'loading' ? LABEL_LOADING : LABEL_IDLE;
          },
          setMode(mode: SubtitleDisplayMode) {
            btn.textContent = MODE_LABELS[mode];
            btn.title = MODE_TITLES[mode];
          },
          show() {
            btn.style.removeProperty('display');
          },
          hide() {
            btn.style.setProperty('display', 'none', 'important');
          },
          destroy() {
            btn.remove();
          },
        });
      }
      return true;
    };

    if (tryInject()) return;

    // Wait for controls to appear
    const obs = new MutationObserver(() => {
      if (tryInject()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      obs.disconnect();
      if (!resolved) {
        resolved = true;
        console.warn('[b3rys] Failed to inject player button (timeout)');
        resolve({ setState() {}, setMode() {}, show() {}, hide() {}, destroy() {} });
      }
    }, 15000);
  });
}
