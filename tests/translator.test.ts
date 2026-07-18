import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  injectTranslation,
  findTextLabel,
  purgeAllTranslations,
  cancelTranslation,
  setTranslationMode,
} from '@/entrypoints/content/translator';
import { recordInjection, isFighting, resetFightGuard } from '@/utils/fight-guard';
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

  it('does NOT re-parent text nodes at injection time (React safety)', () => {
    // Wrapping framework-owned text nodes breaks React reconciliation
    // (insertBefore NotFoundError → whole site crashes). Parallel mode must
    // never move site text nodes.
    setupDOM('<p>Plain text node content here.</p>');
    const p = document.querySelector('p')!;

    injectTranslation(p, '번역된 텍스트');

    // The loose text node stays a direct child of <p> — no wrapper spans
    const directText = Array.from(p.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('Plain text node'),
    );
    expect(directText).toBe(true);
  });

  it('wraps loose text only when entering replace mode, unwraps on parallel', () => {
    setupDOM('<p data-b3rys-id="b3rys-950">Plain text node content here.</p>');
    const p = document.querySelector('p')!;
    injectTranslation(p, '번역된 텍스트');

    setTranslationMode('replace');
    const wrapped = p.querySelectorAll(`span[${DATA_ATTRS.ORIGINAL}]`);
    expect(wrapped.length).toBeGreaterThan(0);
    expect(wrapped[0].textContent).toContain('Plain text node');

    setTranslationMode('parallel');
    // Wrappers are gone; the text node is a direct child again
    expect(p.querySelectorAll(`span[${DATA_ATTRS.ORIGINAL}]`).length).toBe(0);
    const directText = Array.from(p.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes('Plain text node'),
    );
    expect(directText).toBe(true);
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

// ============================================================
// Replace mode ("가" / Korean-only) visibility invariant
// ============================================================
// Regression: on flex/grid blocks the translation is injected into a *descendant*
// text child. If markOriginalContent marked that child's ancestor as original,
// `body.b3rys-replace-mode [data-b3rys-original]{display:none}` hid the whole
// branch — translation and all — so the body content vanished in Korean-only mode.

describe('Replace mode visibility', () => {
  it('keeps the translation branch un-hidden when injected into a flex text child', () => {
    setupDOM(
      '<div style="display:flex;">' +
        '<span class="icon">•</span>' +
        '<div class="txt">What is Skilljar and why am I logging into it right now?</div>' +
        '</div>',
    );
    const block = document.querySelector('div[style]') as HTMLElement;
    const txt = block.querySelector('.txt') as HTMLElement;

    injectTranslation(block, 'Skilljar란 무엇이며 왜 지금 로그인해야 하나요?');

    const translated = block.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    // Translation landed inside the text child (a descendant), not directly on block.
    expect(txt.contains(translated)).toBe(true);

    // Invariant: no ancestor of the translation (up to the block) is marked
    // original, so replace mode's display:none never reaches it.
    expect(translated.closest(`[${DATA_ATTRS.ORIGINAL}]`)).toBeNull();
    // The text child itself is on the path → must stay visible.
    expect(txt.hasAttribute(DATA_ATTRS.ORIGINAL)).toBe(false);
    // The original content is still marked somewhere (so replace mode hides it).
    expect(block.querySelectorAll(`[${DATA_ATTRS.ORIGINAL}]`).length).toBeGreaterThan(0);
    // The off-path sibling (icon) is hidden.
    expect(block.querySelector('.icon')!.hasAttribute(DATA_ATTRS.ORIGINAL)).toBe(true);
  });

  it('restores flex-block original markup after purge', () => {
    setupDOM(
      '<div style="display:flex;">' +
        '<span class="icon">•</span>' +
        '<div class="txt">Another sufficiently long question about data and privacy here.</div>' +
        '</div>',
    );
    const block = document.querySelector('div[style]') as HTMLElement;
    const originalHTML = block.innerHTML;

    injectTranslation(block, '데이터와 개인정보에 대한 또 다른 질문');
    purgeAllTranslations();

    expect(block.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
    expect(block.querySelector(`[${DATA_ATTRS.ORIGINAL}]`)).toBeNull();
    expect(block.innerHTML).toBe(originalHTML);
  });
});

// ============================================================
// Card-style sole-link injection (claude.com TOC regression)
// ============================================================
// The <a> is a grid: icon column + text column. Appending the translation span
// directly to the <a> made it a NEW grid item in the ~22px icon track →
// one-character-per-line vertical text. It must land inside the text column.

describe('Sole-link card injection', () => {
  it('injects inside the link text column, never as a direct <a> grid item', () => {
    // Non-semantic wrapper (DIV) → sole-link path applies. Semantic tags (LI)
    // keep their own default injection by design.
    setupDOM(
      '<div class="card"><a href="#pulse">' +
        '<div class="icon"><svg viewBox="0 0 24 24"></svg></div>' +
        '<div><div class="t">Get a pulse on your business</div>' +
        '<div class="d">One Monday-morning page that covers what you would check across tabs.</div></div>' +
        '</a></div>',
    );
    const card = document.querySelector('.card') as HTMLElement;
    injectTranslation(card, '비즈니스 현황 파악하기');

    const a = card.querySelector('a')!;
    const translated = card.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    expect(a.contains(translated)).toBe(true);
    // Regression: must NOT be a direct child of the grid <a> (icon-track item)
    expect(translated.parentElement).not.toBe(a);
    // And must not land in the icon column
    expect(translated.closest('.icon')).toBeNull();
  });
});

// ============================================================
// Fight guard integration (FAB dead-toggle regression)
// ============================================================

describe('Sole-link card injection — semantic wrapper (LI)', () => {
  it('LI-wrapped grid card also injects into the text column (claude.com TOC)', () => {
    setupDOM(
      '<li><a href="#pulse" style="display: grid">' +
        '<div class="icon"><svg viewBox="0 0 24 24"></svg></div>' +
        '<div><div class="t">Get a pulse on your business</div>' +
        '<div class="d">One Monday-morning page that covers what you would check across tabs.</div></div>' +
        '</a></li>',
    );
    const li = document.querySelector('li') as HTMLElement;
    injectTranslation(li, '비즈니스 현황 파악하기');

    const a = li.querySelector('a')!;
    const translated = li.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    // Inside the link's text column — never a direct grid item of <a>,
    // never in the icon track, never dangling outside the card.
    expect(a.contains(translated)).toBe(true);
    expect(translated.parentElement).not.toBe(a);
    expect(translated.closest('.icon')).toBeNull();
  });

  it('plain (non-grid) sole link inside LI keeps default LI injection', () => {
    setupDOM(
      '<li><a href="/somewhere">A regular list link with a fairly long descriptive label here.</a></li>',
    );
    const li = document.querySelector('li') as HTMLElement;
    injectTranslation(li, '일반 리스트 링크 번역');

    const translated = li.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)!;
    // Non-card semantic wrapper → old behavior preserved (span under LI)
    expect(translated.parentElement).toBe(li);
  });
});

describe('Cancel releases untranslated claims (virtualized-list stranding)', () => {
  it('strips BLOCK_ID from claim-only blocks on cancel, keeps landed ones', () => {
    setupDOM(
      '<p id="landed" data-b3rys-id="b3rys-901">Landed paragraph with translation.</p>' +
        '<p id="claimed" data-b3rys-id="b3rys-902">Claimed but never injected paragraph.</p>',
    );
    // Give the landed block an actual translation span
    const landed = document.getElementById('landed')!;
    const span = document.createElement('span');
    span.setAttribute(DATA_ATTRS.TRANSLATED, 'true');
    landed.appendChild(span);

    cancelTranslation();

    // Landed keeps its claim (duplicate prevention), stranded one is released
    expect(landed.hasAttribute(DATA_ATTRS.BLOCK_ID)).toBe(true);
    expect(document.getElementById('claimed')!.hasAttribute(DATA_ATTRS.BLOCK_ID)).toBe(false);
  });
});

describe('Fight guard integration', () => {
  it('purgeAllTranslations resets the guard — manual re-toggling never yields blocks', () => {
    resetFightGuard();
    const t = 1_000_000;
    recordInjection('Same paragraph text', t);
    recordInjection('Same paragraph text', t + 1000);
    recordInjection('Same paragraph text', t + 2000);
    expect(isFighting('Same paragraph text', t + 3000)).toBe(true);

    // User toggles OFF→ON: purge runs → guard must forget everything
    purgeAllTranslations();
    expect(isFighting('Same paragraph text', t + 3000)).toBe(false);
  });

  it('scroll-driven re-injections (virtualized recycling) never count as fights', () => {
    resetFightGuard();
    const t = 2_000_000;
    for (let i = 0; i < 5; i++) {
      recordInjection('Recycled chat message', t + i * 1000, true);
    }
    expect(isFighting('Recycled chat message', t + 6000)).toBe(false);
  });
});
