import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { SearchAddon } from "@xterm/addon-search";
import { type PaneLike, nextPaneId } from "./types";

const DEFAULT_FONT_SIZE = 14;

/** Frontend-allocated pty ids. Allocated before spawn so per-pty event
 *  listeners can be registered first (see Pane.mount). */
let nextPtyId = 0;

const THEME = {
  background: "#0d1017",
  foreground: "#c5c8c6",
  cursor: "#5ff967",
};

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

  private _title = "";
  private _cwd = "";
  /** Terminal title from OSC 0/2, else the command, else "terminal". */
  get title(): string {
    return this._title || (this.command ? this.command.split(/\s+/)[0] : "terminal");
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
  constructor(private readonly command?: string) {
    this.el = document.createElement("div");
    this.el.className = "pane";
    this.el.tabIndex = -1;

    this.term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: DEFAULT_FONT_SIZE,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 100000,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());

    // Intercept Scanline shortcuts before xterm forwards keys to the pty.
    // Returning false tells xterm to ignore the event.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && this.keyHandler && this.keyHandler(e)) {
        return false;
      }
      return true;
    });

    this.el.addEventListener("mousedown", () => this.onFocusRequest?.(this));
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
      if (m) this._cwd = decodeURIComponent(m[1]).replace(/^\/([A-Za-z]:)/, "$1");
      return true;
    });

    // OSC 9 ; <message>  (ConEmu/Windows-Terminal growl-style notify). Numeric
    // first field (9;4;… progress) is not a notification — skip those.
    this.term.parser.registerOscHandler(9, (data) => {
      if (!/^\d+;/.test(data)) this.onNotify?.(this, "", data);
      return true;
    });
    // OSC 777 ; notify ; <title> ; <body>  (urxvt/iTerm-style).
    this.term.parser.registerOscHandler(777, (data) => {
      const p = data.split(";");
      if (p[0] === "notify") this.onNotify?.(this, p[1] ?? "", p.slice(2).join(";"));
      return true;
    });
    this.term.onBell(() => this.onNotify?.(this, "", ""));
  }

  /** Serialize the terminal buffer + scrollback (surface.read_text / capture-pane). */
  readText(): string {
    return this.serialize?.serialize() ?? "";
  }

  /** Clear scrollback + viewport (pane.clear). */
  clear(): void {
    this.term.clear();
  }

  /** delta of 0 resets to default; otherwise add to the current size. */
  adjustFontSize(delta: number): void {
    const cur = this.term.options.fontSize ?? DEFAULT_FONT_SIZE;
    this.term.options.fontSize =
      delta === 0 ? DEFAULT_FONT_SIZE : Math.max(6, Math.min(40, cur + delta));
    this.safeFit();
    this.refit();
  }

  private async spawn(shell?: string): Promise<void> {
    // Allocate the id up front and register this pty's listeners BEFORE the
    // spawn command — so the shell's first prompt can't outrun the listener.
    const id = (this.ptyId = nextPtyId++);

    const dataUn = await listen<number[]>(`pty://${id}/data`, (e) => {
      if (!this.disposed) this.term.write(new Uint8Array(e.payload));
    });
    const exitUn = await listen(`pty://${id}/exit`, () => {
      if (this.disposed) return;
      this.term.write("\r\n[process exited]\r\n");
      this.onExit?.(this);
    });
    this.unlisteners.push(dataUn, exitUn);

    await invoke("pty_spawn", {
      id,
      rows: this.term.rows,
      cols: this.term.cols,
      shell: shell ?? null,
      command: this.command ?? null,
      surfaceId: this.paneId,
    });
    this.lastRows = this.term.rows;
    this.lastCols = this.term.cols;

    this.term.onData((data) => {
      // xterm hands input as a string of char codes 0–255 (one byte each).
      // Send raw bytes so non-UTF-8 sequences survive.
      const bytes = Array.from(data, (c) => c.charCodeAt(0) & 0xff);
      invoke("pty_write", { id, data: bytes });
    });

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
    const bytes = Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    invoke("pty_write", { id: this.ptyId, data: bytes });
  }

  async copySelection(): Promise<void> {
    const sel = this.term.getSelection();
    if (!sel) return;
    try {
      await navigator.clipboard.writeText(sel);
    } catch (e) {
      console.warn("copy:", e);
    }
  }

  async paste(): Promise<void> {
    try {
      const t = await navigator.clipboard.readText();
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
  }
}
