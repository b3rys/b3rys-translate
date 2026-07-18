import type { CaptionTrack, SubtitleCue } from '@/types';
import { LANG_STORAGE_KEY, DEFAULT_SOURCE_LANG } from '@/utils/constants';

/**
 * Extract caption tracks from YouTube's player response.
 */
export async function fetchCaptionTracks(): Promise<CaptionTrack[]> {
  const playerResponse = await getPlayerResponse();
  if (!playerResponse) {
    console.warn('[b3rys] No player response found');
    return [];
  }

  const captions = playerResponse.captions as Record<string, Record<string, unknown[]>> | undefined;
  const tracks: CaptionTrack[] = (
    captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  ).map((t: unknown) => {
    const track = t as Record<string, unknown>;
    return {
      baseUrl: track.baseUrl as string,
      languageCode: (track.languageCode as string) ?? '',
      name: ((track.name as Record<string, string>)?.simpleText as string) ?? '',
      kind: (track.kind as string) ?? undefined,
    };
  });

  console.log(
    `[b3rys] Found ${tracks.length} caption tracks:`,
    tracks.map((t) => `${t.languageCode}(${t.kind ?? 'manual'})`),
  );
  return tracks;
}

/**
 * Pick the best caption track for the source language.
 * Prefers manual captions over auto-generated (ASR).
 */
export function pickEnglishTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  return pickSourceTrack(tracks, 'en');
}

export async function pickSourceLanguageTrack(
  tracks: CaptionTrack[],
): Promise<CaptionTrack | null> {
  if (tracks.length === 0) return null;

  let sourceLang = DEFAULT_SOURCE_LANG;
  try {
    const data = await chrome.storage.local.get(LANG_STORAGE_KEY);
    const stored = data[LANG_STORAGE_KEY] as { source?: string } | undefined;
    sourceLang = (stored?.source as typeof DEFAULT_SOURCE_LANG) || DEFAULT_SOURCE_LANG;
  } catch {
    /* use default */
  }

  // Prefer the configured source language (e.g. English videos → English track).
  const preferred = pickSourceTrack(tracks, sourceLang);
  if (preferred) return preferred;

  // No track in the configured source language (e.g. a Korean video with only
  // Korean captions). Fall back to the video's primary caption track and let the
  // translator auto-detect the source. Prefer manual captions over ASR.
  const fallback = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
  console.log(
    `[b3rys] No '${sourceLang}' caption track — falling back to '${fallback.languageCode}' (${fallback.kind ?? 'manual'})`,
  );
  return fallback;
}

/** Base language subtag ('en-US' → 'en') for cross-locale comparison. */
export function baseLanguage(code: string): string {
  return (code || '').split('-')[0].toLowerCase();
}

function pickSourceTrack(tracks: CaptionTrack[], lang: string): CaptionTrack | null {
  const matched = tracks.filter((t) => t.languageCode.startsWith(lang));
  if (matched.length === 0) return null;

  const manual = matched.find((t) => t.kind !== 'asr');
  return manual ?? matched[0];
}

/**
 * Download subtitle cues.
 * Strategy 1: Check intercepted timedtext data (from YouTube's own requests)
 * Strategy 2: Wait for YouTube to load subtitles (5s)
 * Strategy 3: Direct fetch via bridge
 */
export async function downloadSubtitles(track: CaptionTrack): Promise<SubtitleCue[]> {
  console.log('[b3rys] Track:', track.languageCode, track.kind ?? 'manual');

  // Strategy 1: Already intercepted?
  let text = checkInterceptedData(track.languageCode);
  if (text) {
    console.log(`[b3rys] Using intercepted data: length=${text.length}`);
    return parseSubtitleResponse(text);
  }

  // Strategy 2: Wait for YouTube's own subtitle loading
  console.log('[b3rys] Waiting for YouTube timedtext interception...');
  text = await waitForInterception(track.languageCode, 5000);
  if (text) {
    console.log(`[b3rys] Got intercepted data: length=${text.length}`);
    return parseSubtitleResponse(text);
  }

  // Strategy 3: Direct fetch via bridge
  const sep = track.baseUrl.includes('?') ? '&' : '?';
  const urls = [track.baseUrl + sep + 'fmt=json3', track.baseUrl];
  for (const url of urls) {
    console.log('[b3rys] Direct fetch attempt:', url.substring(0, 120));
    try {
      const result = await bridgeFetch(url);
      console.log(`[b3rys] Direct fetch response: length=${result.length}`);
      if (result) return parseSubtitleResponse(result);
    } catch (err) {
      console.warn('[b3rys] Direct fetch failed:', err);
    }
  }

  throw new Error('All subtitle fetch strategies failed');
}

