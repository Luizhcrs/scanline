import { invoke } from "./api";
import { listen, type UnlistenFn } from "./api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { SearchAddon } from "@xterm/addon-search";
// openUrl is now window.scanline.openUrl
// clipboard is now window.scanline.clipboardRead/clipboardWrite
import { type PaneLike, nextPaneId } from "./types";
import { config } from "./config";

/** Frontend-allocated pty ids. Allocated before spawn so per-pty event
 *  listeners can be registered first (see Pane.mount). */
let nextPtyId = 0;

/**
 * A single terminal pane: an xterm.js terminal bound to a backend ConPTY.
 * Owns its DOM element (`.pane`), the terminal, and the pty lifecycle.
 */
export class Pane implements PaneLike {
  readonly paneId = nextPaneId();
  readonly kind = "terminal" as const;
  readonly el: HTMLElement;
  private term: Terminal;
  private fit: FitAddon;
  private ptyId = -1;
  private unlisteners: UnlistenFn[] = [];
  private resizeObserver?: ResizeObserver;
  private mounted = false;
  private disposed = false;
  private lastRows = -1;
  private lastCols = -1;
  private serialize?: SerializeAddon;
  private search?: SearchAddon;

  /** Fired on OSC 9 / OSC 777 notify sequences or the bell — wired by Layout to
   *  the notification store. */
  onNotify?: (pane: PaneLike, title: string, body: string) => void;
  /** Ctrl+click on a terminal link -> open it as a browser pane. */
  onOpenUrl?: (pane: PaneLike, url: string) => void;

  private _title = "";
  private _customTitle = "";
  private _cwd = "";
  private lastNotifyAt = 0;
  /** Emit a notification, stamping the time so a trailing BEL is deduped. */
  private notify(title: string, body: string): void {
    this.lastNotifyAt = Date.now();
    this.onNotify?.(this, title, body);
  }
  /** User rename (wins), else terminal title from OSC 0/2, else the command. */
  get title(): string {
    return (
      this._customTitle ||
      this._title ||
      (this.command ? this.command.split(/\s+/)[0] : "terminal")
    );
  }
  /** Override the label; empty clears back to the auto title. */
  setTitle(name: string): void {
    this._customTitle = name.trim();
  }
  /** Restore spec: kind + command + last cwd + rename + scrollback snapshot. */
  serializeSurface(): import("./types").SurfaceSpec {
    // Cap scrollback size so session.json doesn't balloon. 50KB covers ~2000 lines
    // of dense terminal output; beyond that the restore is partial but still useful.
    const MAX_SCROLLBACK_BYTES = 50 * 1024;
    let scrollback: string | undefined;
    if (this.serialize && this.mounted) {
      try {
        const raw = this.serialize.serialize();
        if (raw.length <= MAX_SCROLLBACK_BYTES) scrollback = raw;
        else scrollback = raw.slice(raw.length - MAX_SCROLLBACK_BYTES);
      } catch {
        // serialize can throw if the terminal is in a bad state; skip gracefully.
      }
    }
    return {
      kind: "terminal",
      command: this.command || undefined,
      cwd: this._cwd || undefined,
      title: this._customTitle || undefined,
      scrollback,
    };
  }
  /** Working directory from OSC 7 (sidebar git/ports metadata). */
  get cwd(): string {
    return this._cwd;
  }
  /** The backend pty id (for pane_ports). */
  getPtyId(): number {
    return this.ptyId;
  }

  /** Called when the underlying process exits. */
  onExit?: (pane: PaneLike) => void;
  /** Called when this pane is clicked/focused. */
  onFocusRequest?: (pane: PaneLike) => void;
  /**
   * App-level shortcut handler. Return true if the key was consumed as a
   * Scanline shortcut (then it is NOT forwarded to the shell). xterm.js owns
   * keyboard focus, so global window listeners don't see these — this hook
   * runs inside xterm's own key path via attachCustomKeyEventHandler.
   */
  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

