import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getSiteRule } from '@/utils/site-rules';
import { injectTranslation, purgeAllTranslations } from '@/entrypoints/content/translator';
import { detectTextBlocks, _resetSkipSelectorsCache } from '@/entrypoints/content/text-detector';
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

function stubHostname(hostname: string) {
  vi.stubGlobal('location', { ...window.location, hostname });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Reset cached skip selectors between tests (module-level cache)
// Needed because _skipSelectorsSet is computed once at import time

// ============================================================
// getSiteRule hostname matching
// ============================================================

describe('getSiteRule', () => {
  it('returns Gmail rule for mail.google.com', () => {
    stubHostname('mail.google.com');
    const rule = getSiteRule();

    expect(rule).not.toBeNull();
    expect(rule!.mainContentSelector).toBe('[role="main"]');
    expect(rule!.translateSelectors).toBeUndefined();
  });

  it('returns Substack rule for substack.com', () => {
    stubHostname('substack.com');
    const rule = getSiteRule();

    expect(rule).not.toBeNull();
    expect(rule!.injectAsSibling).toBe(true);
  });

  it('returns Substack rule for subdomain (newsletter.substack.com)', () => {
    stubHostname('newsletter.substack.com');
    const rule = getSiteRule();

    expect(rule).not.toBeNull();
    expect(rule!.injectAsSibling).toBe(true);
  });

  it('returns null for unknown domain', () => {
    stubHostname('example.com');
    const rule = getSiteRule();

    expect(rule).toBeNull();
  });

  it('does not partially match (not-substack.com)', () => {
    stubHostname('not-substack.com');
    const rule = getSiteRule();

    expect(rule).toBeNull();
  });
});

// ============================================================
// Gmail fixture: standard detection + injection
// ============================================================

describe('Gmail fixture injection', () => {
  it('detects email body paragraphs with standard Phase 1', () => {
    setupDOM(loadFixture('gmail-inbox'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts.some((t) => t.includes('biometric authentication was changed'))).toBe(true);
    expect(texts.some((t) => t.includes('review the details'))).toBe(true);
  });

  it('injects translation inside paragraph with markOriginalContent', () => {
    setupDOM(loadFixture('gmail-inbox'));
    const blocks = detectTextBlocks(document.body);
    const para = blocks.find((b) => b.text.includes('biometric authentication'));

    expect(para).toBeDefined();
    injectTranslation(para!.element, '생체 인증이 변경되었습니다.');

    const translated = para!.element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated).not.toBeNull();
  });

  it('restores original after inject → removeAll', () => {
    setupDOM(loadFixture('gmail-inbox'));
    const blocks = detectTextBlocks(document.body);
    const para = blocks.find((b) => b.text.includes('biometric authentication'));
    const originalHTML = para!.element.innerHTML;

    injectTranslation(para!.element, '생체 인증이 변경되었습니다.');
    purgeAllTranslations();

    expect(para!.element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
    expect(para!.element.querySelector(`[${DATA_ATTRS.ORIGINAL}]`)).toBeNull();
    expect(para!.element.innerHTML).toBe(originalHTML);
  });
});

// ============================================================
// Substack fixture: injectAsSibling injection
// ============================================================

describe('Substack fixture injection', () => {
  beforeEach(() => {
    stubHostname('substack.com');
  });

  it('injects translation as sibling for inline elements', () => {
    setupDOM(loadFixture('substack-comment'));
    const span = document.querySelector('.body-SxXE9l')! as HTMLElement;

    // Force inline display for test (happy-dom doesn't compute styles like browsers)
    span.style.display = 'inline';
    injectTranslation(span, '좋은 글이에요!');

    // Translation should be inserted as next sibling, not inside
    const nextSib = span.nextElementSibling;
    expect(nextSib).not.toBeNull();
    expect(nextSib!.hasAttribute(DATA_ATTRS.TRANSLATED)).toBe(true);
  });

  it('restores original after inject → removeAll', () => {
    setupDOM(loadFixture('substack-comment'));
    const span = document.querySelector('.body-SxXE9l')! as HTMLElement;
    const originalText = span.textContent;

    span.style.display = 'inline';
    injectTranslation(span, '좋은 글이에요!');
    purgeAllTranslations();

    expect(span.nextElementSibling?.hasAttribute(DATA_ATTRS.TRANSLATED)).toBeFalsy();
    expect(span.textContent).toBe(originalText);
  });
});

// ============================================================
// Skilljar fixture: skipSelectors
// ============================================================

describe('Skilljar fixture skipSelectors', () => {
  beforeEach(() => {
    stubHostname('anthropic.skilljar.com');
    _resetSkipSelectorsCache();
  });

  afterEach(() => {
    _resetSkipSelectorsCache();
  });

  it('returns skilljar rule for subdomain', () => {
    const rule = getSiteRule();
    expect(rule).not.toBeNull();
    expect(rule!.skipSelectors).toContain('.clp__enroll-btn');
  });

  it('detects stat labels and other content, skips enroll button', () => {
    setupDOM(loadFixture('skilljar-course'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    // "Translate everything" — stat labels are now detected
    expect(texts.some((t) => t.includes('lectures'))).toBe(true);
    expect(texts.some((t) => t.includes('hour of video'))).toBe(true);

    // Should NOT detect enroll button (skipSelectors)
    expect(texts.some((t) => t.includes('Register'))).toBe(false);

    // SHOULD detect normal content
    expect(texts.some((t) => t.includes('Claude Code in Action'))).toBe(true);
    expect(texts.some((t) => t.includes('Learn how to use Claude Code'))).toBe(true);
  });

  it('injects translation inside last text child of flex stat-item (no layout disruption)', () => {
    setupDOM(loadFixture('skilljar-course'));
    const statItem = document.querySelector('.clp__stat-item')! as HTMLElement;

    // Force flex display (happy-dom doesn't compute from inline style attr)
    statItem.style.display = 'flex';
    statItem.parentElement!.style.display = 'flex';

    injectTranslation(statItem, '15개의 강의');

    // Translation should be INSIDE the last text child (stat-label span), not a new flex item
    const label = statItem.querySelector('.clp__stat-label')!;
    const translated = label.querySelector(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated).not.toBeNull();
    expect(translated!.className).toContain('b3rys-translation-inline');

    // Original label text preserved, translation appended inside
    expect(label.textContent).toContain('lectures');
    expect(label.textContent).toContain('15개의 강의');
  });

  it('restores stat-item after inject → removeAll', () => {
    setupDOM(loadFixture('skilljar-course'));
    const statItem = document.querySelector('.clp__stat-item')! as HTMLElement;
    statItem.style.display = 'flex';
    statItem.parentElement!.style.display = 'flex';
    injectTranslation(statItem, '15개의 강의');
    purgeAllTranslations();

    expect(statItem.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
  });
});

// ============================================================
// Skilljar full page: curriculum + FAQ
// ============================================================

describe('Skilljar full page fixture', () => {
  beforeEach(() => {
    stubHostname('anthropic.skilljar.com');
    _resetSkipSelectorsCache();
  });

  afterEach(() => {
    _resetSkipSelectorsCache();
  });

  it('detects curriculum lesson titles', () => {
    setupDOM(loadFixture('skilljar-full'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts.some((t) => t.includes('What is Claude?'))).toBe(true);
    expect(texts.some((t) => t.includes('Other ways to work with Claude'))).toBe(true);
    expect(texts.some((t) => t.includes('Certificate of completion'))).toBe(true);
  });

  it('detects FAQ question text', () => {
    setupDOM(loadFixture('skilljar-full'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(texts.some((t) => t.includes('What is Skilljar'))).toBe(true);
    expect(texts.some((t) => t.includes('What information does Skilljar collect'))).toBe(true);
  });

  it('injects curriculum translation even without <a> tag inside LI', () => {
    setupDOM(loadFixture('skilljar-full'));
    const blocks = detectTextBlocks(document.body);
    const lessonBlock = blocks.find((b) => b.text.includes('What is Claude?'));
    expect(lessonBlock).toBeDefined();
    expect(lessonBlock!.element.tagName).toBe('LI');

    injectTranslation(lessonBlock!.element, 'Claude란 무엇인가요?');

    const translated = lessonBlock!.element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated).not.toBeNull();
    expect(translated!.textContent).toContain('Claude란');
  });

  it('injects FAQ translation below question, not beside it', () => {
    setupDOM(loadFixture('skilljar-full'));

    // Force flex display on ALL faq-labels (happy-dom doesn't compute from inline style attr)
    document.querySelectorAll('.faq-label').forEach((el) => {
      (el as HTMLElement).style.display = 'flex';
    });

    const blocks = detectTextBlocks(document.body);
    const faqBlock = blocks.find((b) => b.text.includes('What is Skilljar'));
    expect(faqBlock).toBeDefined();

    // Detected element should be the LABEL (TRANSLATABLE_TAG)
    expect(faqBlock!.element.tagName).toBe('LABEL');

    injectTranslation(faqBlock!.element, 'Skilljar란 무엇이며 왜 로그인해야 하나요?');

    // Translation should be inside faq-title (largest text child of flex label),
    // NOT as a new flex item or inside faq-icon
    const label = faqBlock!.element;
    const faqTitle = label.querySelector('.faq-title')!;
    const translated = faqTitle.querySelector(`span[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated).not.toBeNull();
    expect(translated!.textContent).toContain('Skilljar란');
    expect(translated!.className).toBe('b3rys-translation');
  });
});

// ============================================================
// GitHub Settings fixture: checkbox labels + button injection
// ============================================================

describe('GitHub Settings fixture', () => {
  it('detects checkbox label text', () => {
    setupDOM(loadFixture('github-settings'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    expect(
      texts.some((t) => t.includes('Restrict editing to users in teams with push access only')),
    ).toBe(true);
  });

  it('injects LABEL translation as block (below), not inline', () => {
    setupDOM(loadFixture('github-settings'));
    const blocks = detectTextBlocks(document.body);
    const labelBlock = blocks.find((b) => b.text.includes('Restrict editing'));

    expect(labelBlock).toBeDefined();
    expect(labelBlock!.element.tagName).toBe('LABEL');

    injectTranslation(
      labelBlock!.element,
      '푸시 액세스 권한이 있는 팀의 사용자에게만 편집을 제한하세요.',
    );

    const translated = labelBlock!.element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`);
    expect(translated).not.toBeNull();
    // Must be block class, not inline — LABEL always gets block treatment
    expect(translated!.className).toContain('b3rys-translation');
    expect(translated!.className).not.toContain('inline');
  });

  it('detects all button text (translate-everything, no [F9] filter)', () => {
    setupDOM(loadFixture('github-settings'));
    const blocks = detectTextBlocks(document.body);
    const texts = blocks.map((b) => b.text);

    // "Translate everything" — button text is now detected
    expect(texts.some((t) => t.includes('Set up templates'))).toBe(true);
    expect(texts.some((t) => t.includes('Set up sponsor button'))).toBe(true);
  });

  it('restores checkbox label after inject → removeAll', () => {
    setupDOM(loadFixture('github-settings'));
    const blocks = detectTextBlocks(document.body);
    const labelBlock = blocks.find((b) => b.text.includes('Restrict editing'));
    const originalHTML = labelBlock!.element.innerHTML;

    injectTranslation(
      labelBlock!.element,
      '푸시 액세스 권한이 있는 팀의 사용자에게만 편집을 제한하세요.',
    );
    purgeAllTranslations();

    expect(labelBlock!.element.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
    expect(labelBlock!.element.innerHTML).toBe(originalHTML);
  });
});
