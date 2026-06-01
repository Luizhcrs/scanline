import { type PaneLike, nextPaneId } from "./types";

/**
 * A grid leaf that holds multiple surfaces (terminals/browsers) as tabs. Only
 * the active surface is shown in the body; the others are detached (kept alive,
 * never destroyed) and, if browsers, their native webview is hidden.
 *
 * Implements PaneLike so the Layout still treats it as one leaf — splits/focus/
 * resize operate on containers; tabs operate on the surfaces inside.
 */
export class PaneContainer implements PaneLike {
  readonly paneId = nextPaneId();
  readonly el: HTMLElement;
  private strip: HTMLElement;
  private body: HTMLElement;
  private surfaces: PaneLike[] = [];
  private mounted = new Set<PaneLike>();
  private flagged = new Set<PaneLike>(); // surfaces with a pending notification
  private active = 0;
  private containerMounted = false;
  private disposed = false;
  private _keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;
  onCloseRequest?: (pane: PaneLike) => void;
  onSplitRequest?: (pane: PaneLike) => void;
  onNotify?: (pane: PaneLike, title: string, body: string) => void;

  // Setting the key handler (Layout does `pane.keyHandler = fn`) propagates to
  // every surface so xterm's custom-key path sees app shortcuts.
  get keyHandler(): ((e: KeyboardEvent) => boolean) | null {
    return this._keyHandler;
  }
  set keyHandler(fn: ((e: KeyboardEvent) => boolean) | null) {
    this._keyHandler = fn;
    for (const s of this.surfaces) s.keyHandler = fn;
  }

  constructor(
    first: PaneLike,
    private surfaceFactory: () => PaneLike,
  ) {
    this.el = document.createElement("div");
    this.el.className = "pane-container";

    this.strip = document.createElement("div");
    this.strip.className = "surface-tabs";

    this.body = document.createElement("div");
    this.body.className = "surface-body";

    this.el.append(this.strip, this.body);
    this.adoptSurface(first);
    this.surfaces.push(first);
  }

  get kind(): "terminal" | "browser" {
    return this.activeSurface.kind;
  }
  get title(): string {
    return this.activeSurface.title ?? "";
  }
  /** Rename the active surface (delegates to the surface). */
  setTitle(name: string): void {
    this.activeSurface.setTitle?.(name);
    this.renderStrip();
  }
  get activeSurface(): PaneLike {
    return this.surfaces[this.active];
  }
  get allSurfaces(): PaneLike[] {
    return this.surfaces;
  }

  // ---- surface event wiring (surface -> container -> Layout) ----
  private adoptSurface(s: PaneLike): void {
    s.keyHandler = this._keyHandler;
    s.onFocusRequest = () => this.onFocusRequest?.(this);
    s.onExit = () => this.closeSurface(s);
    s.onCloseRequest = () => this.closeSurface(s);
    s.onSplitRequest = () => this.onSplitRequest?.(this);
    s.onNotify = (_surf, t, b) => {
      if (s !== this.activeSurface) {
        this.flagged.add(s);
        this.renderStrip();
      }
      this.onNotify?.(this, t, b);
    };
  }

  // ---- PaneLike ----
  mount(): void {
    if (this.containerMounted) return;
    this.containerMounted = true;
    this.showActive();
    this.renderStrip();
  }

  focus(): void {
    this.el.classList.add("focused");
    this.activeSurface.focus();
  }
  blur(): void {
    this.el.classList.remove("focused");
    this.activeSurface.blur();
  }
  refit(): void {
    this.activeSurface.refit();
  }
  setVisible(visible: boolean): void {
    // Whole container shown/hidden (e.g. grid zoom): only the active surface
    // owns a visible webview.
    this.activeSurface.setVisible?.(visible);
  }

