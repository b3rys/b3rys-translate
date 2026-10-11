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

  it('upgrades the saved model and keeps the four-provider selector usable', async () => {
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
      expect(select.value).toBe('gpt-6-luna');
      expect(select.disabled).toBe(false);
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        'gemini-3.1-flash-lite',
        'gpt-6-luna',
        'claude-haiku-5-5',
        'solar-mini4',
      ]);
      expect(apiKey.value).toBe('••••••••1234');
      expect(badge.textContent).toBe('GPT-6 Luna');
    });

    select.value = 'gemini-3.1-flash-lite';
    select.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(mock.local._data.get('selectedEngine')).toBe('gemini');
      expect(mock.local._data.get(SELECTED_MODELS_KEY)).toEqual({
        gemini: 'gemini-3.1-flash-lite',
        openai: 'gpt-6-luna',
        anthropic: 'claude-haiku-5-5',
        upstage: 'solar-mini4',
      });
      expect(mock.local._data.get('engineApiKeys')).toEqual({
        gemini: 'gemini-existing-key',
        openai: 'openai-existing-1234',
      });
      expect(apiKey.value).toBe('••••••••-key');
      expect(badge.textContent).toBe('Gemini 3.1 Flash Lite');
    });
  });
});
