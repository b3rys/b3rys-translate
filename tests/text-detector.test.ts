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

  /**
   * 위 테스트는 SKIP_TAGS 를 실제로 지키지 못한다 — 하네스 리뷰에서 드러났다.
   * SKIP_TAGS 에서 'CODE','PRE' 를 지워도 전부 통과한다. 독립된 <code>/<script>
   * 는 애초에 TRANSLATABLE_TAGS 에 없어서 어느 단계에서도 안 잡히기 때문이다.
   * 즉 다른 이유로 통과하고 있었고, 안전장치가 사라져도 CI 는 조용했다.
   *
   * SKIP_TAGS 가 실제로 일하는 곳은 ★번역 대상 안에 섞인 인라인 코드★ 다.
   * <p> 는 번역 대상이라 텍스트를 모으는데, 그 안의 <code> 를 빼주는 것이
   * SKIP_TAGS 다. 그래서 그 경우로 고정한다 — 이 테스트는 SKIP_TAGS 에서
   * CODE 를 지우면 실제로 실패한다.
   */
  it('keeps inline code out of a translatable paragraph (SKIP_TAGS 실효 고정)', () => {
    setupDOM(`
      <p>Please run <code>rm -rf node_modules &amp;&amp; npm install</code> before starting.</p>
      <li>Set <code>DEBUG=1</code> to enable verbose logging for this session.</li>
    `);
    const texts = detectTextBlocks(document.body).map((b) => b.text);

    // 문단 자체는 번역 대상으로 잡혀야 한다
    expect(texts.some((t) => t.includes('before starting'))).toBe(true);

    // 그런데 쉘 명령과 환경변수는 번역기에 넘어가면 안 된다.
    // 넘어가면 사용자가 복사해 실행할 명령어가 번역돼 망가진다.
    expect(texts.some((t) => t.includes('rm -rf'))).toBe(false);
    expect(texts.some((t) => t.includes('node_modules'))).toBe(false);
    expect(texts.some((t) => t.includes('DEBUG=1'))).toBe(false);
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

// ============================================================
// 상단 메뉴의 짧은 라벨
// ============================================================

describe('navigation labels', () => {
  it('skips one-word menu labels inside a nav', () => {
    // "Research" 밑에 "연구" 가 붙으면 메뉴가 두 배로 길어지고 훑어보기 어려워진다.
    // anthropic.com 상단 메뉴에서 한 번에 네 개가 이렇게 됐다.
    const container = setupDOM(`
      <header><nav><ul>
        <li><a href="/research">Research</a></li>
        <li><a href="/policy">Policy</a></li>
        <li><button>Commitments</button></li>
      </ul></nav></header>
    `);

    const texts = detectTextBlocks(container).map((block) => block.text);

    expect(texts).not.toContain('Research');
    expect(texts).not.toContain('Policy');
    expect(texts).not.toContain('Commitments');
  });

  it('still translates a full sentence that happens to sit in a header nav', () => {
    // 헤더 메뉴라도 통째로 막지 않는다 — 긴 글은 라벨이 아니라 내용이다.
    const sentence = 'Learn how to build production applications with our API';
    const container = setupDOM(
      `<header><nav><ul><li><a href="/docs">${sentence}</a></li></ul></nav></header>`,
    );

    const texts = detectTextBlocks(container).map((block) => block.text);

    expect(texts.some((text) => text.includes('production applications'))).toBe(true);
  });

  it('keeps translating a sidebar nav — only the header menu is skipped', () => {
    // GitHub 설정 사이드바가 이 경우다. nav 라는 이유만으로 막으면 이게 죽는다.
    const container = setupDOM(
      `<nav aria-label="Settings"><ul><li><a href="/s">Account</a></li></ul></nav>`,
    );

    expect(detectTextBlocks(container).map((b) => b.text)).toContain('Account');
  });

  it('leaves short text outside a nav alone', () => {
    // 본문의 짧은 문구까지 건드리면 안 된다.
    const container = setupDOM(`<article><p>Research</p><p>Policy</p></article>`);

    const texts = detectTextBlocks(container).map((block) => block.text);

    expect(texts).toContain('Research');
    expect(texts).toContain('Policy');
  });
});

// ============================================================
// html payload boundary (Phase 1 — getDirectHTML)
// ============================================================
// getDirectText 는 경계 자식에서 멈추고 getDirectHTML 은 안 멈추면, 짧은 text 로
// 필터를 통과한 블록이 그 자식들의 subtree 전체를 payload 에 싣는다.
// 접힌 드롭다운이 그 형태다 — 보이는 글자는 "Main Conference" 하나인데,
// display:none 인 ul.dropdown-menu 는 안 보여서 자기 블록이 안 되고,
// 그래서 바깥 li 가 조상 필터에도 안 걸린 채 메뉴 전체를 payload 로 보낸다.

/**
 * display:none 재현. happy-dom 은 레이아웃을 계산하지 않아 offsetParent 가 undefined,
 * getClientRects 가 항상 1개다 — isElementHidden 이 보는 두 값을 직접 눌러야 한다.
 */
function hideSubtree(root: Element): void {
  const hide = (el: HTMLElement): void => {
    Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
    el.getClientRects = () => [] as unknown as DOMRectList;
  };
  hide(root as HTMLElement);
  root.querySelectorAll('*').forEach((el) => hide(el as HTMLElement));
}

describe('html payload respects text collection boundaries', () => {
  function collapsedDropdown(): HTMLElement {
    const container = setupDOM(`
      <ul>
        <li class="dropdown-item dropdown pe-3">
          <a href="#">Main Conference</a>
          <ul class="dropdown-menu">


            <li><a href="/invited">Invited Talks</a></li>


            <li><a href="/orals">Oral Presentations</a></li>


          </ul>
        </li>
      </ul>`);
    hideSubtree(container.querySelector('.dropdown-menu')!);
    return container;
  }

  it('drops nested block children from the html payload, not just from text', () => {
    const container = collapsedDropdown();

    const menu = detectTextBlocks(container).find((b) => b.text.trim() === 'Main Conference');

    expect(menu).toBeDefined();
    expect(menu!.html).toContain('Main Conference');
    expect(menu!.html).not.toContain('Invited Talks');
    expect(menu!.html).not.toContain('Oral Presentations');
  });

  it('leaves no whitespace-only container or blank lines in the html payload', () => {
    const container = collapsedDropdown();

    const menu = detectTextBlocks(container).find((b) => b.text.trim() === 'Main Conference');

    expect(menu).toBeDefined();
    // The submenu's <li> items are boundaries; only the indentation between them
    // is left, and that must not reach the payload as a "<ul> </ul>" shell.
    expect(menu!.html.replace(/\s+/g, ' ').trim()).toBe('<a href="#">Main Conference</a>');
    expect(menu!.html).not.toMatch(/\n\s*\n/);
  });

  it('collapses whitespace-only text between inline children to one space', () => {
    const container = setupDOM(`<p>Read the <a href="/docs">docs</a>


          <strong>notes</strong> now.</p>`);

    const block = detectTextBlocks(container).find((b) => b.text.includes('Read the'));

    expect(block).toBeDefined();
    expect(block!.html).toBe('Read the <a href="/docs">docs</a> <strong>notes</strong> now.');
    expect(block!.html).not.toMatch(/\n\s*\n/);
  });

  it('keeps whitespace inside text nodes that carry characters', () => {
    const container = setupDOM(`<p>Keep  two   spaces <em>and\n  this</em> here.</p>`);

    const block = detectTextBlocks(container).find((b) => b.text.includes('Keep'));

    expect(block!.html).toContain('Keep  two   spaces');
    expect(block!.html).toContain('<em>and\n  this</em>');
  });

  it('keeps inline markup in the html payload', () => {
    const container = setupDOM(
      `<p>Read the <a href="/docs">docs</a> and the <strong>notes</strong> with <em>care</em>.</p>`,
    );

    const block = detectTextBlocks(container).find((b) => b.text.includes('Read the'));

    expect(block).toBeDefined();
    expect(block!.html).toContain('<a href="/docs">docs</a>');
    expect(block!.html).toContain('<strong>notes</strong>');
    expect(block!.html).toContain('<em>care</em>');
  });

  it('drops attributes outside API_KEEP_ATTRS and keeps A href', () => {
    const container = setupDOM(
      `<p>See <a href="/x" class="btn" data-track="1" title="t">this page</a> now.</p>`,
    );

    const block = detectTextBlocks(container).find((b) => b.text.includes('See'));

    expect(block!.html).toContain('<a href="/x">this page</a>');
    expect(block!.html).not.toContain('data-track');
    expect(block!.html).not.toContain('class=');
  });

  it('removes SKIP_TAGS descendants from the html payload', () => {
    const container = setupDOM(
      `<p>Install it first <span><script>alert(1)</script>and then run it twice</span>.</p>`,
    );

    const block = detectTextBlocks(container).find((b) => b.text.includes('Install it first'));

    expect(block!.html).toContain('and then run it twice');
    expect(block!.html).not.toContain('alert(1)');
    expect(block!.html).not.toContain('<script');
  });

  it('serializes void elements without a closing tag', () => {
    const container = setupDOM(
      `<p>The first line is here<span>then<br>the second line follows</span></p>`,
    );

    const block = detectTextBlocks(container).find((b) => b.text.includes('first line'));

    expect(block!.html).toContain('<br>');
    expect(block!.html).not.toContain('</br>');
  });

  it('escapes " and & in a kept href', () => {
    const container = setupDOM(
      `<p>Open the <a href='/s?a=1&b=2&quot;x&quot;'>search results page</a> now.</p>`,
    );

    const block = detectTextBlocks(container).find((b) => b.text.includes('Open the'));

    expect(block!.html).toContain('href="/s?a=1&amp;b=2&quot;x&quot;"');
  });
});
