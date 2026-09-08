import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';

// The paper body on neurips.cc is an <iframe src="bytez.com/read/…">, so the
// content script has to run in sub-frames too. What it must NOT do there is
// draw a second FAB, and what it must still do is translate when the top
// frame's FAB is switched on.

vi.mock('@/entrypoints/content/translator', () => ({
  translatePage: vi.fn(async () => 'ok'),
  removeAllTranslations: vi.fn(),
  cancelTranslation: vi.fn(),
  hasTranslationsOnPage: vi.fn(() => false),
  setTranslationMode: vi.fn(),
  setTranslationModeWhenAvailable: vi.fn(),
}));

interface ContentScriptConfig {
  matches: string[];
  allFrames?: boolean;
  runAt?: string;
  main: () => void;
}

const FAB_HOST = '#b3rys-translate-root';

async function loadContentScript(): Promise<ContentScriptConfig> {
  vi.stubGlobal('defineContentScript', (config: ContentScriptConfig) => config);
  const mod = await import('@/entrypoints/content');
  return mod.default as unknown as ContentScriptConfig;
}

/** window.top !== window.self is what tells the script it is in a sub-frame */
function pretendSubFrame(): void {
  Object.defineProperty(window, 'top', { value: {}, configurable: true });
}

function storageListener(): (changes: Record<string, { newValue: unknown }>, area: string) => void {
  const addListener = chrome.storage.onChanged.addListener as unknown as Mock;
  const call = addListener.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0] as (changes: Record<string, { newValue: unknown }>, area: string) => void;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  Object.defineProperty(window, 'top', { value: window, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('content script frame coverage', () => {
  it('registers for every frame, not just the top document', async () => {
    setupChromeMock();
    const config = await loadContentScript();

    expect(config.matches).toEqual(['<all_urls>']);
    expect(config.allFrames).toBe(true);
  });

  it('draws the floating button in the top frame', async () => {
    setupChromeMock();
    const config = await loadContentScript();

    config.main();

    expect(document.querySelector(FAB_HOST)).not.toBeNull();
  });

  it('draws no floating button in a sub-frame', async () => {
    setupChromeMock();
    const config = await loadContentScript();
    pretendSubFrame();

    config.main();

    expect(document.querySelector(FAB_HOST)).toBeNull();
  });

  it('translates a sub-frame when the top frame turns the FAB on', async () => {
    setupChromeMock({
      localStorage: { selectedEngine: 'gemini', engineApiKeys: { gemini: 'k' } },
    });
    const config = await loadContentScript();
    const { translatePage } = await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    expect(translatePage).not.toHaveBeenCalled();

    storageListener()({ translationEnabled: { newValue: true } }, 'local');

    await vi.waitFor(() => expect(translatePage).toHaveBeenCalled());
  });

  it('clears a sub-frame when the top frame turns the FAB off', async () => {
    setupChromeMock({
      localStorage: { selectedEngine: 'gemini', engineApiKeys: { gemini: 'k' } },
    });
    const config = await loadContentScript();
    const { removeAllTranslations } = await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    storageListener()({ translationEnabled: { newValue: false } }, 'local');

    expect(removeAllTranslations).toHaveBeenCalled();
  });

  it('leaves the top frame to its own FAB — the persisted flag does not re-trigger it', async () => {
    setupChromeMock({
      localStorage: { selectedEngine: 'gemini', engineApiKeys: { gemini: 'k' } },
    });
    const config = await loadContentScript();
    const { translatePage } = await import('@/entrypoints/content/translator');

    config.main();
    storageListener()({ translationEnabled: { newValue: true } }, 'local');

    await new Promise((r) => setTimeout(r, 20));
    expect(translatePage).not.toHaveBeenCalled();
  });
});
