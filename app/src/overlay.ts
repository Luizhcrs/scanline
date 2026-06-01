/**
 * Native-webview occlusion guard. WebView2 child webviews (browser panes) are
 * separate native windows composited ABOVE the main webview's DOM, so any DOM
 * overlay (settings, help, palette, context menu, feed) is hidden behind a
 * browser pane. Overlays push/pop here by a stable key; a listener (App) hides
 * every browser webview while at least one overlay is open and restores them
 * after.
 *
 * Keyed by string (not a bare counter) so a double-push from the same overlay
 * is idempotent and can't desync the state into "browsers hidden forever".
 */
const active = new Set<string>();
const listeners: Array<(active: boolean) => void> = [];

export function onOverlayChange(fn: (active: boolean) => void): void {
  listeners.push(fn);
}

/** Mark an overlay open (hides browser webviews when the first one opens). */
export function pushOverlay(key: string): void {
  const wasEmpty = active.size === 0;
  active.add(key);
  if (wasEmpty) for (const l of listeners) l(true);
}

/** Mark an overlay closed (restores browser webviews when the last closes). */
export function popOverlay(key: string): void {
  if (!active.delete(key)) return;
  if (active.size === 0) for (const l of listeners) l(false);
}
