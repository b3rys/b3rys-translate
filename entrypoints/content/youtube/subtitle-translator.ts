import type { SubtitleCue } from '@/types';
import type { TranslateBatchResponse } from '@/utils/messaging';
import {
  SUBTITLE_LOOK_AHEAD_SEC,
  SUBTITLE_BATCH_SIZE,
  LANG_STORAGE_KEY,
  DEFAULT_TARGET_LANG,
} from '@/utils/constants';
import { getTranslation, setTranslations } from './subtitle-cache';

const THROTTLE_MS = 250;
const SEEK_LOOK_BACK = 3;
const PRIORITY_SIZE = 5;

/**
 * Event-driven rolling translator.
 * Listens to timeupdate/seeking/seeked events instead of polling.
 * Translates N cues ahead (and a few behind on seek) of current playback position.
 * Tracks in-flight requests to prevent duplicate API calls.
 */
export async function startRollingTranslation(
  videoId: string,
  cues: SubtitleCue[],
  signal: AbortSignal,
): Promise<void> {
  const video = document.querySelector('video');
  if (!video || signal.aborted) return;

  let targetLang = DEFAULT_TARGET_LANG;
  try {
    const data = await chrome.storage.sync.get(LANG_STORAGE_KEY);
    const stored = data[LANG_STORAGE_KEY] as { target?: string } | undefined;
    targetLang = (stored?.target as typeof DEFAULT_TARGET_LANG) || DEFAULT_TARGET_LANG;
  } catch {
    /* use default */
  }

  return new Promise((resolve) => {
    const inFlight = new Set<string>();
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    function translateWindow(lookBack: number = 0): void {
      if (signal.aborted) return;

      const currentTime = video!.currentTime;
      const startIdx = cues.findIndex((c) => c.start + c.duration > currentTime);
      if (startIdx === -1) return;

      const from = Math.max(0, startIdx - lookBack);
      const cutoffTime = currentTime + SUBTITLE_LOOK_AHEAD_SEC;
      const toIdx = cues.findIndex((c) => c.start > cutoffTime);
      const to = toIdx === -1 ? cues.length : toIdx;
      const windowCues = cues.slice(from, to);

      const untranslated = windowCues.filter(
        (c) => !getTranslation(videoId, c.text) && !inFlight.has(c.text),
      );
      if (untranslated.length === 0) return;

      // Mark in-flight
      for (const c of untranslated) inFlight.add(c.text);

      // Collect context: up to 3 already-translated cues before the window
      const contextStart = Math.max(0, from - 3);
      const subtitleContext = cues
        .slice(contextStart, from)
        .map((c) => ({
          original: c.text,
          translated: getTranslation(videoId, c.text) || '',
        }))
        .filter((c) => c.translated);

      // Priority micro-batch: current + next few cues for fast response
      const priorityCues = untranslated.slice(0, PRIORITY_SIZE);
      const futureCues = untranslated.slice(PRIORITY_SIZE);

      if (priorityCues.length > 0) sendBatch(priorityCues);
      for (const batch of chunkArray(futureCues, SUBTITLE_BATCH_SIZE)) {
        sendBatch(batch);
      }

      function sendBatch(batch: SubtitleCue[]): void {
        const paragraphs = batch.map((cue, i) => ({ id: String(i), text: cue.text }));

        chrome.runtime
          .sendMessage({
            type: 'TRANSLATE_BATCH',
            paragraphs,
            mode: 'subtitle',
            subtitleContext: subtitleContext.length > 0 ? subtitleContext : undefined,
            targetLang,
          })
          .then((response: TranslateBatchResponse) => {
            if (signal.aborted) return;

            // Clear in-flight
            for (const c of batch) inFlight.delete(c.text);

            if (response?.error) {
              console.warn('[b3rys] Subtitle translation error:', response.error);
              return;
            }

            if (response?.translations) {
              const entries = response.translations.map((t) => ({
                original: batch[parseInt(t.id)].text,
                translated: t.translatedText,
              }));
              setTranslations(videoId, entries);
            }
          })
          .catch((err: unknown) => {
            // Clear in-flight so retry is possible on next event
            for (const c of batch) inFlight.delete(c.text);
            console.warn('[b3rys] Subtitle translation failed:', err);
          });
      }
    }

    function onTimeUpdate(): void {
      if (throttleTimer) return;
      translateWindow();
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
      }, THROTTLE_MS);
    }

    function onSeeked(): void {
      // On seek complete: translate around final position including backward cues
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      translateWindow(SEEK_LOOK_BACK);
    }

    function onPlay(): void {
      // Resume: immediately check for untranslated cues (bypass throttle)
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      translateWindow();
    }

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('play', onPlay);

    // Initial trigger
    translateWindow();

    // Cleanup on abort
    signal.addEventListener(
      'abort',
      () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('play', onPlay);
        if (throttleTimer) clearTimeout(throttleTimer);
        resolve();
      },
      { once: true },
    );
  });
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
