import { describe, expect, it } from 'vitest';
import { assertUsable, extractText, type AnthropicResponse } from '@/utils/engines/anthropic';

/**
 * Regression: the engine used to read `data.content[0].text`.
 *
 * `content` is an array of *typed blocks* and text is not guaranteed to be
 * first. Any response that leads with a non-text block made `.text` undefined,
 * which the caller reported as "Empty response from Anthropic API" — a message
 * that points at the network layer instead of the real cause.
 */
describe('extractText', () => {
  it('reads the text block when it is first (the normal case)', () => {
    const data: AnthropicResponse = { content: [{ type: 'text', text: '안녕하세요' }] };
    expect(extractText(data)).toBe('안녕하세요');
  });

  it('★ finds the text block even when another block comes first', () => {
    // A thinking-capable model leads with a `thinking` block, which has no
    // `text` field. Positional access returned undefined here.
    const data: AnthropicResponse = {
      content: [{ type: 'thinking' }, { type: 'text', text: '안녕하세요' }],
    };
    expect(extractText(data)).toBe('안녕하세요');
  });

  it('returns undefined when there is genuinely no text block', () => {
    expect(extractText({ content: [{ type: 'thinking' }] })).toBeUndefined();
    expect(extractText({ content: [] })).toBeUndefined();
    expect(extractText({})).toBeUndefined();
  });
});

describe('assertUsable', () => {
  it('passes a normal response through', () => {
    expect(() => assertUsable({ content: [{ type: 'text', text: 'ok' }] })).not.toThrow();
  });

  it('surfaces an API error with its own message', () => {
    expect(() =>
      assertUsable({ error: { type: 'invalid_request_error', message: 'bad key' } }),
    ).toThrow(/bad key/);
  });

  it('names a refusal instead of letting it read as an empty response', () => {
    // stop_reason: "refusal" arrives as HTTP 200 with empty or partial content.
    expect(() => assertUsable({ stop_reason: 'refusal', content: [] })).toThrow(/declined/i);
  });
});
