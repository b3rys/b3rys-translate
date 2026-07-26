import type { CaptionTrack, SubtitleCue } from '@/types';
import { LANG_STORAGE_KEY, DEFAULT_SOURCE_LANG } from '@/utils/constants';
import { getVideoId } from '@/utils/youtube-helpers';

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

/** Downloaded cues plus the kind of captions they actually are. */
export type SubtitleDownload = { cues: SubtitleCue[]; isAsr: boolean };

/**
 * Download subtitle cues.
 * Strategy 1: Check intercepted timedtext data (from YouTube's own requests)
 * Strategy 2: Re-target an intercepted URL to the track we want (borrows its token)
 * Strategy 3: Wait for YouTube to load subtitles (5s)
 * Strategy 4: Direct fetch of the track's own baseUrl
 */
export async function downloadSubtitles(
  track: CaptionTrack,
  videoId: string | null = getVideoId(),
): Promise<SubtitleDownload> {
  console.log('[b3rys] Track:', track.languageCode, track.kind ?? 'manual');
  const query: TrackQuery = { lang: track.languageCode, kind: track.kind };
  const triedUrls = new Set<string>();

  // Strategies 1+2 over whatever has been intercepted so far.
  const fromInterceptions = async (): Promise<SubtitleDownload | null> => {
    // 1: an interception of the track itself.
    const hit = findInterceptedTrack(query, videoId);
    if (hit) {
      console.log(`[b3rys] Using intercepted data: length=${hit.text.length}`);
      // An unparseable payload must not dead-end the pipeline — drop it and let the
      // remaining strategies run instead of throwing out of downloadSubtitles.
      const cues = tryParse(hit.text);
      if (cues) return asDownload(cues, hit);
      dropInterceptedTrack(hit.text);
    }

    // 2: YouTube loaded some *other* track for this video — borrow its token and
    // ask for the one we want.
    const tokenized = tokenizedUrlFor(query, videoId);
    if (!tokenized || triedUrls.has(tokenized)) return null;
    triedUrls.add(tokenized);
    console.log('[b3rys] Re-targeting an intercepted URL to', `${query.lang}/${queryKind(query)}`);
    try {
      const result = await bridgeFetch(tokenized);
      console.log(`[b3rys] Re-targeted fetch: length=${result.length}`);
      const cues = result ? tryParse(result) : null;
      if (cues) return { cues, isAsr: isAsrKind(query.kind) };
    } catch (err) {
      console.warn('[b3rys] Re-targeted fetch failed:', err);
    }
    return null;
  };

  const cached = await fromInterceptions();
  if (cached) return cached;

  // Strategy 3: nothing intercepted yet — captions load ~1s after we ask YouTube to
  // turn them on. Wait for ANY payload for this video (not just our language: a
  // different one still carries the token), then retry the strategies above.
  console.log('[b3rys] Waiting for YouTube timedtext interception...');
  if (await waitForAnyInterception(videoId, 5000)) {
    const afterWait = await fromInterceptions();
    if (afterWait) return afterWait;
  }

  // Strategy 4: Direct fetch via bridge — this is the picked track itself,
  // so its kind is authoritative.
  const sep = track.baseUrl.includes('?') ? '&' : '?';
  const urls = [track.baseUrl + sep + 'fmt=json3', track.baseUrl];
  for (const url of urls) {
    console.log('[b3rys] Direct fetch attempt:', url.substring(0, 120));
    try {
      const result = await bridgeFetch(url);
      console.log(`[b3rys] Direct fetch response: length=${result.length}`);
      if (result) return { cues: parseSubtitleResponse(result), isAsr: isAsrKind(track.kind) };
    } catch (err) {
      console.warn('[b3rys] Direct fetch failed:', err);
    }
  }

  throw new Error('All subtitle fetch strategies failed');
}

/**
 * Post-processing depends on the kind of captions actually received, not on the
 * track that was requested: YouTube may have loaded the auto-generated track
 * while we picked the manual one. Treating ASR fragments as manual captions
 * skips merging and renders 2–3 word shards.
 */
function asDownload(cues: SubtitleCue[], entry: InterceptedTrack): SubtitleDownload {
  const isAsr = isAsrKind(entry.kind);
  console.log(`[b3rys] Payload kind: ${isAsr ? 'asr' : 'manual'} (lang=${entry.lang})`);
  return { cues, isAsr };
}

// ===================== Timedtext interception =====================

type InterceptedTrack = {
  videoId: string | null;
  lang: string | null;
  kind: string | null;
  text: string;
};

