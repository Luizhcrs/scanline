import { type PaneLike, nextPaneId } from "./types";
import { t } from "./i18n";
import { createIcons, Terminal, Globe, PanelRight, PanelBottom } from "lucide";
import { BrowserPane } from "./browser";


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
  // Cancels an in-flight pane drag (set by startPaneDrag, called by dispose).
  private cancelDrag?: () => void;

  onExit?: (pane: PaneLike) => void;
  onFocusRequest?: (pane: PaneLike) => void;
  onCloseRequest?: (pane: PaneLike) => void;
  onSplitRequest?: (pane: PaneLike) => void;
  onSplitRight?: (pane: PaneLike) => void;
  onSplitDown?: (pane: PaneLike) => void;
  onNewBrowserTab?: (pane: PaneLike) => void;
  /** Cross-container surface move: called when a tab from container srcId
   *  at index srcIdx is dropped onto this container at position destIdx. */
  onReceiveSurface?: (srcContainerId: number, srcIdx: number, destIdx: number) => void;
  onSplitWithSurface?: (srcContainerId: number, srcIdx: number) => void;
  onTabMovedTo?: (srcSurfaceIdx: number, destContainerId: number, toStrip: boolean) => void;
  onNotify?: (pane: PaneLike, title: string, body: string) => void;
  onOpenUrl?: (pane: PaneLike, url: string) => void;
  onPaneDragStart?: () => void;
  onPaneDragEnd?: () => void;
  onPaneMove?: (toPaneId: number) => void;

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
    this.strip.className = "surface-tabs surface-strip";

    this.body = document.createElement("div");
    this.body.className = "surface-body";

    // Drop-target highlight: set/cleared by startTabDrag pointer tracking.

    this.el.append(this.strip, this.body);
    this.el.dataset.paneId = String(this.paneId); // for drag hit-testing
    this.adoptSurface(first);
    this.surfaces.push(first);
  }

  /** Pointer-based pane drag from the grip handle. Pointer events (not HTML5
   *  DnD) because hiding the native browser webviews mid-drag — needed so the
   *  drop can land over a browser pane — cancels an HTML5 drag. With pointer
   *  capture the gesture survives, and elementFromPoint hit-tests the DOM once
   *  the webviews are hidden. */
  private startTabDrag(surfaceIdx: number, e: PointerEvent): void {
    const THRESHOLD = 6; // px before drag activates
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let ghost: HTMLElement | null = null;

    const clearHighlights = () => {
      document.querySelectorAll(".surface-body.drop-target, .surface-strip.drop-target")
        .forEach(el => el.classList.remove("drop-target"));
    };

    const containerUnder = (x: number, y: number): { containerId: number; onStrip: boolean } | null => {
      // Temporarily hide ghost so elementFromPoint works.
      if (ghost) ghost.style.display = "none";
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (ghost) ghost.style.display = "";
      const strip = el?.closest<HTMLElement>(".surface-strip");
      const body  = el?.closest<HTMLElement>(".surface-body");
      const container = strip?.closest<HTMLElement>(".pane-container") ??
                        body?.closest<HTMLElement>(".pane-container");
      if (!container) return null;
      const cId = Number(container.dataset.paneId);
      return Number.isNaN(cId) ? null : { containerId: cId, onStrip: !!strip };
    };

    let done = false;
    const finish = (target: { containerId: number; onStrip: boolean } | null) => {
      if (done) return;
      done = true;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.body.classList.remove("dragging-tab");
      ghost?.remove();
      clearHighlights();
      if (!target || target.containerId === this.paneId) return;
      // onTabMovedTo is wired by Layout on the SOURCE container — it knows both
      // source and destination IDs and calls moveSurfaceBetweenContainers correctly.
      this.onTabMovedTo?.(surfaceIdx, target.containerId, target.onStrip);
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < THRESHOLD) return;

      if (!dragging) {
        dragging = true;
        document.body.classList.add("dragging-tab");
        ghost = document.createElement("div");
        ghost.className = "tab-drag-ghost";
        ghost.textContent = this.surfaces[surfaceIdx]?.title || "tab";
        document.body.appendChild(ghost);
      }

      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top  = `${ev.clientY - 10}px`;
      }
      clearHighlights();
      const target = containerUnder(ev.clientX, ev.clientY);
      if (target && target.containerId !== this.paneId) {
        const container = document.querySelector<HTMLElement>(
          `[data-pane-id="${target.containerId}"] .${target.onStrip ? "surface-strip" : "surface-body"}`
        );
        container?.classList.add("drop-target");
      }
    };

    const up = (ev: PointerEvent) => {
      const target = dragging ? containerUnder(ev.clientX, ev.clientY) : null;
      finish(target);
    };
    const cancel = () => { finish(null); };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
  }

  private startPaneDrag(_grip: HTMLElement, e: PointerEvent): void {
    e.preventDefault();
    this.onPaneDragStart?.(); // hide browser webviews so DOM is hit-testable
    const clearHighlight = () => {
      document
        .querySelectorAll(".pane-container.drop-target")
        .forEach((el) => el.classList.remove("drop-target"));
    };
    const paneUnder = (x: number, y: number): HTMLElement | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const c = el?.closest<HTMLElement>(".pane-container") ?? null;
      return c && c.dataset.paneId !== String(this.paneId) ? c : null;
    };
    // Listen on the DOCUMENT, not the grip: the grip is re-created on every
    // renderStrip() (e.g. a tab notification), which would orphan grip-bound
    // listeners and strand the drag. `done` makes teardown run exactly once so
    // pointercancel/Escape can't double-restore — and crucially ALWAYS restores
    // the browser webviews (else they stay black forever).
    let done = false;
    const finish = (dstId: number | null) => {
      if (done) return;
      done = true;
      this.cancelDrag = undefined; // drag is over; dispose no longer needs to call us
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      clearHighlight();
      // Do the layout swap BEFORE restoring webviews so a browser pane is not
      // shown at its pre-swap (stale) bounds for a frame.
      if (dstId !== null && dstId !== this.paneId) this.onPaneMove?.(dstId);
      this.onPaneDragEnd?.(); // restore browser webviews (after swap bounds computed)
    };
    // Allow dispose() to abort an in-flight drag (e.g. loadTree mid-drag).
    this.cancelDrag = () => finish(null);
    const move = (ev: PointerEvent) => {
      clearHighlight();
      paneUnder(ev.clientX, ev.clientY)?.classList.add("drop-target");
    };
    const up = (ev: PointerEvent) => {
      const dst = paneUnder(ev.clientX, ev.clientY);
      finish(dst?.dataset.paneId ? Number(dst.dataset.paneId) : null);
    };
    const cancel = () => finish(null); // interrupted: restore, no swap
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
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
    s.onOpenUrl = (_s, url) => this.onOpenUrl?.(this, url);
    s.onNewWindow = (_s, url) => {
      // Open target=_blank as a new surface tab in this container, not a split.
      this.addSurface(new BrowserPane(url));
    };
    s.onNotify = (_surf, t, b) => {
      if (s !== this.activeSurface) {
        this.flagged.add(s);
        this.renderStrip();
      }
      // Forward the originating surface's identity (paneId) instead of the
      // container's so notifications.ts can key notifs per-surface tab, not
      // per-container. The PaneLike contract passes pane as first arg; we
      // synthesise a minimal object carrying s.paneId for the handler.
      this.onNotify?.(s, t, b);
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
    this.activeSurface?.focus();
  }
  blur(): void {
    this.el.classList.remove("focused");
    this.activeSurface?.blur();
  }
  refit(): void {
    this.activeSurface?.refit();
  }
  setVisible(visible: boolean): void {
    // Whole container shown/hidden (e.g. grid zoom): only the active surface
    // owns a visible webview.
    this.activeSurface.setVisible?.(visible);
  }

  /** Agent lifecycle status -> a colored dot on the pane (running/waiting/…). */
  setStatus(status: string): void {
    // Generic clear: remove ANY previously applied status-* class so an unknown
    // value never accumulates alongside a later known one.
    const toRemove = Array.from(this.el.classList).filter((c) =>
      c.startsWith("status-"),
    );
    if (toRemove.length) this.el.classList.remove(...toRemove);
    // Only known statuses produce a visual dot; silently drop unknowns.
    const known = ["running", "waiting", "idle", "error"];
    if (status && status !== "idle" && known.includes(status)) {
      this.el.classList.add("status-" + status);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // Abort any in-flight pane drag before tearing down; finish(null) removes the
    // document/window listeners so they cannot reference this disposed container.
    this.cancelDrag?.();
    for (const s of this.surfaces) await s.dispose();
    this.surfaces = [];
    this.el.remove();
    // Null all Layout callback back-refs (mirrors Pane.dispose): these closures
    // capture the long-lived App/Layout; releasing them lets the GC collect this
    // container even when a stale reference (e.g. an in-flight rAF) lingers.
    this.keyHandler = null;
    this.onExit = this.onFocusRequest = this.onCloseRequest = this.onSplitRequest =
      this.onNotify = this.onOpenUrl = this.onPaneDragStart = this.onPaneDragEnd =
      this.onPaneMove = undefined;
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
    // splice(from,1) shifts every index >from down by one, so a right-to-left
    // drop lands correctly at `to`. A left-to-right drop must subtract 1 to
    // land ON the drop-target element rather than after it.
    const dest = from < to ? to - 1 : to;
    this.surfaces.splice(dest, 0, s);
    this.active = this.surfaces.indexOf(activeSurf);
    this.renderStrip();
  }

  /** Close the focused surface; if it was the last, the whole pane closes. */
  /** Remove surface at index without disposing it (for cross-container move). */
  removeSurfaceAt(idx: number): void {
    if (idx < 0 || idx >= this.surfaces.length) return;
    const s = this.surfaces[idx];
    this.mounted.delete(s);
    this.flagged.delete(s);
    this.surfaces.splice(idx, 1);
    if (this.surfaces.length === 0) {
      this.onExit?.(this);
      return;
    }
    if (idx < this.active) this.active--;
    if (this.active >= this.surfaces.length) this.active = this.surfaces.length - 1;
    this.showActive();
    this.renderStrip();
  }

  /** Insert a surface at index (for cross-container move). */
  insertSurfaceAt(s: PaneLike, idx: number): void {
    this.adoptSurface(s);
    const clamp = Math.max(0, Math.min(this.surfaces.length, idx));
    this.surfaces.splice(clamp, 0, s);
    this.active = clamp;
    this.showActive();
    this.renderStrip();
    s.focus();
  }

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
    // Tabs always render; close buttons are suppressed when only one surface
    // exists (see surfaces.length > 1 guard below). The + affordance is always present.
    const tabs = this.surfaces.map((s, i) => {
      const tab = document.createElement("div");
      tab.className = "surface-tab";
      if (i === this.active) tab.classList.add("active");
      if (this.flagged.has(s)) tab.classList.add("flagged");
      const label = document.createElement("span");
      label.className = "surface-tab-label";
      label.textContent = `${s.kind === "browser" ? "◉ " : ""}${s.title || s.kind}`;
      label.title = t("pane.renameHint");
      label.ondblclick = (e) => {
        e.stopPropagation();
        this.beginRename(s, label);
      };
      // Pointer-based tab drag (HTML5 DnD conflicts with WebView2 pointer events).
      // Do NOT call e.preventDefault() on pointerdown — it suppresses the click
      // event that tab.onclick relies on for plain tab selection. Instead, start
      // drag tracking and let clicks fall through naturally; startTabDrag only
      // activates after the 6px THRESHOLD is crossed.
      tab.onpointerdown = (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest(".surface-tab-close")) return;
        this.startTabDrag(i, e);
      };
      tab.onclick = () => this.select(i);
      tab.append(label);
      const x = document.createElement("button");
      x.className = "surface-tab-close";
      x.textContent = "✕";
      x.onclick = (e) => {
        e.stopPropagation();
        this.closeSurface(s);
      };
      tab.append(x);
      return tab;
    });
    const add = document.createElement("button");
    add.className = "surface-tab-add";
    add.textContent = "+";
    add.title = t("pane.newTabTitle");
    add.onclick = () => this.newTerminalTab();
    // Drag handle: grab this to reposition the whole pane (swap with the pane
    // you drop on). Distinct from tab reorder (which drags the tab itself).
    const grip = document.createElement("div");
    grip.className = "pane-grip";
    grip.title = t("pane.dragGrip");
    grip.onpointerdown = (e) => {
      if (e.button === 0) this.startPaneDrag(grip, e);
    };
    // Right-side pane action buttons
    const mkPaneBtn = (icon: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "pane-action-btn";
      b.title = title;
      b.innerHTML = `<i data-lucide="${icon}"></i>`;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    const btnTerm    = mkPaneBtn("terminal", "New terminal tab",  () => this.newTerminalTab());
    const btnBrowser = mkPaneBtn("globe",           "New browser tab",   () => this.onNewBrowserTab?.(this));
    const btnRight   = mkPaneBtn("panel-right",     "Split right",       () => this.onSplitRight?.(this));
    const btnDown    = mkPaneBtn("panel-bottom",    "Split down",        () => this.onSplitDown?.(this));
    this.strip.replaceChildren(grip, ...tabs, add, spacer, btnTerm, btnBrowser, btnRight, btnDown);
    createIcons({ icons: { Terminal, Globe, PanelRight, PanelBottom } });
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
