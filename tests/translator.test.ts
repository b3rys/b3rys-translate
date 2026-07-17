import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  injectTranslation,
  findTextLabel,
  purgeAllTranslations,
  setTranslationMode,
} from '@/entrypoints/content/translator';
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
});

// ============================================================
// Nav item injection (LI with flex <a> + label span)
// ============================================================

describe('Nav LI injection (GitHub ActionList pattern)', () => {
  it('injects translation inside the <span class="label">', () => {
    setupDOM(loadFixture('github-sidebar'));
    const li = document.querySelector('li')!;
    injectTranslation(li, '공개 프로필');

    const translated = li.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated).toBeDefined();
    // Translation should be inside the <span class="label">, not directly under <li>
    expect(translated.parentElement!.classList.contains('label')).toBe(true);
    expect(translated.className).toBe('b3rys-translation-inline');
  });

  it('injects inside <a> fallback when no deeper label found (inside nav)', () => {
    setupDOM(`
      <nav>
        <ul>
          <li><a href="/about">About Us</a></li>
        </ul>
      </nav>
    `);
    const li = document.querySelector('li')!;
    injectTranslation(li, '회사 소개');

    const translated = li.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated).toBeDefined();
    expect(translated.parentElement!.tagName).toBe('A');
    expect(translated.className).toBe('b3rys-translation-inline');
  });

  it('uses inline treatment for short LI outside <nav> (≤60 chars)', () => {
    setupDOM(`
      <ul>
        <li><a href="/about">About Us</a></li>
      </ul>
    `);
    const li = document.querySelector('li')!;
    injectTranslation(li, '회사 소개');

    const translated = li.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated).toBeDefined();
    expect(translated.className).toBe('b3rys-translation-inline');
  });
});

// ============================================================
// Inline vs block class assignment
// ============================================================

describe('Inline vs block class', () => {
  it('uses block class for short P text (≤60 chars) — P always block', () => {
    setupDOM('<p>Short text here.</p>');
    const p = document.querySelector('p')!;
    injectTranslation(p, '짧은 텍스트');

    const translated = p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated.className).toBe('b3rys-translation');
  });

  it('uses block class for long P text (>60 chars)', () => {
    const longText =
      'This is a much longer paragraph that definitely exceeds the sixty character inline limit for translations.';
    setupDOM(`<p>${longText}</p>`);
    const p = document.querySelector('p')!;
    injectTranslation(p, '이것은 인라인 제한을 확실히 초과하는 긴 문단입니다.');

    const translated = p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated.className).toBe('b3rys-translation');
  });

  it('uses block class for H1-H6 regardless of text length', () => {
    const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    for (const tag of headings) {
      document.body.innerHTML = '';
      setupDOM(`<${tag}>Short</${tag}>`);
      const heading = document.querySelector(tag)!;
      injectTranslation(heading as HTMLElement, '짧음');

      const translated = heading.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
      expect(translated.className).toBe('b3rys-translation');
    }
  });
});

// ============================================================
// HTML sanitization
// ============================================================

describe('HTML sanitization', () => {
  it('keeps allowed tags (a, code, strong, em)', () => {
    setupDOM(
      '<p>Some long enough paragraph text so it is not inline mode for this test case here.</p>',
    );
    const p = document.querySelector('p')!;
    injectTranslation(
      p,
      'Visit <a href="https://example.com">example</a> and <code>run</code> with <strong>bold</strong>',
    );

    const translated = p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated.querySelector('a')).not.toBeNull();
    expect(translated.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
    expect(translated.querySelector('code')).not.toBeNull();
    expect(translated.querySelector('strong')).not.toBeNull();
  });

  it('strips dangerous tags (script, img, iframe)', () => {
    setupDOM(
      '<p>A paragraph with enough text to ensure block mode translation injection is used here.</p>',
    );
    const p = document.querySelector('p')!;
    injectTranslation(
      p,
      'Hello <script>alert("xss")</script> <img src=x onerror=alert(1)> <iframe src="evil"></iframe> world',
    );

    const translated = p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(translated.querySelector('script')).toBeNull();
    expect(translated.querySelector('img')).toBeNull();
    expect(translated.querySelector('iframe')).toBeNull();
    expect(translated.textContent).toContain('Hello');
    expect(translated.textContent).toContain('world');
  });

  it('blocks javascript: hrefs', () => {
    setupDOM(
      '<p>Text content long enough for this test paragraph to work properly in block mode.</p>',
    );
    const p = document.querySelector('p')!;
    injectTranslation(p, '<a href="javascript:alert(1)">click</a>');

    const translated = p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    const link = translated.querySelector('a')!;
    expect(link.hasAttribute('href')).toBe(false);
  });
});

