let paneCounter = 0;
/** Monotonic unique id shared across all pane kinds. */
export function nextPaneId(): number {
  return ++paneCounter;
}

/**
 * Common interface for anything that can live in a layout leaf: a terminal
 * pane or a browser pane. The Layout operates only on this interface.
 */
export interface PaneLike {
  /** Stable unique id. */
  readonly paneId: number;
  /** Root DOM element (class "pane"). */
  readonly el: HTMLElement;
  /** App shortcut handler; return true to consume the key. */
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  /** Fired when the pane's underlying process/content ends. */
  onExit?: (pane: PaneLike) => void;
  /** Fired when the pane requests focus (e.g. clicked). */
  onFocusRequest?: (pane: PaneLike) => void;
  /** Give this pane keyboard focus + focused styling. */
  focus(): void;
  /** Remove focused styling. */
  blur(): void;
  /** Re-fit to the current element size. */
  refit(): void;
  /** Tear down resources. */
  dispose(): Promise<void>;
}
