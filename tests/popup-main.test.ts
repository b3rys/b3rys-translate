import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { setupChromeMock } from './helpers/chrome-mock';
import { SELECTED_MODELS_KEY } from '@/utils/models';

const popupHtml = readFileSync(resolve(__dirname, '../entrypoints/popup/index.html'), 'utf-8')
  .replace(/<link[\s\S]*?>/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');

describe('popup model wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = popupHtml;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = '';
  });

  it('restores the selected model and preserves provider keys when changing models', async () => {
    const mock = setupChromeMock({
      localStorage: {
        selectedEngine: 'openai',
        selectedModels: {
          gemini: 'gemini-3.1-flash-lite',
          openai: 'gpt-5.6-luna',
          anthropic: 'claude-haiku-4-5-20251001',
        },
        engineApiKeys: {
          gemini: 'gemini-existing-key',
          openai: 'openai-existing-1234',
        },
      },
    });

    await import('@/entrypoints/popup/main');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const select = document.getElementById('engine-select') as HTMLSelectElement;
    const apiKey = document.getElementById('api-key') as HTMLInputElement;
    const badge = document.querySelector('.badge-model') as HTMLElement;

    await vi.waitFor(() => {
      expect(select.options).toHaveLength(4);
      expect(select.value).toBe('gpt-5.6-luna');
      expect(apiKey.value).toBe('••••••••1234');
      expect(badge.textContent).toBe('GPT-5.6 Luna');
    });

    select.value = 'gpt-5.4-nano';
    select.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(mock.local._data.get('selectedEngine')).toBe('openai');
      expect(mock.local._data.get(SELECTED_MODELS_KEY)).toEqual({
        gemini: 'gemini-3.1-flash-lite',
        openai: 'gpt-5.4-nano',
        anthropic: 'claude-haiku-4-5-20251001',
      });
      expect(mock.local._data.get('engineApiKeys')).toEqual({
        gemini: 'gemini-existing-key',
        openai: 'openai-existing-1234',
      });
      expect(apiKey.value).toBe('••••••••1234');
      expect(badge.textContent).toBe('GPT-5.4 Nano');
    });
  });
});
