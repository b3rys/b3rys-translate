/** Keep the same shadow host alive when a site replaces body children. */
export function mountPersistentUiHost(host: HTMLElement): () => void {
  // Translation observers must ignore both the initial mount and remounts.
  host.setAttribute('data-b3rys-ui', '');
  document.body.appendChild(host);

  const remounts: number[] = [];
  const observer = new MutationObserver(() => {
    if (host.isConnected || !document.body) return;

    const now = performance.now();
    while (remounts.length && now - remounts[0] >= 1000) remounts.shift();
    // A site that continuously deletes our UI must not create a mutation loop.
    // After three repairs within one second, leave it alone until page reload.
    if (remounts.length >= 3) {
      observer.disconnect();
      return;
    }
    remounts.push(now);
    document.body.appendChild(host);
  });
  // Observe above body so replacing body itself is recoverable too.
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    host.remove();
  };
}
