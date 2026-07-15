import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildTranslationPrompt,
  buildWordTranslationPrompt,
  buildSubtitleTranslationPrompt,
  buildSegmentationPrompt,
  parseTranslationResponse,
  callWithRetry,
} from '@/utils/engines/llm-helpers';

describe('buildTranslationPrompt', () => {
  it('formats paragraphs with numbered markers', () => {
    const result = buildTranslationPrompt([
      { id: 'a', text: 'Hello world' },
      { id: 'b', text: 'Goodbye world' },
    ]);
    expect(result).toContain('[1] Hello world');
    expect(result).toContain('[2] Goodbye world');
    expect(result).toContain('into Korean');
  });

  it('preserves HTML tags in text', () => {
    const result = buildTranslationPrompt([
      { id: 'a', text: 'Click <a href="https://x.com">here</a> for more' },
    ]);
    expect(result).toContain('<a href="https://x.com">here</a>');
  });

  it('handles empty array', () => {
    const result = buildTranslationPrompt([]);
    expect(result).toContain('into Korean');
    // Should not crash
  });
});

describe('buildWordTranslationPrompt', () => {
  it('formats word entries with numbered markers', () => {
    const result = buildWordTranslationPrompt([{ id: 'w1', text: 'algorithm' }]);
    expect(result).toContain('[1] algorithm');
    expect(result).toContain('example sentences');
  });
});

describe('buildSubtitleTranslationPrompt', () => {
  it('includes context section when provided', () => {
    const result = buildSubtitleTranslationPrompt(
      [{ id: 's1', text: 'Hello everyone' }],
      [{ original: 'Welcome', translated: '환영합니다' }],
    );
    expect(result).toContain('Original: Welcome → KO: 환영합니다');
    expect(result).toContain('[1] Hello everyone');
  });

  it('omits context section when not provided', () => {
    const result = buildSubtitleTranslationPrompt([{ id: 's1', text: 'Hello everyone' }]);
    expect(result).not.toContain('Previous subtitles');
  });
});

describe('buildSegmentationPrompt', () => {
  it('joins all paragraph texts into single text', () => {
    const result = buildSegmentationPrompt([
      { id: '1', text: 'hello there' },
      { id: '2', text: 'how are you' },
    ]);
    expect(result).toContain('hello there how are you');
    expect(result).toContain('punctuation');
  });
});

describe('parseTranslationResponse', () => {
  const paras = [
    { id: 'p1', text: 'Hello' },
    { id: 'p2', text: 'World' },
    { id: 'p3', text: 'Test' },
  ];

  it('parses numbered response correctly', () => {
    const response = '[1] 안녕하세요\n[2] 세계\n[3] 테스트';
    const result = parseTranslationResponse(response, paras);
    expect(result).toEqual([
      { id: 'p1', translatedText: '안녕하세요' },
      { id: 'p2', translatedText: '세계' },
      { id: 'p3', translatedText: '테스트' },
    ]);
  });

  it('handles multi-line translations', () => {
    const response = '[1] 첫째줄\n두번째줄\n[2] 세계';
    const result = parseTranslationResponse(response, paras);
    expect(result[0].translatedText).toBe('첫째줄\n두번째줄');
    expect(result[1].translatedText).toBe('세계');
  });

  it('skips out-of-range indices', () => {
    const response = '[1] 안녕\n[5] 범위 밖';
    const result = parseTranslationResponse(response, paras);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('returns empty array for malformed response', () => {
    const result = parseTranslationResponse('no markers here', paras);
    expect(result).toEqual([]);
  });
});

describe('callWithRetry', () => {
  // Use real timers with small delayBase to avoid fake-timer / async-rejection conflicts.
  // Math.random adds up to 500ms jitter, so we stub it to 0 for deterministic delays.
  let origRandom: () => number;

  beforeEach(() => {
    origRandom = Math.random;
    Math.random = () => 0;
  });

  afterEach(() => {
    Math.random = origRandom;
  });

  it('returns response on first success', async () => {
    const response = new Response('ok', { status: 200 });
    const fn = vi.fn().mockResolvedValue(response);
    const result = await callWithRetry(fn, 3, 1);
    expect(result).toBe(response);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const rate429 = new Response('rate limited', { status: 429 });
    const ok200 = new Response('ok', { status: 200 });
    const fn = vi.fn().mockResolvedValueOnce(rate429).mockResolvedValueOnce(ok200);

    const result = await callWithRetry(fn, 3, 1);
    expect(result).toBe(ok200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 server error', async () => {
    const err500 = new Response('error', { status: 500 });
    const ok200 = new Response('ok', { status: 200 });
    const fn = vi.fn().mockResolvedValueOnce(err500).mockResolvedValueOnce(ok200);

    const result = await callWithRetry(fn, 3, 1);
    expect(result).toBe(ok200);
  });

  it('throws after max retries on network error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    await expect(callWithRetry(fn, 2, 1)).rejects.toThrow('Network error');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
