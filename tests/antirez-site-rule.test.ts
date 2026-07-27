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

  it('splits the article PRE into one block per paragraph', () => {
    // 한 문단 아래에 그 문단의 번역이 오는 게 제품 기본 동작이다. 이 <pre> 를
    // 통째로 한 블록으로 잡으면 영문 전체 뒤에 국문 전체가 붙어버린다.
    const texts = detectFixture('antirez.com', '/news/169');
    const prose = texts.filter((text) => text.includes('.') && !text.startsWith('Control'));

    expect(prose).toHaveLength(3);
    expect(prose[0]).toContain('Look at the past history of this blog');
    expect(prose[1]).toContain('controlling the idea');
    expect(prose[2]).toContain('Focus on quality');
    // 어느 블록도 다른 블록의 본문을 삼키지 않는다 — 통짜 블록이면 여기서 걸린다.
    expect(prose[0]).not.toContain('Focus on quality');
  });

  it('leaves the visible text of the PRE unchanged when splitting', () => {
    stubLocation('antirez.com', '/news/169');
    _resetSkipSelectorsCache();
    document.body.innerHTML = fixture;
    const pre = document.querySelector('topcomment article.comment > pre') as HTMLElement;
    const before = pre.textContent;

    detectTextBlocks(document.body);

    // 문단 wrapper 는 inline span 이라 화면에 보이는 글자는 한 글자도 달라지지 않아야 한다.
    expect(pre.textContent).toBe(before);
  });

  it('reuses the same wrappers when detection runs again', () => {
    // 관찰자(observer)가 재감지를 돌릴 때마다 다시 쪼개면 span 이 중첩된다.
    stubLocation('antirez.com', '/news/169');
    _resetSkipSelectorsCache();
    document.body.innerHTML = fixture;

    detectTextBlocks(document.body);
    const first = document.querySelectorAll('[data-b3rys-para]').length;
    detectTextBlocks(document.body);

    expect(document.querySelectorAll('[data-b3rys-para]').length).toBe(first);
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
