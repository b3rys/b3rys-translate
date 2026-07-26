import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import {
  recordInterceptedTrack,
  checkInterceptedData,
  pruneInterceptedTracks,
  dropInterceptedTrack,
  isPlayerResponseFor,
} from '@/entrypoints/content/youtube/subtitle-fetcher';

const VIDEO_A = 'ZvDkJsKE80k';
const VIDEO_B = '-c43cv80FiA';

const timedtextUrl = (videoId: string, params = 'lang=en&kind=asr&fmt=json3') =>
  `https://www.youtube.com/api/timedtext?v=${videoId}&${params}`;

/**
 * Regression: intercepted timedtext survives YouTube's SPA navigation. Matching
 * on language alone served the previous video's cues on the next video (stale
 * subtitles that only a page reload cleared).
 */
describe('intercepted timedtext cache', () => {
  beforeEach(() => {
    setupChromeMock();
    pruneInterceptedTracks(null); // empty the map between tests
  });

  it('never returns another video’s payload', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');

    expect(checkInterceptedData('en', VIDEO_A)).toBe('CUES_A');
    expect(checkInterceptedData('en', VIDEO_B)).toBeNull();
  });

  it('serves each video its own payload after navigation', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');
    recordInterceptedTrack(timedtextUrl(VIDEO_B), 'CUES_B');

    expect(checkInterceptedData('en', VIDEO_B)).toBe('CUES_B');
    expect(checkInterceptedData('en', VIDEO_A)).toBe('CUES_A');
  });

  it('matches language across locales but not across languages', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en-US&fmt=json3'), 'CUES_A');

    expect(checkInterceptedData('en', VIDEO_A)).toBe('CUES_A');
    expect(checkInterceptedData('ja', VIDEO_A)).toBeNull();
  });

  it('ignores YouTube’s own auto-translated responses (tlang)', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&tlang=ko&fmt=json3'), 'ALREADY_KOREAN');

    expect(checkInterceptedData('en', VIDEO_A)).toBeNull();
  });

  it('prefers the newest payload for the same track', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&fmt=json3&t=1'), 'OLD');
    recordInterceptedTrack(timedtextUrl(VIDEO_A, 'lang=en&fmt=json3&t=2'), 'FRESH');

    expect(checkInterceptedData('en', VIDEO_A)).toBe('FRESH');
  });

  it('drops an unparseable payload so later strategies can run', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), '<html>503</html>');

    dropInterceptedTrack('<html>503</html>');

    expect(checkInterceptedData('en', VIDEO_A)).toBeNull();
  });

  it('prunes other videos’ payloads on navigation', () => {
    recordInterceptedTrack(timedtextUrl(VIDEO_A), 'CUES_A');
    recordInterceptedTrack(timedtextUrl(VIDEO_B), 'CUES_B');

    pruneInterceptedTracks(VIDEO_B);

    expect(checkInterceptedData('en', VIDEO_B)).toBe('CUES_B');
    expect(checkInterceptedData('en', VIDEO_A)).toBeNull();
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