  /** @param command optional command line to run in this pane (instead of a
   *  plain interactive shell) — used for agent panes spawned via the CLI/shim. */
  constructor(
    private readonly command?: string,
    /** Restore: start the shell here instead of home (if the dir still exists). */
    private readonly initialCwd?: string,
    private readonly initialScrollback?: string,
  ) {
    this.el = document.createElement("div");
    this.el.className = "pane";
    this.el.tabIndex = -1;

    const t = config().terminal;
    this.term = new Terminal({
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      cursorBlink: true,
      theme: t.theme,
      allowProposedApi: true,
      scrollback: t.scrollback,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    // Ctrl+click a link -> open it as a Scanline browser pane (not the external
    // browser). Plain click is left for text selection.
    this.term.loadAddon(
      new WebLinksAddon((e, uri) => {
        if (e.ctrlKey || e.metaKey) this.onOpenUrl?.(this, uri);
        // Plain click -> OS default browser via window.scanline.openUrl. window.open
        // in a WebView2 host is unreliable (blocked or an unmanaged popup).
        else void ((window as any).scanline as any).openUrl(uri);
      }),
    );

    // Intercept Scanline shortcuts before xterm forwards keys to the pty.
    // Returning false tells xterm to ignore the event.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && this.keyHandler && this.keyHandler(e)) {
        return false;
      }
      return true;
    });

