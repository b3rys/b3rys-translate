import type { TranslateBatchResponse } from '@/utils/messaging';
import {
  LANGUAGES,
  LANG_STORAGE_KEY,
  DEFAULT_SOURCE_LANG,
  type LanguageCode,
} from '@/utils/constants';
import css from './selection-popup.css?raw';
import { isContextInvalidated, markContextInvalidated } from './context-invalidated';

const TRIGGER_ICON = `<svg viewBox="0 0 20 20" fill="none">
  <text x="10" y="11" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="14" font-weight="800" fill="currentColor">A</text>
  <line x1="2" y1="13" x2="16" y2="13" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2" stroke-linecap="round"/>
  <polygon points="14,11 17,13 14,15" fill="currentColor" fill-opacity="0.45"/>
  <text x="10" y="20" text-anchor="middle" font-family="-apple-system,'Apple SD Gothic Neo',sans-serif" font-size="11" font-weight="800" fill="currentColor" opacity="0.85">가</text>
</svg>`;

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2"/>
  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
</svg>`;

const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 12l5 5L20 7"/>
</svg>`;

const SPINNER_SVG = `<svg class="b3rys-sel-spinner" viewBox="0 0 20 20" fill="none">
  <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const SPEAK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
</svg>`;

let host: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let triggerEl: HTMLButtonElement | null = null;
let popupEl: HTMLDivElement | null = null;

let selectionSourceScript: 'latin' | 'cjk' | 'cyrillic' = 'latin';

export async function loadSelectionSourceLanguage(): Promise<void> {
  try {
    const data = await chrome.storage.local.get(LANG_STORAGE_KEY);
    const stored = data[LANG_STORAGE_KEY] as { source?: string } | undefined;
    const code = (stored?.source || DEFAULT_SOURCE_LANG) as LanguageCode;
    selectionSourceScript = LANGUAGES[code]?.script ?? 'latin';
  } catch {
    selectionSourceScript = 'latin';
  }
}

export function isLikelyEnglish(text: string): boolean {
  const totalLetters = text.replace(/[\s\d\p{P}]/gu, '').length;
  if (totalLetters === 0) return false;

  if (selectionSourceScript === 'cjk') {
    const cjkChars = text.replace(/[^\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/g, '').length;
    return cjkChars / totalLetters > 0.4;
  }

  if (selectionSourceScript === 'cyrillic') {
    const cyrillicChars = text.replace(/[^\u0400-\u04ff]/g, '').length;
    return cyrillicChars / totalLetters > 0.4;
  }

  const asciiLetters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '').length;
  return asciiLetters / totalLetters > 0.6;
}

export function hasMinLength(text: string): boolean {
  return text.trim().length >= 2;
}

export function isSingleWord(text: string): boolean {
  return !/\s/.test(text.trim());
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureShadowRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  host = document.createElement('div');
  host.id = 'b3rys-selection-popup-root';
  shadowRoot = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.appendChild(style);

  document.body.appendChild(host);
  return shadowRoot;
}

function removeTrigger(): void {
  triggerEl?.remove();
  triggerEl = null;
}

function removePopup(): void {
  popupEl?.remove();
  popupEl = null;
}

function closeAll(): void {
  removeTrigger();
  removePopup();
}

function showTrigger(clientX: number, clientY: number, clientY2?: number): void {
  clientY2 = clientY2 ?? clientY;
  removeTrigger();
  removePopup();

  const root = ensureShadowRoot();

  triggerEl = document.createElement('button');
  triggerEl.className = 'b3rys-sel-trigger';
  triggerEl.innerHTML = TRIGGER_ICON;

  // Position: right end of selection's last line
  const x = clamp(clientX + 4, 4, window.innerWidth - 28);
  const y = clamp(clientY + (clientY2 - clientY) / 2 - 12, 4, window.innerHeight - 28);
  triggerEl.style.left = `${x}px`;
  triggerEl.style.top = `${y}px`;

  root.appendChild(triggerEl);
}

