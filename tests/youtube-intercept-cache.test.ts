import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import {
  recordInterceptedTrack,
  findInterceptedTrack,
  pruneInterceptedTracks,
  clearInterceptedTracks,
  dropInterceptedTrack,
  isPlayerResponseFor,
} from '@/entrypoints/content/youtube/subtitle-fetcher';

const VIDEO_A = 'ZvDkJsKE80k';
const VIDEO_B = '-c43cv80FiA';

const timedtextUrl = (videoId: string, params = 'lang=en&kind=asr&fmt=json3') =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&${params}`;

/** The text of the best match, or null — what the download pipeline consumes. */
const bestText = (lang: string, videoId: string | null, kind?: string) =>
  findInterceptedTrack({ lang, kind }, videoId)?.text ?? null;

/**
 * Regression: intercepted timedtext survives YouTube's SPA navigation. Matching
 * on language alone served the previous video's cues on the next video (stale
 * subtitles that only a page reload cleared).
 */
describe('intercepted timedtext cache', () => {
  beforeEach(() => {
    setupChromeMock();
    clearInterceptedTracks();
  });

  it('never returns another video’s payload', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');

    expect(bestText('en', VIDEO_A, 'asr')).toBe('CUES_A');
    expect(bestText('en', VIDEO_B, 'asr')).toBeNull();
  });

  it('serves each video its own payload after navigation', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');
    recordInterceptedTrack(timedtextUrl(VIDEO_B), 'CUES_B');

    expect(bestText('en', VIDEO_B, 'asr')).toBe('CUES_B');
    expect(bestText('en', VIDEO_A, 'asr')).toBe('CUES_A');
  });

  it('never returns a payload with no video id of its own', () => {
    // A URL without v= used to be tagged with whatever video the page was on,
    // which could mis-attribute a prefetched payload to the current video.
    recordInterceptedTrack('https://www.youtube.com/api/timedtext?lang=en&fmt=json3', 'UNTAGGED');

    expect(bestText('en', VIDEO_A)).toBeNull();
    expect(bestText('en', null)).toBeNull();
  });

  it('matches language across locales but not across languages', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en-US&fmt=json3'), 'CUES_A');

    expect(bestText('en', VIDEO_A)).toBe('CUES_A');
    expect(bestText('ja', VIDEO_A)).toBeNull();
  });

  it('prefers the exact locale over a same-base variant', () => {
    // zh-Hant must not be served zh-Hans (different script), while en↔en-CA stays fine.
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=zh-Hans&fmt=json3'), 'SIMPLIFIED');
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=zh-Hant&fmt=json3'), 'TRADITIONAL');

    expect(bestText('zh-Hant', VIDEO_A)).toBe('TRADITIONAL');
    expect(bestText('zh-Hans', VIDEO_A)).toBe('SIMPLIFIED');
  });

  it('prefers the requested caption kind over the other kind', () => {
    // Picking the manual track but receiving the ASR payload made the pipeline skip
    // merging and render 2–3 word fragments.
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&kind=asr&fmt=json3'), 'ASR');
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&fmt=json3'), 'MANUAL');

    expect(findInterceptedTrack({ lang: 'en' }, VIDEO_A)?.text).toBe('MANUAL');
    expect(findInterceptedTrack({ lang: 'en', kind: 'asr' }, VIDEO_A)?.text).toBe('ASR');
  });

  it('still serves the other kind when only that one is cached, and says so', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&kind=asr&fmt=json3'), 'ASR');

    // Requested manual, got ASR — usable, but the caller must learn it is ASR so it
    // merges the fragments instead of rendering them raw.
    const hit = findInterceptedTrack({ lang: 'en' }, VIDEO_A);
    expect(hit?.text).toBe('ASR');
    expect(hit?.kind).toBe('asr');
  });

  it('ignores YouTube’s own auto-translated responses (tlang)', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&tlang=ko&fmt=json3'), 'ALREADY_KOREAN');

    expect(bestText('en', VIDEO_A)).toBeNull();
  });

  it('prefers the newest payload for the same track', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&fmt=json3&t=1'), 'OLD');
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&fmt=json3&t=2'), 'FRESH');

    expect(bestText('en', VIDEO_A)).toBe('FRESH');
  });

  it('drops an unparseable payload so later strategies can run', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), '<html>503</html>');

    dropInterceptedTrack('<html>503</html>');

    expect(bestText('en', VIDEO_A, 'asr')).toBeNull();
  });

  it('prunes other videos’ payloads on navigation', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');
    recordInterceptedTrack(timedtextUrl(VIDEO_B), 'CUES_B');

    pruneInterceptedTracks(VIDEO_B);

    expect(bestText('en', VIDEO_B, 'asr')).toBe('CUES_B');
    expect(bestText('en', VIDEO_A, 'asr')).toBeNull();
  });
});

/**
 * Regression: after an SPA navigation both `ytInitialPlayerResponse` and the
 * initial page's inline scripts still describe the *previous* video (observed
 * live: bridge returned ZvDkJsKE80k while the page was on 0mDjeG8K-cg). Using
 * that response would hand the previous video's caption URLs to the new video.
 */
describe('player response staleness guard', () => {
  const responseFor = (videoId: string) => ({ videoDetails: { videoId }, captions: {} });

  it('accepts a response for the current video', () => {
    expect(isPlayerResponseFor(responseFor(VIDEO_B), VIDEO_B)).toBe(true);
  });

  it('rejects a response left over from another video', () => {
    expect(isPlayerResponseFor(responseFor(VIDEO_A), VIDEO_B)).toBe(false);
  });

  it('rejects a response with no videoDetails to verify', () => {
    expect(isPlayerResponseFor({ captions: {} }, VIDEO_A)).toBe(false);
  });

  it('rejects when there is no current video', () => {
    expect(isPlayerResponseFor(responseFor(VIDEO_A), null)).toBe(false);
    expect(isPlayerResponseFor(null, VIDEO_A)).toBe(false);
  });
});
