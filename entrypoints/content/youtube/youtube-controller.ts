import type { SubtitleCue } from '@/types';
import type { ContentMessage, TranslateBatchResponse } from '@/utils/messaging';
import {
  fetchCaptionTracks,
  pickSourceLanguageTrack,
  downloadSubtitles,
  baseLanguage,
} from './subtitle-fetcher';
import { startRollingTranslation } from './subtitle-translator';
import {
  startOverlay,
  stopOverlay,
  updateOverlayCues,
  setDisplayMode,
  flashOverlayNotice,
  type SubtitleDisplayMode,
} from './subtitle-overlay';
import { injectYtPlayerButton, type YtPlayerButton } from './yt-player-button';
import { getVideoId } from '@/utils/youtube-helpers';
import { mergeCues, mergeCuesTwoLine, postProcessCues } from './cue-merger';
import './subtitle-styles.css';
import { isContextInvalidated, markContextInvalidated } from '../context-invalidated';
import { LANG_STORAGE_KEY, DEFAULT_TARGET_LANG, LANGUAGES } from '@/utils/constants';
import type { LanguageCode } from '@/utils/constants';
import { clearVideo as clearTranslations } from './subtitle-cache';

// AI subtitle segmentation: read from chrome.storage.sync at runtime

/** 'one-line': 1줄 강제 (nowrap, MAX 80). 'two-line': 2줄 balance (MAX 110). */
const SUBTITLE_LINE_MODE: 'one-line' | 'two-line' = 'one-line';

const SEGMENT_BATCH_SIZE = 80;

let button: YtPlayerButton | null = null;
let buttonReady: Promise<void> = Promise.resolve();
let isActive = false;
let abortController: AbortController | null = null;
let currentMode: SubtitleDisplayMode = 'both';
// When the caption language matches the target, we display the original captions
// only (no translation). Mode cycling is disabled in this state.
let isSourceOnly = false;
// Track active state for language change restart
let activeVideoId: string | null = null;
let activeCues: SubtitleCue[] | null = null;
let rollingAbortRef: AbortController | null = null;

export function initYouTubeSubtitles(): void {
  buttonReady = injectButton();
  document.addEventListener('yt-navigate-finish', () => {
    if (isActive) cancelPipeline();
    if (!document.querySelector('.b3rys-yt-btn')) buttonReady = injectButton();
  });

  // Apply initial visibility
  buttonReady.then(async () => {
    try {
      const { ytButtonVisible } = await chrome.storage.sync.get<{
        ytButtonVisible?: boolean;
      }>('ytButtonVisible');
      if (ytButtonVisible === false) button?.hide();
    } catch {
      // Extension context invalidated — ignore silently
    }
  });

  // Restart rolling translation when target language changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[LANG_STORAGE_KEY]) return;
    if (!isActive || !activeVideoId || !activeCues || !abortController) return;

    // Clear subtitle cache for current video and restart translation
    clearTranslations(activeVideoId);
    if (rollingAbortRef) rollingAbortRef.abort();
    rollingAbortRef = new AbortController();
    const signal = abortController.signal;
    signal.addEventListener('abort', () => rollingAbortRef!.abort(), { once: true });
    startRollingTranslation(activeVideoId, activeCues, rollingAbortRef.signal);
    console.log('[b3rys] Language changed — restarting subtitle translation');
  });

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((message: ContentMessage) => {
    if (message.type === 'TOGGLE_YT_BUTTON') {
      buttonReady
        .then(() => {
          if (message.visible) {
            button?.show();
          } else {
            button?.hide();
          }
        })
        .catch(() => {});
    }
  });
}

export function destroyYouTubeSubtitles(): void {
  cancelPipeline();
  button?.destroy();
  button = null;
}

async function injectButton(): Promise<void> {
  button = await injectYtPlayerButton(handleButtonClick);
}

function cancelPipeline(): void {
  abortController?.abort();
  abortController = null;
  rollingAbortRef = null;
  activeVideoId = null;
  activeCues = null;
  stopOverlay();
  window.postMessage({ type: '__b3rys_restore_captions' });
  isActive = false;
  currentMode = 'both';
  isSourceOnly = false;
  button?.setState('idle');
}

/** Read the target language from storage (falls back to default). */
async function getTargetLanguage(): Promise<string> {
  try {
    const data = await chrome.storage.sync.get(LANG_STORAGE_KEY);
    const stored = data[LANG_STORAGE_KEY] as { target?: string } | undefined;
    return stored?.target || DEFAULT_TARGET_LANG;
  } catch {
    return DEFAULT_TARGET_LANG;
  }
}

