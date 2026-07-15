/**
 * Translation state machine — extracted from content.ts for testability.
 *
 * States: idle | loading | done | error
 * See safety-rules skill for full transition table.
 */
import type { FloatingButtonState, TranslationMode } from '@/types';
import { checkCircuitBreaker } from './circuit-breaker';

const CIRCUIT_WINDOW = 60_000; // 1 minute
const CIRCUIT_MAX = 15; // max translation starts per window
const ERROR_RECOVERY_MS = 3000;

export interface StateMachineDeps {
  translatePage(
    onProgress: (completed: number, total: number) => void,
  ): Promise<'done' | 'cancelled'>;
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

  onObserverContent(): void {
    if (this._state === 'done') {
      // Incremental: translate only new blocks (existing BLOCK_IDs preserved)
      void this.startTranslation().catch(() => {});
    } else if (this._state === 'loading') {
      // Cancel current translation and restart for new content
      this.pendingRestart = true;
      this.deps.cancelTranslation();
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

    // Circuit breaker: block runaway loops before any API call
    const now = Date.now();
    if (checkCircuitBreaker(this.recentStarts, now, CIRCUIT_MAX, CIRCUIT_WINDOW).tripped) {
      console.error('[b3rys] Circuit breaker tripped — switching to manual-only mode');
      this.setState('error');
      await this.deps.persistEnabled(false);
      return;
    }
    this.recentStarts.push(now);

    // Check API key before starting — open popup if missing
    if (!(await this.deps.checkApiKey())) {
      this.deps.openPopup();
      return;
    }

    const myGen = ++this.startGen;
    this.setState('loading');
    this.deps.onProgress(0);
    this.deps.setTranslationMode(this._mode);
    await this.deps.persistEnabled(true);

    try {
      const result = await this.deps.translatePage((completed, total) => {
        if (myGen !== this.startGen) return; // stale progress callback
        this.deps.onProgress(completed / total);
      });
      // A newer startTranslation() (or cancel) superseded us — don't touch state
      if (myGen !== this.startGen) return;
      if (result === 'cancelled') {
        // Content changed during translation — restart for new content
        if (this.pendingRestart) {
          this.pendingRestart = false;
          this.deps.removeAllTranslations();
          this.setState('idle');
          this.deps.onProgress(0);
          await this.startTranslation();
          return;
        }
        if (this.deps.hasTranslationsOnPage()) {
          this.setState('done');
        } else {
          this.setState('idle');
        }
        this.deps.onProgress(0);
        await this.deps.persistEnabled(false);
        return;
      }
      this.setState('done');
      this.deps.setTranslationMode(this._mode);
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
