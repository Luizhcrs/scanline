import { invoke } from "@tauri-apps/api/core";

let nextBrowserId = 0;

/** Normalize user input into a URL (add scheme, or web-search bare terms). */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

/** Short label for a tab chip, derived from a URL's host. */
export function tabLabel(url: string): string {
  try {
    return new URL(toUrl(url)).hostname.replace(/^www\./, "") || "web";
  } catch {
    return "web";
  }
}

/**
 * A browser tab backed by a native Tauri child webview (real WebView2), which
 * ignores X-Frame-Options so any site loads (google, github, …).
 *
 * Unlike the previous design, a browser is NOT a leaf in the tiling grid. The
 * native webview always floats over the DOM, so inside a split it covered the
 * resize gutter, trapped keyboard focus, and fought DPI scaling. Here it lives
 * as a full-width tab: it owns the whole content area when active and is hidden
 * (native hide) when the terminal tab is active. No split = none of that.
 *
 * The control bar (back/fwd/url) stays in the DOM above the webview, so its
 * buttons are always clickable even though the webview captures key focus —
 * and the DOM tab strip is what lets you escape back to the terminal.
 */
export class BrowserView {
  readonly id = nextBrowserId++;
  readonly el: HTMLElement;
  private viewport: HTMLElement;
  private urlInput: HTMLInputElement;
  private created = false;
  private active = false;
  private pendingUrl: string;
  private lastRect = { x: -1, y: -1, w: -1, h: -1 };

  /** Fired when this tab's close button is clicked. */
  onCloseRequest?: (view: BrowserView) => void;
  /** Fired when the user submits a URL (lets the shell refresh the tab label). */
  onTitleChange?: (view: BrowserView) => void;

  constructor(initialUrl = "https://duckduckgo.com") {
    this.pendingUrl = toUrl(initialUrl);

    this.el = document.createElement("div");
    this.el.className = "browser-view";
    this.el.style.display = "none";

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

    const back = mkBtn("‹", "Back", () =>
      invoke("browser_back", { id: this.id }).catch(() => {}),
    );
    const fwd = mkBtn("›", "Forward", () =>
      invoke("browser_forward", { id: this.id }).catch(() => {}),
    );
    const reload = mkBtn("⟳", "Reload", () => this.navigate(this.urlInput.value));

    this.urlInput = document.createElement("input");
    this.urlInput.className = "browser-url";
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = "Enter URL or search…";
    this.urlInput.value = this.pendingUrl;
    this.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.navigate(this.urlInput.value);
      }
    });

    bar.append(back, fwd, reload, this.urlInput);

    this.viewport = document.createElement("div");
    this.viewport.className = "browser-viewport";

    this.el.append(bar, this.viewport);
  }

  navigate(input: string): void {
    const url = toUrl(input);
    this.urlInput.value = url;
    this.pendingUrl = url;
    if (this.created) {
      invoke("browser_navigate", { id: this.id, url }).catch(() => {});
    }
    this.onTitleChange?.(this);
  }

  get url(): string {
    return this.pendingUrl;
  }

  /** Show this tab: reveal its chrome, create-or-show the native webview. */
  show(): void {
    this.active = true;
    this.el.style.display = "flex";
    // Defer the rect read to the next frame so the element has laid out.
    requestAnimationFrame(() => this.refit());
  }

  /** Hide this tab: hide the native webview and its chrome. */
  hide(): void {
    this.active = false;
    this.el.style.display = "none";
    if (this.created) {
      invoke("browser_visible", { id: this.id, visible: false }).catch(() => {});
    }
  }

  /** Sync the native webview to the viewport rectangle. No-op while hidden,
   *  which is what keeps a 0×0 hidden tab from creating a broken webview. */
  refit(): void {
    if (!this.active) return;
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const next = { x: r.left, y: r.top, w: r.width, h: r.height };

    if (!this.created) {
      this.created = true;
      this.lastRect = next;
      invoke("browser_open", { id: this.id, url: this.pendingUrl, ...next })
        .then(() => invoke("browser_visible", { id: this.id, visible: true }))
        .catch((err) => {
          this.created = false;
          console.error("browser_open", err);
        });
      return;
    }

    invoke("browser_visible", { id: this.id, visible: true }).catch(() => {});
    if (
      next.x === this.lastRect.x &&
      next.y === this.lastRect.y &&
      next.w === this.lastRect.w &&
      next.h === this.lastRect.h
    ) {
      return; // no change
    }
    this.lastRect = next;
    invoke("browser_bounds", { id: this.id, ...next }).catch(() => {});
  }

  focusUrl(): void {
    this.urlInput.focus();
    this.urlInput.select();
  }

  async dispose(): Promise<void> {
    if (this.created) {
      await invoke("browser_close", { id: this.id }).catch(() => {});
    }
    this.el.remove();
  }
}