  /** Agent lifecycle status -> a colored dot on the pane (running/waiting/…). */
  setStatus(status: string): void {
    this.el.classList.remove(
      "status-running",
      "status-waiting",
      "status-idle",
      "status-error",
    );
    if (status && status !== "idle") this.el.classList.add("status-" + status);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.surfaces) await s.dispose();
    this.surfaces = [];
    this.el.remove();
  }

  // ---- tabs ----
  addSurface(s: PaneLike): void {
    this.adoptSurface(s);
    this.surfaces.push(s);
    this.select(this.surfaces.length - 1);
  }

  /** Append a surface without selecting/mounting it (session restore). Mounting
   *  is deferred to the container's mount() so xterm.open / pty spawn run only
   *  after the element is attached and measurable. */
  addSurfaceQuiet(s: PaneLike): void {
    this.adoptSurface(s);
    this.surfaces.push(s);
  }
  /** Set the active tab index pre-mount (restore); clamps to range. */
  setActiveIndex(i: number): void {
    this.active = Math.max(0, Math.min(i, this.surfaces.length - 1));
  }

  /** New terminal tab (+ button / Ctrl+T). */
  newTerminalTab(): void {
    this.addSurface(this.surfaceFactory());
  }

  select(index: number): void {
    if (index < 0 || index >= this.surfaces.length || this.disposed) return;
    const prev = this.surfaces[this.active];
    if (prev && prev !== this.surfaces[index]) prev.setVisible?.(false);
    this.active = index;
    this.flagged.delete(this.activeSurface);
    this.showActive();
    this.renderStrip();
    this.activeSurface.focus();
  }

  nextSurface(): void {
    this.select((this.active + 1) % this.surfaces.length);
  }
  prevSurface(): void {
    this.select((this.active - 1 + this.surfaces.length) % this.surfaces.length);
  }
  /** Jump to surface by 0-based index (Ctrl+1-8); clamps to last. */
  selectSurface(index: number): void {
    this.select(Math.min(index, this.surfaces.length - 1));
  }

  /** Move a tab from one index to another (drag reorder), keeping the active
   *  surface active. */
  reorder(from: number, to: number): void {
    if (from === to || from < 0 || from >= this.surfaces.length) return;
    to = Math.max(0, Math.min(to, this.surfaces.length - 1));
    const activeSurf = this.activeSurface;
    const [s] = this.surfaces.splice(from, 1);
    this.surfaces.splice(to, 0, s);
    this.active = this.surfaces.indexOf(activeSurf);
    this.renderStrip();
  }

  /** Close the focused surface; if it was the last, the whole pane closes. */
  closeActiveSurface(): void {
    this.closeSurface(this.activeSurface);
  }

  private closeSurface(s: PaneLike): void {
    const i = this.surfaces.indexOf(s);
    if (i < 0) return;
    if (this.surfaces.length === 1) {
      this.onExit?.(this); // last surface -> Layout closes the pane (disposes us)
      return;
    }
    void s.dispose();
    this.mounted.delete(s);
    this.flagged.delete(s);
    this.surfaces.splice(i, 1);
    // Keep the same active surface focused: closing a tab before it shifts its
    // index down by one; closing the active tab keeps the index (next surface).
    if (i < this.active) this.active--;
    if (this.active >= this.surfaces.length) this.active = this.surfaces.length - 1;
    this.showActive();
    this.renderStrip();
    this.activeSurface.focus();
  }

  private showActive(): void {
    const s = this.activeSurface;
    this.body.replaceChildren(s.el);
    if (!this.mounted.has(s)) {
      this.mounted.add(s);
      s.mount();
    } else {
      s.setVisible?.(true);
      requestAnimationFrame(() => s.refit());
    }
  }

  private renderStrip(): void {
    // single surface: keep the strip thin/empty but keep the + affordance.
    const tabs = this.surfaces.map((s, i) => {
      const tab = document.createElement("div");
      tab.className = "surface-tab";
      if (i === this.active) tab.classList.add("active");
      if (this.flagged.has(s)) tab.classList.add("flagged");
      const label = document.createElement("span");
      label.className = "surface-tab-label";
      label.textContent = `${s.kind === "browser" ? "◉ " : ""}${s.title || s.kind}`;
      label.title = "Double-click to rename";
      label.ondblclick = (e) => {
        e.stopPropagation();
        this.beginRename(s, label);
      };
      tab.onclick = () => this.select(i);
      // Drag to reorder tabs.
      tab.draggable = true;
      tab.ondragstart = (e) => e.dataTransfer?.setData("text/plain", String(i));
      tab.ondragover = (e) => e.preventDefault();
      tab.ondrop = (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData("text/plain"));
        if (!Number.isNaN(from)) this.reorder(from, i);
      };
      tab.append(label);
      if (this.surfaces.length > 1) {
        const x = document.createElement("button");
        x.className = "surface-tab-close";
        x.textContent = "✕";
        x.onclick = (e) => {
          e.stopPropagation();
          this.closeSurface(s);
        };
        tab.append(x);
      }
      return tab;
    });
    const add = document.createElement("button");
    add.className = "surface-tab-add";
    add.textContent = "+";
    add.title = "New terminal tab (Ctrl+T)";
    add.onclick = () => this.newTerminalTab();
    this.strip.replaceChildren(...tabs, add);
  }

  /** Start inline rename of the active tab (context menu / shortcut). */
  startRenameActive(): void {
    const labels = this.strip.querySelectorAll<HTMLElement>(".surface-tab-label");
    const label = labels[this.active];
    if (label) this.beginRename(this.surfaces[this.active], label);
  }

  /** Inline-edit a tab label. Enter saves, Escape cancels, blur saves. */
  private beginRename(s: PaneLike, label: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "surface-tab-rename";
    input.value = s.title ?? "";
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) s.setTitle?.(input.value);
      this.renderStrip();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };
    input.onblur = () => finish(true);
    label.replaceChildren(input);
    input.focus();
    input.select();
  }
}
