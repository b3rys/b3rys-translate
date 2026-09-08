import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';

// The paper body on neurips.cc is an <iframe src="bytez.com/read/…">, so the
// content script has to run in sub-frames too. What it must NOT do there is
// draw a second FAB, and what it must still do is translate when the top
// frame's FAB is switched on. That intent travels as a FRAME_TOGGLE message
// relayed by the background to the frames of that one tab — not as a stored
// flag, which fires storage.onChanged only when its value changes and does so
// in every tab.

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

/** Deliver a runtime message to every onMessage listener the script registered */
function deliverMessage(message: { type: string; enabled: boolean }): void {
  const addListener = chrome.runtime.onMessage.addListener as unknown as Mock;
  expect(addListener.mock.calls.length).toBeGreaterThan(0);
  for (const call of addListener.mock.calls) {
    (call[0] as (m: unknown) => void)(message);
  }
}

const WITH_KEY = { localStorage: { selectedEngine: 'gemini', engineApiKeys: { gemini: 'k' } } };

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

  it('translates a sub-frame on FRAME_TOGGLE on', async () => {
    setupChromeMock(WITH_KEY);
    const config = await loadContentScript();
    const { translatePage } = await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    expect(translatePage).not.toHaveBeenCalled();

    deliverMessage({ type: 'FRAME_TOGGLE', enabled: true });

    await vi.waitFor(() => expect(translatePage).toHaveBeenCalled());
  });

  it('clears a sub-frame on FRAME_TOGGLE off', async () => {
    setupChromeMock(WITH_KEY);
    const config = await loadContentScript();
    const { removeAllTranslations } = await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    deliverMessage({ type: 'FRAME_TOGGLE', enabled: false });

    expect(removeAllTranslations).toHaveBeenCalled();
  });

  it('ignores FRAME_TOGGLE in the top frame — its own FAB already acted', async () => {
    const { sendMessage } = setupChromeMock(WITH_KEY);
    sendMessage.mockResolvedValue(undefined);
    const config = await loadContentScript();
    const { translatePage } = await import('@/entrypoints/content/translator');

    config.main();
    deliverMessage({ type: 'FRAME_TOGGLE', enabled: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(translatePage).not.toHaveBeenCalled();
    // Acting on it would also relay it again — a top frame must do neither.
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RELAY_FRAME_TOGGLE' }),
    );
  });

  it('no longer follows the stored translationEnabled flag in a sub-frame', async () => {
    // The flag is written by every tab's top frame; following it would wake
    // this frame for another tab's click.
    setupChromeMock(WITH_KEY);
    const config = await loadContentScript();
    const { translatePage, removeAllTranslations } =
      await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    storageListener()({ translationEnabled: { newValue: true } }, 'local');
    await new Promise((r) => setTimeout(r, 20));
    storageListener()({ translationEnabled: { newValue: false } }, 'local');

    expect(translatePage).not.toHaveBeenCalled();
    expect(removeAllTranslations).not.toHaveBeenCalled();
  });

  it('relays the FAB intent from the top frame as RELAY_FRAME_TOGGLE', async () => {
    const { sendMessage } = setupChromeMock(WITH_KEY);
    sendMessage.mockResolvedValue(undefined);
    const config = await loadContentScript();

    config.main();
    // TOGGLE_TRANSLATION drives the state machine the same way a FAB click does.
    deliverMessage({ type: 'TOGGLE_TRANSLATION', enabled: true });

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ type: 'RELAY_FRAME_TOGGLE', enabled: true }),
    );
  });

  it('does not relay from a sub-frame', async () => {
    const { sendMessage } = setupChromeMock(WITH_KEY);
    sendMessage.mockResolvedValue(undefined);
    const config = await loadContentScript();
    const { translatePage } = await import('@/entrypoints/content/translator');
    pretendSubFrame();

    config.main();
    deliverMessage({ type: 'FRAME_TOGGLE', enabled: true });

    await vi.waitFor(() => expect(translatePage).toHaveBeenCalled());
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RELAY_FRAME_TOGGLE' }),
    );
  });
});
