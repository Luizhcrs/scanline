import { invoke } from "@tauri-apps/api/core";
import { type PaneLike, nextPaneId } from "./types";

/** Normalize user input into a URL (add scheme, or web-search bare terms). */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

/**
 * A browser pane backed by a native Tauri child webview (real WebView2),
 * which ignores X-Frame-Options so any site loads (google, github, …).
 *
 * The webview is a native layer floating over the DOM. We keep it aligned with
 * the pane's "viewport" element by pushing its rect to the backend whenever the
 * layout changes (Layout.refitAll → refit). The control bar stays in the DOM
 * (above the webview) so its buttons are always clickable — even though the
 * webview captures keyboard focus and app shortcuts can't reach it.
 */
export class BrowserPane implements PaneLike {
  readonly paneId = nextPaneId();
  readonly el: HTMLElement;
  private viewport: HTMLElement;
  private urlInput: HTMLInputElement;
  private created = false;
  private pendingUrl: string;
  private lastRect = { x: -1, y: -1, w: -1, h: -1 };

  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;
  onCloseRequest?: (pane: PaneLike) => void;
  onSplitRequest?: (pane: PaneLike) => void;

  constructor(initialUrl = "https://duckduckgo.com") {
    this.pendingUrl = toUrl(initialUrl);

    this.el = document.createElement("div");
    this.el.className = "pane browser";
    this.el.tabIndex = -1;

    const bar = document.createElement("div");
    bar.className = "browser-bar";

    const mkBtn = (label: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      return b;
    };

    const back = mkBtn("‹", "Back", () => invoke("browser_back", { id: this.paneId }).catch(() => {}));
    const fwd = mkBtn("›", "Forward", () => invoke("browser_forward", { id: this.paneId }).catch(() => {}));
    const reload = mkBtn("⟳", "Reload", () => this.navigate(this.urlInput.value));

    this.urlInput = document.createElement("input");
    this.urlInput.className = "browser-url";
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = "Enter URL or search…";
    this.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.navigate(this.urlInput.value);
      }
    });

    // Pane controls — always clickable (DOM), independent of webview focus.
    const split = mkBtn("⊟", "Split (new terminal below/beside)", () =>
      this.onSplitRequest?.(this),
    );
    const close = mkBtn("✕", "Close pane", () => this.onCloseRequest?.(this));
    close.classList.add("close");

    bar.append(back, fwd, reload, this.urlInput, split, close);

    this.viewport = document.createElement("div");
    this.viewport.className = "browser-viewport";

    this.el.append(bar, this.viewport);
    this.el.addEventListener("mousedown", () => this.onFocusRequest?.(this));
  }

  navigate(input: string): void {
    const url = toUrl(input);
    this.urlInput.value = url;
    if (this.created) {
      invoke("browser_navigate", { id: this.paneId, url }).catch(() => {});
    } else {
      this.pendingUrl = url;
    }
  }

  /** Sync the native webview to the viewport element's rectangle. */
  refit(): void {
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const next = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (
      next.x === this.lastRect.x &&
      next.y === this.lastRect.y &&
      next.w === this.lastRect.w &&
      next.h === this.lastRect.h
    ) {
      return; // no change
    }
    this.lastRect = next;

    if (!this.created) {
      this.created = true;
      this.urlInput.value = this.pendingUrl;
      invoke("browser_open", {
        id: this.paneId,
        url: this.pendingUrl,
        x: next.x,
        y: next.y,
        w: next.w,
        h: next.h,
      }).catch((err) => console.error("browser_open", err));
    } else {
      invoke("browser_bounds", { id: this.paneId, ...next }).catch(() => {});
    }
  }

  focus(): void {
    this.el.classList.add("focused");
    this.urlInput.focus();
    this.urlInput.select();
  }

  blur(): void {
    this.el.classList.remove("focused");
  }

  async dispose(): Promise<void> {
    if (this.created) {
      await invoke("browser_close", { id: this.paneId }).catch(() => {});
    }
    this.el.remove();
  }
}
