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
import { SKIP_HOSTS, USAGE_RATIO_KEY } from '@/utils/constants';
import { TranslationStateMachine } from '@/utils/translation-state';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
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
          const { selectedEngine } = await chrome.storage.sync.get<{
            selectedEngine?: string;
          }>('selectedEngine');
          const { engineApiKeys } = await chrome.storage.local.get<{
            engineApiKeys?: Record<string, string>;
          }>('engineApiKeys');
          const engine = selectedEngine || 'gemini';
          return !!engineApiKeys?.[engine];
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

    // Load initial usage gauge
    chrome.storage.sync
      .get(USAGE_RATIO_KEY)
      .then((data) => {
        const ratio = data[USAGE_RATIO_KEY] as number | undefined;
        if (ratio !== undefined) fab.setUsageGauge(ratio);
      })
      .catch(() => {});

    // Listen for storage changes from other tabs
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;

      if (changes[USAGE_RATIO_KEY]) {
        const ratio = changes[USAGE_RATIO_KEY].newValue as number;
        fab.setUsageGauge(ratio);
      }

      // Sync translation mode across tabs (live, no refresh needed)
      if (changes.translationMode) {
        const mode = changes.translationMode.newValue as TranslationMode;
        sm.setMode(mode);
        fab.setMode(mode);
        if (hasTranslationsOnPage()) {
          setTranslationMode(mode);
        }
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
    });

    // Detect SPA navigation via URL polling
    // (history.pushState patching doesn't work from content script's isolated world)
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset translation state for new page — user clicks FAB to translate again
        sm.handleToggle(false);
      }
    }, 500);

    // popstate fires for browser back/forward
    window.addEventListener('popstate', () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        sm.handleToggle(false);
      }
    });

    // Observe DOM mutations for SPA content changes (e.g. Substack inbox navigation)
    // Complements URL polling: catches in-page content swaps where URL may not change
    observeDynamicContent(() => {
      sm.onObserverContent();
    });

    // Auto-translate on page load is disabled — default is always OFF.
    // User clicks FAB to translate. The autoTranslateIfEnabled() method
    // and persistEnabled() calls in the state machine are preserved for
    // future opt-in auto-translate feature.
  },
});
