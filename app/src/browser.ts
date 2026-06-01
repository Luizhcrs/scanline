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
 * A browser pane backed by a native Tauri child webview (real WebView2), which
 * ignores X-Frame-Options so any site loads (google, github, …).
 *
 * It is a LEAF in the tiling grid (like a terminal pane), always in normal
 * document flow. The native webview floats over the DOM, aligned to the pane's
 * `viewport` element by pushing its rect to the backend whenever the layout
 * changes (Layout.refitAll → refit). The control bar stays in the DOM above the
 * webview so its buttons are always clickable even though the webview captures
 * keyboard focus.
 *
 * NOTE: an earlier design made the browser a display:none-toggled absolute
 * overlay (a "tab"). That wedged WebView2 compositing to black — the child was
 * created against a just-un-hidden region with no post-create bounds nudge.
 * Keeping the pane in flow + the post-create bounds re-apply (see refit) is what
 * makes it paint. Do not reintroduce display:none toggling of the container.
 */
export class BrowserPane implements PaneLike {
  readonly paneId = nextPaneId();
  readonly kind = "browser" as const;
  readonly el: HTMLElement;
  private viewport: HTMLElement;
  private urlInput: HTMLInputElement;
  private created = false;
  private creating = false;
  private disposed = false;
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

    const back = mkBtn("‹", "Back", () =>
      invoke("browser_back", { id: this.paneId }).catch(() => {}),
    );
    const fwd = mkBtn("›", "Forward", () =>
      invoke("browser_forward", { id: this.paneId }).catch(() => {}),
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

    // Pane controls — always clickable (DOM), independent of webview focus.
    const split = mkBtn("⊟", "Split a terminal beside this", () =>
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

  private resizeObserver?: ResizeObserver;

  /** Called once by the Layout after the element is in the DOM. The webview is
   *  created lazily in refit() as soon as the viewport has a real size. */
  mount(): void {
    // Track the viewport's own size: the native webview is a separate window
    // that must be repositioned on ANY size change (split drag, sidebar toggle,
    // window resize, MAXIMIZE). Relying only on the window 'resize' event missed
    // maximize and left the webview stranded off its cell.
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.viewport);
    requestAnimationFrame(() => this.refit());
  }

  private _customTitle = "";
  get title(): string {
    if (this._customTitle) return this._customTitle;
    try {
      return new URL(this.pendingUrl).hostname.replace(/^www\./, "") || "browser";
    } catch {
      return "browser";
    }
  }
  /** Override the label; empty clears back to the host. */
  setTitle(name: string): void {
    this._customTitle = name.trim();
  }
  /** Restore spec: kind + last URL + rename. */
  serializeSurface(): import("./types").SurfaceSpec {
    return {
      kind: "browser",
      url: this.pendingUrl || undefined,
      title: this._customTitle || undefined,
    };
  }

  navigate(input: string): void {
    const url = toUrl(input);
    this.urlInput.value = url;
    this.pendingUrl = url;
    if (this.created) {
      invoke("browser_navigate", { id: this.paneId, url }).catch(() => {});
    }
  }

  private _zoom = 1;
  /** Page zoom (Ctrl+=/-/0 when a browser leaf is focused). delta 0 resets. */
  adjustZoom(delta: number): void {
    this._zoom = delta === 0 ? 1 : Math.max(0.3, Math.min(3, this._zoom + delta * 0.1));
    if (!this.created) return;
    invoke("browser_cdp", {
      id: this.paneId,
      method: "Runtime.evaluate",
      params: JSON.stringify({ expression: `document.body.style.zoom=${this._zoom}` }),
    }).catch(() => {});
  }

  /** Sync the native webview to the viewport element's rectangle. */
  refit(): void {
    if (this.disposed) return;
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const next = { x: r.left, y: r.top, w: r.width, h: r.height };

    if (!this.created) {
      if (this.creating) return; // open in flight — don't double-create
      this.creating = true;
      this.lastRect = next;
      invoke("browser_open", { id: this.paneId, url: this.pendingUrl, ...next })
        .then(() => {
          this.created = true;
          this.creating = false;
          // Disposed while the open was in flight? dispose() skipped
          // browser_close (created was still false), so close now and don't
          // start the poll — otherwise the native webview + 800ms interval leak.
          if (this.disposed) {
            void invoke("browser_close", { id: this.paneId }).catch(() => {});
            return;
          }
          // Force the next refit to re-apply bounds: a post-create set_position/
          // set_size is the composition nudge that makes WebView2 paint.
          this.lastRect = { x: -1, y: -1, w: -1, h: -1 };
          this.startUrlPoll();
        })
        .catch((err) => {
          this.creating = false;
          console.error("browser_open", err);
        });
      return;
    }

    if (
      next.x === this.lastRect.x &&
      next.y === this.lastRect.y &&
      next.w === this.lastRect.w &&
      next.h === this.lastRect.h
    ) {
      return; // no change
    }
    this.lastRect = next;
    invoke("browser_bounds", { id: this.paneId, ...next }).catch(() => {});
  }

  /** Hide/show the native webview when the surface tab (de)activates. */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (this.created) {
      invoke("browser_visible", { id: this.paneId, visible }).catch(() => {});
    }
    if (visible) requestAnimationFrame(() => this.refit());
  }

  // ---- URL tracking ----
  // The native webview navigates on its own (links, redirects, JS). Our bridge
  // is request/reply (no CDP event stream wired through), so poll location.href
  // while visible and reflect it into the address bar.
  private isVisible = true;
  private urlPoll?: ReturnType<typeof setInterval>;
  private pollInFlight = false;
  private startUrlPoll(): void {
    if (this.urlPoll) return;
    this.urlPoll = setInterval(() => void this.syncUrl(), 2000);
  }
  private async syncUrl(): Promise<void> {
    if (!this.created || this.disposed || !this.isVisible || document.hidden) return;
    // Never have two CDP calls outstanding: each runs a closure on the native
    // main thread, so if one stalls the 2s timer would otherwise pile them up
    // and freeze the window's message pump (Application Hang).
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    void invoke("log_activity", { line: `${Date.now()} urlpoll ${this.paneId}` }).catch(() => {});
    try {
      const raw = await invoke<string>("browser_cdp", {
        id: this.paneId,
        method: "Runtime.evaluate",
        params: JSON.stringify({ expression: "location.href", returnByValue: true }),
      });
      const href = JSON.parse(raw)?.result?.value;
      if (typeof href === "string" && href && href !== this.pendingUrl) {
        this.pendingUrl = href;
        // Don't overwrite the address bar while the user is editing it.
        if (document.activeElement !== this.urlInput) this.urlInput.value = href;
      }
    } catch {
      /* page mid-navigation / not ready — try again next tick */
    } finally {
      this.pollInFlight = false;
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
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (this.urlPoll) clearInterval(this.urlPoll);
    if (this.created) {
      await invoke("browser_close", { id: this.paneId }).catch(() => {});
    }
    this.el.remove();
    this.keyHandler = null;
    this.onExit = this.onFocusRequest = this.onCloseRequest = this.onSplitRequest = undefined;
  }
}
