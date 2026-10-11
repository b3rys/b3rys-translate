import { loadModelCatalog } from '@/utils/model-catalog';
import bundled from '@/config/models.json';
import type { EngineType } from '@/utils/engines/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicEngine } from '@/utils/engines/anthropic';
import { geminiEngine } from '@/utils/engines/gemini';
import { openaiEngine } from '@/utils/engines/openai';
import { upstageEngine } from '@/utils/engines/upstage';
import {
  calculateModelCost,
  DEFAULT_MODEL_IDS,
  getModelConfig,
  MODEL_CATALOG,
  MODEL_MIGRATIONS,
  resolveSelectedModel,
} from '@/utils/models';
import { getSettings, migrateStorage } from '@/utils/storage';
import { setupChromeMock } from './helpers/chrome-mock';

function mockResponse(data: unknown) {
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function bodyOf(mock: ReturnType<typeof mockResponse>) {
  return JSON.parse(mock.mock.calls[0][1]!.body as string);
}
const paragraphs = [{ id: 'p1', text: 'Hello.' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('0.5.37 model refresh', () => {
  it('ships exactly four default models and removes all replaced choices', () => {
    expect(DEFAULT_MODEL_IDS).toEqual({
      gemini: 'gemini-3.1-flash-lite',
      openai: 'gpt-6-luna',
      anthropic: 'claude-haiku-5-5',
      upstage: 'solar-mini4',
    });
    expect(MODEL_CATALOG.map((m) => m.id)).not.toContain('solar-mini');
    expect(getModelConfig('gpt-6-luna').pricing).toEqual({ input: 0.1, output: 0.5 });
    expect(getModelConfig('claude-haiku-5-5').pricing).toEqual({ input: 0.1, output: 0.5 });
    expect(getModelConfig('gemini-3.1-flash-lite').note).toBe(
      '추론 완전 off 불가, minimal 예외 허용(팀장 승인 10/11)',
    );
  });

  const migrations: [EngineType, string, string][] = [
    ['openai', 'gpt-5.4-nano', 'gpt-6-luna'],
    ['openai', 'gpt-5.6-luna', 'gpt-6-luna'],
    ['anthropic', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5'],
    ['upstage', 'solar-mini', 'solar-mini4'],
  ];

  it.each(migrations)(
    'persists %s selection %s as %s and keeps it on a second save',
    async (engine, from, to) => {
      const mock = setupChromeMock({
        localStorage: { selectedEngine: engine, selectedModels: { [engine]: from } },
      });
      expect((await getSettings()).selectedModels[engine]).toBe(to);
      await migrateStorage();
      const persisted = mock.local._data.get('selectedModels') as Record<string, string>;
      expect(persisted[engine]).toBe(to);
      await chrome.storage.local.set({ selectedModels: { ...persisted } });
      await migrateStorage();
      expect((await getSettings()).selectedModels[engine]).toBe(to);
      expect(MODEL_CATALOG.some((m) => m.id === from)).toBe(false);
    },
  );

  it('persists engine defaults for unknown values', async () => {
    const mock = setupChromeMock({
      localStorage: {
        selectedModels: {
          openai: 'unknown',
          anthropic: 'unknown',
          upstage: 'unknown',
          gemini: 'unknown',
        },
      },
    });
    await migrateStorage();
    expect(mock.local._data.get('selectedModels')).toEqual(DEFAULT_MODEL_IDS);
  });

  it('uses explicit migration targets, not whichever model is currently default', () => {
    expect(MODEL_MIGRATIONS).toEqual(migrations.map(([, from, to]) => ({ from, to })));
    const raw = structuredClone(bundled);
    for (const engine of ['openai', 'anthropic', 'upstage']) {
      const target = raw.models.find((m) => m.engine === engine)!;
      target.default = false;
      raw.models.push({ ...target, id: `alternate-${engine}`, default: true });
    }
    const catalog = loadModelCatalog(raw);
    for (const [engine, from, to] of migrations) {
      expect(resolveSelectedModel(engine, from, catalog)).toBe(to);
      expect(resolveSelectedModel(engine, 'unknown', catalog)).toBe(`alternate-${engine}`);
    }
    expect(resolveSelectedModel('anthropic', 'gpt-5.4-nano', catalog)).toBe('alternate-anthropic');
  });

  it('migrates legacy Solar selection once, upgrading other legacy choices and retaining keys and historical usage', async () => {
    const history = {
      'solar-mini': { inputTokens: 10, outputTokens: 20, estimatedCost: 0.003, requestCount: 1 },
    };
    const keys = { upstage: 'fixture-key' };
    const mock = setupChromeMock({
      localStorage: {
        selectedEngine: 'upstage',
        selectedModels: {
          gemini: 'gemini-3.1-flash-lite',
          openai: 'gpt-5.6-luna',
          anthropic: 'claude-haiku-4-5-20251001',
          upstage: 'solar-mini',
        },
        engineApiKeys: keys,
        b3rys_usage_stats: history,
      },
    });
    // Repair is effective before persistence too (popup/settings and background selection).
    expect((await getSettings()).selectedModels.upstage).toBe('solar-mini4');
    await migrateStorage();
    expect(mock.local._data.get('selectedModels')).toEqual({
      gemini: 'gemini-3.1-flash-lite',
      openai: 'gpt-6-luna',
      anthropic: 'claude-haiku-5-5',
      upstage: 'solar-mini4',
    });
    expect(mock.local._data.get('selectedEngine')).toBe('upstage');
    expect(mock.local._data.get('engineApiKeys')).toEqual(keys);
    expect(mock.local._data.get('b3rys_usage_stats')).toEqual(history);
    const writes = vi.mocked(mock.local.set).mock.calls.length;
    await migrateStorage();
    expect(vi.mocked(mock.local.set).mock.calls.length).toBe(writes);
  });

  it.each(['page', 'segment'] as const)(
    'disables Haiku thinking in the %s request for the current version',
    async (mode) => {
      for (const model of ['claude-haiku-5-5']) {
        const mock = mockResponse({ content: [{ type: 'text', text: '[1] 번역' }] });
        await anthropicEngine.translate(
          'fixture-key',
          paragraphs,
          mode,
          undefined,
          undefined,
          model,
        );
        // Request body snapshot; prompt text is already covered by engine routing tests.
        expect(bodyOf(mock)).toMatchSnapshot(
          { messages: [{ role: 'user', content: expect.any(String) }] },
          `${mode}-${model}`,
        );
        expect(bodyOf(mock).thinking).toEqual({ type: 'disabled' });
        expect(bodyOf(mock).max_tokens).toBe(8192);
      }
    },
  );

  it.each(['page', 'segment'] as const)(
    'keeps Solar Mini 4 reasoning absent in the %s request',
    async (mode) => {
      const mock = mockResponse({ choices: [{ message: { content: '[1] 번역' } }] });
      await upstageEngine.translate(
        'fixture-key',
        paragraphs,
        mode,
        undefined,
        undefined,
        'solar-mini',
      );
      const body = bodyOf(mock);
      expect(body).toMatchSnapshot({ messages: [{ role: 'user', content: expect.any(String) }] });
      expect(body.model).toBe('solar-mini4');
      expect(body).not.toHaveProperty('reasoning_effort');
    },
  );

  it.each(['page', 'segment'] as const)(
    'keeps GPT-6 Luna reasoning none in the %s request',
    async (mode) => {
      const mock = mockResponse({ choices: [{ message: { content: '[1] 번역' } }] });
      await openaiEngine.translate(
        'fixture-key',
        paragraphs,
        mode,
        undefined,
        undefined,
        'gpt-6-luna',
      );
      expect(bodyOf(mock)).toMatchSnapshot({
        messages: [{ role: 'user', content: expect.any(String) }],
      });
      expect(bodyOf(mock).reasoning_effort).toBe('none');
      expect(bodyOf(mock).model).toBe('gpt-6-luna');
    },
  );

  it.each(['page', 'segment'] as const)(
    'bills Gemini thinking and visible output exactly once in %s mode',
    async (mode) => {
      mockResponse({
        candidates: [{ content: { parts: [{ text: '[1] 번역' }] } }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 30,
          totalTokenCount: 150,
        },
      });
      const result = await geminiEngine.translate('fixture-key', paragraphs, mode);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(calculateModelCost('gemini-3.1-flash-lite', result.usage!)).toBeCloseTo(0.0001, 10);
    },
  );

  it.each([
    [
      { promptTokenCount: 100, candidatesTokenCount: 20 },
      { inputTokens: 100, outputTokens: 20 },
    ],
    [
      { promptTokenCount: 100, thoughtsTokenCount: 30 },
      { inputTokens: 100, outputTokens: 30 },
    ],
    [
      { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 0 },
      { inputTokens: 100, outputTokens: 20 },
    ],
  ])('handles optional Gemini usage fields without NaN: %j', async (usageMetadata, expected) => {
    mockResponse({ candidates: [{ content: { parts: [{ text: '[1] 번역' }] } }], usageMetadata });
    expect((await geminiEngine.translate('fixture-key', paragraphs, 'page')).usage).toEqual(
      expected,
    );
  });

  it('does not invent Gemini usage when metadata is absent', async () => {
    mockResponse({ candidates: [{ content: { parts: [{ text: '[1] 번역' }] } }] });
    expect((await geminiEngine.translate('fixture-key', paragraphs, 'page')).usage).toBeUndefined();
  });
});
