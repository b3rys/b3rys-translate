import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';

// RELAY_FRAME_TOGGLE comes from a tab's top frame. The background sends it
// back to that same tab as FRAME_TOGGLE with no frameId, which reaches every
// frame of the tab — and only that tab.

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

async function loadBackground(): Promise<() => void> {
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
  const mod = await import('@/entrypoints/background');
  return (mod.default as unknown as { main: () => void }).main;
}

function messageListener(): Listener {
  const addListener = chrome.runtime.onMessage.addListener as unknown as Mock;
  const call = addListener.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0] as Listener;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('background RELAY_FRAME_TOGGLE', () => {
  it('sends FRAME_TOGGLE to the sending tab, every frame', async () => {
    const { tabsSendMessage } = setupChromeMock();
    const main = await loadBackground();
    main();

    const handled = messageListener()(
      { type: 'RELAY_FRAME_TOGGLE', enabled: true },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(handled).toBe(false);
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
    expect(tabsSendMessage).toHaveBeenCalledWith(7, { type: 'FRAME_TOGGLE', enabled: true });
  });

  it('passes the off intent through unchanged', async () => {
    const { tabsSendMessage } = setupChromeMock();
    const main = await loadBackground();
    main();

    messageListener()(
      { type: 'RELAY_FRAME_TOGGLE', enabled: false },
      { tab: { id: 3 } } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(tabsSendMessage).toHaveBeenCalledWith(3, { type: 'FRAME_TOGGLE', enabled: false });
  });

  it('sends nothing when the message did not come from a tab', async () => {
    const { tabsSendMessage } = setupChromeMock();
    const main = await loadBackground();
    main();

    messageListener()(
      { type: 'RELAY_FRAME_TOGGLE', enabled: true },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(tabsSendMessage).not.toHaveBeenCalled();
  });

  it('swallows a rejected tab delivery', async () => {
    const { tabsSendMessage } = setupChromeMock();
    tabsSendMessage.mockRejectedValue(new Error('Could not establish connection'));
    const main = await loadBackground();
    main();

    messageListener()(
      { type: 'RELAY_FRAME_TOGGLE', enabled: true },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
  });
});
