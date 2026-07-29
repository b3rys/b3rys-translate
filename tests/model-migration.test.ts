import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import { DEFAULT_MODEL_IDS, SELECTED_MODELS_KEY } from '@/utils/models';
import { migrateStorage } from '@/utils/storage';

describe('model selection migration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists economy defaults for existing users without saved model choices', async () => {
    const mock = setupChromeMock({
      localStorage: {
        selectedEngine: 'openai',
        engineApiKeys: { openai: 'existing-key' },
      },
    });

    await migrateStorage();

    expect(mock.local._data.get(SELECTED_MODELS_KEY)).toEqual(DEFAULT_MODEL_IDS);
    expect(mock.local._data.get('selectedEngine')).toBe('openai');
    expect(mock.local._data.get('engineApiKeys')).toEqual({ openai: 'existing-key' });
  });

  it('repairs a retired model and one saved under the wrong provider, keeping valid choices', async () => {
    // gemini-3.5-flash-lite 는 목록에서 제거된 모델이다(씽킹을 끌 수 없어서).
    // 제거 전에 그것을 골라둔 사용자가 실제로 있으므로, 저장값이 그대로 남아
    // 지원하지 않는 모델로 호출이 나가면 안 된다. 기본값으로 복구돼야 한다.
    const mock = setupChromeMock({
      localStorage: {
        selectedEngine: 'anthropic',
        selectedModels: {
          gemini: 'gemini-3.5-flash-lite',
          openai: 'claude-haiku-4-5-20251001',
          anthropic: 'claude-haiku-4-5-20251001',
        },
        engineApiKeys: { anthropic: 'existing-key' },
      },
    });

    await migrateStorage();

    expect(mock.local._data.get(SELECTED_MODELS_KEY)).toEqual({
      gemini: DEFAULT_MODEL_IDS.gemini, // 제거된 모델 → 기본값으로 복구
      openai: DEFAULT_MODEL_IDS.openai, // 다른 제공사 모델 → 기본값으로 복구
      anthropic: DEFAULT_MODEL_IDS.anthropic, // 유효한 선택 → 보존
      upstage: DEFAULT_MODEL_IDS.upstage, // 저장값 없음 → 기본값
    });
    expect(mock.local._data.get('selectedEngine')).toBe('anthropic');
    expect(mock.local._data.get('engineApiKeys')).toEqual({ anthropic: 'existing-key' });
  });

  it('does not replace an existing provider when migrating a legacy Gemini key', async () => {
    const mock = setupChromeMock({
      syncStorage: { geminiApiKey: 'legacy-gemini-key' },
      localStorage: {
        selectedEngine: 'openai',
        engineApiKeys: { openai: 'existing-openai-key' },
      },
    });

    await migrateStorage();

    expect(mock.local._data.get('selectedEngine')).toBe('openai');
    expect(mock.local._data.get('engineApiKeys')).toEqual({
      openai: 'existing-openai-key',
      gemini: 'legacy-gemini-key',
    });
  });
});

describe('legacy usage buckets', () => {
  it('drops engine-keyed usage rows so the cost table stops showing duplicate labels', async () => {
    // 집계 키가 엔진 → 모델로 바뀌면서 업그레이드 사용자에게 두 형식이 함께
    // 남았다. 옛 엔진 버킷의 표시 이름이 새 모델 라벨과 글자까지 같아
    // 비용 상세에 같은 이름이 두 줄로 나온다.
    const mock = setupChromeMock({
      localStorage: {
        b3rys_usage_stats: {
          gemini: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.01, requestCount: 2 },
          anthropic: { inputTokens: 10, outputTokens: 5, estimatedCost: 0.001, requestCount: 1 },
          'gemini-3.1-flash-lite': {
            inputTokens: 20,
            outputTokens: 10,
            estimatedCost: 0.002,
            requestCount: 1,
          },
        },
      },
    });

    await migrateStorage();

    // 모델 키만 남는다
    expect(Object.keys(mock.local._data.get('b3rys_usage_stats') as object)).toEqual([
      'gemini-3.1-flash-lite',
    ]);
  });

  it('does not write when there is nothing legacy to drop', async () => {
    const mock = setupChromeMock({
      localStorage: {
        b3rys_usage_stats: {
          'gpt-5.4-nano': { inputTokens: 1, outputTokens: 1, estimatedCost: 0, requestCount: 1 },
        },
      },
    });

    await migrateStorage();

    expect(Object.keys(mock.local._data.get('b3rys_usage_stats') as object)).toEqual([
      'gpt-5.4-nano',
    ]);
  });
});
