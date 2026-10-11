import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import type { EngineType } from '@/utils/engines/types';
import type { BackgroundMessage } from '@/utils/messaging';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('background cache isolation after model migration', () => {
  it.each<[EngineType, string, string]>([
    ['openai', 'gpt-5.4-nano', 'gpt-6-luna'],
    ['openai', 'gpt-5.6-luna', 'gpt-6-luna'],
    ['anthropic', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5'],
    ['upstage', 'solar-mini', 'solar-mini4'],
  ])('%s: %s cache does not leak into %s lookup or translation', async (engine, from, to) => {
    const { CACHE_STORAGE_KEY } = await import('@/utils/constants');
    setupChromeMock({
      localStorage: {
        selectedEngine: engine,
        selectedModels: { [engine]: from },
        engineApiKeys: { [engine]: 'fixture-key' },
        [CACHE_STORAGE_KEY]: [
          [`ko:page:${from}:Hello.`, { translatedText: 'OLD', timestamp: Date.now() }],
        ],
      },
    });
    const fetchMock = vi.fn(() => Promise.reject(new Error('Unexpected network request')));
    vi.stubGlobal('fetch', fetchMock);
    const cache = await import('@/utils/translation-cache');
    await cache.loadCache();
    vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
    const background = await import('@/entrypoints/background');
    (background.default as unknown as { main: () => void }).main();
    const listener = (chrome.runtime.onMessage.addListener as unknown as Mock).mock.calls.at(
      -1,
    )![0];
    const send = (message: BackgroundMessage) =>
      new Promise<unknown>((resolve) => listener(message, {}, resolve));
    const paragraphs = [{ id: 'p1', text: 'Hello.' }];
    expect(await send({ type: 'CACHE_LOOKUP', paragraphs, targetLang: 'ko' })).toEqual({
      translations: [],
    });
    cache.setCached(`ko:page:${to}:Hello.`, 'NEW');
    for (const type of ['CACHE_LOOKUP', 'TRANSLATE_BATCH'] as const) {
      expect(await send({ type, paragraphs, targetLang: 'ko' })).toMatchObject({
        translations: [{ id: 'p1', translatedText: 'NEW' }],
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.getCached(`ko:page:${from}:Hello.`)).toBe('OLD');
  });
});
