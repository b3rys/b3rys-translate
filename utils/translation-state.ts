/**
 * Translation state machine — extracted from content.ts for testability.
 *
 * States: idle | loading | done | error
 * See safety-rules skill for full transition table.
 */
import type { FloatingButtonState, TranslationMode } from '@/types';
import type { TranslationResult } from '@/entrypoints/content/translator';
import { checkCircuitBreaker } from './circuit-breaker';
import { dbg } from './debug';

const CIRCUIT_WINDOW = 60_000; // 1 minute
// Max *productive* translation starts per window. Auto-translate legitimately
// starts a pass on every page you browse, so 15 was too tight (≈1 page/4s).
// A real runaway loop fires dozens/sec, so 30 still catches it — and empty
// passes + the fight guard already absorb churn.
const CIRCUIT_MAX = 30;
const ERROR_RECOVERY_MS = 3000;

/**
 * What an observed DOM change means for translation:
 * - 'added':    content grew, detected blocks intact → incremental handling
 * - 'replaced': detected blocks were removed (SPA navigation) → restart
 */
export type ContentChangeKind = 'added' | 'replaced';

export interface StateMachineDeps {
  translatePage(onProgress: (completed: number, total: number) => void): Promise<TranslationResult>;
  removeAllTranslations(): void;
  cancelTranslation(): void;
  hasTranslationsOnPage(): boolean;
  setTranslationMode(mode: TranslationMode): void;
  checkApiKey(): Promise<boolean>;
  onStateChange(state: FloatingButtonState): void;
  onProgress(ratio: number): void;
  persistEnabled(enabled: boolean): Promise<void>;
  openPopup(): void;
}

export class TranslationStateMachine {
  private _state: FloatingButtonState = 'idle';
  private _mode: TranslationMode = 'parallel';
  private startGen = 0;
  private pendingRestart = false;
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;
  private recentStarts: number[] = [];

  constructor(private deps: StateMachineDeps) {}

  get state(): FloatingButtonState {
    return this._state;
  }

  get mode(): TranslationMode {
    return this._mode;
  }

  setMode(mode: TranslationMode): void {
    this._mode = mode;
  }

  async onFabClick(): Promise<void> {
    if (this._state === 'loading') {
      this.deps.cancelTranslation();
      if (this.deps.hasTranslationsOnPage()) {
        this.setState('done');
      } else {
        this.setState('idle');
      }
      this.deps.onProgress(0);
      await this.deps.persistEnabled(false);
      return;
    }

    if (this._state === 'done') {
      this.deps.removeAllTranslations();
      this.setState('idle');
      this.deps.onProgress(0);
      await this.deps.persistEnabled(false);
      return;
    }

    // User-initiated start: reset circuit breaker (only manual click resets it)
    this.recentStarts.length = 0;
    await this.startTranslation();
  }

  onObserverContent(kind: ContentChangeKind = 'added'): void {
    dbg('observer %s; state=%s', kind, this._state);
    if (this._state === 'done') {
      // Incremental: translate only new blocks (existing BLOCK_IDs preserved)
      void this.startTranslation().catch(() => {});
    } else if (this._state === 'loading') {
      if (kind === 'replaced') {
        // Real content swap (SPA navigation) — in-flight results are stale.
        // Cancel and rebuild from scratch once translatePage unwinds.
        this.pendingRestart = true;
        this.deps.cancelTranslation();
      } else {
        // Content merely grew (e.g. Gmail app chrome churning while a long
        // mail translates). Cancelling would discard already-paid batches and
        // rip out injected translations — schedule an incremental pass for
        // after completion instead.
        this.pendingRestart = true;
      }
    }
  }

  async autoTranslateIfEnabled(translationEnabled: boolean): Promise<void> {
    if (translationEnabled && this._state !== 'loading') {
      this.deps.removeAllTranslations();
      this.setState('idle');
      this.deps.onProgress(0);
      await this.startTranslation();
    }
  }

  handleToggle(enabled: boolean): void {
    if (enabled) {
      if (this._state === 'idle') void this.startTranslation();
    } else {
      this.deps.cancelTranslation();
      this.deps.removeAllTranslations();
      this.setState('idle');
      this.deps.onProgress(0);
    }
  }

  private setState(state: FloatingButtonState): void {
    this._state = state;
    this.deps.onStateChange(state);
  }

