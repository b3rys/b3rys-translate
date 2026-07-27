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

  it('preserves valid choices and repairs a model saved under the wrong provider', async () => {
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
      gemini: 'gemini-3.5-flash-lite',
      openai: DEFAULT_MODEL_IDS.openai,
      anthropic: 'claude-sonnet-4-6',
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
