/**
 * Diagnostic test: Substack Notes single-note page detection
 * https://substack.com/@rasbt/note/c-207892753
 *
 * Bugs found via screenshot analysis:
 *   1. Translations truncated to single line — isContentTruncated false positive
 *   2. "I" detected as separate block — single-char paragraph from editor line break
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture, setupDOM } from './helpers/test-utils';
import { detectTextBlocks } from '@/entrypoints/content/text-detector';
import { injectTranslation, purgeAllTranslations } from '@/entrypoints/content/translator';
import { DATA_ATTRS } from '@/utils/constants';

beforeEach(() => {
  document.body.innerHTML = '';
});

function stubLayout(
  element: HTMLElement,
  {
    scrollWidth,
    clientWidth,
    scrollHeight,
    clientHeight,
  }: Record<'scrollWidth' | 'clientWidth' | 'scrollHeight' | 'clientHeight', number>,
): void {
  Object.defineProperties(element, {
    scrollWidth: { configurable: true, value: scrollWidth },
    clientWidth: { configurable: true, value: clientWidth },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
  element.getClientRects = () =>
    [{ width: clientWidth, height: clientHeight }] as unknown as DOMRectList;
}

describe('Substack Note single-page (rasbt c-207892753)', () => {
  const EXPECTED_TEXTS = [
    'Ch 6 on reinforcement learning',
    'less complicated than it sounds',
    'clawdbot / OpenClaw',
    'building methods from scratch',
    'follow-up chapter',
    'GRPO-related algorithmic tweaks',
    'early-access link',
    'Happy weekend',
  ];

  it('detects note paragraphs (skips single-char "I")', () => {
    setupDOM(loadFixture('substack-note-single'));
    const blocks = detectTextBlocks(document.body);
    const allText = blocks.map((b) => b.text);

    // "I" alone should NOT be detected (too short, F8 filter)
    expect(allText.some((t) => t === 'I')).toBe(false);

    // "am currently working..." SHOULD be detected (valid paragraph)
    expect(allText.some((t) => t.includes('follow-up chapter'))).toBe(true);

    // Should detect 9 paragraphs total (8 note - "I" + 2 comments)
    expect(blocks.length).toBeGreaterThanOrEqual(9);
  });

  it('detects each expected paragraph', () => {
    setupDOM(loadFixture('substack-note-single'));
    const blocks = detectTextBlocks(document.body);
    const allText = blocks.map((b) => b.text);

    const missing: string[] = [];
    for (const expected of EXPECTED_TEXTS) {
      if (!allText.some((t) => t.includes(expected))) missing.push(expected);
    }
    expect(missing).toEqual([]);
  });

  it('does not apply truncation when only text-overflow without overflow:hidden', () => {
    setupDOM(loadFixture('substack-note-single'));
    const blocks = detectTextBlocks(document.body);

    // Inject translation into first block
    injectTranslation(blocks[0].element, '검증 가능한 보상을 사용한 강화 학습 번역');

    const span = blocks[0].element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span).toBeTruthy();
    // Should NOT have truncation styles — parent has text-overflow: ellipsis
    // but NOT overflow: hidden, so truncation is inactive
    expect(span.style.whiteSpace).not.toBe('nowrap');
    expect(span.style.overflow).not.toBe('hidden');
  });

  it('DOES apply truncation when both text-overflow AND overflow:hidden', () => {
    const html =
      '<p style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Some long English text that should be truncated in the translation too</p>';
    setupDOM(html);
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBe(1);

    injectTranslation(blocks[0].element, '잘려야 하는 긴 번역 텍스트');
    const span = blocks[0].element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).toBe('nowrap');
    expect(span.style.overflow).toBe('hidden');
  });

  it('does not force nowrap for an expanding caption with inactive ellipsis styles', () => {
    const html =
      '<div class="caption__text" style="display:grid; overflow:hidden">' +
      '<p style="overflow:hidden; text-overflow:ellipsis; white-space:normal">' +
      'A multi-line figure caption that is allowed to grow with its content.' +
      '</p></div>';
    setupDOM(html);
    const caption = document.querySelector('p') as HTMLElement;
    stubLayout(caption, { scrollWidth: 240, clientWidth: 240, scrollHeight: 60, clientHeight: 60 });
    const blocks = detectTextBlocks(document.body);

    injectTranslation(
      blocks[0].element,
      '콘텐츠 높이에 맞춰 여러 줄로 늘어나야 하는 그림 설명 번역문입니다.',
    );

    const span = blocks[0].element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).not.toBe('nowrap');
    expect(span.style.textOverflow).not.toBe('ellipsis');
  });

  it('applies truncation when wrapping ellipsis content actually overflows', () => {
    setupDOM(
      '<p style="overflow:hidden; text-overflow:ellipsis; white-space:normal">A wrapping caption whose rendered content is clipped.</p>',
    );
    const caption = document.querySelector('p') as HTMLElement;
    stubLayout(caption, { scrollWidth: 240, clientWidth: 240, scrollHeight: 63, clientHeight: 60 });

    injectTranslation(caption, '실제로 높이가 잘리는 여러 줄 번역문');

    const span = caption.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).toBe('nowrap');
    expect(span.style.overflow).toBe('hidden');
  });

  it('applies truncation when wrapping ellipsis content overflows horizontally', () => {
    setupDOM(
      '<p style="overflow:hidden; text-overflow:ellipsis; white-space:normal">A fixed-width single-line caption whose rendered content is clipped horizontally.</p>',
    );
    const caption = document.querySelector('p') as HTMLElement;
    stubLayout(caption, { scrollWidth: 300, clientWidth: 240, scrollHeight: 60, clientHeight: 60 });

    injectTranslation(caption, '고정 폭에서 가로로 잘리는 한 줄 캡션 번역문');

    const span = caption.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).toBe('nowrap');
    expect(span.style.overflow).toBe('hidden');
  });

  it('ignores a one-pixel scroll/client rounding difference', () => {
    setupDOM(
      '<p style="overflow:hidden; text-overflow:ellipsis; white-space:normal">A wrapping caption with a rounding-only height difference.</p>',
    );
    const caption = document.querySelector('p') as HTMLElement;
    stubLayout(caption, { scrollWidth: 240, clientWidth: 240, scrollHeight: 61, clientHeight: 60 });

    injectTranslation(caption, '반올림 오차만 있는 여러 줄 번역문');

    const span = caption.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).not.toBe('nowrap');
    expect(span.style.overflow).not.toBe('hidden');
  });

  it('falls back conservatively when wrapping ellipsis layout is unavailable', () => {
    setupDOM(
      '<p style="overflow:hidden; text-overflow:ellipsis; white-space:normal">A caption without an observable layout box.</p>',
    );
    const caption = document.querySelector('p') as HTMLElement;
    caption.getClientRects = () => [] as unknown as DOMRectList;

    injectTranslation(caption, '레이아웃을 관측할 수 없는 번역문');

    const span = caption.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(span.style.whiteSpace).toBe('nowrap');
    expect(span.style.overflow).toBe('hidden');
  });

  it('inserts a translation break when parent is nowrap but an ellipsis child is not clipped', () => {
    setupDOM(
      '<p style="white-space:nowrap"><span style="overflow:hidden; text-overflow:ellipsis; white-space:normal">A child caption that fits its box.</span></p>',
    );
    const parent = document.querySelector('p') as HTMLElement;
    const child = document.querySelector('span') as HTMLElement;
    stubLayout(child, { scrollWidth: 240, clientWidth: 240, scrollHeight: 60, clientHeight: 60 });

    injectTranslation(parent, '부모의 줄바꿈 금지와 별개로 다음 줄에 표시되는 번역문');

    const translated = parent.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(Array.from(translated).some((node) => node.tagName === 'BR')).toBe(true);
  });

  it('detects all visible text including short UI labels (translate-everything)', () => {
    setupDOM(loadFixture('substack-note-single'));
    const blocks = detectTextBlocks(document.body);
    const allText = blocks.map((b) => b.text);

    // "Translate everything" — short UI text is no longer filtered
    expect(allText.some((t) => t === 'Like')).toBe(true);
    expect(allText.some((t) => t === 'Reply')).toBe(true);
  });

  it('inject + removeAll roundtrip is clean', () => {
    setupDOM(loadFixture('substack-note-single'));
    const blocks = detectTextBlocks(document.body);

    for (const block of blocks) {
      injectTranslation(block.element, '테스트 번역');
    }

    expect(document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length).toBe(blocks.length);

    purgeAllTranslations();
    expect(document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length).toBe(0);
    expect(document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).length).toBe(0);
  });
});
