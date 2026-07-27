import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiEngine } from '@/utils/engines/openai';
import { geminiEngine } from '@/utils/engines/gemini';
import { anthropicEngine } from '@/utils/engines/anthropic';

function okOpenAIResponse() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ id: 'p1', text: '번역' }]) } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('model-aware engine requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes GPT-5.6 Luna with reasoning disabled and no temperature override', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      okOpenAIResponse(),
    );
    vi.stubGlobal('fetch', fetchMock);

    await openaiEngine.translate(
      'key',
      [{ id: 'p1', text: 'Translate this paragraph.' }],
      'page',
      undefined,
      { sourceLang: 'en', targetLang: 'ko' },
      'gpt-5.6-luna',
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.reasoning_effort).toBe('none');
    expect(body).not.toHaveProperty('temperature');
  });

  it('routes Gemini 3.1 Flash Lite through its model endpoint without deprecated temperature', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify([{ id: 'p1', text: '번역' }]) }] } },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await geminiEngine.translate(
      'key',
      [{ id: 'p1', text: 'Translate this paragraph.' }],
      'page',
      undefined,
      { sourceLang: 'en', targetLang: 'ko' },
      'gemini-3.1-flash-lite',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/models/gemini-3.1-flash-lite:generateContent');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig).not.toHaveProperty('temperature');
  });

  it('routes Claude Sonnet 4.6 through the existing Messages API contract', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify([{ id: 'p1', text: '번역' }]) }],
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await anthropicEngine.translate(
      'key',
      [{ id: 'p1', text: 'Translate this paragraph.' }],
      'page',
      undefined,
      { sourceLang: 'en', targetLang: 'ko' },
      'claude-sonnet-4-6',
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
  });
});
