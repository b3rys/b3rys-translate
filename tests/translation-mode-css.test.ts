import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const translatorCss = readFileSync(
  resolve(__dirname, '../entrypoints/content/translator.css'),
  'utf-8',
);

beforeEach(() => {
  const siteStyle = document.createElement('style');
  siteStyle.dataset.testId = 'site-css';
  siteStyle.textContent = '.site-original { display: flex; }';
  document.head.appendChild(siteStyle);

  const style = document.createElement('style');
  style.dataset.testId = 'translator-css';
  style.textContent = translatorCss;
  document.head.appendChild(style);

  document.body.className = '';
  document.body.innerHTML =
    '<p data-b3rys-original class="site-original">Original text.</p>' +
    '<p data-b3rys-translated class="b3rys-translation">번역문입니다.</p>';
});

afterEach(() => {
  document.querySelectorAll('style[data-test-id]').forEach((style) => style.remove());
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('translation mode CSS visibility', () => {
  it('preserves the site display value when translations are hidden in replace mode', () => {
    document.body.className = 'b3rys-replace-mode b3rys-hiding-translations';

    const original = document.querySelector<HTMLElement>('[data-b3rys-original]')!;
    const translation = document.querySelector<HTMLElement>('[data-b3rys-translated]')!;

    expect(getComputedStyle(original).display).toBe('flex');
    expect(getComputedStyle(translation).display).toBe('none');
  });

  it('hides originals when translations are visible in replace mode', () => {
    document.body.className = 'b3rys-replace-mode';

    const original = document.querySelector<HTMLElement>('[data-b3rys-original]')!;
    const translation = document.querySelector<HTMLElement>('[data-b3rys-translated]')!;

    expect(getComputedStyle(original).display).toBe('none');
    expect(getComputedStyle(translation).display).not.toBe('none');
  });
});