    this.el.addEventListener("mousedown", () => this.onFocusRequest?.(this));

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer) return;

      // Try files first (most reliable in Electron).
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const paths = Array.from(files)
          .map((f) => (f as any).path as string)
          .filter(Boolean);
        if (paths.length > 0) {
          const text = paths
            .map((p) => (p.includes(" ") ? `"${p}"` : p))
            .join(" ");
          this.sendText(text);
          return;
        }
      }

      // Fallback: text/uri-list (some OS/拖拽 sources emit URIs instead of files).
      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const paths = uriList
          .split(/\r?\n/)
          .filter((l) => l.startsWith("file://"))
          .map((l) => {
            try {
              const url = new URL(l);
              const p = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
              return p.includes(" ") ? `"${p}"` : p;
            } catch {
              return l.replace("file://", "");
            }
          });
        if (paths.length > 0) {
          this.sendText(paths.join(" "));
          return;
        }
      }

      // Final fallback: plain text (e.g. dragged text snippet).
      const text = e.dataTransfer.getData("text/plain");
      if (text) this.sendText(text.includes(" ") ? `"${text}"` : text);
    };

    // Use capture phase to ensure we see the event before xterm's internal listeners.
    this.el.addEventListener("dragover", onDragOver, true);
    this.el.addEventListener("drop", onDrop, true);
  }

  /**
   * Open the terminal into its (now DOM-attached) element and spawn the pty.
   * Called once by the Layout after the element is in the document — opening
   * xterm on a detached 0×0 element gives a broken terminal.
   */
  mount(shell?: string): void {
    if (this.mounted) return;
    this.mounted = true;
    this.term.open(this.el);
    this.installAddons();
    this.safeFit();
    // Apply the correct theme (dark/light) based on system preference.
    const dark =
      document.documentElement.dataset.theme !== "light" &&
      (document.documentElement.dataset.theme === "dark" ||
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    this.applyTheme(dark);
    // Restore previous scrollback before spawning so the user sees their prior
    // terminal content immediately. Written as raw VT sequences — the terminal
    // replays the saved state exactly as it was serialized.
    if (this.initialScrollback) {
      this.term.write(this.initialScrollback);
    }
    void this.spawn(shell);
  }

  /** Addons + notification escape-sequence handlers. After term.open. */
  private installAddons(): void {
    try {
      this.serialize = new SerializeAddon();
      this.term.loadAddon(this.serialize);
      this.search = new SearchAddon();
      this.term.loadAddon(this.search);
    } catch (e) {
      console.warn("serialize/search addon unavailable:", e);
    }

    // OSC 0/2 set the window/icon title (used for tab/sidebar labels later).
    this.term.parser.registerOscHandler(0, (d) => ((this._title = d), true));
    this.term.parser.registerOscHandler(2, (d) => ((this._title = d), true));
    // OSC 7 reports the working directory (file://host/path) — sidebar metadata.
    this.term.parser.registerOscHandler(7, (d) => {
      const m = d.match(/^file:\/\/[^/]*(\/.*)$/);
      if (m) {
        try {
          this._cwd = decodeURIComponent(m[1]).replace(/^\/([A-Za-z]:)/, "$1");
        } catch {
          // raw '%' in the path makes decodeURIComponent throw — keep it literal.
          this._cwd = m[1].replace(/^\/([A-Za-z]:)/, "$1");
        }
      }
      return true;
    });

    // OSC 9 ; <message>  (ConEmu/Windows-Terminal growl-style notify). Numeric
    // first field (9;4;… progress) is not a notification — skip those.
    this.term.parser.registerOscHandler(9, (data) => {
      if (!/^\d+;/.test(data)) this.notify("", data);
      return true;
    });
    // OSC 777 ; notify ; <title> ; <body>  (urxvt/iTerm-style).
    this.term.parser.registerOscHandler(777, (data) => {
      const p = data.split(";");
      if (p[0] === "notify") {
        this.notify(p[1] ?? "", p.slice(2).join(";"));
      }
      return true;
    });
    // An OSC notify is terminated by BEL, which also fires onBell - dedupe so a
    // single notify is not counted twice (notify + phantom bell).
    this.term.onBell(() => {
      const delta = Date.now() - this.lastNotifyAt;
      if (delta < 500) return;
      this.notify("", "");
    });
  }

  /** Serialize the terminal buffer + scrollback (surface.read_text / capture-pane). */
  readText(): string {
    return this.serialize?.serialize() ?? "";
  }

  /** Clear scrollback + viewport (pane.clear). */
  clear(): void {
    this.term.clear();
  }

  /** delta of 0 resets to the configured size; otherwise add to the current. */
  adjustFontSize(delta: number): void {
    const base = config().terminal.fontSize;
    const cur = this.term.options.fontSize ?? base;
    this.term.options.fontSize = delta === 0 ? base : Math.max(6, Math.min(40, cur + delta));
    this.safeFit();
    this.refit();
  }

  /** Re-apply the live config (font/theme) to this terminal (config reload). */
  applyConfig(): void {
    const t = config().terminal;
    this.term.options.fontFamily = t.fontFamily;
    this.term.options.fontSize = t.fontSize;
    this.term.options.theme = t.theme;
    this.safeFit();
    this.refit();
  }

  /** Update terminal theme when OS dark/light mode changes. */
  applyTheme(dark: boolean): void {
    const cfg = config().terminal;
    const userTheme = cfg.theme;
    // If user explicitly set non-default colors, respect their choice.
    const isDefault =
      userTheme.background === "#000000" &&
      userTheme.foreground === "#ffffff" &&
      userTheme.cursor === "#5aa0ff";
    if (!isDefault) {
      this.term.options.theme = userTheme;
      return;
    }
    // Auto theme: match system dark/light.
    if (dark) {
      this.term.options.theme = {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#5aa0ff",
        selectionBackground: "#264f78",
        selectionForeground: "#ffffff",
      };
    } else {
      this.term.options.theme = {
        background: "#ffffff",
        foreground: "#1d1d1f",
        cursor: "#0066cc",
        selectionBackground: "#b3d7ff",
        selectionForeground: "#1d1d1f",
      };
    }
  }

  private async spawn(shell?: string): Promise<void> {
    // Allocate the id up front and register this pty's listeners BEFORE the
    // spawn command — so the shell's first prompt can't outrun the listener.
    const id = (this.ptyId = nextPtyId++);

    const api = (window as any).scanline;
    const dataUnlisten = api.onPtyData(id, (data: string) => {
      if (this.disposed) return;
      this.term.write(data);
      // PowerShell doesn't emit OSC 7 natively — parse its default prompt to track cwd.
      // Strip ANSI codes, look for "PS C:\path> " pattern.
      const stripped = data.replace(/\x1b\[[^m]*m|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\/g, '');
      const psMatch = stripped.match(/(?:^|\n)PS ([A-Za-z]:[^\r\n>]*?)>\s/);
      if (psMatch) {
        const cwd = psMatch[1].trim();
        if (cwd) this._cwd = cwd;
      }
    });
    this.unlisteners.push(dataUnlisten);

    const exitUn = await listen(`pty://${id}/exit`, () => {
      if (this.disposed) return;
      // Disable xterm input immediately so keystrokes typed into the dead
      // terminal do not race against the backend's pty_write (which now returns
      // Err for an unknown/closed id). dispose() will also set this.disposed,
      // but that only happens after the async onExit chain completes.
      this.term.options.disableStdin = true;
      this.term.write("\r\n[process exited]\r\n");
      this.onExit?.(this);
    });
    this.unlisteners.push(exitUn);

    // Wire input -> pty BEFORE spawning. The shell's PSReadLine emits a DSR
    // cursor-position query (ESC[6n) on startup and BLOCKS until the terminal
    // replies; xterm generates that reply through onData. If onData isn't
    // registered when the (fast) DSR arrives — common when several panes spawn
    // at once on session restore — the reply is dropped and the shell hangs
    // with no prompt. Registering onData first closes that race.
    this.term.onData((data) => {
      // UTF-8 encode: typed accented chars / emoji are multi-byte, so a
      // charCodeAt&0xff truncation would corrupt them. TextEncoder yields the
      // correct UTF-8 byte sequence (control chars / ESC are ASCII, unaffected).
      // .catch logs the error so a dropped keystroke (e.g. pty_write returning
      // Err for an unknown/closed id) is visible instead of a silent no-op.
      invoke("pty_write", { id, data: Array.from(new TextEncoder().encode(data)) }).catch(
        (e) => console.warn("pty_write:", e),
      );
    });

    // Disposed during the awaits above (e.g. session restore disposes the
    // placeholder pane before its pty_spawn fires)? Don't spawn — otherwise the
    // backend gets a pty_close (no-op, nothing spawned yet) then this spawn
    // creates an orphaned ConPTY no listener owns. One orphan per workspace per
    // boot otherwise.
    if (this.disposed) return;

    const spawnResult = await invoke<{ cwd: string }>("pty_spawn", {
      id,
      rows: this.term.rows,
      cols: this.term.cols,
      shell: shell ?? null,
      command: this.command ?? null,
      surfaceId: this.paneId,
      cwd: this.initialCwd ?? null,
    });
    if (spawnResult?.cwd) this._cwd = spawnResult.cwd;
    this.lastRows = this.term.rows;
    this.lastCols = this.term.cols;

    // Refit whenever the pane element changes size (splits, drags, window).
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.el);
  }

  /** Refit the terminal to its element and push the new size to the pty. */
  refit(): void {
    this.safeFit();
    if (this.ptyId < 0) return;
    // ResizeObserver and the Layout's post-render rAF both call refit; only
    // push a pty_resize when the grid size actually changed.
    if (this.term.rows === this.lastRows && this.term.cols === this.lastCols) {
      return;
    }
    this.lastRows = this.term.rows;
    this.lastCols = this.term.cols;
    invoke("pty_resize", {
      id: this.ptyId,
      rows: this.term.rows,
      cols: this.term.cols,
    });
  }

  private safeFit(): void {
    try {
      if (this.el.clientWidth > 0 && this.el.clientHeight > 0) this.fit.fit();
    } catch {
      /* element not measurable yet */
    }
  }

  /** Write literal bytes to this pane's pty (surface.send_text / send_key). */
  sendText(text: string): void {
    if (this.ptyId < 0) return;
    // UTF-8 (accents/emoji survive); ASCII control/ESC sequences pass through.
    // .catch: surface.send_text on a dead pty returns Err; log so it's visible.
    invoke("pty_write", { id: this.ptyId, data: Array.from(new TextEncoder().encode(text)) }).catch(
      (e) => console.warn("pty_write (sendText):", e),
    );
  }

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  async copySelection(): Promise<void> {
    const sel = this.term.getSelection();
    if (!sel) return;
    try {
      await (window as any).scanline.clipboardWrite(sel);
    } catch (e) {
      console.warn("copy:", e);
    }
  }

  async paste(): Promise<void> {
    try {
      const t = await (window as any).scanline.clipboardRead();
      if (t) this.term.paste(t);
    } catch (e) {
      console.warn("paste:", e);
    }
  }

  selectAll(): void {
    this.term.selectAll();
  }

  /** Find in the terminal buffer (addon-search). */
  findNext(q: string): void {
    if (q) this.search?.findNext(q, { caseSensitive: false });
  }
  findPrev(q: string): void {
    if (q) this.search?.findPrevious(q, { caseSensitive: false });
  }
  clearSearch(): void {
    this.search?.clearDecorations();
  }

  focus(): void {
    this.el.classList.add("focused");
    this.term.focus();
  }

  blur(): void {
    this.el.classList.remove("focused");
  }

  /** Tear down: kill the pty, drop listeners, dispose the terminal.
   *  Guarded so the onExit + onClose double-fire can't dispose twice. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    for (const un of this.unlisteners) un();
    this.unlisteners = [];
    if (this.ptyId >= 0) {
      await invoke("pty_close", { id: this.ptyId }).catch(() => {});
    }
    this.term.dispose();
    // Drop back-references so the disposed pane (and its xterm) is collectable
    // even if a stale ref lingers; these closures capture the long-lived App.
    this.keyHandler = null;
    this.onExit = this.onFocusRequest = this.onNotify = this.onOpenUrl = undefined;
  }
}
