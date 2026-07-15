import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from './helpers/chrome-mock';

// Mock all heavy YouTube dependencies before importing controller
vi.mock('@/entrypoints/content/youtube/subtitle-fetcher', () => ({
  fetchCaptionTracks: vi
    .fn()
    .mockResolvedValue([{ languageCode: 'en', kind: 'asr', baseUrl: 'https://example.com/sub' }]),
  pickSourceLanguageTrack: vi.fn().mockResolvedValue({
    languageCode: 'en',
    kind: 'asr',
    baseUrl: 'https://example.com/sub',
  }),
  downloadSubtitles: vi.fn().mockResolvedValue([
    { start: 0, duration: 2, text: 'Hello world' },
    { start: 2, duration: 2, text: 'How are you' },
  ]),
  baseLanguage: (code: string) => (code || '').split('-')[0].toLowerCase(),
}));

vi.mock('@/entrypoints/content/youtube/subtitle-translator', () => ({
  startRollingTranslation: vi.fn(),
}));

vi.mock('@/entrypoints/content/youtube/subtitle-overlay', () => ({
  startOverlay: vi.fn(),
  stopOverlay: vi.fn(),
  updateOverlayCues: vi.fn(),
  setDisplayMode: vi.fn(),
  flashOverlayNotice: vi.fn(),
}));

vi.mock('@/entrypoints/content/youtube/cue-merger', () => ({
  mergeCues: vi.fn((cues) => cues),
  mergeCuesTwoLine: vi.fn((cues) => cues),
  postProcessCues: vi.fn((cues) => cues),
}));

vi.mock('@/entrypoints/content/youtube/subtitle-styles.css', () => ({}));

vi.mock('@/entrypoints/content/context-invalidated', () => ({
  isContextInvalidated: vi.fn().mockReturnValue(false),
  markContextInvalidated: vi.fn(),
}));

// Mock yt-player-button — capture the onClick callback
let capturedOnClick: (() => void) | null = null;
const mockButton = {
  setState: vi.fn(),
  setMode: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('@/entrypoints/content/youtube/yt-player-button', () => ({
  injectYtPlayerButton: vi.fn((onClick: () => void) => {
    capturedOnClick = onClick;
    return Promise.resolve(mockButton);
  }),
}));

vi.mock('@/utils/youtube-helpers', () => ({
  isYouTubeVideoPage: vi.fn(() => true),
  getVideoId: vi.fn(() => 'abc123'),
}));

/** Flush microtasks + macrotask queue */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('YouTube subtitle mode cycling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    capturedOnClick = null;
    mockButton.setState.mockClear();
    mockButton.setMode.mockClear();
    setupChromeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in both mode', async () => {
    vi.resetModules();
    setupChromeMock();

    const { initYouTubeSubtitles } =
      await import('@/entrypoints/content/youtube/youtube-controller');
    initYouTubeSubtitles();
    await flush();
    capturedOnClick!();
    await flush();

    expect(mockButton.setState).toHaveBeenCalledWith('active');
    expect(mockButton.setMode).not.toHaveBeenCalled();
  });

  it('cycles both → en → ko → off', async () => {
    vi.resetModules();
    setupChromeMock();

    const { setDisplayMode } = await import('@/entrypoints/content/youtube/subtitle-overlay');
    vi.mocked(setDisplayMode).mockClear();

    const { initYouTubeSubtitles } =
      await import('@/entrypoints/content/youtube/youtube-controller');
    initYouTubeSubtitles();
    await flush();

    // Click 1: off → both
    capturedOnClick!();
    await flush();
    expect(mockButton.setState).toHaveBeenCalledWith('active');

    // Click 2: both → en
    capturedOnClick!();
    await flush();
    expect(setDisplayMode).toHaveBeenCalledWith('en');
    expect(mockButton.setMode).toHaveBeenCalledWith('en');

    // Click 3: en → ko
    capturedOnClick!();
    await flush();
    expect(setDisplayMode).toHaveBeenCalledWith('ko');
    expect(mockButton.setMode).toHaveBeenCalledWith('ko');

    // Click 4: ko → off
    capturedOnClick!();
    await flush();
    expect(mockButton.setState).toHaveBeenCalledWith('idle');
  });

  it('shows original captions (source-only, no translation) when caption language equals target', async () => {
    vi.resetModules();
    setupChromeMock();

    const { pickSourceLanguageTrack } =
      await import('@/entrypoints/content/youtube/subtitle-fetcher');
    // Korean-only video, default target is Korean → nothing to translate
    vi.mocked(pickSourceLanguageTrack).mockResolvedValueOnce({
      languageCode: 'ko',
      kind: 'asr',
      name: '한국어 (자동 생성됨)',
      baseUrl: 'https://example.com/sub',
    });
    const { startOverlay, flashOverlayNotice } =
      await import('@/entrypoints/content/youtube/subtitle-overlay');
    const { startRollingTranslation } =
      await import('@/entrypoints/content/youtube/subtitle-translator');
    vi.mocked(startRollingTranslation).mockClear();

    const { initYouTubeSubtitles } =
      await import('@/entrypoints/content/youtube/youtube-controller');
    initYouTubeSubtitles();
    await flush();
    capturedOnClick!();
    await flush();

    // Original captions shown with sourceOnly; no translation kicked off
    expect(startOverlay).toHaveBeenCalledWith('abc123', expect.anything(), { sourceOnly: true });
    expect(flashOverlayNotice).toHaveBeenCalledWith(expect.stringContaining('원문 자막'));
    expect(startRollingTranslation).not.toHaveBeenCalled();
    expect(mockButton.setState).toHaveBeenCalledWith('active', expect.any(String));
    expect(mockButton.setState).not.toHaveBeenCalledWith('error');
  });

  it('shows an info notice (not error) when the video has no caption tracks', async () => {
    vi.resetModules();
    setupChromeMock();

    const { pickSourceLanguageTrack } =
      await import('@/entrypoints/content/youtube/subtitle-fetcher');
    vi.mocked(pickSourceLanguageTrack).mockResolvedValueOnce(null);

    const { initYouTubeSubtitles } =
      await import('@/entrypoints/content/youtube/youtube-controller');
    initYouTubeSubtitles();
    await flush();
    capturedOnClick!();
    await flush();

    expect(mockButton.setState).toHaveBeenCalledWith('info', expect.any(String));
    expect(mockButton.setState).not.toHaveBeenCalledWith('error');
  });

  it('re-activating after off starts from both again', async () => {
    vi.resetModules();
    setupChromeMock();

    const { setDisplayMode } = await import('@/entrypoints/content/youtube/subtitle-overlay');

    const { initYouTubeSubtitles } =
      await import('@/entrypoints/content/youtube/youtube-controller');
    initYouTubeSubtitles();
    await flush();

    // Activate → cycle to off
    capturedOnClick!();
    await flush(); // off → both
    capturedOnClick!();
    await flush(); // both → en
    capturedOnClick!();
    await flush(); // en → ko
    capturedOnClick!();
    await flush(); // ko → off

    vi.mocked(setDisplayMode).mockClear();
    mockButton.setMode.mockClear();

    // Re-activate: should start from both
    capturedOnClick!();
    await flush();
    expect(mockButton.setState).toHaveBeenCalledWith('active');
    expect(setDisplayMode).not.toHaveBeenCalled();
  });
});
