import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { detectTextBlocks } from '@/entrypoints/content/text-detector';
import { DATA_ATTRS } from '@/utils/constants';

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', `${name}.html`), 'utf-8');
}

function setupDOM(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Clean up any stale block IDs from previous tests
  document.querySelectorAll(`[${DATA_ATTRS.BLOCK_ID}]`).forEach((el) => {
    el.removeAttribute(DATA_ATTRS.BLOCK_ID);
  });
});

// ============================================================
// Fixture: github-sidebar
// ============================================================

describe('GitHub sidebar (Phase 1 — LI detection)', () => {
  it('detects all LI menu items', () => {
    setupDOM(loadFixture('github-sidebar'));
    const blocks = detectTextBlocks(document.body);

    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('Public profile');
    expect(texts).toContain('Account');
    expect(texts).toContain('Appearance');
    expect(texts).toContain('Notifications');
    expect(texts).toContain('Password and authentication');
    expect(texts).toContain('Settings');
  });

  it('detects short text like "Account" (7 chars)', () => {
    setupDOM(loadFixture('github-sidebar'));
    const blocks = detectTextBlocks(document.body);

    const account = blocks.find((b) => b.text === 'Account');
    expect(account).toBeDefined();
    expect(account!.element.tagName).toBe('LI');
  });
});

// ============================================================
// Fixture: anthropic-news-list (composite cells — date | category | title)
// ============================================================
// Regression: rows whose cells concatenate without whitespace were detected as
// ONE block → "Jul 14, 2026Product Introducing…" → run-on garbage translation.

describe('Anthropic news list (composite-cell rows)', () => {
  it('detects each cell as its own block — never a merged row', () => {
    setupDOM(loadFixture('anthropic-news-list'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts).toContain('Introducing Claude for Teachers');
    expect(texts).toContain('Product');
    expect(texts).toContain('Jul 14, 2026');

    // The glued row/header text must never appear as a single unit
    for (const t of texts) {
      expect(t).not.toMatch(/2026Product|2026Announcements|DateCategory/);
    }
  });

  it('splits the glued header spans (Date/Category/Title) into separate blocks', () => {
    setupDOM(loadFixture('anthropic-news-list'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts).toContain('Date');
    expect(texts).toContain('Category');
    expect(texts).toContain('Title');
    expect(texts).not.toContain('DateCategoryTitle');
  });

  it('splits block-level title/desc card cells even WITH whitespace between them (claude.com TOC)', () => {
    // Real ck-toc markup has newlines between the divs — the glue signal alone
    // missed it, so LI merged title+desc into one run-on translation unit.
    setupDOM(
      '<li><a href="#pulse">' +
        '<div class="ck-toc-icon"><svg viewBox="0 0 24 24"></svg></div>' +
        '<div>\n  <div class="ck-toc-title">Get a pulse on your business</div>\n  ' +
        '<div class="ck-toc-desc">One Monday-morning page that covers what you would check.</div>\n</div>' +
        '</a></li>',
    );
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts).toContain('Get a pulse on your business');
    expect(texts).toContain('One Monday-morning page that covers what you would check.');
    // Never merged into a single run-on unit
    for (const t of texts) {
      expect(t).not.toMatch(/business[\s\S]*One Monday/);
    }
  });

  it('keeps a normal sentence with inline markup as one block (not composite)', () => {
    setupDOM('<p>Hello <strong>brave</strong> new <em>world</em> of translation testing.</p>');
    const blocks = detectTextBlocks(document.body);
    expect(blocks.length).toBe(1);
    expect(blocks[0].text).toBe('Hello brave new world of translation testing.');
  });
});

// ============================================================
// Fixture: substack-title
// ============================================================

describe('Substack title (Phase 2 — standalone A and DIV)', () => {
  it('detects standalone <a> title in Phase 2', () => {
    setupDOM(loadFixture('substack-title'));
    const blocks = detectTextBlocks(document.body);

    const title = blocks.find((b) => b.text.includes('Understanding the fundamentals'));
    expect(title).toBeDefined();
    expect(title!.element.tagName).toBe('A');
  });

  it('detects <div> subtitle in Phase 2', () => {
    setupDOM(loadFixture('substack-title'));
    const blocks = detectTextBlocks(document.body);

    const subtitle = blocks.find((b) => b.text.includes('deep dive into consistency models'));
    expect(subtitle).toBeDefined();
    expect(subtitle!.element.tagName).toBe('DIV');
  });
});

// ============================================================
// Inline tests (no fixture file needed)
// ============================================================

describe('SKIP_TAGS ignored', () => {
  it('skips SCRIPT, CODE, SVG content', () => {
    setupDOM(`
      <p>This is a normal English paragraph that should be detected.</p>
      <script>var skip = "this should be ignored";</script>
      <code>const x = skipThisToo;</code>
      <svg><text>SVG text to ignore</text></svg>
    `);
    const blocks = detectTextBlocks(document.body);

    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('This is a normal English paragraph that should be detected.');
    // None of the skip-tag content should appear
    expect(texts.some((t) => t.includes('skip'))).toBe(false);
    expect(texts.some((t) => t.includes('skipThisToo'))).toBe(false);
    expect(texts.some((t) => t.includes('SVG text'))).toBe(false);
  });
});

describe('Non-English text skipped', () => {
  it('skips Korean text', () => {
    setupDOM(`
      <p>This English text should be detected by the system.</p>
      <p>한국어 텍스트는 번역 대상이 아닙니다.</p>
    `);
    const blocks = detectTextBlocks(document.body);

    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('This English text should be detected by the system.');
    expect(texts.some((t) => t.includes('한국어'))).toBe(false);
  });

  it('skips Japanese text', () => {
    setupDOM(`
      <p>Another English paragraph for detection purposes here.</p>
      <p>日本語のテキストです。</p>
    `);
    const blocks = detectTextBlocks(document.body);

    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('Another English paragraph for detection purposes here.');
    expect(texts.some((t) => t.includes('日本語'))).toBe(false);
  });
});

describe('URL text skipped', () => {
  it('skips bare URL text in paragraphs', () => {
    setupDOM(`
      <p>Read more about our architecture and design decisions below.</p>
      <p>https://example.com/very/long/path/to/resource</p>
      <p>github.com/user/repo</p>
    `);
    const blocks = detectTextBlocks(document.body);

    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('Read more about our architecture and design decisions below.');
    expect(texts.some((t) => t.includes('example.com'))).toBe(false);
    expect(texts.some((t) => t.includes('github.com'))).toBe(false);
  });
});