  private async startTranslation(): Promise<void> {
    if (this._state === 'loading') return; // Already translating
    // Clear any pending error recovery timeout to prevent stale state override
    if (this.errorTimeout) {
      clearTimeout(this.errorTimeout);
      this.errorTimeout = null;
    }

    // Circuit breaker: block runaway loops before any API call.
    // Note: the start is *recorded* only after a productive pass (see below),
    // so no-op passes on a busy page (Gmail churn) never trip it.
    const now = Date.now();
    if (checkCircuitBreaker(this.recentStarts, now, CIRCUIT_MAX, CIRCUIT_WINDOW).tripped) {
      console.error('[b3rys] Circuit breaker tripped — switching to manual-only mode');
      this.setState('error');
      await this.deps.persistEnabled(false);
      return;
    }

    // Check API key before starting — open popup if missing
    if (!(await this.deps.checkApiKey())) {
      this.deps.openPopup();
      return;
    }

    const myGen = ++this.startGen;
    dbg('pass start gen=%d', myGen);
    this.setState('loading');
    this.deps.onProgress(0);
    this.deps.setTranslationMode(this._mode);
    await this.deps.persistEnabled(true);

    try {
      const result = await this.deps.translatePage((completed, total) => {
        if (myGen !== this.startGen) return; // stale progress callback
        this.deps.onProgress(completed / total);
      });
      dbg('pass result=%s gen=%d (cur=%d)', result, myGen, this.startGen);
      // A newer startTranslation() (or cancel) superseded us — don't touch state
      if (myGen !== this.startGen) return;

      // Record the start for loop detection ONLY if the pass did real work.
      // An 'empty' pass (nothing new to translate) is a no-op and must not
      // count, or a churning page trips the breaker with nothing to translate.
      if (result !== 'empty') this.recentStarts.push(now);

      if (result === 'cancelled') {
        // Content changed during translation — restart for new content.
        // NO removeAllTranslations here: swapped-out nodes took their
        // translations with them, and translations on still-present elements
        // are valid. Ripping the whole page out was itself a huge visible
        // stutter when an app (Gmail) kept re-rendering its own widgets.
        if (this.pendingRestart) {
          this.pendingRestart = false;
          this.setState('idle');
          this.deps.onProgress(0);
          await this.startTranslation();
          return;
        }
        // NOTE: no persistEnabled(false) here — a user-initiated cancel already
        // persisted OFF in onFabClick's loading branch. Reaching this line via a
        // navigation cancel (handleToggle during auto mode) must not clobber the
        // sticky FAB state that the next page's auto pass is about to read.
        this.setState(this.deps.hasTranslationsOnPage() ? 'done' : 'idle');
        this.deps.onProgress(0);
        return;
      }

      if (result === 'empty') {
        this.deps.onProgress(0);
        // pendingRestart means content arrived AFTER this pass took its
        // detection snapshot — "this pass found nothing" does NOT mean
        // "nothing is waiting". Discarding it here stranded late-arriving
        // content (virtualized lists) untranslated forever. One follow-up
        // pass; the flag is consumed first, so a truly empty DOM settles.
        if (this.pendingRestart) {
          this.pendingRestart = false;
          this.setState(this.deps.hasTranslationsOnPage() ? 'done' : 'idle');
          await this.startTranslation();
          return;
        }
        // NOTE: do NOT persistEnabled(false) here. An empty pass is "nothing
        // to translate on this page" (e.g. a Korean-only page), not a user
        // intent change — auto mode replays the persisted FAB state across
        // navigations, and a single untranslatable page must not switch it off.
        this.setState(this.deps.hasTranslationsOnPage() ? 'done' : 'idle');
        return;
      }

      // result === 'done'
      this.setState('done');
      this.deps.setTranslationMode(this._mode);
      // Content that arrived while we were translating ('added' during loading):
      // handle incrementally — existing translations stay, only new blocks run.
      if (this.pendingRestart) {
        this.pendingRestart = false;
        await this.startTranslation();
      }
    } catch {
      if (myGen !== this.startGen) return; // superseded — don't touch state
      this.setState('error');
      await this.deps.persistEnabled(false).catch(() => {});
      this.errorTimeout = setTimeout(() => {
        this.errorTimeout = null;
        if (this._state !== 'error') return; // another action already changed state
        if (this.deps.hasTranslationsOnPage()) {
          this.setState('done');
        } else {
          this.setState('idle');
        }
      }, ERROR_RECOVERY_MS);
    }
  }
}
