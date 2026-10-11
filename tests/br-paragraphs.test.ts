import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectTextBlocks, _resetSkipSelectorsCache } from '@/entrypoints/content/text-detector';
import {
  injectTranslation,
  purgeAllTranslations,
  removeAllTranslations,
  setTranslationMode,
  translatePage,
  cancelTranslation,
} from '@/entrypoints/content/translator';
import { DATA_ATTRS } from '@/utils/constants';
import { loadFixture } from './helpers/test-utils';

const translated = `[${DATA_ATTRS.TRANSLATED}]`;
const original = `[${DATA_ATTRS.ORIGINAL}]`;
const expectedHTML = [
  'You may see this message when trying to sign in.',
  'Your account may have been deleted or deactivated.',
  '<b>Deleted account:</b> Deleted accounts cannot be restored.',
  'You can read our <a href="https://help.openai.com/example">account guide</a> for details.',
  '<b>Deactivated account:</b> Please contact support for assistance.',
  'For more information, visit the help center.',
];
let style: HTMLStyleElement;
beforeEach(() => {
  document.body.innerHTML = loadFixture('intercom-br-paragraphs');
  document.body.className = '';
  _resetSkipSelectorsCache();
  style = document.createElement('style');
  style.textContent = readFileSync(
    resolve(__dirname, '../entrypoints/content/translator.css'),
    'utf8',
  );
  document.head.append(style);
});
afterEach(() => {
  cancelTranslation();
  purgeAllTranslations();
  style.remove();
  vi.unstubAllGlobals();
});
function injectAll() {
  const blocks = detectTextBlocks();
  blocks.forEach((b, i) => injectTranslation(b.element, `번역 ${i}`, b.segment));
  return blocks;
}
function assertPlacement() {
  const p = document.querySelector('p')!;
  const spans = [...p.querySelectorAll(translated)];
  expect(spans).toHaveLength(6);
  spans.forEach((span, i) => {
    expect(span.parentNode).toBe(p);
    expect(span.textContent).toBe(`번역 ${i}`);
    expect(span.nextSibling?.nodeName ?? null).toBe(i === 5 ? null : 'BR');
    expect(getComputedStyle(span).display).toBe('block');
  });
}