function showPopup(anchorX: number, anchorY: number, compact = false): void {
  removePopup();

  const root = ensureShadowRoot();

  popupEl = document.createElement('div');
  popupEl.className = compact ? 'b3rys-sel-popup compact' : 'b3rys-sel-popup';

  const inner = document.createElement('div');
  inner.className = 'b3rys-sel-popup-inner';
  popupEl.appendChild(inner);

  const popupWidth = compact ? 320 : 440;

  // Measure containing-block origin so position works on any site
  popupEl.style.left = '0px';
  popupEl.style.top = '0px';
  popupEl.style.visibility = 'hidden';
  root.appendChild(popupEl);

  const origin = popupEl.getBoundingClientRect();

  // Target viewport position → adjust by containing-block offset
  const targetVX = clamp(anchorX - popupWidth / 2, 8, window.innerWidth - popupWidth - 8);
  const targetVY = anchorY + 8;

  popupEl.style.left = `${targetVX - origin.left}px`;
  popupEl.style.top = `${targetVY - origin.top}px`;
  popupEl.style.visibility = '';
}

function setPopupLoading(): void {
  const inner = popupEl?.querySelector('.b3rys-sel-popup-inner');
  if (!inner) return;
  inner.innerHTML = `<div class="b3rys-sel-loading">${SPINNER_SVG}<span>번역 중...</span></div>`;
}

/**
 * Split Korean translated text into sentences for readability.
 * Splits on sentence-ending punctuation (. ! ? 다. 요. 음. 임.) followed by a space.
 */
export function splitSentences(text: string): string[] {
  // Split on sentence boundaries: period/exclamation/question + space, or Korean endings
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter((s) => s.trim().length > 0);
}

function setPopupResult(text: string): void {
  const inner = popupEl?.querySelector('.b3rys-sel-popup-inner');
  if (!inner) return;

  const result = document.createElement('div');
  result.className = 'b3rys-sel-result';

  const textEl = document.createElement('div');
  textEl.className = 'b3rys-sel-text';

  // Break long translations into separate lines per sentence
  const sentences = splitSentences(text);
  if (sentences.length > 1) {
    textEl.innerHTML = sentences
      .map((s) => `<span class="b3rys-sel-sentence">${s}</span>`)
      .join('');
  } else {
    textEl.textContent = text;
  }

  const actions = document.createElement('div');
  actions.className = 'b3rys-sel-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'b3rys-sel-copy';
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard
      .writeText(text)
      .then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
        }, 1000);
      })
      .catch(() => {});
  });

  actions.appendChild(copyBtn);
  result.appendChild(textEl);
  result.appendChild(actions);

  inner.innerHTML = '';
  inner.appendChild(result);
}

interface WordExample {
  en: string;
  ko: string;
}

export function parseWordResponse(raw: string): {
  translation: string;
  definition: string;
  similarWords: string;
  examples: WordExample[];
} {
  const lines = raw.split('\n').map((l) => l.trim());
  const translation = lines[0] || raw.trim();
  let definition = '';
  let similarWords = '';
  const examples: WordExample[] = [];

  let currentEn = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('=')) {
      definition = line.slice(1).trim();
    } else if (line.startsWith('~')) {
      similarWords = line.slice(1).trim();
    } else if (line.startsWith('•')) {
      currentEn = line.slice(1).trim();
    } else if (line.startsWith('→') && currentEn) {
      examples.push({ en: currentEn, ko: line.slice(1).trim() });
      currentEn = '';
    }
  }

  return { translation, definition, similarWords, examples };
}

export function highlightWord(sentence: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return sentence.replace(re, '<span class="b3rys-sel-highlight">$1</span>');
}

