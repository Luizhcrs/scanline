import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type PaneLike, nextPaneId } from "./types";

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

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "pane";
    this.el.tabIndex = -1;

    this.term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
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
    this.enableWebgl();
    this.safeFit();
    void this.spawn(shell);
  }

  /** Switch xterm to the GPU (WebGL) renderer. Must run after term.open (it
   *  needs the canvas). Falls back to the default DOM renderer if the GPU
   *  context is unavailable or lost. */
  private enableWebgl(): void {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => addon.dispose());
      this.term.loadAddon(addon);
    } catch (e) {
      console.warn("WebGL terminal renderer unavailable, using DOM:", e);
    }
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