describe('BR-delimited paragraphs', () => {
  it('reproduces the reported childNodes and sends one HTML payload per paragraph without moving originals', () => {
    const p = document.querySelector('p')!;
    const nodes = [...p.childNodes];
    expect(nodes.map((n) => n.nodeName)).toEqual([
      '#text',
      'BR',
      'BR',
      '#text',
      'BR',
      'BR',
      'BR',
      'B',
      '#text',
      'BR',
      'BR',
      '#text',
      'A',
      '#text',
      'BR',
      'BR',
      'BR',
      'B',
      '#text',
      'BR',
      'BR',
      '#text',
    ]);
    const blocks = detectTextBlocks();
    expect(blocks.map((b) => b.html)).toEqual(expectedHTML);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(6);
    expect(blocks.every((b) => b.element === p)).toBe(true);
    expect([...p.childNodes]).toEqual(nodes);
    expect(detectTextBlocks()).toEqual([]);
  });

  it('inserts each translation before its boundary, preserves node identity, and only replaces its own translation', () => {
    const p = document.querySelector('p')!;
    const nodes = [...p.childNodes];
    const blocks = injectAll();
    assertPlacement();
    expect(
      [...p.childNodes].filter((n) => !(n instanceof Element && n.matches(translated))),
    ).toEqual(nodes);
    injectTranslation(p, '새 번역', blocks[2].segment);
    expect(p.querySelectorAll(translated)).toHaveLength(6);
    expect([...p.querySelectorAll(translated)].map((n) => n.textContent)).toEqual([
      '번역 0',
      '번역 1',
      '새 번역',
      '번역 3',
      '번역 4',
      '번역 5',
    ]);
  });

  it('replace → parallel → off → purge restores original markup and original nodes', () => {
    const p = document.querySelector('p')!;
    const html = p.outerHTML;
    const nodes = [...p.childNodes];
    injectAll();
    setTranslationMode('replace');
    expect(
      [...p.querySelectorAll(original)].every((n) => getComputedStyle(n).display === 'none'),
    ).toBe(true);
    expect([...p.childNodes].every((n) => n.nodeType !== Node.TEXT_NODE)).toBe(true);
    assertPlacement();
    setTranslationMode('parallel');
    expect(
      [...p.childNodes].filter((n) => !(n instanceof Element && n.matches(translated))),
    ).toEqual(nodes);
    removeAllTranslations();
    expect(
      [...p.querySelectorAll(translated)].every((n) => getComputedStyle(n).display === 'none'),
    ).toBe(true);
    purgeAllTranslations();
    expect(p.outerHTML).toBe(html);
    expect([...p.childNodes]).toEqual(nodes);
    expect(detectTextBlocks()).toHaveLength(6);
  });

  it('purges directly from replace mode without losing inline elements or text nodes', () => {
    const p = document.querySelector('p')!;
    const html = p.outerHTML;
    const nodes = [...p.childNodes];
    injectAll();
    setTranslationMode('replace');
    purgeAllTranslations();
    expect(p.outerHTML).toBe(html);
    expect([...p.childNodes]).toEqual(nodes);
  });

  it.each(['network', 'cache', 'mixed'] as const)(
    'uses segmented payloads and placements through the %s pipeline',
    async (path) => {
      const sendMessage = vi.fn(
        async (message: { type: string; paragraphs: { id: string; text: string }[] }) => {
          const items = message.paragraphs ?? [];
          const hits =
            message.type === 'CACHE_LOOKUP'
              ? items.filter((_, i) => path === 'cache' || (path === 'mixed' && i % 2 === 0))
              : items;
          return {
            translations: hits.map((b) => ({
              id: b.id,
              translatedText: `번역 ${expectedHTML.indexOf(b.text)}`,
            })),
          };
        },
      );
      vi.stubGlobal('chrome', {
        runtime: { sendMessage },
        storage: { local: { get: async () => ({}) } },
      });
      expect(await translatePage()).toBe('done');
      expect(sendMessage.mock.calls[0][0].paragraphs.map((b) => b.text)).toEqual(expectedHTML);
      const batches = sendMessage.mock.calls.filter(([m]) => m.type === 'TRANSLATE_BATCH');
      expect(batches.flatMap(([m]) => m.paragraphs)).toHaveLength(
        path === 'network' ? 6 : path === 'mixed' ? 3 : 0,
      );
      assertPlacement();
      expect(await translatePage()).toBe('empty');
      removeAllTranslations();
      expect(await translatePage()).toBe('empty');
      assertPlacement();
    },
  );

  it('does not split ordinary paragraphs or single BR line breaks', () => {
    document.body.innerHTML = '<p>First paragraph.</p><p>Second<br>line stays together.</p>';
    const blocks = injectAll();
    expect(blocks.map((b) => b.html)).toEqual([
      'First paragraph.',
      'Second<br>line stays together.',
    ]);
    expect(blocks.every((b) => b.segment === undefined)).toBe(true);
    document
      .querySelectorAll('p')
      .forEach((p) => expect(p.lastElementChild?.matches(translated)).toBe(true));
  });

  it('handles whitespace between BRs without splitting single BRs', () => {
    document.body.innerHTML =
      '<p>First line<br>still first.<br> \n<!-- gap --><br><br>Second paragraph.</p>';
    expect(detectTextBlocks().map((b) => b.html)).toEqual([
      'First line<br>still first.',
      'Second paragraph.',
    ]);
  });

  it('does not create empty segments from leading or trailing separators', () => {
    document.body.innerHTML = '<p><br><br>First paragraph.<br><br>Second paragraph.<br><br></p>';
    expect(detectTextBlocks().map((b) => b.html)).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
  });

  it('handles inline-only DIV hosts while leaving nested semantic blocks separate', () => {
    document.body.innerHTML =
      '<div>First paragraph.<br><br><b>Second</b> paragraph.</div><blockquote><p>Third paragraph.</p><p>Fourth paragraph.</p></blockquote>';
    const blocks = detectTextBlocks();
    expect(blocks.filter((b) => b.segment).map((b) => b.html)).toEqual([
      'First paragraph.',
      '<b>Second</b> paragraph.',
    ]);
    expect(blocks.filter((b) => !b.segment).map((b) => b.text)).toEqual([
      'Third paragraph.',
      'Fourth paragraph.',
    ]);
  });
});