// ===================== Timedtext interception =====================

const interceptedData = new Map<string, string>();

window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type !== '__b3rys_timedtext_intercepted') return;
  console.log(`[b3rys] Received intercepted timedtext: length=${e.data.text?.length}`);
  interceptedData.set(e.data.url, e.data.text);
});

function checkInterceptedData(lang: string): string | null {
  for (const [url, text] of interceptedData) {
    if (url.includes(`lang=${lang}`)) return text;
  }
  return null;
}

function waitForInterception(lang: string, timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = checkInterceptedData(lang);
    if (existing) {
      resolve(existing);
      return;
    }

    const handler = (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_timedtext_intercepted') return;
      if ((e.data.url ?? '').includes(`lang=${lang}`)) {
        window.removeEventListener('message', handler);
        clearTimeout(timer);
        resolve(e.data.text);
      }
    };
    window.addEventListener('message', handler);
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, timeout);
  });
}

// ===================== Bridge communication =====================

function bridgeFetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_fetch_response') return;
      if (e.data.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.text);
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: '__b3rys_fetch_request', url, requestId });
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Bridge fetch timeout'));
    }, 15000);
  });
}

/**
 * Get player response via MAIN world bridge.
 * The bridge reads window.ytInitialPlayerResponse directly.
 * Falls back to script tag parsing.
 */
async function getPlayerResponse(): Promise<Record<string, unknown> | null> {
  // Strategy 1: Ask MAIN world bridge for ytInitialPlayerResponse
  const fromBridge = await getPlayerResponseFromBridge();
  if (fromBridge) {
    const videoId = new URLSearchParams(location.search).get('v');
    const responseVideoId = (fromBridge.videoDetails as Record<string, string>)?.videoId;
    console.log(`[b3rys] Bridge player response: videoId=${responseVideoId}, expected=${videoId}`);
    if (responseVideoId === videoId) return fromBridge;
  }

  // Strategy 2: Parse from script tags
  const fromDOM = extractFromScripts();
  if (fromDOM) {
    console.log('[b3rys] Using player response from script tags');
    return fromDOM;
  }

  // Strategy 3: Fetch page HTML
  try {
    console.log('[b3rys] Fetching page HTML for player response...');
    const response = await fetch(location.href);
    const html = await response.text();
    return extractPlayerResponseJSON(html);
  } catch {
    return null;
  }
}

function getPlayerResponseFromBridge(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_player_response') return;
      window.removeEventListener('message', handler);
      resolve(e.data.data ?? null);
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: '__b3rys_get_player_response' });
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 3000);
  });
}

// ===================== Script tag parsing (fallback) =====================

function extractFromScripts(): Record<string, unknown> | null {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text?.includes('ytInitialPlayerResponse')) continue;
    const result = extractPlayerResponseJSON(text);
    if (result) return result;
  }
  return null;
}

function extractPlayerResponseJSON(text: string): Record<string, unknown> | null {
  const marker = 'ytInitialPlayerResponse';
  const start = text.indexOf(marker);
  if (start === -1) return null;

  const eqIdx = text.indexOf('=', start + marker.length);
  if (eqIdx === -1) return null;

  const braceIdx = text.indexOf('{', eqIdx);
  if (braceIdx === -1) return null;

  try {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = braceIdx; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.substring(braceIdx, i + 1));
        }
      }
    }
  } catch {
    /* parse failed */
  }

  return null;
}

// ===================== Subtitle parsing =====================

export function parseSubtitleResponse(text: string): SubtitleCue[] {
  // Try JSON (fmt=json3)
  try {
    const data = JSON.parse(text);
    const events: SubtitleCue[] = [];
    for (const event of data.events ?? []) {
      const segs = event.segs as { utf8: string }[] | undefined;
      if (!segs) continue;
      const cueText = segs
        .map((seg: { utf8: string }) => seg.utf8)
        .join('')
        .trim();
      if (!cueText) continue;
      events.push({
        start: ((event.tStartMs as number) ?? 0) / 1000,
        duration: ((event.dDurationMs as number) ?? 0) / 1000,
        text: cueText,
      });
    }
    if (events.length > 0) return events;
  } catch {
    /* not JSON */
  }

  // Try XML
  const events: SubtitleCue[] = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const decoded = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '')
      .trim();
    if (decoded) {
      events.push({ start: parseFloat(match[1]), duration: parseFloat(match[2]), text: decoded });
    }
  }
  if (events.length > 0) return events;

  throw new Error(`Unrecognized subtitle format: ${text.substring(0, 200)}`);
}