/**
 * Show a neutral (non-error) notice on the button and reset to idle.
 * Used when there is simply nothing to translate — not a failure.
 */
function showNotice(message: string): void {
  console.log(`[b3rys] ${message}`);
  cancelPipeline();
  button?.setState('info', message);
  setTimeout(() => button?.setState('idle'), 4000);
}

/**
 * Use LLM to add punctuation to ASR subtitle text, then run heuristic merge.
 * LLM only adds periods/commas/question marks — the proven mergeCues handles splitting.
 * Timing is preserved from original cues (no word-timing mapping needed).
 */
async function semanticMergeCues(cues: SubtitleCue[], signal: AbortSignal): Promise<SubtitleCue[]> {
  const updated = cues.map((c) => ({ ...c }));

  for (let i = 0; i < updated.length; i += SEGMENT_BATCH_SIZE) {
    if (signal.aborted) throw new Error('Aborted');

    const batch = updated.slice(i, i + SEGMENT_BATCH_SIZE);
    const paragraphs = batch.map((f, idx) => ({
      id: String(idx + 1),
      text: f.text,
    }));

    const response: TranslateBatchResponse = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      paragraphs,
      mode: 'segment',
    });

    if (response.error) throw new Error(response.error);

    const rawEntry = response.translations.find((t) => t.id === '__raw__');
    if (!rawEntry) throw new Error('No punctuation response received');

    // Clean LLM output: strip markdown fencing, join into single text
    const punctuated = rawEntry.translatedText
      .replace(/```[^\n]*\n?/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log(
      `[b3rys] Punctuation (batch ${Math.floor(i / SEGMENT_BATCH_SIZE) + 1}):`,
      punctuated.slice(0, 200),
    );

    // Map punctuated words back to cues by content matching (not word count)
    // This prevents cascading misalignment when LLM changes word count
    const pWords = punctuated.split(/\s+/).filter(Boolean);
    const strip = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

    let pIdx = 0;
    for (const cue of batch) {
      const origWords = cue.text.split(/\s+/).filter(Boolean);
      const newWords: string[] = [];
      for (const ow of origWords) {
        const owClean = strip(ow);
        let matched = false;
        // Look ahead up to 3 positions (handles LLM inserting extra words)
        for (let look = 0; look <= 3 && pIdx + look < pWords.length; look++) {
          if (strip(pWords[pIdx + look]) === owClean) {
            newWords.push(pWords[pIdx + look]); // use punctuated version
            pIdx = pIdx + look + 1;
            matched = true;
            break;
          }
        }
        if (!matched) {
          newWords.push(ow); // keep original word unchanged
        }
      }
      if (newWords.length > 0) {
        cue.text = newWords.join(' ');
      }
    }
  }

  // Run heuristic merge on punctuated cues — now has sentence boundaries
  const result = SUBTITLE_LINE_MODE === 'two-line' ? mergeCuesTwoLine(updated) : mergeCues(updated);

  // AI splits are more precise → add small extra lead
  const EXTRA_LEAD = 0.2;
  for (const c of result) {
    const origEnd = c.start + c.duration;
    c.start = Math.max(0, c.start - EXTRA_LEAD);
    c.duration = origEnd - c.start; // preserve end time
  }

  return result;
}

async function handleButtonClick(): Promise<void> {
  if (isActive) {
    // Source-only captions have no translation to cycle through — click turns off.
    if (isSourceOnly) {
      cancelPipeline();
      console.log('[b3rys] Source-only captions OFF');
      return;
    }
    if (currentMode === 'both') {
      currentMode = 'en';
    } else if (currentMode === 'en') {
      currentMode = 'ko';
    } else {
      cancelPipeline();
      console.log('[b3rys] Translate OFF');
      return;
    }
    setDisplayMode(currentMode);
    button?.setMode(currentMode);
    console.log(`[b3rys] Display mode: ${currentMode}`);
    return;
  }

  const videoId = getVideoId();
  if (!videoId) return;

  isActive = true;
  currentMode = 'both';
  abortController = new AbortController();
  const signal = abortController.signal;
  button?.setState('loading');

  try {
    window.postMessage({ type: '__b3rys_trigger_captions' });

    const tracks = await fetchCaptionTracks();
    if (signal.aborted) return;

    const track = await pickSourceLanguageTrack(tracks);
    if (!track) {
      // No caption tracks on this video at all — nothing to work with.
      showNotice('이 영상에는 자막이 없습니다');
      return;
    }

    // If the only available caption language already matches the target
    // (e.g. a Korean video with target=Korean), there is nothing to translate.
    // Show the original captions in the b3rys overlay (no translation line).
    const targetLang = await getTargetLanguage();
    const sourceOnly = baseLanguage(track.languageCode) === baseLanguage(targetLang);

    const cues = await downloadSubtitles(track);
    if (signal.aborted) return;

    if (cues.length === 0) {
      console.log('[b3rys] No subtitle cues found');
      cancelPipeline();
      button?.setState('error');
      setTimeout(() => button?.setState('idle'), 3000);
      return;
    }

    // Manual subtitles: already well-formatted → use as-is (just apply LEAD + duration chain)
    // ASR subtitles: tiny fragments → need heuristic merge
    const isManual = track.kind !== 'asr';
    let merged: SubtitleCue[];
    if (isManual) {
      merged = postProcessCues(cues, 85, 0.1);
      console.log(`[b3rys] Manual subs: ${cues.length} cues (no merge needed)`);
    } else {
      merged = SUBTITLE_LINE_MODE === 'two-line' ? mergeCuesTwoLine(cues) : mergeCues(cues);
      console.log(
        `[b3rys] ASR ${SUBTITLE_LINE_MODE === 'two-line' ? '2-line' : '1-line'} merge: ${cues.length} cues → ${merged.length} chunks`,
      );
    }

    // Source-only: caption language matches target → show original captions with
    // a brief notice, and skip translation + semantic refinement entirely.
    if (sourceOnly) {
      startOverlay(videoId, merged, { sourceOnly: true });
      isSourceOnly = true;
      const langLabel =
        LANGUAGES[track.languageCode as LanguageCode]?.nativeName ?? track.languageCode;
      flashOverlayNotice(`원문 자막 (${langLabel}) · 번역 없음`);
      button?.setState('active', `원문 자막 (${langLabel}) · 클릭: 끄기`);
      activeVideoId = videoId;
      activeCues = merged;
      console.log(`[b3rys] Source-only captions (${track.languageCode}) — no translation`);
      return;
    }

    startOverlay(videoId, merged);
    button?.setState('active');
    activeVideoId = videoId;
    activeCues = merged;

    // Rolling translation controller — can be restarted on refinement
    let rollingAbort = new AbortController();
    rollingAbortRef = rollingAbort;
    signal.addEventListener('abort', () => rollingAbort.abort(), { once: true });
    startRollingTranslation(videoId, merged, rollingAbort.signal);

    // Semantic refinement: only for ASR subtitles (manual subs already have punctuation)
    if (!isManual) {
      const { ytAiSubtitleEnabled, selectedEngine } = await chrome.storage.sync.get<{
        ytAiSubtitleEnabled?: boolean;
        selectedEngine?: string;
      }>(['ytAiSubtitleEnabled', 'selectedEngine']);
      console.log(
        `[b3rys] AI subtitle check: enabled=${ytAiSubtitleEnabled}, engine=${selectedEngine}`,
      );
      if (ytAiSubtitleEnabled !== false) {
        semanticMergeCues(cues, signal)
          .then((semanticMerged) => {
            if (signal.aborted) return;
            console.log(
              `[b3rys] Semantic refinement: ${merged.length} → ${semanticMerged.length} chunks`,
            );

            // Hot-swap cues in overlay
            updateOverlayCues(semanticMerged);
            activeCues = semanticMerged;

            // Restart rolling translation with new cues
            rollingAbort.abort();
            rollingAbort = new AbortController();
            rollingAbortRef = rollingAbort;
            signal.addEventListener('abort', () => rollingAbort.abort(), { once: true });
            startRollingTranslation(videoId, semanticMerged, rollingAbort.signal);
          })
          .catch((err) => {
            if (!signal.aborted) {
              console.warn('[b3rys] Semantic refinement failed, keeping heuristic:', err);
            }
          });
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      if (isContextInvalidated(err)) {
        markContextInvalidated();
        return;
      }
      console.error('[b3rys] Subtitle error:', err);
      cancelPipeline();
      button?.setState('error');
      setTimeout(() => button?.setState('idle'), 3000);
    }
  }
}
