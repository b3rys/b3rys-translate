import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { TranslationStateMachine, type StateMachineDeps } from '@/utils/translation-state';

/**
 * Flush microtasks so fire-and-forget async calls complete.
 * Uses setTimeout(0) which runs after all pending microtasks.
 */
async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type MockDeps = { [K in keyof StateMachineDeps]: Mock };

function createMockDeps(): MockDeps {
  return {
    translatePage: vi.fn().mockResolvedValue('done' as const),
    removeAllTranslations: vi.fn(),
    cancelTranslation: vi.fn(),
    hasTranslationsOnPage: vi.fn().mockReturnValue(false),
    setTranslationMode: vi.fn(),
    checkApiKey: vi.fn().mockResolvedValue(true),
    onStateChange: vi.fn(),
    onProgress: vi.fn(),
    persistEnabled: vi.fn().mockResolvedValue(undefined),
    openPopup: vi.fn(),
  };
}

/**
 * Start a translation via FAB click with a manually-controlled translatePage promise.
 * Returns the FAB click promise + a resolve function to complete the translation.
 * After calling, sm.state is guaranteed to be 'loading'.
 */
async function startPendingTranslation(
  sm: TranslationStateMachine,
  deps: MockDeps,
): Promise<{ promise: Promise<void>; resolve: (v: 'done' | 'cancelled') => void }> {
  let resolve!: (v: 'done' | 'cancelled') => void;
  deps.translatePage.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const promise = sm.onFabClick();
  // Flush microtasks so checkApiKey + persistEnabled resolve → state reaches 'loading'
  await flushPromises();
  return { promise, resolve };
}

