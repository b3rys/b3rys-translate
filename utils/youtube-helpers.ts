export function isYouTubeVideoPage(): boolean {
  return (
    location.hostname === 'www.youtube.com' && location.pathname === '/watch' && !!getVideoId()
  );
}

export function getVideoId(): string | null {
  const params = new URLSearchParams(location.search);
  return params.get('v');
}
