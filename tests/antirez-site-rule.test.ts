import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { detectTextBlocks, _resetSkipSelectorsCache } from '@/entrypoints/content/text-detector';
import { injectTranslation, purgeAllTranslations } from '@/entrypoints/content/translator';
import { DATA_ATTRS } from '@/utils/constants';

const fixture = readFileSync(resolve(__dirname, 'fixtures', 'antirez-article.html'), 'utf-8');

function stubLocation(hostname: string, pathname = '/'): void {
  vi.stubGlobal('location', { hostname, pathname });
}

function detectFixture(hostname: string, pathname = '/'): string[] {
  stubLocation(hostname, pathname);
  _resetSkipSelectorsCache();
  document.body.innerHTML = fixture;
  return detectTextBlocks(document.body).map((block) => block.text);
}

describe('antirez preformatted prose rule', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetSkipSelectorsCache();
  });

  it('detects the article title and prose body on antirez.com only', () => {
    const texts = detectFixture('antirez.com', '/news/169');

    expect(texts).toContain('Control the ideas, not the code');
    expect(texts.some((text) => text.includes('Look at the past history of this blog'))).toBe(true);
    expect(texts.some((text) => text.includes('sourceCode'))).toBe(false);
  });

  it('continues to skip the same preformatted prose on unrelated sites', () => {
    const texts = detectFixture('example.com');

    expect(texts).toContain('Control the ideas, not the code');
    expect(texts.some((text) => text.includes('Look at the past history of this blog'))).toBe(
      false,
    );
    expect(texts.some((text) => text.includes('sourceCode'))).toBe(false);
  });

  it('does not opt the antirez homepage into bulk PRE translation', () => {
    const texts = detectFixture('antirez.com', '/');

    expect(texts.some((text) => text.includes('Look at the past history of this blog'))).toBe(
      false,
    );
  });

  it('skips the article PRE if the selected structure contains code', () => {
    stubLocation('antirez.com', '/news/169');
    _resetSkipSelectorsCache();
    document.body.innerHTML = fixture;
    const pre = document.querySelector('topcomment article.comment > pre') as HTMLElement;
    pre.appendChild(document.createElement('code')).textContent = 'const unsafe = true;';

    const texts = detectTextBlocks(document.body).map((block) => block.text);

    expect(texts.some((text) => text.includes('Look at the past history of this blog'))).toBe(
      false,
    );
    expect(texts.some((text) => text.includes('unsafe'))).toBe(false);
  });

  it('preserves paragraph line breaks in the injected antirez translation', () => {
    stubLocation('antirez.com', '/news/169');
    _resetSkipSelectorsCache();
    document.body.innerHTML = fixture;
    const pre = document.querySelector('topcomment article.comment > pre') as HTMLElement;
    pre.style.whiteSpace = 'pre';

    injectTranslation(pre, '첫 번째 문단입니다.\n\n두 번째 문단입니다.');

    const translated = pre.querySelector(`[${DATA_ATTRS.TRANSLATED}]`) as HTMLElement;
    expect(translated).not.toBeNull();
    expect(translated.style.whiteSpace).toBe('pre-wrap');
  });

  it('restores the prose PRE exactly after translation purge', () => {
    stubLocation('antirez.com', '/news/169');
    _resetSkipSelectorsCache();
    document.body.innerHTML = fixture;
    const pre = document.querySelector('topcomment article.comment > pre') as HTMLElement;
    const originalHtml = pre.innerHTML;

    injectTranslation(pre, '번역된 본문입니다.');
    purgeAllTranslations();

    expect(pre.innerHTML).toBe(originalHtml);
    expect(pre.querySelector(`[${DATA_ATTRS.TRANSLATED}]`)).toBeNull();
  });
});
