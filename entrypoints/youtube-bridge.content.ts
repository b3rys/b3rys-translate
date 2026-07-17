/**
 * MAIN world content script — runs in YouTube's page JS context.
 *
 * Responsibilities:
 * 1) Provide ytInitialPlayerResponse to isolated world
 * 2) Intercept YouTube's own fetch/XHR timedtext requests
 * 3) Handle direct fetch requests from isolated world
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    console.log('[b3rys-bridge] MAIN world bridge loaded');

    // --- 1) Player response request handler ---
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === '__b3rys_get_player_response') {
        const data = (window as unknown as Record<string, unknown>).ytInitialPlayerResponse ?? null;
        console.log('[b3rys-bridge] Player response:', data ? 'found' : 'null');
        window.postMessage({
          type: '__b3rys_player_response',
          data: data ? JSON.parse(JSON.stringify(data)) : null,
        });
      }
    });

    // --- 2) Intercept fetch() for timedtext ---
    const origFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await origFetch.apply(this, args);
      const url = String(args[0] ?? '');
      if (url.includes('/api/timedtext')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (text) {
            console.log(`[b3rys-bridge] Intercepted fetch timedtext: length=${text.length}`);
            window.postMessage({ type: '__b3rys_timedtext_intercepted', url, text });
          }
        } catch {
          /* ignore */
        }
      }
      return response;
    };

    // --- 2b) Intercept XHR for timedtext ---
    const OrigXHR = XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      (this as unknown as Record<string, unknown>).__b3rysUrl = String(url);
      return origOpen.apply(this, [method, url, ...rest] as unknown as Parameters<typeof origOpen>);
    };

    OrigXHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const xhrUrl = (this as unknown as Record<string, string>).__b3rysUrl ?? '';
      if (xhrUrl.includes('/api/timedtext')) {
        this.addEventListener('load', () => {
          if (this.responseText) {
            console.log(
              `[b3rys-bridge] Intercepted XHR timedtext: length=${this.responseText.length}`,
            );
            window.postMessage({
              type: '__b3rys_timedtext_intercepted',
              url: xhrUrl,
              text: this.responseText,
            });
          }
        });
      }
      return origSend.apply(this, args as Parameters<typeof origSend>);
    };

    // --- 3) Direct fetch handler from isolated world ---
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_fetch_request') return;
      const { url, requestId } = e.data;
      console.log('[b3rys-bridge] Direct fetch:', url.substring(0, 120));

      // Use original fetch (not monkey-patched) to avoid recursion
      origFetch(url, { credentials: 'include' })
        .then(async (r) => {
          const text = await r.text();
          console.log(
            `[b3rys-bridge] Direct fetch done: status=${r.status}, length=${text.length}`,
          );
          window.postMessage({ type: '__b3rys_fetch_response', requestId, text, status: r.status });
        })
        .catch((err) => {
          console.error('[b3rys-bridge] Direct fetch error:', err);
          window.postMessage({
            type: '__b3rys_fetch_response',
            requestId,
            error: String(err),
            status: 0,
          });
        });
    });

    // --- 4) Trigger captions: enable YouTube CC so it fetches timedtext ---
    let didToggleCC = false;

    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_trigger_captions') return;

      try {
        const player = document.getElementById('movie_player');
        if (!player) {
          console.log('[b3rys-bridge] No movie_player element');
          return;
        }

        const p = player as unknown as Record<string, (...args: unknown[]) => void>;

        // Load the captions module first
        if (typeof p.loadModule === 'function') {
          p.loadModule('captions');
          console.log('[b3rys-bridge] Loaded captions module');
        }

        // If CC is already on, no need to toggle
        const ccBtn = document.querySelector('.ytp-subtitles-button');
        const isOn = ccBtn?.getAttribute('aria-pressed') === 'true';

        if (isOn) {
          console.log('[b3rys-bridge] Captions already active');
          didToggleCC = false;
          return;
        }

        // Toggle subtitles on after a short delay (module needs time to load)
        setTimeout(() => {
          const p2 = document.getElementById('movie_player') as unknown as Record<
            string,
            (...args: unknown[]) => void
          > | null;
          if (p2 && typeof p2.toggleSubtitles === 'function') {
            p2.toggleSubtitles();
            didToggleCC = true;
            console.log('[b3rys-bridge] Toggled subtitles on');
          }
        }, 500);
      } catch (err) {
        console.error('[b3rys-bridge] Trigger captions error:', err);
      }
    });

    // --- 5) Restore captions: turn CC back off if we toggled it on ---
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_restore_captions') return;

      if (!didToggleCC) {
        console.log('[b3rys-bridge] CC was not toggled by us, skipping restore');
        return;
      }

      try {
        const player = document.getElementById('movie_player') as unknown as Record<
          string,
          (...args: unknown[]) => void
        > | null;
        if (player && typeof player.toggleSubtitles === 'function') {
          player.toggleSubtitles();
          console.log('[b3rys-bridge] Restored CC to off');
        }
      } catch (err) {
        console.error('[b3rys-bridge] Restore captions error:', err);
      }

      didToggleCC = false;
    });
  },
});
