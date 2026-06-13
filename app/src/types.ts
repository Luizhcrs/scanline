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
  /** Serialized xterm scrollback for crash recovery (base64 xterm serialize output). */
  scrollback?: string;
}

/** A workspace's layout tree, serialized for session restore. */
export type TreeSpec =
  | { kind: "leaf"; surfaces: SurfaceSpec[]; active: number }
  | { kind: "split"; dir: "row" | "col"; ratio: number; a: TreeSpec; b: TreeSpec };

// ── Core pane interface ────────────────────────────────────────────────
// Every surface (terminal, browser, placeholder, container) must implement
// this. Layout operates exclusively on PaneLike.

export interface PaneLike {
  readonly paneId: number;
  readonly kind: "terminal" | "browser";
  readonly el: HTMLElement;
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  mount(): void;
  focus(): void;
  blur(): void;
  refit(): void;
  dispose(): Promise<void>;

  // ── Optional: metadata ─────────────────────────────────────────────
  readonly title?: string;
  readonly cwd?: string;

  // ── Optional: lifecycle callbacks (set by Layout / App) ────────────
  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;
  onCloseRequest?: (pane: PaneLike) => void;
  onSplitRequest?: (pane: PaneLike) => void;
  onSplitRight?: (pane: PaneLike) => void;
  onSplitDown?: (pane: PaneLike) => void;
  onNewBrowserTab?: (pane: PaneLike) => void;
  onNotify?: (pane: PaneLike, title: string, body: string) => void;
  onOpenUrl?: (pane: PaneLike, url: string) => void;
  onNewWindow?: (pane: PaneLike, url: string) => void;

  // ── Optional: drag-and-drop / tab reordering ───────────────────────
  onReceiveSurface?: (srcContainerId: number, srcIdx: number, destIdx: number) => void;
  onSplitWithSurface?: (srcContainerId: number, srcIdx: number) => void;
  onTabMovedTo?: (srcSurfaceIdx: number, destContainerId: number, toStrip: boolean) => void;
  onPaneDragStart?: () => void;
  onPaneDragEnd?: () => void;
  onPaneMove?: (toPaneId: number) => void;

  // ── Optional: display / serialization ──────────────────────────────
  setStatus?(status: string): void;
  setTitle?(name: string): void;
  serializeSurface?(): SurfaceSpec;
  setVisible?(visible: boolean): void;

  // ── Optional: container (tab-strip) hooks ──────────────────────────
  readonly allSurfaces?: PaneLike[];
  readonly activeSurface?: PaneLike;
  newTerminalTab?(): void;
  nextSurface?(): void;
  prevSurface?(): void;
  selectSurface?(index: number): void;
  closeActiveSurface?(): void;
}
