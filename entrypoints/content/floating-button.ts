import type { FloatingButtonState, TranslationMode } from '@/types';
import css from './floating-button.css?raw';

const ICONS = {
  translate: `<svg viewBox="0 0 20 20" fill="none" class="icon icon-translate">
    <text x="10" y="11" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="14" font-weight="800" fill="currentColor">A</text>
    <line x1="2" y1="13" x2="16" y2="13" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2" stroke-linecap="round"/>
    <polygon points="14,11 17,13 14,15" fill="currentColor" fill-opacity="0.45"/>
    <text x="10" y="20" text-anchor="middle" font-family="-apple-system,'Apple SD Gothic Neo',sans-serif" font-size="11" font-weight="800" fill="currentColor" opacity="0.85">가</text>
  </svg>`,
  loading: `<svg viewBox="0 0 20 20" fill="none" class="icon icon-loading">
    <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  done: `<svg viewBox="0 0 20 20" fill="none" class="icon icon-done">
    <path d="M5 10.5l3.5 3.5L15 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  error: `<svg viewBox="0 0 20 20" fill="none" class="icon icon-error">
    <circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.5"/>
    <path d="M10 7v4M10 13h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
};

export interface FloatingButton {
  setState: (state: FloatingButtonState) => void;
  setProgress: (ratio: number) => void;
  setUsageGauge: (ratio: number) => void;
  setMode: (mode: TranslationMode) => void;
  onModeToggle: (callback: (mode: TranslationMode) => void) => void;
  showToast: (text: string) => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
}

export function createFloatingButton(onClick: () => void): FloatingButton {
  const host = document.createElement('div');
  host.id = 'b3rys-translate-root';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  // Wrapper (close + fab)
  const wrap = document.createElement('div');
  wrap.className = 'b3rys-wrap';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'b3rys-close';
  closeBtn.innerHTML = `<svg viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    host.style.display = 'none';
    chrome.storage.sync.set({ floatingButtonVisible: false }).catch(() => {});
  });

  // FAB
  const fab = document.createElement('div');
  fab.className = 'b3rys-fab';
  fab.setAttribute('data-state', 'idle');
  fab.innerHTML = `
    ${ICONS.translate}
    ${ICONS.loading}
    ${ICONS.done}
    ${ICONS.error}
    <svg class="b3rys-progress" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="19"/>
    </svg>
    <div class="b3rys-usage-gauge"></div>
  `;

  // Mode toggle button
  const modeBtn = document.createElement('button');
  modeBtn.className = 'b3rys-mode-toggle';
  modeBtn.textContent = 'A+가';
  let currentMode: TranslationMode = 'parallel';
  let modeToggleCallback: ((mode: TranslationMode) => void) | null = null;
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const newMode: TranslationMode = currentMode === 'parallel' ? 'replace' : 'parallel';
    currentMode = newMode;
    modeBtn.textContent = newMode === 'parallel' ? 'A+가' : '가';
    modeToggleCallback?.(newMode);
  });

  wrap.appendChild(closeBtn);
  wrap.appendChild(fab);
  wrap.appendChild(modeBtn);
  shadow.appendChild(wrap);
  document.body.appendChild(host);

  // Draggable vertically
  let isDragging = false;
  let startY = 0;
  let startTop = 0;

  fab.addEventListener('mousedown', (e) => {
    isDragging = false;
    startY = e.clientY;
    const rect = wrap.getBoundingClientRect();
    startTop = rect.top + rect.height / 2;

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientY - startY) > 4) {
        isDragging = true;
        const newTop = startTop + (ev.clientY - startY);
        const clampedTop = Math.max(40, Math.min(window.innerHeight - 40, newTop));
        wrap.style.top = `${clampedTop}px`;
        wrap.style.transform = 'translateY(-50%)';
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (isDragging) {
        setTimeout(() => {
          isDragging = false;
        }, 0);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isDragging) onClick();
  });

  const progressCircle = shadow.querySelector('.b3rys-progress circle') as SVGCircleElement | null;
  const usageGauge = shadow.querySelector('.b3rys-usage-gauge') as HTMLElement;

  return {
    setState(state: FloatingButtonState) {
      fab.setAttribute('data-state', state);
    },

    setProgress(ratio: number) {
      if (!progressCircle) return;
      const circumference = 2 * Math.PI * 19; // r=19
      const offset = circumference * (1 - ratio);
      progressCircle.style.strokeDasharray = `${circumference}`;
      progressCircle.style.strokeDashoffset = `${offset}`;
    },

    setUsageGauge(ratio: number) {
      if (!usageGauge) return;
      // ratio < 0 means no limit set — hide gauge
      if (ratio < 0) {
        usageGauge.style.display = 'none';
        return;
      }
      usageGauge.style.display = '';
      const clamped = Math.max(0, Math.min(1, ratio));
      usageGauge.style.height = `${clamped * 100}%`;
      // Color: green (0-50%) → yellow (50-80%) → red (80-100%)
      let color: string;
      if (clamped <= 0.5) color = '#7ee787';
      else if (clamped <= 0.8) color = '#d29922';
      else color = '#f85149';
      usageGauge.style.backgroundColor = color;
    },

    setMode(mode: TranslationMode) {
      currentMode = mode;
      modeBtn.textContent = mode === 'parallel' ? 'A+가' : '가';
    },

    onModeToggle(callback: (mode: TranslationMode) => void) {
      modeToggleCallback = callback;
    },

    showToast(text: string) {
      const existing = shadow.querySelector('.b3rys-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'b3rys-toast';
      toast.textContent = text;
      fab.appendChild(toast);

      const removeToast = () => toast.remove();
      setTimeout(removeToast, 3000);
      wrap.addEventListener('mouseleave', removeToast, { once: true });
    },

    show() {
      host.style.display = '';
    },

    hide() {
      host.style.display = 'none';
    },

    destroy() {
      host.remove();
    },
  };
}
