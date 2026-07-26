/**
 * In-memory cache: videoId -> Map<originalText, translatedText>
 * Persists across subtitle on/off toggles within the same video.
 * Keyed per video, so entries never cross videos; cleared on target-language
 * change and on page reload (navigation within the SPA keeps them, which makes
 * going back to an earlier video instant).
 */
const cache = new Map<string, Map<string, string>>();

export function getTranslation(videoId: string, text: string): string | undefined {
  return cache.get(videoId)?.get(text);
}

export function setTranslations(
  videoId: string,
  entries: { original: string; translated: string }[],
): void {
  let videoCache = cache.get(videoId);
  if (!videoCache) {
    videoCache = new Map();
    cache.set(videoId, videoCache);
  }
  for (const entry of entries) {
    videoCache.set(entry.original, entry.translated);
  }
}

export function hasVideo(videoId: string): boolean {
  return cache.has(videoId);
}

export function getCacheSize(videoId: string): number {
  return cache.get(videoId)?.size ?? 0;
}

export function clearVideo(videoId: string): void {
  cache.delete(videoId);
}

export function clearAll(): void {
  cache.clear();
}
