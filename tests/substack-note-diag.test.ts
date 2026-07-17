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
