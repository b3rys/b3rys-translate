import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { upstageEngine } from '@/utils/engines/upstage';
import { buildSegmentationPrompt } from '@/utils/engines/llm-helpers';
import { ENGINE_MODELS } from '@/utils/constants';

// ============================================================
// Upstage engine tests
// ============================================================

function makeOkResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(message: string, status = 401): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================
// Page mode
// ============================================================

describe('upstageEngine', () => {
  const apiKey = 'test-upstage-key';

  it('translates page text and parses numbered response', async () => {
    const paragraphs = [
      { id: 'p1', text: 'Hello world' },
      { id: 'p2', text: 'Goodbye world' },
    ];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        choices: [{ message: { content: '[1] 안녕하세요 세계\n[2] 안녕히 가세요 세계' } }],
        usage: { prompt_tokens: 150, completion_tokens: 30 },
      }),
    );

    vi.stubGlobal('fetch', mockFetch);

    const result = await upstageEngine.translate(apiKey, paragraphs, 'page');

    expect(result.translations).toEqual([
      { id: 'p1', translatedText: '안녕하세요 세계' },
      { id: 'p2', translatedText: '안녕히 가세요 세계' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 30 });

    // Verify correct API call
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      }),
    );
  });

  it('throws when API returns an error', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];
    const mockFetch = vi.fn().mockResolvedValue(makeErrorResponse('Invalid API key'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(upstageEngine.translate(apiKey, paragraphs, 'page')).rejects.toThrow(
      'Upstage API error: Invalid API key',
    );
  });

  it('throws when response has no content', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({ choices: [{ message: { content: '' } }] }));
    vi.stubGlobal('fetch', mockFetch);

    await expect(upstageEngine.translate(apiKey, paragraphs, 'page')).rejects.toThrow(
      'Empty response from Upstage API',
    );
  });

  it('throws when choices array is missing', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({}));
    vi.stubGlobal('fetch', mockFetch);

    await expect(upstageEngine.translate(apiKey, paragraphs, 'page')).rejects.toThrow(
      'Empty response from Upstage API',
    );
  });

  it('includes the correct model in the request body', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello world' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요 세계' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'page');

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    expect(body.model).toBe(ENGINE_MODELS.upstage);
  });

  it('sets temperature to 0.1', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'page');

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    expect(body.temperature).toBe(0.1);
  });

  it('sends Bearer token in Authorization header', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'page');

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBe(`Bearer ${apiKey}`);
  });

  it('returns usage data when present in response', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        choices: [{ message: { content: '[1] 안녕하세요' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await upstageEngine.translate(apiKey, paragraphs, 'page');

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('returns undefined usage when absent from response', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await upstageEngine.translate(apiKey, paragraphs, 'page');

    expect(result.usage).toBeUndefined();
  });

  it('includes translated text in the prompt for page mode', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello world' }, { id: 'p2', text: 'Goodbye' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요\n[2] 안녕' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'page');

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    const content = body.messages[0].content as string;
    expect(content).toContain('[1] Hello world');
    expect(content).toContain('[2] Goodbye');
  });

  it('includes the segmentation prompt for segment mode', async () => {
    const paragraphs = [{ id: 's1', text: 'hello there' }, { id: 's2', text: 'how are you' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: 'Hello there. How are you?' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'segment');

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    const content = body.messages[0].content as string;
    const expectedPrompt = buildSegmentationPrompt(paragraphs);
    expect(content).toBe(expectedPrompt);
  });

  it('retries on 429 rate limit then succeeds', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];
    const rate429 = new Response('rate limited', { status: 429, headers: { 'Content-Type': 'application/json' } });
    const ok200 = makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요' } }] });

    const mockFetch = vi.fn().mockResolvedValueOnce(rate429).mockResolvedValueOnce(ok200);
    vi.stubGlobal('fetch', mockFetch);

    // Stub Math.random to 0 so retry delays are near-zero
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      const result = await upstageEngine.translate(apiKey, paragraphs, 'page');
      expect(result.translations).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      Math.random = origRandom;
    }
  });

  it('retries on 500 server error then succeeds', async () => {
    const paragraphs = [{ id: 'p1', text: 'Hello' }];
    const err500 = new Response('server error', { status: 500, headers: { 'Content-Type': 'application/json' } });
    const ok200 = makeOkResponse({ choices: [{ message: { content: '[1] 안녕하세요' } }] });

    const mockFetch = vi.fn().mockResolvedValueOnce(err500).mockResolvedValueOnce(ok200);
    vi.stubGlobal('fetch', mockFetch);

    // Stub Math.random to 0 so retry delays are near-zero
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      const result = await upstageEngine.translate(apiKey, paragraphs, 'page');
      expect(result.translations).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      Math.random = origRandom;
    }
  });
});

// ============================================================
// Word mode
// ============================================================

describe('upstageEngine - word mode', () => {
  const apiKey = 'test-upstage-key';

  it('translates words and returns detailed output', async () => {
    const paragraphs = [{ id: 'w1', text: 'algorithm' }];
    const lang = { targetLang: 'ko' as const };

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        choices: [
          {
            message: {
              content:
                '[1] 알고리즘\n=\nA step-by-step procedure\n~\nComparable, Efficient\n• The algorithm processes data quickly.\n→ 알고리즘이 데이터를 빠르게 처리합니다.\n• This algorithm is efficient.\n→ 이 알고리즘은 효율적입니다.',
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await upstageEngine.translate(apiKey, paragraphs, 'word', undefined, lang);

    expect(result.translations).toHaveLength(1);
    expect(result.translations[0].translatedText).toContain('알고리즘');
  });
});

// ============================================================
// Subtitle mode
// ============================================================

describe('upstageEngine - subtitle mode', () => {
  const apiKey = 'test-upstage-key';

  it('translates subtitles with context', async () => {
    const paragraphs = [{ id: 's1', text: 'Hello everyone' }];
    const context = [{ original: 'Welcome', translated: '환영합니다' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 여러분 안녕하세요' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await upstageEngine.translate(apiKey, paragraphs, 'subtitle', context);

    expect(result.translations).toHaveLength(1);
    expect(result.translations[0].translatedText).toBe('여러분 안녕하세요');
  });

  it('omits context section when not provided', async () => {
    const paragraphs = [{ id: 's1', text: 'Hello everyone' }];

    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ choices: [{ message: { content: '[1] 여러분 안녕하세요' } }] }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await upstageEngine.translate(apiKey, paragraphs, 'subtitle', undefined);

    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body as string);
    expect(body.messages[0].content).not.toContain('Previous subtitles');
  });
});