describe('TranslationStateMachine', () => {
  let deps: MockDeps;
  let sm: TranslationStateMachine;

  beforeEach(() => {
    deps = createMockDeps();
    sm = new TranslationStateMachine(deps);
  });

  // ============================================================
  // Basic transitions
  // ============================================================

  describe('basic transitions', () => {
    it('idle → loading → done (happy path)', async () => {
      expect(sm.state).toBe('idle');

      await sm.onFabClick();

      expect(sm.state).toBe('done');
      expect(deps.onStateChange).toHaveBeenCalledWith('loading');
      expect(deps.onStateChange).toHaveBeenCalledWith('done');
      expect(deps.translatePage).toHaveBeenCalledTimes(1);
      expect(deps.persistEnabled).toHaveBeenCalledWith(true);
    });

    it('loading → idle on cancel (no translations on page)', async () => {
      const { promise, resolve } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      deps.hasTranslationsOnPage.mockReturnValue(false);
      await sm.onFabClick(); // cancel
      expect(sm.state).toBe('idle');
      expect(deps.cancelTranslation).toHaveBeenCalled();
      expect(deps.persistEnabled).toHaveBeenCalledWith(false);

      resolve('cancelled');
      await promise;
    });

    it('loading → done on cancel (has translations on page)', async () => {
      const { promise, resolve } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      deps.hasTranslationsOnPage.mockReturnValue(true);
      await sm.onFabClick(); // cancel
      expect(sm.state).toBe('done');

      resolve('cancelled');
      await promise;
    });

    it('done → idle on FAB click (removes translations)', async () => {
      await sm.onFabClick(); // idle → done
      expect(sm.state).toBe('done');

      await sm.onFabClick(); // done → idle
      expect(sm.state).toBe('idle');
      expect(deps.removeAllTranslations).toHaveBeenCalled();
      expect(deps.persistEnabled).toHaveBeenCalledWith(false);
    });

    it('done → loading on observer new content', async () => {
      await sm.onFabClick(); // idle → done
      expect(sm.state).toBe('done');

      deps.translatePage.mockResolvedValueOnce('done');
      sm.onObserverContent(); // fire-and-forget
      await flushPromises();

      expect(sm.state).toBe('done');
      expect(deps.translatePage).toHaveBeenCalledTimes(2);
    });

    it('autoTranslateIfEnabled skips when already loading', async () => {
      const { promise, resolve } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      await sm.autoTranslateIfEnabled(true);
      // translatePage should NOT be called a second time
      expect(deps.translatePage).toHaveBeenCalledTimes(1);

      resolve('done');
      await promise;
    });
  });

  // ============================================================
  // Error recovery (needs fake timers)
  // ============================================================

  describe('error recovery', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('loading → error on API failure, recovers to idle after 3s', async () => {
      deps.translatePage.mockRejectedValueOnce(new Error('API error'));
      deps.hasTranslationsOnPage.mockReturnValue(false);

      await sm.onFabClick();
      expect(sm.state).toBe('error');
      expect(deps.persistEnabled).toHaveBeenCalledWith(false);

      await vi.advanceTimersByTimeAsync(3000);
      expect(sm.state).toBe('idle');
    });

    it('error recovers to done after 3s when translations exist', async () => {
      deps.translatePage.mockRejectedValueOnce(new Error('API error'));

      await sm.onFabClick();
      expect(sm.state).toBe('error');

      deps.hasTranslationsOnPage.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sm.state).toBe('done');
    });

    it('error timeout cleared when new translation starts', async () => {
      deps.translatePage.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('done');
      deps.hasTranslationsOnPage.mockReturnValue(false);

      await sm.onFabClick();
      expect(sm.state).toBe('error');

      // FAB click resets circuit breaker and starts new translation
      await sm.onFabClick();
      expect(sm.state).toBe('done');

      // Advance past error timeout — should NOT override state
      await vi.advanceTimersByTimeAsync(3000);
      expect(sm.state).toBe('done');
    });
  });

  // ============================================================
  // Safety guards
  // ============================================================

  describe('safety guards', () => {
    it('stale gen ignored after new translation starts', async () => {
      const { promise: promise1, resolve: resolve1 } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      // Cancel via FAB
      deps.hasTranslationsOnPage.mockReturnValue(false);
      await sm.onFabClick();
      expect(sm.state).toBe('idle');

      // Second translation (gen=2) completes immediately
      deps.translatePage.mockResolvedValueOnce('done');
      await sm.onFabClick();
      expect(sm.state).toBe('done');

      deps.onStateChange.mockClear();

      // First translation's stale result resolves — should be ignored
      resolve1('done');
      await promise1;

      expect(sm.state).toBe('done');
      // onStateChange should NOT have been called with stale result
      expect(deps.onStateChange).not.toHaveBeenCalled();
    });

    it('circuit breaker trips after 30 productive starts', async () => {
      deps.translatePage.mockResolvedValue('done');

      // First via FAB (resets breaker, adds 1 start)
      await sm.onFabClick();
      expect(sm.state).toBe('done');

      // 29 more via observer (adds 29 starts, total = 30)
      for (let i = 0; i < 29; i++) {
        sm.onObserverContent();
        await flushPromises();
        expect(sm.state).toBe('done');
      }

      // 30th further start: recentStarts.length = 30 >= 30 → tripped
      sm.onObserverContent();
      await flushPromises();
      expect(sm.state).toBe('error');
    });

    it('empty (no-op) passes never trip the breaker, even on a busy page', async () => {
      // Productive first pass so the page has translations.
      deps.hasTranslationsOnPage.mockReturnValue(true);
      await sm.onFabClick();
      expect(sm.state).toBe('done');

      // Simulate Gmail-style churn: many observer events, each finding nothing
      // new to translate ('empty'). This must NOT trip the breaker.
      deps.translatePage.mockResolvedValue('empty');
      for (let i = 0; i < 40; i++) {
        sm.onObserverContent('added');
        await flushPromises();
      }
      expect(sm.state).toBe('done');
    });

    it('FAB click resets circuit breaker', async () => {
      deps.translatePage.mockResolvedValue('done');

      // Trip the breaker (30 productive starts)
      await sm.onFabClick();
      for (let i = 0; i < 29; i++) {
        sm.onObserverContent();
        await flushPromises();
      }
      sm.onObserverContent();
      await flushPromises();
      expect(sm.state).toBe('error');

      // FAB click resets breaker and starts successfully
      await sm.onFabClick();
      expect(sm.state).toBe('done');
    });

    it('missing API key opens popup without changing state', async () => {
      deps.checkApiKey.mockResolvedValue(false);

      await sm.onFabClick();

      expect(deps.openPopup).toHaveBeenCalled();
      expect(sm.state).toBe('idle');
      expect(deps.translatePage).not.toHaveBeenCalled();
    });

    it("pending restart: 'replaced' during loading triggers cancel + full restart", async () => {
      const { promise, resolve } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      // Detected blocks were removed (SPA navigation) → in-flight work is stale
      sm.onObserverContent('replaced');
      expect(deps.cancelTranslation).toHaveBeenCalled();

      // Second translatePage call (for restart) resolves immediately
      deps.translatePage.mockResolvedValueOnce('done');

      // First translation returns cancelled → triggers restart
      resolve('cancelled');
      await promise;

      // Should have restarted and completed
      expect(sm.state).toBe('done');
      // Restart is incremental: swapped-out nodes took their translations with
      // them; surviving translations stay (no full page rip-out).
      expect(deps.removeAllTranslations).not.toHaveBeenCalled();
      expect(deps.translatePage).toHaveBeenCalledTimes(2);
    });

    it("'added' during loading does NOT cancel — incremental pass after completion", async () => {
      const { promise, resolve } = await startPendingTranslation(sm, deps);
      expect(sm.state).toBe('loading');

      // App chrome churn (e.g. Gmail) while a long page is still translating
      sm.onObserverContent('added');
      expect(deps.cancelTranslation).not.toHaveBeenCalled();

      // Incremental follow-up pass resolves immediately
      deps.translatePage.mockResolvedValueOnce('done');

      // First translation completes normally — injected work is kept
      resolve('done');
      await promise;

      expect(sm.state).toBe('done');
      // The added path must never rip out already-injected translations
      expect(deps.removeAllTranslations).not.toHaveBeenCalled();
      // Follow-up incremental pass ran for the content that arrived mid-flight
      expect(deps.translatePage).toHaveBeenCalledTimes(2);
    });
  });
});
