import type { SubtitleCue } from '@/types';
import { getTranslation } from './subtitle-cache';

export type SubtitleDisplayMode = 'both' | 'en' | 'ko';
let displayMode: SubtitleDisplayMode = 'both';

export function setDisplayMode(mode: SubtitleDisplayMode): void {
  displayMode = mode;
  lastDisplayedIdx = -1; // force re-render
}

let overlayEl: HTMLElement | null = null;
let originalEl: HTMLElement | null = null;
let translatedEl: HTMLElement | null = null;
let videoEl: HTMLVideoElement | null = null;
let cues: SubtitleCue[] = [];
let currentVideoId: string | null = null;
let rafId: number | null = null;
let lastDisplayedIdx = -1;
let isSeeking = false;
// When the caption language already matches the target, there is nothing to
// translate — show the original captions only (no translation line, no "...").
let sourceOnly = false;

/**
 * Create a custom subtitle overlay at the bottom of the video player.
 * Hides YouTube's native CC and syncs display with video time.
 */
export function startOverlay(
  videoId: string,
  subtitleCues: SubtitleCue[],
  opts?: { sourceOnly?: boolean },
): void {
  stopOverlay();
  currentVideoId = videoId;
  cues = subtitleCues;
  lastDisplayedIdx = -1;
  sourceOnly = opts?.sourceOnly ?? false;

  videoEl = document.querySelector('video');
  if (!videoEl) {
    console.warn('[b3rys] No video element found for overlay');
    return;
  }

  // Hide YouTube's native captions
  setYouTubeCCHidden(true);

  // Create overlay inside the player
  const player = document.getElementById('movie_player');
  if (!player) {
    console.warn('[b3rys] No movie_player element for overlay');
    return;
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'b3rys-subtitle-overlay';

  originalEl = document.createElement('div');
  originalEl.className = 'b3rys-subtitle-line b3rys-subtitle-original';

  translatedEl = document.createElement('div');
  translatedEl.className = 'b3rys-subtitle-line b3rys-subtitle-translated';

  overlayEl.appendChild(originalEl);
  overlayEl.appendChild(translatedEl);
  player.appendChild(overlayEl);

  // Inject dynamic font-size rule (bypasses content script CSS caching)
  injectFontSizeStyle();

  // Hide overlay during seek to prevent stale subtitle flash
  videoEl.addEventListener('seeking', onSeeking);
  videoEl.addEventListener('seeked', onSeeked);

  // Start rAF-driven display loop for smooth subtitle updates
  startDisplayLoop();

  console.log('[b3rys] Custom subtitle overlay started');
}

/**
 * Show a brief, auto-dismissing notice near the top of the player.
 * Used for lightweight status messages (e.g. "original captions, no translation").
 */
export function flashOverlayNotice(message: string): void {
  const player = document.getElementById('movie_player');
  if (!player) return;
  player.querySelector('.b3rys-yt-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'b3rys-yt-notice';
  el.textContent = message;
  player.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/**
 * Hot-swap cues without tearing down the overlay.
 * Used by semantic refinement to upgrade from heuristic to LLM-segmented cues.
 */
export function updateOverlayCues(newCues: SubtitleCue[]): void {
  cues = newCues;
  lastDisplayedIdx = -1; // force re-render on next tick
}

export function stopOverlay(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (videoEl) {
    videoEl.removeEventListener('seeking', onSeeking);
    videoEl.removeEventListener('seeked', onSeeked);
  }
  overlayEl?.remove();
  removeFontSizeStyle();
  overlayEl = null;
  originalEl = null;
  translatedEl = null;
  videoEl = null;
  cues = [];
  currentVideoId = null;
  lastDisplayedIdx = -1;
  isSeeking = false;
  displayMode = 'both';
  sourceOnly = false;

  // Restore YouTube's native captions
  setYouTubeCCHidden(false);
}

function onSeeking(): void {
  isSeeking = true;
  if (overlayEl) overlayEl.style.display = 'none';
  lastDisplayedIdx = -1;
}

function onSeeked(): void {
  isSeeking = false;
  // Next rAF tick will pick up the correct cue
}

function startDisplayLoop(): void {
  function tick(): void {
    if (!videoEl || !overlayEl) return;
    updateDisplay();
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function updateDisplay(): void {
  if (!videoEl || !overlayEl || !originalEl || !translatedEl || !currentVideoId) return;
  if (isSeeking) return;

  const idx = findCurrentCueIdx(videoEl.currentTime);

  if (idx === -1) {
    if (lastDisplayedIdx !== -1) {
      overlayEl.style.display = 'none';
      lastDisplayedIdx = -1;
    }
    return;
  }

  const cue = cues[idx];

  // Source-only mode: caption language already matches target — show the
  // original captions with no translation line.
  if (sourceOnly) {
    if (idx === lastDisplayedIdx) return;
    lastDisplayedIdx = idx;
    overlayEl.style.display = '';
    originalEl.textContent = decodeEntities(cue.text);
    originalEl.style.display = '';
    translatedEl.textContent = '';
    translatedEl.style.display = 'none';
    return;
  }

  // Skip DOM update if same cue is already displayed (check translation availability too)
  const translation = getTranslation(currentVideoId, cue.text);

  const decodedTranslation = translation ? decodeEntities(translation) : '...';
  if (idx === lastDisplayedIdx && translatedEl.textContent === decodedTranslation) {
    return;
  }

  lastDisplayedIdx = idx;
  overlayEl.style.display = '';

  originalEl.textContent = decodeEntities(cue.text);
  originalEl.style.display = displayMode === 'ko' ? 'none' : '';

  if (translation) {
    translatedEl.textContent = decodeEntities(translation);
    translatedEl.classList.remove('b3rys-subtitle-loading');
  } else {
    translatedEl.textContent = '...';
    translatedEl.classList.add('b3rys-subtitle-loading');
  }
  translatedEl.style.display = displayMode === 'en' ? 'none' : '';
}

/**
 * Binary search to find the cue index active at the given time.
 * Cues are sorted by start time. Returns -1 if no cue is active.
 */
function findCurrentCueIdx(time: number): number {
  let lo = 0;
  let hi = cues.length - 1;

  // Find the last cue whose start <= time
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].start <= time) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (candidate === -1) return -1;

  const c = cues[candidate];
  if (time < c.start + c.duration) {
    return candidate;
  }

  return -1;
}

/** Decode HTML entities (&quot; &amp; etc.) in subtitle text */
function decodeEntities(text: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

const FONT_STYLE_ID = 'b3rys-subtitle-font';
let playerResizeObserver: ResizeObserver | null = null;

/**
 * Recompute the subtitle font size from the *player* width, not the window.
 * vw units scale with the whole viewport, so the text ballooned in a wide
 * window or fullscreen even when the player itself was small. Scaling off the
 * player's own width (like YouTube's native captions) keeps the size in
 * proportion to the video in every layout.
 */
function updateFontSize(): void {
  const player = document.getElementById('movie_player');
  const style = document.getElementById(FONT_STYLE_ID);
  if (!player || !style) return;
  const px = Math.round(Math.min(38, Math.max(16, player.clientWidth * 0.023)));
  style.textContent = `.b3rys-subtitle-line { font-size: ${px}px !important; }`;
}

/**
 * Inject the font-size <style> tag and keep it in sync with the player size.
 * Injected via JS to bypass content script CSS caching issues.
 */
function injectFontSizeStyle(): void {
  if (!document.getElementById(FONT_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = FONT_STYLE_ID;
    document.head.appendChild(style);
  }
  updateFontSize();

  const player = document.getElementById('movie_player');
  if (player && 'ResizeObserver' in window) {
    playerResizeObserver = new ResizeObserver(() => updateFontSize());
    playerResizeObserver.observe(player);
  }
  // Fullscreen transitions don't always resize #movie_player synchronously.
  document.addEventListener('fullscreenchange', updateFontSize);
}

function removeFontSizeStyle(): void {
  document.getElementById(FONT_STYLE_ID)?.remove();
  playerResizeObserver?.disconnect();
  playerResizeObserver = null;
  document.removeEventListener('fullscreenchange', updateFontSize);
}

/**
 * Hide or restore YouTube's native caption windows via a style element.
 */
function setYouTubeCCHidden(hidden: boolean): void {
  const id = 'b3rys-hide-yt-cc';
  const existing = document.getElementById(id);

  if (hidden && !existing) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '.caption-window { display: none !important; }';
    document.head.appendChild(style);
  } else if (!hidden && existing) {
    existing.remove();
  }
}
