import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  injectTranslation,
  removeAllTranslations,
  purgeAllTranslations,
} from '@/entrypoints/content/translator';
import { DATA_ATTRS } from '@/utils/constants';

/**
 * Tests for scroll-safe translation toggle.
 *
 * removeAllTranslations() = CSS-only hide (no DOM removal, no scroll jump)
 * purgeAllTranslations() = actual DOM cleanup (called before next translate)
 */

function injectTestParagraph(text: string, translation: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.appendChild(p);
  injectTranslation(p, translation);
  return p;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  vi.restoreAllMocks();
});

describe('removeAllTranslations (CSS-only hide)', () => {
  it('hides translations via CSS class, does NOT remove from DOM', () => {
    injectTestParagraph(
      'This is a test paragraph long enough for block mode.',
      '이것은 블록 모드에 충분히 긴 테스트 문단입니다.',
    );

    const translatedEl = document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translatedEl).not.toBeNull();

    removeAllTranslations();

    // Element is still in DOM (just CSS-hidden)
    expect(document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).not.toBeNull();
    // Body has hiding class
    expect(document.body.classList.contains('b3rys-hiding-translations')).toBe(true);
  });

  it('does not call scrollBy — zero DOM changes means zero scroll issues', () => {
    injectTestParagraph(
      'Another test paragraph that is long enough for block mode injection.',
      '블록 모드 주입에 충분히 긴 또 다른 테스트 문단입니다.',
    );

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    removeAllTranslations();
    expect(scrollBySpy).not.toHaveBeenCalled();
  });
});

describe('purgeAllTranslations (actual DOM cleanup)', () => {
  it('removes translated elements from DOM', () => {
    injectTestParagraph(
      'A paragraph for testing purge functionality.',
      '퍼지 기능을 테스트하기 위한 문단입니다.',
    );

    expect(document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).not.toBeNull();

    purgeAllTranslations();

    expect(document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
    expect(document.querySelector(`[${DATA_ATTRS.ORIGINAL}]`)).toBeNull();
  });

  it('removes hiding class if present', () => {
    injectTestParagraph(
      'Paragraph for testing class cleanup after purge.',
      '퍼지 후 클래스 정리 테스트용 문단입니다.',
    );

    removeAllTranslations(); // CSS hide
    expect(document.body.classList.contains('b3rys-hiding-translations')).toBe(true);

    purgeAllTranslations(); // DOM cleanup
    expect(document.body.classList.contains('b3rys-hiding-translations')).toBe(false);
    expect(document.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
  });
});
