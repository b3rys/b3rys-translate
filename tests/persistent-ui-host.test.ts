import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPersistentUiHost } from '@/entrypoints/content/persistent-ui-host';
import { createFloatingButton } from '@/entrypoints/content/floating-button';
import { initSelectionPopup, destroySelectionPopup } from '@/entrypoints/content/selection-popup';
import { observeDynamicContent } from '@/entrypoints/content/observer';
import { setupChromeMock } from './helpers/chrome-mock';

const cleanups: (() => void)[] = [];
// Yield through a timer turn so native MutationObserver microtasks, including
// notifications queued by a repair, finish before the next DOM mutation.
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  document.body.replaceChildren();
  setupChromeMock();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn() });
});

afterEach(() => {
  destroySelectionPopup();
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('persistent extension UI', () => {
  it('restores the same FAB after body children are replaced, preserving state and clicks', async () => {
    const attach = vi.spyOn(Element.prototype, 'attachShadow');
    const clicked = vi.fn();
    const fab = createFloatingButton(clicked);
    cleanups.push(() => fab.destroy());
    const host = document.getElementById('b3rys-translate-root')!;
    const shadow = attach.mock.results[0].value as ShadowRoot;
    const button = shadow.querySelector<HTMLElement>('.b3rys-fab')!;
    const wrap = shadow.querySelector<HTMLElement>('.b3rys-wrap')!;
    fab.setState('done');
    fab.setMode('replace');
    wrap.style.top = '123px';

    document.body.replaceChildren(document.createElement('main'));

    await settle();
    expect(host.parentElement).toBe(document.body);
    expect(document.querySelectorAll('#b3rys-translate-root')).toHaveLength(1);
    expect(button.dataset.state).toBe('done');
    expect(shadow.querySelector('.b3rys-mode-toggle')!.textContent).toBe('가');
    expect(wrap.style.top).toBe('123px');
    button.click();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('preserves intentional hiding and never resurrects a destroyed FAB', async () => {
    const fab = createFloatingButton(vi.fn());
    cleanups.push(() => fab.destroy());
    const host = document.getElementById('b3rys-translate-root')!;
    fab.hide();
    host.remove();
    await settle();
    expect(host.isConnected).toBe(true);
    expect(host.style.display).toBe('none');
    fab.show();
    expect(host.style.display).toBe('');
    // Disconnect must also cancel a queued removal notification.
    host.remove();
    fab.destroy();
    document.body.appendChild(document.createElement('p'));
    await settle();
    expect(host.isConnected).toBe(false);
  });

  it('recovers after body is replaced, including a temporarily missing body', async () => {
    const host = document.createElement('div');
    cleanups.push(mountPersistentUiHost(host));
    const oldBody = document.body;
    oldBody.remove();
    await settle();
    const newBody = document.createElement('body');
    document.documentElement.appendChild(newBody);
    await settle();
    expect(host.parentElement).toBe(newBody);
  });

  it('stops a site-removal loop after three repairs in one second', async () => {
    const host = document.createElement('div');
    cleanups.push(mountPersistentUiHost(host));
    for (let i = 0; i < 3; i++) {
      host.remove();
      await settle();
      expect(host.isConnected).toBe(true);
    }
    host.remove();
    await settle();
    expect(host.isConnected).toBe(false);
    document.body.appendChild(document.createElement('p'));
    await settle();
    expect(host.isConnected).toBe(false);
  });

  it('does not count repairs outside the rolling one-second window', async () => {
    const host = document.createElement('div');
    cleanups.push(mountPersistentUiHost(host));
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1001);
      host.remove();
      await settle();
      expect(host.isConnected).toBe(true);
    }
  });

  it('does not trigger page translation when mounting or repairing UI', async () => {
    const changed = vi.fn();
    cleanups.push(observeDynamicContent(changed));
    const host = document.createElement('div');
    cleanups.push(mountPersistentUiHost(host));
    host.remove();
    await settle();
    expect(host.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(changed).not.toHaveBeenCalled();
  });

  it('restores the selection trigger and translated popup, but not after disabling selection', async () => {
    const { sendMessage } = setupChromeMock();
    sendMessage.mockResolvedValue({
      translations: [{ id: 'selection-0', translatedText: '안녕하세요' }],
    });
    const attach = vi.spyOn(Element.prototype, 'attachShadow');
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        getClientRects: () => [{ left: 10, right: 100, top: 10, bottom: 30 }],
      }),
    } as unknown as Selection);
    initSelectionPopup();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(document.getElementById('b3rys-selection-popup-root')).not.toBeNull();
    const host = document.getElementById('b3rys-selection-popup-root')!;
    const shadow = attach.mock.results[0].value as ShadowRoot;
    const trigger = shadow.querySelector('button')!;
    expect(trigger).not.toBeNull();

    document.body.replaceChildren();

    await settle();
    expect(host.parentElement).toBe(document.body);
    expect(shadow.querySelector('button')).toBe(trigger);
    trigger.click();
    await settle();
    expect(shadow.textContent).toContain('안녕하세요');
    const popup = shadow.querySelector('.b3rys-sel-popup');
    // test:ui-host-gc exposes GC to catch happy-dom's orphaned callback regression.
    // The regular suite still checks this path without forcing a collection.
    await globalThis.gc?.({ execution: 'async' });
    host.remove();
    await settle();
    expect(host.isConnected).toBe(true);
    expect(shadow.querySelector('.b3rys-sel-popup')).toBe(popup);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    destroySelectionPopup();
    await settle();
    expect(host.isConnected).toBe(false);
  });
});
