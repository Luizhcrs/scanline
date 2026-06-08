import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type PaneLike, nextPaneId } from "./types";
import { t } from "./i18n";

/** Normalize user input into a URL (add scheme, or web-search bare terms). */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

// Serialise all browser_open calls: creating a WebView2 child webview is a
// main-thread-synchronous operation (add_child). Concurrent calls pile onto the
// Win32 message pump and cause an Application Hang. Chain each open so at most
// one add_child is in-flight at a time.
let _browserOpenQueue: Promise<void> = Promise.resolve();

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
  private loadingBar!: HTMLElement;
  private created = false;
  private creating = false;
  private disposed = false;
  private pendingUrl: string;
  // refit() is coalesced through one rAF so a burst of ResizeObserver / window
  // resize ticks collapses to a single browser_bounds per frame; lastRect then
  // skips no-op bounds. browser_bounds hops to the native main thread, so an
  // un-throttled flood (e.g. a window-resize drag) freezes the win32 message
  // pump — an Application Hang.
  private refitPending = false;
  private lastRect: { x: number; y: number; w: number; h: number } | null = null;

  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;
  onCloseRequest?: (pane: PaneLike) => void;
  onSplitRequest?: (pane: PaneLike) => void;
  onOpenUrl?: (pane: PaneLike, url: string) => void;
  /** Fired when a new window is requested (target="_blank", window.open).
   *  Distinct from onOpenUrl (Ctrl+click link in terminal → split).
   *  Browser panes open new-window requests as a new surface tab, not a split. */
  onNewWindow?: (pane: PaneLike, url: string) => void;

  constructor(initialUrl = "https://duckduckgo.com") {
    this.pendingUrl = toUrl(initialUrl);

    this.el = document.createElement("div");
    this.el.className = "pane browser";
    this.el.tabIndex = -1;

    const loadingBar = document.createElement("div");
    loadingBar.className = "browser-loading-bar";
    this.el.appendChild(loadingBar);
    this.loadingBar = loadingBar;

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

    const back = mkBtn("‹", t("browser.back"), () =>
      invoke("browser_back", { id: this.paneId }).catch(() => {}),
    );
    const fwd = mkBtn("›", t("browser.forward"), () =>
      invoke("browser_forward", { id: this.paneId }).catch(() => {}),
    );
    const reload = mkBtn("⟳", t("browser.reload"), () => this.navigate(this.urlInput.value));

    this.urlInput = document.createElement("input");
    this.urlInput.className = "browser-url";
    this.urlInput.spellcheck = false;
    this.urlInput.placeholder = t("browser.url");
    this.urlInput.value = this.pendingUrl;
    this.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.navigate(this.urlInput.value);
      }
    });

    // Pane controls — always clickable (DOM), independent of webview focus.
    const devtools = mkBtn("⚙", t("browser.devtools"), () =>
      invoke("browser_devtools", { id: this.paneId }).catch(() => {}),
    );
    devtools.classList.add("browser-devtools-btn");

    // Theme toggle: cycles Auto → Dark → Light → Auto via CDP Emulation.setEmulatedMedia.
    type Theme = "auto" | "dark" | "light";
    let theme: Theme = "auto";
    const themeBtn = document.createElement("button");
    themeBtn.className = "browser-bar-btn browser-theme-btn";
    const updateThemeBtn = () => {
      const next: Theme = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto";
      themeBtn.title = t(next === "auto" ? "browser.themeAuto" : next === "dark" ? "browser.themeDark" : "browser.themeLight");
      themeBtn.textContent = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◑";
    };
    updateThemeBtn();
    themeBtn.onclick = (e) => {
      e.stopPropagation();
      theme = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto";
      updateThemeBtn();
      const value = theme === "auto" ? "" : theme;
      invoke("browser_cdp", {
        id: this.paneId,
        method: "Emulation.setEmulatedMedia",
        params: JSON.stringify({ features: [{ name: "prefers-color-scheme", value }] }),
      }).catch(() => {});
    };

    const openExternal = mkBtn("↗", t("browser.openExternal"), () => {
      const url = this.urlInput.value.trim();
      if (url && url !== "about:blank") openUrl(url).catch(() => {});
    });
    openExternal.classList.add("browser-devtools-btn");

    const clearReload = mkBtn("⊘", t("browser.clearReload"), () => {
      const origin = (() => {
        try { return new URL(this.urlInput.value).origin; } catch { return null; }
      })();
      const clear = origin
        ? invoke("browser_cdp", {
            id: this.paneId,
            method: "Storage.clearDataForOrigin",
            params: JSON.stringify({
              origin,
              storageTypes: "cookies,local_storage,session_storage,indexeddb,cache_storage",
            }),
          })
        : Promise.resolve();
      clear.catch(() => {}).finally(() => this.navigate(this.urlInput.value));
    });
    clearReload.classList.add("browser-devtools-btn");
    clearReload.title = t("browser.clearReload");

    bar.append(back, fwd, reload, this.urlInput, themeBtn, clearReload, openExternal, devtools);

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
      this.setLoading(true);
      invoke("browser_navigate", { id: this.paneId, url }).catch(() => {
        this.setLoading(false);
      });
    }
  }

  private loadingTimer?: ReturnType<typeof setTimeout>;
  private setLoading(loading: boolean): void {
    this.loadingBar?.classList.toggle("active", loading);
    clearTimeout(this.loadingTimer);
    if (loading) {
      this.loadingTimer = setTimeout(() => this.setLoading(false), 30_000);
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

  /** Sync the native webview to the viewport rectangle. Coalesced via rAF so a
   *  burst of resize ticks applies bounds at most once per frame. */
  refit(): void {
    if (this.disposed || this.refitPending) return;
    this.refitPending = true;
    requestAnimationFrame(() => {
      this.refitPending = false;
      this.applyBounds();
    });
  }

  private applyBounds(): void {
    if (this.disposed) return;
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const next = { x: r.left, y: r.top, w: r.width, h: r.height };

    if (!this.created) {
      if (this.creating) return; // open in flight — don't double-create
      this.creating = true;
      this.lastRect = next;
      // Capture the URL we're opening so we can detect a navigate() that
      // arrived while the open was in flight and flush it after creation.
      const openedUrl = this.pendingUrl;
      // Chain onto the serial queue so concurrent restores never pile up on the
      // Win32 message pump (add_child is main-thread-synchronous in Rust).
      if (openedUrl && openedUrl !== "about:blank") this.setLoading(true);
      _browserOpenQueue = _browserOpenQueue.then(() =>
        invoke("browser_open", { id: this.paneId, url: openedUrl, ...next })
          .then(() => {
            this.created = true;
            this.creating = false;
            if (this.disposed) {
              void invoke("browser_close", { id: this.paneId }).catch(() => {});
              return;
            }
            if (this.pendingUrl !== openedUrl) {
              invoke("browser_navigate", { id: this.paneId, url: this.pendingUrl }).catch(() => {});
            }
            this.lastRect = null;
            this.refit();
            this.startUrlListener();
          })
          .catch((err) => {
            this.creating = false;
            this.setLoading(false);
            console.error("browser_open", err);
          }),
      );
      return;
    }

    // Skip no-op bounds: re-applying an unchanged rect floods the native main
    // thread (run_on_main_thread SetBounds) and can hang the message pump. The
    // rect is read fresh here, so a real shrink+grow still re-applies.
    const p = this.lastRect;
    if (p && next.x === p.x && next.y === p.y && next.w === p.w && next.h === p.h) return;
    this.lastRect = next;
    invoke("browser_bounds", { id: this.paneId, ...next }).catch(() => {});
  }

  /** Hide/show the native webview when the surface tab (de)activates. */
  setVisible(visible: boolean): void {
    if (this.created) {
      invoke("browser_visible", { id: this.paneId, visible }).catch(() => {});
    }
    if (visible) {
      this.placeholder?.remove();
      this.placeholder = undefined;
      requestAnimationFrame(() => this.refit());
    } else {
      this.showPlaceholder();
    }
  }

  private placeholder?: HTMLElement;
  private showPlaceholder(): void {
    if (this.placeholder) return;
    const el = document.createElement("div");
    el.className = "browser-placeholder";
    try {
      const host = new URL(this.pendingUrl).hostname;
      if (host) {
        const img = document.createElement("img");
        img.src = `https://www.google.com/s2/favicons?domain=${host}&sz=48`;
        img.className = "browser-placeholder-favicon";
        el.appendChild(img);
      }
    } catch { /* invalid URL, skip favicon */ }
    if (this.title || this.pendingUrl) {
      const label = document.createElement("span");
      label.className = "browser-placeholder-title";
      label.textContent = this.title || this.pendingUrl;
      el.appendChild(label);
    }
    this.viewport.appendChild(el);
    this.placeholder = el;
  }

  // ---- URL tracking ----
  // Event-driven (NOT polling): the Rust side fires browser://<id>/url on each
  // navigation. The old CDP poll ran a COM call on the native main thread every
  // couple seconds and could freeze the window's message pump (Application Hang).
  private urlUnlisten?: UnlistenFn;
  private startUrlListener(): void {
    if (this.urlUnlisten) return;
    void listen<string>(`browser://${this.paneId}/url`, (e) => {
      const href = e.payload;
      if (this.disposed || typeof href !== "string" || !href) return;
      this.setLoading(false);
      if (href === this.pendingUrl) return;
      this.pendingUrl = href;
      // Don't overwrite the address bar while the user is editing it.
      if (document.activeElement !== this.urlInput) this.urlInput.value = href;
    }).then((un) => {
      if (this.disposed) un();
      else this.urlUnlisten = un;
    });
    // Intercept new-window requests (target="_blank", window.open): open as a
    // new Scanline browser pane split beside this one instead of a system window.
    void listen<string>(`browser://${this.paneId}/new-window`, (e) => {
      const url = e.payload;
      if (this.disposed || typeof url !== "string" || !url) return;
      // Use onNewWindow if wired (opens as surface tab in same pane),
      // else fall back to onOpenUrl (opens as split).
      if (this.onNewWindow) this.onNewWindow(this, url);
      else this.onOpenUrl?.(this, url);
    });
    this.startDialogListener();
  }

  // ---- Script-dialog interception ----
  //
  // The Rust backend intercepts WebView2's ScriptDialogOpening event and emits
  // browser://<id>/dialog instead of showing the blocking native modal. We render
  // a small overlay card absolutely positioned over THIS pane's viewport so it
  // does not cover other panes. Only one overlay per pane at a time — a second
  // dialog while one is shown replaces the first (the first deferral is already
  // pending on the Rust side; the user must reply to clear it).
  private dialogUnlisten?: UnlistenFn;
  private dialogOverlay?: HTMLElement;

  private startDialogListener(): void {
    if (this.dialogUnlisten) return;
    void listen<{
      req: number;
      kind: "alert" | "confirm" | "prompt" | "beforeunload";
      message: string;
      defaultText: string;
    }>(`browser://${this.paneId}/dialog`, (e) => {
      if (this.disposed) return;
      this.showDialogOverlay(e.payload);
    }).then((un) => {
      if (this.disposed) un();
      else this.dialogUnlisten = un;
    });
  }

  private showDialogOverlay(payload: {
    req: number;
    kind: "alert" | "confirm" | "prompt" | "beforeunload";
    message: string;
    defaultText: string;
  }): void {
    // Remove any existing overlay — one dialog at a time per pane.
    this.dialogOverlay?.remove();
    this.dialogOverlay = undefined;

    const { req, kind, message, defaultText } = payload;
    const paneId = this.paneId;

    // reply sends the result to the Rust backend and tears down the overlay.
    const reply = (accept: boolean, text?: string) => {
      overlay.remove();
      if (this.dialogOverlay === overlay) this.dialogOverlay = undefined;
      void invoke("browser_dialog_reply", {
        paneId,
        req,
        accept,
        text: text ?? null,
      }).catch(() => {});
    };

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      // Scrim dims only this pane, not the whole app.
      "background:var(--scrim,rgba(0,0,0,0.45))",
      "z-index:9999",
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "background:var(--bg-elev,#1e1e1e)",
      "border:1px solid var(--border,#444)",
      "color:var(--text,#e0e0e0)",
      "border-radius:6px",
      "padding:16px 20px",
      "max-width:360px",
      "width:90%",
      "display:flex",
      "flex-direction:column",
      "gap:10px",
      "font-size:13px",
      "box-shadow:0 4px 24px rgba(0,0,0,0.6)",
    ].join(";");

    // Kind label
    const kindLabel = document.createElement("div");
    kindLabel.textContent =
      kind === "beforeunload" ? t("browser.dlgLeaveTitle")
        : kind === "alert"   ? t("browser.dlgAlert")
        : kind === "confirm" ? t("browser.dlgConfirm")
        : t("browser.dlgPrompt");
    kindLabel.style.cssText = "font-weight:600;font-size:12px;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em";

    // Message text
    const msgEl = document.createElement("div");
    msgEl.textContent = message;
    msgEl.style.cssText = "white-space:pre-wrap;word-break:break-word;line-height:1.5";

    card.append(kindLabel, msgEl);

    // Prompt input
    let inputEl: HTMLInputElement | undefined;
    if (kind === "prompt") {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.value = defaultText;
      inputEl.style.cssText = [
        "background:var(--bg-base,#121212)",
        "border:1px solid var(--border,#444)",
        "color:var(--text,#e0e0e0)",
        "border-radius:4px",
        "padding:6px 8px",
        "font-size:13px",
        "outline:none",
        "width:100%",
        "box-sizing:border-box",
      ].join(";");
      card.append(inputEl);
    }

    // Buttons row
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px";

    const mkBtn = (label: string, primary: boolean, handler: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = [
        "border:1px solid var(--border,#444)",
        "border-radius:4px",
        "padding:5px 14px",
        "font-size:12px",
        "cursor:pointer",
        primary
          ? "background:var(--accent,#0078d4);color:#fff;border-color:transparent"
          : "background:var(--bg-base,#121212);color:var(--text,#e0e0e0)",
      ].join(";");
      b.onclick = handler;
      return b;
    };

    if (kind === "confirm" || kind === "beforeunload" || kind === "prompt") {
      const cancelLabel = kind === "beforeunload" ? t("browser.dlgStay") : t("browser.dlgCancel");
      btnRow.append(mkBtn(cancelLabel, false, () => reply(false)));
    }

    const okLabel = kind === "beforeunload" ? t("browser.dlgLeave") : t("browser.dlgOk");
    btnRow.append(
      mkBtn(okLabel, true, () => {
        reply(true, inputEl?.value);
      }),
    );

    card.append(btnRow);
    overlay.append(card);

    // Keyboard handling: Enter = OK, Esc = Cancel (same as native dialogs).
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        reply(true, inputEl?.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        reply(false);
      }
    });

    // The viewport is position:relative so absolute children stay within it.
    this.viewport.style.position = "relative";
    this.viewport.append(overlay);
    this.dialogOverlay = overlay;

    // Focus the input (prompt) or the OK button so keyboard works immediately.
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      } else {
        const ok = btnRow.lastElementChild as HTMLButtonElement | null;
        ok?.focus();
      }
    });
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
    clearTimeout(this.loadingTimer);
    this.resizeObserver?.disconnect();
    this.urlUnlisten?.();
    this.dialogUnlisten?.();
    this.dialogOverlay?.remove();
    this.dialogOverlay = undefined;
    if (this.created) {
      await invoke("browser_close", { id: this.paneId }).catch(() => {});
    }
    this.el.remove();
    this.keyHandler = null;
    this.onExit = this.onFocusRequest = this.onCloseRequest = this.onSplitRequest = undefined;
  }
}
