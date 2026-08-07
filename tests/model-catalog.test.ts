import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_IDS,
  MODEL_CATALOG,
  calculateModelCost,
  getModelConfig,
  getModelsForEngine,
  resolveSelectedModel,
} from '@/utils/models';

describe('model catalog', () => {
  it('exposes only label-only, non-thinking model choices per provider', () => {
    expect(getModelsForEngine('openai').map((model) => model.label)).toEqual([
      'GPT-5.4 Nano',
      'GPT-5.6 Luna',
    ]);
    expect(getModelsForEngine('gemini').map((model) => model.label)).toEqual([
      'Gemini 3.1 Flash Lite',
    ]);
    expect(getModelsForEngine('anthropic').map((model) => model.label)).toEqual([
      'Claude Haiku 4.5',
    ]);
    expect(getModelsForEngine('upstage').map((model) => model.label)).toEqual([
      'Upstage Solar Mini',
    ]);
    // 5개다. Gemini 3.5 Flash Lite 는 씽킹을 끌 수 없어 제외했다(utils/models.ts 주석).
    // Upstage Solar Mini 는 공급사가 "reasoning 미지원"을 명시해 통과했다.
    expect(MODEL_CATALOG).toHaveLength(5);
  });

  it('migrates users without a saved model to each provider economy model', () => {
    expect(DEFAULT_MODEL_IDS).toEqual({
      gemini: 'gemini-3.1-flash-lite',
      openai: 'gpt-5.4-nano',
      anthropic: 'claude-haiku-4-5-20251001',
      upstage: 'solar-mini',
    });
    expect(resolveSelectedModel('gemini')).toBe('gemini-3.1-flash-lite');
    expect(resolveSelectedModel('openai')).toBe('gpt-5.4-nano');
    expect(resolveSelectedModel('anthropic')).toBe('claude-haiku-4-5-20251001');
    expect(resolveSelectedModel('upstage')).toBe('solar-mini');
  });

  it('rejects a model saved under the wrong provider and falls back safely', () => {
    expect(resolveSelectedModel('openai', 'claude-haiku-4-5-20251001')).toBe('gpt-5.4-nano');
    expect(getModelConfig('gpt-5.6-luna').engine).toBe('openai');
  });

  it('keeps official per-model prices in the same source of truth', () => {
    expect(getModelConfig('gpt-5.4-nano').pricing).toEqual({ input: 0.2, output: 1.25 });
    expect(getModelConfig('gpt-5.6-luna').pricing).toEqual({ input: 0.2, output: 1.2 });
    expect(getModelConfig('gemini-3.1-flash-lite').pricing).toEqual({
      input: 0.25,
      output: 1.5,
    });
  });

  it('calculates usage with the selected model price', () => {
    expect(
      calculateModelCost('gpt-5.6-luna', { inputTokens: 1_000_000, outputTokens: 500_000 }),
    ).toBe(0.8);
    expect(
      calculateModelCost('gpt-5.4-nano', { inputTokens: 1_000_000, outputTokens: 500_000 }),
    ).toBe(0.825);
  });
});