/**
 * Timedtext payloads intercepted from YouTube's own requests, keyed by request URL.
 *
 * YouTube is an SPA, so this map survives video navigation. Lookups therefore
 * MUST match the videoId, not just the language: matching on `lang=` alone made
 * the *previous* video's cues load on the next video (old text on a fresh
 * timeline — reads as scrambled/leftover subtitles, and only a reload cleared it).
 */
const interceptedData = new Map<string, InterceptedTrack>();

/** Read a query param out of a URL string (works for relative URLs too). */
function urlParam(url: string, key: string): string | null {
  const match = new RegExp(`[?&]${key}=([^&#]*)`).exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

export function recordInterceptedTrack(url: string, text: string): void {
  interceptedData.set(url, {
    // Tagged from the URL only. Falling back to the page's current video would
    // stamp a payload that may belong to another video (YouTube prefetches the
    // autoplay-next captions) — a wrong tag serves wrong subtitles, while an
    // untagged entry is merely unusable and falls through to a direct fetch.
    videoId: urlParam(url, 'v'),
    lang: urlParam(url, 'lang'),
    kind: urlParam(url, 'kind'),
    text,
  });
}

/** Forget a payload that turned out not to be parseable subtitle data. */
export function dropInterceptedTrack(text: string): void {
  for (const [url, entry] of interceptedData) {
    if (entry.text === text) interceptedData.delete(url);
  }
}

/** Drop payloads belonging to other videos (SPA navigation cleanup). */
export function pruneInterceptedTracks(keepVideoId: string | null): void {
  for (const [url, entry] of interceptedData) {
    if (entry.videoId !== keepVideoId) interceptedData.delete(url);
  }
}

/** What the caller is looking for: a caption track's language and kind. */
export type TrackQuery = { lang: string; kind?: string };

const normLang = (lang: string | null | undefined) => (lang ?? '').toLowerCase();
/** YouTube marks auto-generated tracks with kind=asr; manual tracks carry no kind. */
const isAsrKind = (kind: string | null | undefined) => kind === 'asr';

function isUsable(url: string, entry: InterceptedTrack, videoId: string | null): boolean {
  if (!videoId || entry.videoId !== videoId) return false;
  // Responses carrying tlang= are YouTube's own auto-translation, not source captions.
  return !urlParam(url, 'tlang');
}

/**
 * How well a payload answers the query — lower is better, null means unusable.
 *
 * Locale-exact beats base-language so `zh-Hant` never receives a `zh-Hans`
 * payload, while `en` still accepts `en-CA`. Same-kind beats other-kind because
 * ASR and manual captions need different post-processing (ASR arrives as 2–3
 * word fragments); when only the other kind is cached it is still usable — the
 * caller is told which kind it actually got.
 */
function rankTrack(entry: InterceptedTrack, query: TrackQuery): number | null {
  const langExact = normLang(entry.lang) === normLang(query.lang);
  const langBase = baseLanguage(entry.lang ?? '') === baseLanguage(query.lang);
  if (!langExact && !langBase) return null;
  const kindSame = isAsrKind(entry.kind) === isAsrKind(query.kind);
  return (kindSame ? 0 : 2) + (langExact ? 0 : 1);
}

/** Best intercepted payload for the query, or null. Newest wins ties. */
export function findInterceptedTrack(
  query: TrackQuery,
  videoId: string | null,
): InterceptedTrack | null {
  let best: InterceptedTrack | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  // Newest first — a re-request for the same track supersedes earlier payloads.
  for (const [url, entry] of [...interceptedData].reverse()) {
    if (!isUsable(url, entry, videoId)) continue;
    const rank = rankTrack(entry, query);
    if (rank === null || rank >= bestRank) continue;
    best = entry;
    bestRank = rank;
  }
  return best;
}

/** Test seam: empty the map regardless of how entries are tagged. */
export function clearInterceptedTracks(): void {
  interceptedData.clear();
}

const queryKind = (query: TrackQuery) => (isAsrKind(query.kind) ? 'asr' : 'manual');

/** Replace a query param in place, preserving every other character of the URL. */
function setParam(url: string, key: string, value: string): string {
  const pattern = new RegExp(`([?&]${key}=)[^&#]*`);
  const encoded = encodeURIComponent(value);
  return pattern.test(url) ? url.replace(pattern, `$1${encoded}`) : `${url}&${key}=${encoded}`;
}

/** Drop a query param that always follows another one (never the leading `?key=`). */
function dropParam(url: string, key: string): string {
  return url.replace(new RegExp(`&${key}=[^&#]*`), '');
}

/**
 * Point an existing timedtext request at a different track, keeping its
 * authorization params byte-for-byte.
 *
 * String surgery rather than URLSearchParams on purpose: the signed params
 * (`sparams`, `signature`, `pot`) must not be re-encoded.
 */
export function retargetTimedtextUrl(url: string, query: TrackQuery): string {
  let out = setParam(url, 'lang', query.lang);
  out = dropParam(out, 'tlang'); // never YouTube's own auto-translation
  out = isAsrKind(query.kind) ? setParam(out, 'kind', 'asr') : dropParam(out, 'kind');
  return setParam(out, 'fmt', 'json3');
}

/**
 * A timedtext URL for this video that carries YouTube's proof-of-origin token,
 * re-pointed at the requested track.
 *
 * `captionTracks[].baseUrl` is no longer enough on its own: without the `pot`
 * token the player appends at request time, YouTube answers 200 with an EMPTY
 * body (verified live for URLs from both the live player response and page HTML).
 * The token is per *video*, not per language — swapping `lang=ko` → `lang=en` on
 * an intercepted URL returned the full English track (52,460 → 103,696 bytes).
 * So when YouTube loaded a different language than we need (its own caption
 * preference), borrow the token from that request instead of failing.
 */
function tokenizedUrlFor(query: TrackQuery, videoId: string | null): string | null {
  if (!videoId) return null;
  for (const [url, entry] of [...interceptedData].reverse()) {
    if (entry.videoId !== videoId || !/[?&]pot=/.test(url)) continue;
    return retargetTimedtextUrl(url, query);
  }
  return null;
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.data?.type !== '__b3rys_timedtext_intercepted') return;
  console.log(`[b3rys] Received intercepted timedtext: length=${e.data.text?.length}`);
  recordInterceptedTrack(e.data.url ?? '', e.data.text);
});

