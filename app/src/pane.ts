import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

interface PtyData {
  id: number;
  bytes: number[];
}

const THEME = {
  background: "#0d1017",
  foreground: "#c5c8c6",
  cursor: "#5ff967",
};

let paneCounter = 0;

/**
 * A single terminal pane: an xterm.js terminal bound to a backend ConPTY.
 * Owns its DOM element (`.pane`), the terminal, and the pty lifecycle.
 */
export class Pane {
  readonly paneId = ++paneCounter;
  readonly el: HTMLElement;
  private term: Terminal;
  private fit: FitAddon;
  private ptyId = -1;
  private unlisteners: UnlistenFn[] = [];
  private resizeObserver?: ResizeObserver;

  /** Called when the underlying process exits. */
  onExit?: (pane: Pane) => void;
  /** Called when this pane is clicked/focused. */
  onFocusRequest?: (pane: Pane) => void;

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

    this.el.addEventListener("mousedown", () => this.onFocusRequest?.(this));
  }

  /** Attach to the DOM, spawn the pty, and start streaming. */
  async start(shell?: string): Promise<void> {
    this.term.open(this.el);
    this.safeFit();

    this.ptyId = await invoke<number>("pty_spawn", {
      rows: this.term.rows,
      cols: this.term.cols,
      shell: shell ?? null,
    });

    const dataUn = await listen<PtyData>("pty-data", (e) => {
      if (e.payload.id === this.ptyId) {
        this.term.write(new Uint8Array(e.payload.bytes));
      }
    });
    const exitUn = await listen<number>("pty-exit", (e) => {
      if (e.payload === this.ptyId) {
        this.term.write("\r\n[process exited]\r\n");
        this.onExit?.(this);
      }
    });
    this.unlisteners.push(dataUn, exitUn);

    this.term.onData((data) => {
      invoke("pty_write", { id: this.ptyId, data });
    });

    // Refit whenever the pane element changes size (splits, drags, window).
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.el);
  }

  /** Refit the terminal to its element and push the new size to the pty. */
  refit(): void {
    this.safeFit();
    if (this.ptyId >= 0) {
      invoke("pty_resize", {
        id: this.ptyId,
        rows: this.term.rows,
        cols: this.term.cols,
      });
    }
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

  /** Tear down: kill the pty, drop listeners, dispose the terminal. */
  async dispose(): Promise<void> {
    this.resizeObserver?.disconnect();
    for (const un of this.unlisteners) un();
    this.unlisteners = [];
    if (this.ptyId >= 0) {
      await invoke("pty_close", { id: this.ptyId }).catch(() => {});
    }
    this.term.dispose();
  }
}