// ============================================================
// findTextLabel
// ============================================================

describe('findTextLabel', () => {
  it('finds the deepest matching text element', () => {
    setupDOM(`
      <a href="/settings" style="display:flex;align-items:center;gap:8px;">
        <svg width="16" height="16"><path d="M1 1"></path></svg>
        <span class="label">Public profile</span>
      </a>
    `);
    const link = document.querySelector('a')!;
    const label = findTextLabel(link, 'Public profile');

    expect(label).not.toBeNull();
    expect(label!.classList.contains('label')).toBe(true);
    expect(label!.tagName).toBe('SPAN');
  });

  it('returns null when no matching descendant found', () => {
    setupDOM('<a href="/about">About</a>');
    const link = document.querySelector('a')!;
    const label = findTextLabel(link, 'Something else entirely');

    expect(label).toBeNull();
  });
});

// ============================================================
// Injection roundtrip (inject → removeAll → verify)
// ============================================================

describe('Injection roundtrip', () => {
  it('restores original innerHTML after inject → removeAll', () => {
    setupDOM('<p>Hello world paragraph that is long enough to be a proper test case here.</p>');
    const p = document.querySelector('p')!;
    const originalHTML = p.innerHTML;

    injectTranslation(p, '안녕하세요 세계');
    expect(p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).not.toBeNull();

    purgeAllTranslations();
    expect(p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
    expect(p.querySelector(`[${DATA_ATTRS.ORIGINAL}]`)).toBeNull();
    expect(p.innerHTML).toBe(originalHTML);
  });

  it('wraps text nodes with <span data-b3rys-original>', () => {
    setupDOM('<p>Plain text node content here.</p>');
    const p = document.querySelector('p')!;

    injectTranslation(p, '번역된 텍스트');

    const originals = p.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`);
    expect(originals.length).toBeGreaterThan(0);
    // Text node should be wrapped in a span
    const wrapper = originals[0] as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.textContent).toContain('Plain text node');
  });

  it('marks inline element children with attribute only (no wrapping)', () => {
    setupDOM(
      '<p><strong>Bold text</strong> and <em>italic</em> in a sufficiently long paragraph.</p>',
    );
    const p = document.querySelector('p')!;

    injectTranslation(p, '굵은 텍스트와 이탤릭');

    const strong = p.querySelector('strong')!;
    expect(strong.hasAttribute(DATA_ATTRS.ORIGINAL)).toBe(true);
    // strong should NOT be wrapped in another element
    expect(strong.parentElement!.tagName).toBe('P');
  });

  it('restores all paragraphs after multi-paragraph inject → removeAll', () => {
    setupDOM(`
      <p>First paragraph with enough text for block mode translation injection.</p>
      <p>Second paragraph with enough text for block mode translation injection.</p>
      <p>Third paragraph with enough text for block mode translation injection.</p>
    `);
    const paragraphs = document.querySelectorAll('p');
    const originals = Array.from(paragraphs).map((p) => p.innerHTML);

    paragraphs.forEach((p, i) => {
      injectTranslation(p as HTMLElement, `번역 ${i + 1}`);
    });

    purgeAllTranslations();

    const restored = document.querySelectorAll('p');
    expect(restored.length).toBe(3);
    restored.forEach((p, i) => {
      expect(p.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
      expect(p.innerHTML).toBe(originals[i]);
    });
  });

  it('toggles body class with setTranslationMode', () => {
    setTranslationMode('replace');
    expect(document.body.classList.contains('b3rys-replace-mode')).toBe(true);

    setTranslationMode('parallel');
    expect(document.body.classList.contains('b3rys-replace-mode')).toBe(false);
  });

  it('replaces previous translation on re-injection (only 1 translation exists)', () => {
    setupDOM('<p>Original text content long enough for the block mode injection to activate.</p>');
    const p = document.querySelector('p')!;

    injectTranslation(p, '첫 번째 번역');
    injectTranslation(p, '두 번째 번역');

    const translations = p.querySelectorAll(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translations.length).toBe(1);
    expect(translations[0].textContent).toContain('두 번째 번역');
  });
});