function setPopupWordResult(raw: string, originalWord: string): void {
  const inner = popupEl?.querySelector('.b3rys-sel-popup-inner');
  if (!inner) return;

  const { translation, definition, similarWords, examples } = parseWordResponse(raw);

  const result = document.createElement('div');
  result.className = 'b3rys-sel-result';

  // Header row: "word — translation" + speak button
  const header = document.createElement('div');
  header.className = 'b3rys-sel-word-header';

  const headerText = document.createElement('span');
  headerText.innerHTML = `<span class="b3rys-sel-word-original">${originalWord}</span> <span class="b3rys-sel-word-dash">—</span> <span class="b3rys-sel-word-translation">${translation}</span>`;

  const speakBtn = document.createElement('button');
  speakBtn.className = 'b3rys-sel-speak';
  speakBtn.innerHTML = SPEAK_ICON;
  speakBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const utterance = new SpeechSynthesisUtterance(originalWord);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    // Prefer high-quality Google voice over default
    const voices = speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Google')) ??
      voices.find((v) => v.lang.startsWith('en-US') && !v.localService);
    if (preferred) utterance.voice = preferred;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });

  header.appendChild(headerText);
  header.appendChild(speakBtn);
  result.appendChild(header);

  // English definition (small, grey)
  if (definition) {
    const defEl = document.createElement('div');
    defEl.className = 'b3rys-sel-word-definition';
    defEl.textContent = definition;
    result.appendChild(defEl);
  }

  // Similar words
  if (similarWords) {
    const simEl = document.createElement('div');
    simEl.className = 'b3rys-sel-word-similar';
    const words = similarWords
      .split(',')
      .map((w) => `<span class="b3rys-sel-word-similar-word">${w.trim()}</span>`);
    simEl.innerHTML = `<span class="b3rys-sel-word-similar-label">≈</span> ${words.join(', ')}`;
    result.appendChild(simEl);
  }

  // Examples
  if (examples.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'b3rys-sel-separator';
    result.appendChild(sep);

    for (const ex of examples) {
      const enEl = document.createElement('div');
      enEl.className = 'b3rys-sel-example-en';
      enEl.innerHTML = `• ${highlightWord(ex.en, originalWord)}`;
      result.appendChild(enEl);

      const koEl = document.createElement('div');
      koEl.className = 'b3rys-sel-example-ko';
      koEl.textContent = `→ ${ex.ko}`;
      result.appendChild(koEl);
    }
  }

  inner.innerHTML = '';
  inner.appendChild(result);
}

function setPopupError(message: string): void {
  const inner = popupEl?.querySelector('.b3rys-sel-popup-inner');
  if (!inner) return;
  inner.innerHTML = `<div class="b3rys-sel-error">${message}</div>`;
}

async function translateSelection(text: string, wordMode: boolean): Promise<void> {
  setPopupLoading();

  try {
    const response: TranslateBatchResponse = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      paragraphs: [{ id: 'selection-0', text }],
      mode: wordMode ? 'word' : 'page',
    });

    // Popup may have been closed while waiting
    if (!popupEl) return;

    if (response.apiKeyError) {
      setPopupError('API 키가 설정되지 않았습니다. 팝업에서 설정해주세요.');
      return;
    }
    if (response.costLimitExceeded) {
      setPopupError('사용량 한도에 도달했습니다.');
      return;
    }
    if (response.error) {
      setPopupError(`번역 실패: ${response.error}`);
      return;
    }

    const translated = response.translations?.[0]?.translatedText;
    if (translated) {
      if (wordMode) {
        setPopupWordResult(translated, text);
      } else {
        setPopupResult(translated);
      }
    } else {
      setPopupError('번역 결과가 없습니다.');
    }
  } catch (err) {
    if (!popupEl) return;
    if (isContextInvalidated(err)) {
      markContextInvalidated();
      return;
    }
    setPopupError('번역 요청 중 오류가 발생했습니다.');
  }
}

function onMouseUp(e: MouseEvent): void {
  // Ignore clicks inside our shadow host
  if (host && host.contains(e.target as Node)) return;

  // Small delay to let the selection finalize
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (!text) return;
    if (!hasMinLength(text)) return;
    if (!isLikelyEnglish(text)) return;

    // Position at the right end of the last line of the selection
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const lastRect = rects[rects.length - 1];
    if (!lastRect) return;

    showTrigger(lastRect.right, lastRect.top, lastRect.bottom);

    // Store text and position for trigger click
    const wordMode = isSingleWord(text);
    if (triggerEl) {
      triggerEl.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          ev.preventDefault();

          const triggerRect = triggerEl!.getBoundingClientRect();
          const anchorX = triggerRect.left + triggerRect.width / 2;
          const anchorY = triggerRect.bottom;

          removeTrigger();
          showPopup(anchorX, anchorY, wordMode);
          translateSelection(text, wordMode);
        },
        { once: true },
      );
    }
  }, 10);
}

function onMouseDown(e: MouseEvent): void {
  // If clicking inside our shadow host elements, don't close
  if (host && e.composedPath().includes(host)) return;

  closeAll();
}

function onScroll(): void {
  // Page scrolled — dismiss trigger (selection moved), but keep popup open
  removeTrigger();
}

function onResize(): void {
  closeAll();
}

let listening = false;

export function initSelectionPopup(): void {
  if (listening) return;
  listening = true;

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('scroll', onScroll);
  window.addEventListener('resize', onResize);
}

export function destroySelectionPopup(): void {
  if (!listening) return;
  listening = false;

  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);

  closeAll();
  host?.remove();
  host = null;
  shadowRoot = null;
}
