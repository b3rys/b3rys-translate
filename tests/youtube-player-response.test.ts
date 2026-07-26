import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';
import { fetchCaptionTracks } from '@/entrypoints/content/youtube/subtitle-fetcher';

const VIDEO_A = 'ZvDkJsKE80k';
const VIDEO_B = '0mDjeG8K-cg';

const playerResponse = (videoId: string, baseUrl: string) => ({
  videoDetails: { videoId },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl, languageCode: 'en', name: { simpleText: 'English' }, kind: 'asr' },
      ],
    },
  },
});

const A_TRACK = 'https://www.youtube.com/api/timedtext?v=' + VIDEO_A + '&lang=en';
const B_TRACK = 'https://www.youtube.com/api/timedtext?v=' + VIDEO_B + '&lang=en';

function setUrl(videoId: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    `https://www.youtube.com/watch?v=${videoId}`,
  );
}

/** Answer the MAIN-world bridge request with a given player response (or null). */
function stubBridge(data: unknown): () => void {
  const handler = (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type !== '__b3rys_get_player_response') return;
    window.postMessage({ type: '__b3rys_player_response', data });
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/**
 * Regression: on YouTube's SPA, EVERY source of the player response can describe
 * the previously watched video — `ytInitialPlayerResponse` in the MAIN world AND
 * the initial page's inline <script>, which stays in the DOM after navigation.
 * Observed live: the bridge returned ZvDkJsKE80k while the page was on 0mDjeG8K-cg.
 * Using either would hand the previous video's caption URLs to the new video.
 */
describe('caption tracks after an SPA navigation', () => {
  let unstub: (() => void) | null = null;

  beforeEach(() => {
    setupChromeMock();
    setUrl(VIDEO_B);
    // The page was originally loaded on video A, so A's inline script is still here.
    document.body.innerHTML = `<script>var ytInitialPlayerResponse = ${JSON.stringify(
      playerResponse(VIDEO_A, A_TRACK),
    )};</script>`;
  });

  afterEach(() => {
    unstub?.();
    unstub = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('ignores the stale bridge and script-tag responses and uses the current video’s', async () => {
    unstub = stubBridge(playerResponse(VIDEO_A, A_TRACK)); // bridge is stale too
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: async () =>
          `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(
            playerResponse(VIDEO_B, B_TRACK),
          )};</script></html>`,
      }),
    );

    const tracks = await fetchCaptionTracks();

    expect(tracks).toHaveLength(1);
    expect(tracks[0].baseUrl).toBe(B_TRACK);
    expect(tracks[0].baseUrl).not.toContain(VIDEO_A);
  });

  it('returns no tracks rather than the previous video’s when nothing current is available', async () => {
    unstub = stubBridge(playerResponse(VIDEO_A, A_TRACK));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    // Better a "no subtitles" notice than confidently fetching video A's captions.
    expect(await fetchCaptionTracks()).toEqual([]);
  });

  it('uses the bridge response when it is for the current video', async () => {
    unstub = stubBridge(playerResponse(VIDEO_B, B_TRACK));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('should not be reached')));

    const tracks = await fetchCaptionTracks();

    expect(tracks[0].baseUrl).toBe(B_TRACK);
    expect(fetch).not.toHaveBeenCalled();
  });
});
