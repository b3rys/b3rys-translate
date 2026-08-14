import { afterEach, describe, expect, it, vi } from 'vitest';
import { upstageEngine } from '@/utils/engines/upstage';
import { getEngine } from '@/utils/engines';
import { calculateModelCost, DEFAULT_MODEL_IDS, getModelsForEngine } from '@/utils/models';
import { ENGINE_ENDPOINTS } from '@/utils/constants';

/**
 * 이 테스트는 전부 fetch 를 mock 한다 — 실제 Upstage API 를 호출하지 않는다.
 * (외부 PR #14 를 참고해 우리 구조로 새로 구현한 엔진이다. 그 PR 의 코드나
 *  테스트는 실행하지 않았다.)
 */
function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 엔진이 파싱하는 실제 형식은 `[1] 번역문` 번호 표기다 (llm-helpers). */
function translationBody(translated = '번역된 문장') {
  return {
    choices: [{ message: { content: `[1] ${translated}` } }],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  };
}

function stubFetch(body: unknown) {
  const mock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => okResponse(body));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function sentBody(mock: ReturnType<typeof stubFetch>) {
  return JSON.parse(mock.mock.calls[0]![1]!.body as string);
}

describe('Upstage Solar engine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the key as a Bearer header and nowhere else', async () => {
    const mock = stubFetch(translationBody());

    await upstageEngine.translate('secret-key', [{ id: 'p1', text: 'Hello.' }], 'page');

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe(ENGINE_ENDPOINTS.upstage);
    expect(String(url).startsWith('https://api.upstage.ai/')).toBe(true);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    // 키가 본문에 섞여 나가면 안 된다 — 외부 기여 코드를 참고한 엔진이라 특히 고정해둔다.
    expect(init!.body as string).not.toContain('secret-key');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('does not send reasoning_effort — Upstage documents that solar-mini ignores it', async () => {
    const mock = stubFetch(translationBody());

    await upstageEngine.translate('k', [{ id: 'p1', text: 'Hello.' }], 'page');

    const body = sentBody(mock);
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.temperature).toBe(0.1);
    expect(body.model).toBe('solar-mini');
  });

  it.each([['page' as const], ['word' as const], ['sentence' as const], ['subtitle' as const]])(
    'parses a %s translation into per-paragraph results',
    async (mode) => {
      const mock = stubFetch(translationBody('안녕하세요'));

      const result = await upstageEngine.translate('k', [{ id: 'p1', text: 'Hello.' }], mode);

      expect(result.translations).toEqual([{ id: 'p1', translatedText: '안녕하세요' }]);
      expect(sentBody(mock).messages[0].content).toContain('Hello.');
      if (mode === 'sentence') {
        expect(sentBody(mock).messages[0].content).toContain(
          '※ difficult word | short Korean meaning',
        );
      }
    },
  );

  it('returns segment mode output raw instead of per-paragraph', async () => {
    stubFetch({
      choices: [{ message: { content: '  A sentence. Another one.  ' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });

    const result = await upstageEngine.translate('k', [{ id: 'p1', text: 'x' }], 'segment');

    expect(result.translations).toEqual([
      { id: '__raw__', translatedText: 'A sentence. Another one.' },
    ]);
  });

  it('reports token usage so the cost gauge can count it', async () => {
    stubFetch(translationBody());

    const result = await upstageEngine.translate('k', [{ id: 'p1', text: 'Hello.' }], 'page');

    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
  });

  it('omits usage when the response has none rather than reporting zeros', async () => {
    stubFetch({ choices: [{ message: { content: '[1] 번역' } }] });

    const result = await upstageEngine.translate('k', [{ id: 'p1', text: 'Hello.' }], 'page');

    // 0 으로 채우면 "무료로 번역됐다"는 잘못된 비용 표시가 된다.
    expect(result.usage).toBeUndefined();
  });

  it('surfaces an API error message instead of an empty translation', async () => {
    stubFetch({ error: { message: 'invalid api key' } });

    await expect(
      upstageEngine.translate('bad', [{ id: 'p1', text: 'Hello.' }], 'page'),
    ).rejects.toThrow(/invalid api key/);
  });

  it('throws on an empty completion rather than wiping the paragraph', async () => {
    stubFetch({ choices: [{ message: { content: '' } }] });

    await expect(
      upstageEngine.translate('k', [{ id: 'p1', text: 'Hello.' }], 'page'),
    ).rejects.toThrow(/Empty response/);
  });

  it('honours an explicitly selected model id', async () => {
    const mock = stubFetch(translationBody());

    await upstageEngine.translate(
      'k',
      [{ id: 'p1', text: 'Hello.' }],
      'page',
      undefined,
      { sourceLang: 'en', targetLang: 'ko' },
      'solar-mini',
    );

    expect(sentBody(mock).model).toBe('solar-mini');
  });
});

describe('Upstage catalog wiring', () => {
  it('is reachable through the engine registry', () => {
    expect(getEngine('upstage')).toBe(upstageEngine);
  });

  it('offers exactly one Upstage model and defaults to it', () => {
    const models = getModelsForEngine('upstage');
    expect(models.map((m) => m.id)).toEqual(['solar-mini']);
    expect(DEFAULT_MODEL_IDS.upstage).toBe('solar-mini');
  });

  it('prices Solar Mini below every other model we offer', () => {
    // 채택 근거가 "제일 싸다" 이므로 그 전제를 고정해둔다. 다른 모델이 더 싸지면
    // 이 테스트가 깨지고, 그때 다시 판단하면 된다.
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const solar = calculateModelCost('solar-mini', usage);
    const others = (
      ['gemini-3.1-flash-lite', 'gpt-5.4-nano', 'claude-haiku-4-5-20251001'] as const
    ).map((id) => calculateModelCost(id, usage));

    expect(others.every((cost) => cost > solar)).toBe(true);
  });
});
