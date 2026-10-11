import { afterEach, describe, expect, it, vi } from 'vitest';
import bundled from '@/config/models.json';
import { loadModelCatalog } from '@/utils/model-catalog';
import {
  calculateModelCost,
  getModelConfig,
  getModelsForEngine,
  normalizeSelectedModels,
  resolveSelectedModel,
} from '@/utils/models';
import { populateModelSelect, renderModelPricingTable } from '@/entrypoints/popup/model-ui';
import { getEngine } from '@/utils/engines';
import type { EngineType } from '@/utils/engines/types';

const engines: EngineType[] = ['gemini', 'openai', 'anthropic', 'upstage'];
const baseline = loadModelCatalog(bundled);
const clone = () => structuredClone(bundled);

function assertInvariants(raw: unknown) {
  const catalog = loadModelCatalog(raw);
  expect(new Set(catalog.models.map((m) => m.id)).size).toBe(catalog.models.length);
  for (const engine of engines) {
    const models = getModelsForEngine(engine, catalog);
    expect(models.length).toBeGreaterThan(0);
    expect(models.filter((m) => m.default)).toHaveLength(1);
    expect(models.find((m) => m.default)?.id).toBe(catalog.defaultModelIds[engine]);
  }
  return catalog;
}

describe('source-independent catalog loader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pins the complete bundled ids, labels, prices and defaults before extraction', () => {
    expect(baseline.version).toBe(1);
    expect(baseline.diagnostics).toEqual([]);
    expect(
      baseline.models.map((m) => [
        m.id,
        m.engine,
        m.label,
        m.pricing.input,
        m.pricing.output,
        m.default,
      ]),
    ).toEqual([
      ['gemini-3.1-flash-lite', 'gemini', 'Gemini 3.1 Flash Lite', 0.25, 1.5, true],
      ['gpt-5.4-nano', 'openai', 'GPT-5.4 Nano', 0.2, 1.25, true],
      ['gpt-5.6-luna', 'openai', 'GPT-5.6 Luna', 0.2, 1.2, false],
      ['claude-haiku-4-5-20251001', 'anthropic', 'Claude Haiku 4.5', 1, 5, true],
      ['solar-mini', 'upstage', 'Upstage Solar Mini', 0.15, 0.15, true],
    ]);
    expect(baseline.defaultModelIds).toEqual({
      gemini: 'gemini-3.1-flash-lite',
      openai: 'gpt-5.4-nano',
      anthropic: 'claude-haiku-4-5-20251001',
      upstage: 'solar-mini',
    });
  });

  it.each([
    [
      'unknown engine',
      (raw: ReturnType<typeof clone>) => {
        raw.models[1].engine = 'unknown';
      },
      'unknown engine',
    ],
    [
      'missing price',
      (raw: ReturnType<typeof clone>) => {
        Reflect.deleteProperty(raw.models[1].pricing, 'output');
      },
      'price',
    ],
    [
      'duplicate id',
      (raw: ReturnType<typeof clone>) => {
        raw.models.push(structuredClone(raw.models[1]));
      },
      'duplicate id',
    ],
    [
      'zero defaults',
      (raw: ReturnType<typeof clone>) => {
        raw.models[1].default = false;
      },
      'expected 1 default, got 0',
    ],
    [
      'two defaults',
      (raw: ReturnType<typeof clone>) => {
        raw.models[2].default = true;
      },
      'expected 1 default, got 2',
    ],
    [
      'empty engine',
      (raw: ReturnType<typeof clone>) => {
        raw.models = raw.models.filter((m) => m.engine !== 'openai');
      },
      'no valid models',
    ],
  ])('falls back only the invalid engine: %s', (_name, change, reason) => {
    const raw = clone();
    raw.models[0].label = 'Unchanged valid custom label';
    change(raw);
    const catalog = assertInvariants(raw);
    expect(getModelsForEngine('openai', catalog)).toEqual(getModelsForEngine('openai', baseline));
    expect(catalog.models[0].label).toBe('Unchanged valid custom label');
    expect(catalog.diagnostics.some((message) => message.includes(reason))).toBe(true);
  });

  it.each([-1, Number.NaN, Infinity, -Infinity, '0.2', null, undefined])(
    'rejects invalid price %s without throwing',
    (value) => {
      const raw = clone();
      Reflect.set(raw.models[2].pricing, 'input', value);
      const catalog = assertInvariants(raw);
      // A bad optional item is discarded; the valid default survives without whole-engine fallback.
      expect(getModelsForEngine('openai', catalog).map((m) => m.id)).toEqual(['gpt-5.4-nano']);
      expect(catalog.diagnostics.some((message) => message.includes('price'))).toBe(true);
    },
  );

  it.each([
    undefined,
    null,
    'not json',
    [],
    {},
    { version: 2, models: [] },
    { version: 1, models: null },
    { version: 1, models: [] },
  ])('falls back all engines for an invalid/empty envelope: %j', (raw) => {
    const catalog = assertInvariants(raw);
    expect(catalog.models).toEqual(baseline.models);
    expect(catalog.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects malformed fields and duplicate optional ids, not healthy siblings', () => {
    for (const change of [
      (item: Record<string, unknown>) => {
        item.id = '';
      },
      (item: Record<string, unknown>) => {
        item.label = ' ';
      },
      (item: Record<string, unknown>) => {
        item.default = 'false';
      },
      (item: Record<string, unknown>) => {
        item.pricing = null;
      },
    ]) {
      const raw = clone();
      change(raw.models[2]);
      expect(getModelsForEngine('openai', assertInvariants(raw))).toHaveLength(1);
    }
    const raw = clone();
    raw.models.push(structuredClone(raw.models[2]));
    expect(getModelsForEngine('openai', assertInvariants(raw)).map((m) => m.id)).toEqual([
      'gpt-5.4-nano',
    ]);
    expect(assertInvariants({ version: 1, models: [null, 42] }).models).toEqual(baseline.models);
  });

  it('keeps fallback ids unique even when an input moves a bundled id to another engine', () => {
    const raw = clone();
    raw.models = [{ ...raw.models[0], id: 'solar-mini' }];
    expect(assertInvariants(raw).models).toEqual(baseline.models);
  });

  it('uses supplied catalog for selection, removed saved ids, lookup and cost', () => {
    const raw = clone();
    raw.models = raw.models.filter((m) => m.id !== 'gpt-5.4-nano');
    raw.models[1] = {
      ...raw.models[1],
      id: 'new-openai-model',
      default: true,
      pricing: { input: 2, output: 3 },
    };
    const catalog = assertInvariants(raw);
    expect(resolveSelectedModel('openai', 'gpt-5.4-nano', catalog)).toBe('new-openai-model');
    expect(resolveSelectedModel('openai', 'solar-mini', catalog)).toBe('new-openai-model');
    expect(
      normalizeSelectedModels({ openai: 'gpt-5.6-luna', upstage: 'solar-mini' }, catalog),
    ).toEqual({ ...baseline.defaultModelIds, openai: 'new-openai-model' });
    expect(getModelConfig('new-openai-model', catalog).pricing).toEqual({ input: 2, output: 3 });
    expect(() => getModelConfig('gpt-5.4-nano', catalog)).toThrow('Unknown model');
    expect(
      calculateModelCost(
        'new-openai-model',
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        catalog,
      ),
    ).toBe(3.5);
  });

  it('is deterministic, side-effect free, and detached from mutable input', () => {
    const raw = clone();
    const before = clone();
    const log = vi.spyOn(console, 'log');
    const debug = vi.spyOn(console, 'debug');
    const catalog = loadModelCatalog(raw);
    expect(raw).toEqual(before);
    expect(loadModelCatalog(raw)).toEqual(catalog);
    loadModelCatalog(null);
    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    log.mockRestore();
    debug.mockRestore();
    raw.models[0].pricing.input = 999;
    expect(catalog.models[0].pricing.input).toBe(0.25);
    expect(() => Reflect.set(catalog.models[0].pricing, 'input', 999)).not.toThrow();
    expect(catalog.models[0].pricing.input).toBe(0.25);
  });

  it('renders supplied model ids, labels and prices as text, not markup', () => {
    const raw = clone();
    raw.models[1] = {
      ...raw.models[1],
      id: 'new-model',
      label: '<img src=x onerror=alert(1)>',
      pricing: { input: 0, output: 7 },
    };
    const catalog = loadModelCatalog(raw);
    const select = document.createElement('select');
    const pricing = document.createElement('div');
    populateModelSelect(select, catalog);
    renderModelPricingTable(pricing, catalog);
    expect(select.options[1].value).toBe('new-model');
    expect(select.options[1].textContent).toBe(raw.models[1].label);
    expect(pricing.textContent).toContain('$0.00/7.00');
    expect(pricing.querySelector('img')).toBeNull();
  });

  it.each(engines)(
    'routes a new string id/default through %s using the supplied catalog',
    async (engine) => {
      const raw = clone();
      const item = raw.models.find((m) => m.engine === engine && m.default)!;
      item.id = `new-${engine}-model`;
      const catalog = loadModelCatalog(raw);
      const text = JSON.stringify([{ id: 'p1', text: '번역' }]);
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text }] } }],
              choices: [{ message: { content: text } }],
              content: [{ type: 'text', text }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      await getEngine(engine).translate(
        'test-key',
        [{ id: 'p1', text: 'Hello.' }],
        'page',
        undefined,
        undefined,
        undefined,
        catalog,
      );
      const call = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
      const body = JSON.parse(call[1].body as string);
      if (engine === 'gemini') {
        expect(String(call[0])).toContain(`/models/${item.id}:generateContent`);
        expect(body.generationConfig.temperature).toBe(0.1);
      } else {
        expect(body.model).toBe(item.id);
        if (engine === 'openai') expect(body.reasoning_effort).toBe('none');
        else expect(body).not.toHaveProperty('reasoning_effort');
      }
    },
  );
});
