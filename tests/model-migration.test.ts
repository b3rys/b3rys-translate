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
          openai: 'claude-sonnet-4-6',
          anthropic: 'claude-sonnet-4-6',
        },
        engineApiKeys: { anthropic: 'existing-key' },
      },
    });

    await migrateStorage();

    expect(mock.local._data.get(SELECTED_MODELS_KEY)).toEqual({
      gemini: DEFAULT_MODEL_IDS.gemini, // 제거된 모델 → 기본값으로 복구
      openai: DEFAULT_MODEL_IDS.openai, // 다른 제공사 모델 → 기본값으로 복구
      anthropic: 'claude-sonnet-4-6', // 유효한 선택 → 보존
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
