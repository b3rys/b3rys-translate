import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectTextBlocks, _resetSkipSelectorsCache } from '@/entrypoints/content/text-detector';

function stubLocation(hostname: string): void {
  vi.stubGlobal('location', { hostname, pathname: '/thsottiaux/status/2082317452755751098' });
  _resetSkipSelectorsCache();
}

function renderTweet(text: string): HTMLElement {
  document.body.innerHTML = '';
  const tweet = document.createElement('div');
  const content = document.createElement('span');
  content.style.whiteSpace = 'pre-wrap';
  content.appendChild(document.createTextNode(text));
  tweet.appendChild(content);
  document.body.appendChild(tweet);
  return tweet;
}

describe('X paragraph splitting site rule', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetSkipSelectorsCache();
  });

  it.each(['x.com', 'twitter.com'])(
    'splits a long tweet into paragraph blocks on %s without selectors',
    (hostname) => {
      stubLocation(hostname);
      const tweet = renderTweet(
        'The first paragraph explains the opening idea in enough detail.\n\n' +
          'The second paragraph develops a separate point for the reader.\n\n' +
          'The final paragraph closes the argument with a clear conclusion.',
      );
      const before = tweet.textContent;

      const blocks = detectTextBlocks(document.body);

      expect(blocks.map((block) => block.text)).toEqual([
        'The first paragraph explains the opening idea in enough detail.',
        'The second paragraph develops a separate point for the reader.',
        'The final paragraph closes the argument with a clear conclusion.',
      ]);
      expect(tweet.textContent).toBe(before);
      expect(tweet.querySelectorAll('[data-b3rys-para]')).toHaveLength(3);
    },
  );

  it('leaves a single-paragraph reply DOM untouched', () => {
    stubLocation('x.com');
    const reply = renderTweet('This reply has no blank line and must remain one untouched block.');
    const originalHtml = reply.innerHTML;

    const blocks = detectTextBlocks(document.body);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].element).toBe(reply);
    expect(reply.innerHTML).toBe(originalHtml);
    expect(reply.querySelector('[data-b3rys-para]')).toBeNull();
  });

  it('reuses paragraph wrappers when X is detected again', () => {
    stubLocation('x.com');
    const tweet = renderTweet(
      'The first paragraph contains a complete English sentence.\n\n' +
        'The second paragraph also contains a complete English sentence.',
    );

    detectTextBlocks(document.body);
    const wrappers = [...tweet.querySelectorAll('[data-b3rys-para]')];
    detectTextBlocks(document.body);

    expect(tweet.querySelectorAll('[data-b3rys-para]')).toHaveLength(2);
    const reused = [...tweet.querySelectorAll('[data-b3rys-para]')];
    expect(reused[0]).toBe(wrappers[0]);
    expect(reused[1]).toBe(wrappers[1]);
    expect(tweet.querySelector('[data-b3rys-para] [data-b3rys-para]')).toBeNull();
  });

  it('does not split a Phase 1 block that contains a nested block child', () => {
    stubLocation('x.com');
    document.body.innerHTML =
      '<blockquote>Lead sentence of the pull quote goes here today. ' +
      '<p>Attribution paragraph of the quote here.</p>\n\n' +
      'Closing sentence of the pull quote goes here today.</blockquote>';
    const quote = document.querySelector('blockquote') as HTMLElement;

    const blocks = detectTextBlocks(document.body);

    expect(blocks.map((block) => block.text)).toEqual(['Attribution paragraph of the quote here.']);
    expect(quote.querySelector('[data-b3rys-para]')).toBeNull();
    expect(quote.firstElementChild?.tagName).toBe('P');
  });

  it('splits a multi-paragraph Phase 1 element', () => {
    stubLocation('x.com');
    document.body.innerHTML =
      '<p>The first semantic paragraph has enough English text.\n\n' +
      'The second semantic paragraph also has enough English text.</p>';

    const blocks = detectTextBlocks(document.body);

    expect(blocks.map((block) => block.text)).toEqual([
      'The first semantic paragraph has enough English text.',
      'The second semantic paragraph also has enough English text.',
    ]);
    expect(document.querySelectorAll('p > [data-b3rys-para]')).toHaveLength(2);
  });

  it('leaves a multi-paragraph Korean tweet DOM untouched', () => {
    stubLocation('x.com');
    const tweet = renderTweet('첫 번째 한국어 문단입니다.\n\n두 번째 한국어 문단입니다.');
    const originalHtml = tweet.innerHTML;

    const blocks = detectTextBlocks(document.body);

    expect(blocks).toHaveLength(0);
    expect(tweet.innerHTML).toBe(originalHtml);
    expect(tweet.querySelector('[data-b3rys-para], [data-b3rys-split]')).toBeNull();
  });

  it('restores the DOM when fewer than two translatable wrappers remain', () => {
    stubLocation('x.com');
    const tweet = renderTweet(
      '  const first = value;\n  if (first > limit) {\n    return limit;\n  }\n\n' +
        'The prose paragraph after the code remains available for translation.',
    );
    const originalHtml = tweet.innerHTML;

    const blocks = detectTextBlocks(document.body);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].element).toBe(tweet);
    expect(tweet.innerHTML).toBe(originalHtml);
    expect(tweet.querySelector('[data-b3rys-para], [data-b3rys-split]')).toBeNull();
  });

  it('does not split the same nested pre-wrap structure on unrelated sites', () => {
    stubLocation('example.com');
    const tweet = renderTweet(
      'The first paragraph contains a complete English sentence.\n\n' +
        'The second paragraph contains another complete English sentence.',
    );

    const blocks = detectTextBlocks(document.body);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].element).toBe(tweet);
    expect(tweet.querySelector('[data-b3rys-para]')).toBeNull();
  });
});
