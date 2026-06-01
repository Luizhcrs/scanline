/**
 * Native-webview occlusion guard. WebView2 child webviews (browser panes) are
 * separate native windows composited ABOVE the main webview's DOM, so any DOM
 * overlay (settings, help, palette, context menu, feed) is hidden behind a
 * browser pane. Overlays push/pop here; a listener (App) hides every browser
 * webview while at least one overlay is open and restores them after.
 */
let count = 0;
const listeners: Array<(active: boolean) => void> = [];

export function onOverlayChange(fn: (active: boolean) => void): void {
  listeners.push(fn);
}

/** Mark an overlay as opened (hides browser webviews on the first one). */
export function pushOverlay(): void {
  count++;
  if (count === 1) for (const l of listeners) l(true);
}

/** Mark an overlay as closed (restores browser webviews when the last closes). */
export function popOverlay(): void {
  if (count === 0) return;
  count--;
  if (count === 0) for (const l of listeners) l(false);
}
