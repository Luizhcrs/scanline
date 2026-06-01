let paneCounter = 0;
/** Monotonic unique id shared across all pane kinds. */
export function nextPaneId(): number {
  return ++paneCounter;
}

/** Minimal description of a surface, enough to recreate it on session restore. */
export interface SurfaceSpec {
  kind: "terminal" | "browser";
  /** Terminal: the command line, if it was a command pane (not a plain shell). */
  command?: string;
  /** Browser: the last URL. */
  url?: string;
  /** Terminal: last known working dir (restore the shell there). */
  cwd?: string;
  /** User rename, if any. */
  title?: string;
}

/** A workspace's layout tree, serialized for session restore. */
export type TreeSpec =
  | { kind: "leaf"; surfaces: SurfaceSpec[]; active: number }
  | { kind: "split"; dir: "row" | "col"; ratio: number; a: TreeSpec; b: TreeSpec };

/**
 * Common interface for anything that can live in a layout leaf: a terminal
 * pane or a browser pane. The Layout operates only on this interface.
 */
export interface PaneLike {
  /** Stable unique id. */
  readonly paneId: number;
  /** Discriminator for serialization / targeting (pane.list, send_text). */
  readonly kind: "terminal" | "browser";
  /** Display label (terminal title from OSC 0/2, or browser host). */
  readonly title?: string;
  /** Working directory (terminal OSC 7), for sidebar git/ports metadata. */
  readonly cwd?: string;
  /** Root DOM element (class "pane"). */
  readonly el: HTMLElement;
  /** App shortcut handler; return true to consume the key. */
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  /** Fired when the pane's underlying process/content ends. */
  onExit?: (pane: PaneLike) => void;
  /** Fired when the pane requests focus (e.g. clicked). */
  onFocusRequest?: (pane: PaneLike) => void;
  /** Fired when the pane's close button is clicked. */
  onCloseRequest?: (pane: PaneLike) => void;
  /** Fired when the pane's split button is clicked. */
  onSplitRequest?: (pane: PaneLike) => void;
  /** Fired on a notification escape sequence / bell (terminal panes). */
  onNotify?: (pane: PaneLike, title: string, body: string) => void;
  /** Fired when a link in the terminal is Ctrl+clicked (open as a browser pane). */
  onOpenUrl?: (pane: PaneLike, url: string) => void;
  /** Set the agent lifecycle status indicator (running/waiting/idle/error). */
  setStatus?(status: string): void;
  /** Override the display label (user rename). Empty string clears it back to
   *  the auto title (OSC/command/host). */
  setTitle?(name: string): void;
  /** A spec sufficient to recreate this surface on session restore. */
  serializeSurface?(): SurfaceSpec;
  /**
   * Called once by the Layout after the pane's element is attached to the DOM.
   * Heavy init that needs a measurable element (xterm.open, pty spawn) happens
   * here — never in the constructor, where `el` isn't laid out yet.
   */
  mount(): void;
  /** Give this pane keyboard focus + focused styling. */
  focus(): void;
  /** Remove focused styling. */
  blur(): void;
  /** Re-fit to the current element size. */
  refit(): void;
  // ---- surface-tab container hooks (PaneContainer implements these) ----
  /** All surfaces (tabs) in this leaf; absent on a plain surface. */
  readonly allSurfaces?: PaneLike[];
  /** The currently shown surface. */
  readonly activeSurface?: PaneLike;
  /** Open a new terminal tab in this leaf. */
  newTerminalTab?(): void;
  /** Activate the next / previous tab. */
  nextSurface?(): void;
  prevSurface?(): void;
  /** Activate a tab by 0-based index. */
  selectSurface?(index: number): void;
  /** Close the active tab (closes the whole leaf if it was the last). */
  closeActiveSurface?(): void;
  /** Show/hide the surface when its tab (de)activates. Browser panes hide their
   *  native webview; terminals can no-op. Optional. */
  setVisible?(visible: boolean): void;
  /** Tear down resources. */
  dispose(): Promise<void>;
}