/**
 * Resolve once YouTube has loaded captions for this video — in ANY language.
 * A different language is still useful: it carries the per-video token, so the
 * caller can re-target it (see `tokenizedUrlFor`).
 */
function waitForAnyInterception(videoId: string | null, timeout: number): Promise<boolean> {
  const hasPayload = () =>
    [...interceptedData.values()].some((entry) => videoId && entry.videoId === videoId);

  return new Promise((resolve) => {
    if (hasPayload()) {
      resolve(true);
      return;
    }

    const handler = (e: MessageEvent) => {
      if (e.data?.type !== '__b3rys_timedtext_intercepted') return;
      // The module-level listener records first, but re-record defensively so a
      // listener-ordering change can't strand this wait until timeout.
      recordInterceptedTrack(e.data.url ?? '', e.data.text);
      if (!hasPayload()) return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      resolve(true);
    };
    window.addEventListener('message', handler);
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(false);
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
  const videoId = getVideoId();

  // Strategy 1: Ask MAIN world bridge for ytInitialPlayerResponse
  const fromBridge = await getPlayerResponseFromBridge();
  if (fromBridge) {
    console.log(
      `[b3rys] Bridge player response: videoId=${playerResponseVideoId(fromBridge)}, expected=${videoId}`,
    );
    if (isPlayerResponseFor(fromBridge, videoId)) return fromBridge;
  }

  // Strategy 2: Parse from script tags. After an SPA navigation the *initial*
  // page's inline script is still in the DOM, so this can hand back the
  // previously watched video — the videoId check is what keeps its caption URLs
  // from being used on the current one.
  const fromDOM = extractFromScripts();
  if (isPlayerResponseFor(fromDOM, videoId)) {
    console.log('[b3rys] Using player response from script tags');
    return fromDOM;
  }
  if (fromDOM) {
    console.log(
      `[b3rys] Script-tag player response is for ${playerResponseVideoId(fromDOM)} — ignoring`,
    );
  }

  // Strategy 3: Fetch page HTML
  try {
    console.log('[b3rys] Fetching page HTML for player response...');
    const response = await fetch(location.href);
    const html = await response.text();
    const fromHTML = extractPlayerResponseJSON(html);
    return isPlayerResponseFor(fromHTML, videoId) ? fromHTML : null;
  } catch {
    return null;
  }
}

function playerResponseVideoId(response: Record<string, unknown> | null): string | undefined {
  return (response?.videoDetails as Record<string, string> | undefined)?.videoId;
}

/**
 * Whether a player response describes the given video. Every source of player
 * data can be stale on YouTube's SPA, so each one is checked before use.
 */
export function isPlayerResponseFor(
  response: Record<string, unknown> | null,
  videoId: string | null,
): boolean {
  if (!response || !videoId) return false;
  return playerResponseVideoId(response) === videoId;
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

/** parseSubtitleResponse, but returns null instead of throwing on bad input. */
function tryParse(text: string): SubtitleCue[] | null {
  try {
    return parseSubtitleResponse(text);
  } catch (err) {
    console.warn('[b3rys] Intercepted payload was not subtitle data — discarding:', err);
    return null;
  }
}

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
