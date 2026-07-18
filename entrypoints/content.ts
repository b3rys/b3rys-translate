import './content/translator.css';
import { createFloatingButton } from './content/floating-button';
import {
  translatePage,
  removeAllTranslations,
  cancelTranslation,
  hasTranslationsOnPage,
  setTranslationMode,
} from './content/translator';
import { observeDynamicContent } from './content/observer';
import {
  initSelectionPopup,
  destroySelectionPopup,
  loadSelectionSourceLanguage,
} from './content/selection-popup';
import {
  isContextInvalidated,
  isMarkedInvalidated,
  markContextInvalidated,
} from './content/context-invalidated';
import type { TranslationMode } from '@/types';
import type { ContentMessage } from '@/utils/messaging';
import { SKIP_HOSTS, USAGE_RATIO_KEY, BUILD_TAG } from '@/utils/constants';
import { TranslationStateMachine } from '@/utils/translation-state';
import { dbg } from '@/utils/debug';

/** Does the currently-selected engine have an API key saved? (no side effects) */
async function hasApiKeyStored(): Promise<boolean> {
  const { selectedEngine } = await chrome.storage.sync.get<{ selectedEngine?: string }>(
    'selectedEngine',
  );
  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Record<string, string>;
  }>('engineApiKeys');
  return !!engineApiKeys?.[selectedEngine || 'gemini'];
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    // Identify the running bundle (debug mode only — default console is silent).
    dbg(`content script ${BUILD_TAG}`);
    // Initialize YouTube dual subtitles if on YouTube
    if (location.hostname === 'www.youtube.com') {
      import('./content/youtube/youtube-controller').then(({ initYouTubeSubtitles }) => {
        initYouTubeSubtitles();
      });
    }

    // Skip complex web apps (Gmail, Google Docs, etc.)
    if (SKIP_HOSTS.has(location.hostname)) return;

    // Load source language setting for text detection filters
    import('./content/text-detector').then(({ loadSourceLanguage }) => loadSourceLanguage());
    loadSelectionSourceLanguage();

    // Selection popup — translate highlighted text
    initSelectionPopup();

    let lastUrl = location.href;

    // fab is created after sm because the click handler references sm,
    // but sm's callbacks reference fab. Closures capture by reference,
    // so onStateChange/onProgress see the assigned value when actually called.
    let fab: ReturnType<typeof createFloatingButton> = undefined!;

    const sm = new TranslationStateMachine({
      translatePage,
      removeAllTranslations,
      cancelTranslation,
      hasTranslationsOnPage,
      setTranslationMode,
      checkApiKey: async () => {
        try {
          const hasKey = await hasApiKeyStored();
          if (!hasKey) {
            // First-run onboarding: the popup we're about to open should
            // explain WHY it opened and point at the key-issuance link.
            await chrome.storage.local.set({ onboardingNotice: true });
          }
          return hasKey;
        } catch (err) {
          if (isContextInvalidated(err)) {
            markContextInvalidated();
            fab.showToast('새로고침하세요.');
            return false;
          }
          throw err;
        }
      },
      onStateChange: (state) => fab.setState(state),
      onProgress: (ratio) => fab.setProgress(ratio),
      persistEnabled: async (enabled) => {
        try {
          await chrome.storage.sync.set({ translationEnabled: enabled });
        } catch (err) {
          if (isContextInvalidated(err)) {
            markContextInvalidated();
            fab.showToast('새로고침하세요.');
          }
        }
      },
      openPopup: () => {
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch((err) => {
          if (isContextInvalidated(err)) {
            markContextInvalidated();
            fab.showToast('새로고침하세요.');
          }
        });
      },
    });

    fab = createFloatingButton(async () => {
      dbg('FAB click; state=%s invalidated=%s', sm.state, isMarkedInvalidated());
      if (isMarkedInvalidated()) {
        fab.showToast('새로고침하세요.');
        return;
      }
      try {
        await sm.onFabClick();
      } catch (err) {
        if (isContextInvalidated(err)) {
          markContextInvalidated();
          fab.showToast('새로고침하세요.');
          return;
        }
        throw err;
      }
    });

    // Apply initial floating button visibility (also controls selection popup)
    chrome.storage.sync
      .get<{ floatingButtonVisible?: boolean }>('floatingButtonVisible')
      .then(({ floatingButtonVisible }) => {
        if (floatingButtonVisible === false) {
          fab.hide();
          destroySelectionPopup();
        }
      });

    // Restore translation mode from storage
    chrome.storage.sync
      .get<{ translationMode?: TranslationMode }>('translationMode')
      .then(({ translationMode: saved }) => {
        if (saved) {
          sm.setMode(saved);
          fab.setMode(saved);
        }
      });

    // Mode toggle callback
    fab.onModeToggle((mode) => {
      sm.setMode(mode);
      setTranslationMode(mode);
      chrome.storage.sync.set({ translationMode: mode }).catch(() => {});
    });

    // Load initial usage gauge (usage/cost lives in storage.local — see
    // usage-storage note: sync's write quota can't take per-batch writes)
    chrome.storage.local
      .get(USAGE_RATIO_KEY)
      .then((data) => {
        const ratio = data[USAGE_RATIO_KEY] as number | undefined;
        if (ratio !== undefined) fab.setUsageGauge(ratio);
      })
      .catch(() => {});

    // Listen for storage changes from other tabs. Usage ratio is in `local`;
    // the prefs below are in `sync` — dispatch by area, don't early-return.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[USAGE_RATIO_KEY]) {
          fab.setUsageGauge(changes[USAGE_RATIO_KEY].newValue as number);
        }
        return;
      }
      if (area !== 'sync') return;

      // Sync translation mode across tabs (live, no refresh needed)
      if (changes.translationMode) {
        const mode = changes.translationMode.newValue as TranslationMode;
        sm.setMode(mode);
        fab.setMode(mode);
        if (hasTranslationsOnPage()) {
          setTranslationMode(mode);
        }
      }

      // Sync auto-translate flag across tabs. Only update the flag here —
      // don't auto-translate background tabs (the active tab is handled by the
      // TOGGLE_AUTO_TRANSLATE message); other tabs translate on their next nav.
      if (changes.autoTranslate) {
        autoTranslate = changes.autoTranslate.newValue === true;
      }
    });

    // Listen for toggles from popup
    chrome.runtime.onMessage.addListener((message: ContentMessage) => {
      if (message.type === 'TOGGLE_TRANSLATION') {
        sm.handleToggle(message.enabled);
      }
      if (message.type === 'TOGGLE_TRANSLATION_MODE') {
        sm.setMode(message.mode);
        fab.setMode(message.mode);
        setTranslationMode(message.mode);
        chrome.storage.sync.set({ translationMode: message.mode }).catch(() => {});
      }
      if (message.type === 'TOGGLE_FLOATING_BUTTON') {
        if (message.visible) {
          fab.show();
          initSelectionPopup();
        } else {
          fab.hide();
          destroySelectionPopup();
        }
      }
      if (message.type === 'TOGGLE_AUTO_TRANSLATE') {
        autoTranslate = message.enabled;
        // Turning on replays the remembered FAB state on the current page
        // (translates only if the FAB was last ON). Turning off leaves current
        // translations as-is (toggle FAB to remove).
        if (message.enabled) void autoTranslateCurrentPage();
      }
    });

    // --- Auto-translate: opt-in "FAB state follows me across pages" ---
    // Off by default (has API cost). When on, the FAB's last on/off intent
    // (persisted as `translationEnabled` by the state machine) carries over to
    // every navigation: FAB ON → each new page auto-translates; FAB OFF → pages
    // stay untranslated until the user turns the FAB on again. Without auto
    // mode every page starts OFF regardless. Silently skips when no API key is
    // set — never nags the popup open on every page load.
    let autoTranslate = false;

    async function autoTranslateCurrentPage(): Promise<void> {
      if (!autoTranslate || isMarkedInvalidated()) return;
      if (!(await hasApiKeyStored())) return; // no key → stay quiet
      const { translationEnabled } = await chrome.storage.sync.get<{
        translationEnabled?: boolean;
      }>('translationEnabled');
      // Unset (never clicked the FAB) counts as ON — enabling auto mode should
      // just work for a fresh install.
      await sm.autoTranslateIfEnabled(translationEnabled !== false);
    }

    // Re-translate after an in-page (SPA) navigation. Falls back to the plain
    // "reset to off" behavior when auto-translate is disabled.
    function handleNavigation(): void {
      if (autoTranslate) {
        sm.handleToggle(false); // clear the previous page's translations first
        void autoTranslateCurrentPage();
      } else {
        // Reset translation state for new page — user clicks FAB to translate again
        sm.handleToggle(false);
      }
    }

    chrome.storage.sync
      .get<{ autoTranslate?: boolean }>('autoTranslate')
      .then(({ autoTranslate: on }) => {
        autoTranslate = on === true;
        if (autoTranslate) void autoTranslateCurrentPage();
      })
      .catch(() => {});

    // Detect SPA navigation via URL polling
    // (history.pushState patching doesn't work from content script's isolated world)
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleNavigation();
      }
    }, 500);

    // popstate fires for browser back/forward
    window.addEventListener('popstate', () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleNavigation();
      }
    });

    // Observe DOM mutations for SPA content changes (e.g. Substack inbox navigation)
    // Complements URL polling: catches in-page content swaps where URL may not change
    // kind: 'added' (content grew) vs 'replaced' (detected blocks removed)
    observeDynamicContent((kind) => {
      sm.onObserverContent(kind);
    });

    // Auto-translate is opt-in (default OFF) — wired above via the
    // `autoTranslate` flag, the storage load, and handleNavigation().
  },
});
