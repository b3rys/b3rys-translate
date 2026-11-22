import { afterEach, expect, it, vi } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import { loadModelCatalog } from '../utils/model-catalog';
import models from '../config/models.json';
import translate from './fixtures/remote-data/etym/translate.json';

const remote = structuredClone(models);
remote.models[1].id = 'remote-openai';
remote.models[1].pricing = { input: 2, output: 3 };
const catalog = loadModelCatalog(remote);
const state = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  getEtymology: vi.fn(),
  translate: vi.fn(),
}));
vi.mock('../utils/remote-data-runtime', () => ({ remoteData: state }));
vi.mock('../utils/engines', () => ({ getEngine: () => ({ translate: state.translate }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('uses a remote model for translation, costs and migration and exposes both data messages', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  state.getCatalog.mockResolvedValue(catalog);
  state.getEtymology.mockResolvedValue(translate);
  state.translate.mockResolvedValue({
    translations: [{ id: 'p', translatedText: '번역' }],
    usage: { inputTokens: 100, outputTokens: 10 },
  });
  const mock = setupChromeMock({
    localStorage: {
      selectedEngine: 'openai',
      selectedModels: { openai: 'remote-openai' },
      engineApiKeys: { openai: 'test-key' },
    },
  });
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
  const bg = await import('../entrypoints/background');
  (bg.default as unknown as { main: () => void }).main();
  const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  const send = (message: unknown) =>
    new Promise<unknown>((resolve) => {
      expect(listener(message, {}, resolve)).toBe(true);
    });
  expect(await send({ type: 'GET_MODEL_CATALOG' })).toEqual({ catalog });
  expect(state.getCatalog).toHaveBeenCalledWith(true);
  expect(await send({ type: 'GET_ETYMOLOGY', word: 'translate' })).toEqual({
    etymology: translate,
  });
  const result = await send({
    type: 'TRANSLATE_BATCH',
    mode: 'segment',
    paragraphs: [{ id: 'p', text: 'hello' }],
  });
  expect(state.translate.mock.calls[0].slice(-2)).toEqual(['remote-openai', catalog]);
  expect(result).toEqual({
    translations: [{ id: 'p', translatedText: '번역' }],
    totalCost: 0.00023,
  });
  expect(mock.local._data.get('selectedModels')).toMatchObject({ openai: 'remote-openai' });
  await vi.runOnlyPendingTimersAsync();
  expect(mock.local._data.get('b3rys_usage_stats')).toMatchObject({
    'remote-openai': { estimatedCost: 0.00023 },
  });
});
