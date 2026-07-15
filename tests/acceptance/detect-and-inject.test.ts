import { describe, it, expect, beforeEach } from 'vitest';
import { loadFixture, setupDOM } from '../helpers/test-utils';
import { detectTextBlocks } from '@/entrypoints/content/text-detector';
import { injectTranslation, purgeAllTranslations } from '@/entrypoints/content/translator';
import { DATA_ATTRS } from '@/utils/constants';

beforeEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((el) => {
    el.removeAttribute(DATA_ATTRS.BLOCK_ID);
  });
});

// ============================================================
// Fixture: latent-space-article
// ============================================================

describe('latent.space article', () => {
  it('detects article paragraphs (>5 blocks)', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(5);
  });

  it('detects headings (H1-H4)', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    const headingTags = blocks.map((b) => b.element.tagName).filter((t) => /^H[1-6]$/.test(t));
    expect(headingTags.length).toBeGreaterThanOrEqual(3);
  });

  it('does not detect code blocks', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    // Code content should be excluded
    expect(texts.some((t) => t.includes('import torch'))).toBe(false);
    expect(texts.some((t) => t.includes('class SelfAttention'))).toBe(false);
  });

  it('detects blockquote content', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    const bqBlocks = blocks.filter(
      (b) => b.element.tagName === 'BLOCKQUOTE' || b.element.closest('blockquote'),
    );
    expect(bqBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it('detects list items', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    const liBlocks = blocks.filter((b) => b.element.tagName === 'LI');
    expect(liBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('inject + removeAll roundtrip is clean', () => {
    setupDOM(loadFixture('latent-space-article'));
    const blocks = detectTextBlocks(document.body);
    // Inject translations
    for (const block of blocks.slice(0, 5)) {
      injectTranslation(block.element, '테스트 번역');
    }

    // Verify translations exist
    const translated = document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated.length).toBeGreaterThan(0);

    // Remove and verify clean restoration
    purgeAllTranslations();
    const remaining = document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(remaining.length).toBe(0);
    const originals = document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`);
    expect(originals.length).toBe(0);
  });
});

// ============================================================
// Fixture: substack-notes
// ============================================================

describe('Substack notes (Phase 2 — DIV detection)', () => {
  it('detects note text divs (>3 blocks)', () => {
    setupDOM(loadFixture('substack-notes'));
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(3);
  });

  it('detects DIV-based note texts in Phase 2', () => {
    setupDOM(loadFixture('substack-notes'));
    const blocks = detectTextBlocks(document.body);
    const divBlocks = blocks.filter((b) => b.element.tagName === 'DIV');
    expect(divBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it('detects link preview content', () => {
    setupDOM(loadFixture('substack-notes'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('Scaling Laws'))).toBe(true);
  });

  it('inject + removeAll roundtrip is clean', () => {
    setupDOM(loadFixture('substack-notes'));
    const blocks = detectTextBlocks(document.body);

    for (const block of blocks.slice(0, 3)) {
      injectTranslation(block.element, '테스트 번역');
    }

    purgeAllTranslations();
    expect(document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length).toBe(0);
    expect(document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).length).toBe(0);
  });
});

// ============================================================
// Fixture: github-readme
// ============================================================

describe('GitHub README (markdown rendering)', () => {
  it('detects paragraphs in markdown body (>3 blocks)', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(3);
  });

  it('detects headings in README', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);
    const headings = blocks.filter((b) => /^H[1-6]$/.test(b.element.tagName));
    expect(headings.length).toBeGreaterThanOrEqual(3);
  });

  it('detects feature list items', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('TypeScript support'))).toBe(true);
  });

  it('does not detect code block content', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    // Code inside <pre><code> should be excluded
    expect(texts.some((t) => t.includes('npm install awesome-project'))).toBe(false);
    expect(texts.some((t) => t.includes('import { createApp } from'))).toBe(false);
  });

  it('detects table cells', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);
    const tdBlocks = blocks.filter((b) => b.element.tagName === 'TD' || b.element.tagName === 'TH');
    expect(tdBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it('inject + removeAll roundtrip is clean', () => {
    setupDOM(loadFixture('github-readme'));
    const blocks = detectTextBlocks(document.body);

    for (const block of blocks.slice(0, 5)) {
      injectTranslation(block.element, '번역된 텍스트');
    }

    purgeAllTranslations();
    expect(document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length).toBe(0);
    expect(document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).length).toBe(0);
  });
});

// ============================================================
// Fixture: github-pr
// ============================================================

describe('GitHub PR (comments and reviews)', () => {
  it('detects PR description and comment paragraphs (>5 blocks)', () => {
    setupDOM(loadFixture('github-pr'));
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(5);
  });

  it('detects comment body paragraphs', () => {
    setupDOM(loadFixture('github-pr'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('backpressure'))).toBe(true);
    expect(texts.some((t) => t.includes('error handling'))).toBe(true);
  });

  it('detects PR title heading', () => {
    setupDOM(loadFixture('github-pr'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('streaming response'))).toBe(true);
  });

  it('detects list items in PR description', () => {
    setupDOM(loadFixture('github-pr'));
    const blocks = detectTextBlocks(document.body);
    const liBlocks = blocks.filter((b) => b.element.tagName === 'LI');
    expect(liBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('inject + removeAll roundtrip is clean', () => {
    setupDOM(loadFixture('github-pr'));
    const blocks = detectTextBlocks(document.body);

    for (const block of blocks.slice(0, 5)) {
      injectTranslation(block.element, '번역');
    }

    purgeAllTranslations();
    expect(document.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`).length).toBe(0);
    expect(document.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).length).toBe(0);
  });
});

// ============================================================
// Existing fixtures: regression tests
// ============================================================

describe('Existing fixtures (regression)', () => {
  it('github-sidebar: detects LI menu items', () => {
    setupDOM(loadFixture('github-sidebar'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('Public profile');
    expect(texts).toContain('Account');
  });

  it('substack-title: detects standalone A and DIV', () => {
    setupDOM(loadFixture('substack-title'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.includes('Understanding the fundamentals'))).toBe(true);
  });

  it('gmail-inbox: detects email body paragraphs', () => {
    const html = loadFixture('gmail-inbox');
    expect(html.length).toBeGreaterThan(0);
    setupDOM(html);
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('substack-comment: fixture loads without error', () => {
    const html = loadFixture('substack-comment');
    expect(html.length).toBeGreaterThan(0);
    setupDOM(html);
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBeGreaterThan(0);
  });
});
