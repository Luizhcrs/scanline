import type { PaneLike, SurfaceSpec, TreeSpec } from "./types";

type Dir = "row" | "col";

interface LeafNode {
  kind: "leaf";
  pane: PaneLike;
}
interface SplitNode {
  kind: "split";
  dir: Dir;
  a: Node;
  b: Node;
  ratio: number; // fraction of space given to `a`
}
type Node = LeafNode | SplitNode;

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

/**
 * Tiling layout: a binary tree of splits whose leaves are panes (terminal or
 * browser). Rendering reuses each pane's DOM element, so content survives
 * re-renders (split / close / resize) without losing state.
 */
export class Layout {
  private root: Node;
  private focused: PaneLike;
  private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private paneFactory: (() => PaneLike) | null = null;
  private browserFactory: ((url: string) => PaneLike) | null = null;
  private mounted = new WeakSet<PaneLike>();
  private zoomed: PaneLike | null = null;
  private notifyHandler: ((pane: PaneLike, title: string, body: string) => void) | null = null;
  /** Called whenever focus moves to a pane (used to clear its notification ring). */
  onFocusChange: ((pane: PaneLike) => void) | null = null;
  /** Called when a leaf is closed (used to prune its notifications). */
  onPaneClosed: ((paneId: number) => void) | null = null;
  /** Pane drag (reposition) start/end — App hides/restores browser webviews so
   *  drops land on the DOM even over a native browser pane. */
  onPaneDragStart: (() => void) | null = null;
  onPaneDragEnd: (() => void) | null = null;

  /** Swap two leaf panes' positions in the grid (drag-to-reposition). */
  swapPanes(aId: number, bId: number): void {
    if (aId === bId) return;
    const a = this.leafOf(this.root, aId);
    const b = this.leafOf(this.root, bId);
    if (!a || !b) return;
    const tmp = a.pane;
    a.pane = b.pane;
    b.pane = tmp;
    this.render();
    this.setFocus(b.pane);
  }

  private leafOf(node: Node, id: number): LeafNode | null {
    if (node.kind === "leaf") return node.pane.paneId === id ? node : null;
    return this.leafOf(node.a, id) ?? this.leafOf(node.b, id);
  }

  constructor(private container: HTMLElement, first: PaneLike) {
    this.root = { kind: "leaf", pane: first };
    this.focused = first;
    this.adopt(first);
    this.render();
    this.setFocus(first);
  }

  /** Install the app shortcut handler on all panes (current and future). */
  setKeyHandler(fn: (e: KeyboardEvent) => boolean): void {
    this.keyHandler = fn;
    for (const p of this.collectPanes(this.root)) p.keyHandler = fn;
  }

  /** Route pane notification sequences (OSC 9/777/bell) to a handler. */
  setNotifyHandler(fn: (pane: PaneLike, title: string, body: string) => void): void {
    this.notifyHandler = fn;
    for (const p of this.collectPanes(this.root)) {
      p.onNotify = (pane, t, b) => this.notifyHandler?.(pane, t, b);
    }
  }

  /** Provide a factory used to create a terminal pane (e.g. for split buttons). */
  setPaneFactory(fn: () => PaneLike): void {
    this.paneFactory = fn;
  }

  /** Factory for a browser pane (Ctrl+click a terminal link opens one beside it). */
  setBrowserFactory(fn: (url: string) => PaneLike): void {
    this.browserFactory = fn;
  }

  /** Create a new terminal pane via the factory and split the focused pane. */
  splitWithNew(dir?: Dir): void {
    if (!this.paneFactory) return;
    this.splitFocused(this.paneFactory(), dir);
  }

  get focusedPane(): PaneLike {
    // Self-heal: if focus drifted off the current tree (a stale ref left by a
    // restore/close edge), re-anchor to a real leaf. Otherwise layout ops
    // (split/focus/close) silently no-op against a pane not in the tree and the
    // grid appears "stuck".
    if (this.root && !this.findLeaf(this.root, this.focused)) {
      const f = this.firstLeaf(this.root);
      if (f) this.setFocus(f);
    }
    return this.focused;
  }

  /** Serialize the grid as a flat list of panes (for pane.list / surface.list). */
  serialize(): Array<{
    id: number;
    pane: number;
    kind: string;
    title: string;
    focused: boolean;
    active: boolean;
    rect: { x: number; y: number; w: number; h: number };
  }> {
    const out: Array<{
      id: number;
      pane: number;
      kind: string;
      title: string;
      focused: boolean;
      active: boolean;
      rect: { x: number; y: number; w: number; h: number };
    }> = [];
    for (const c of this.collectPanes(this.root)) {
      const surfaces = c.allSurfaces ?? [c];
      const activeS = c.activeSurface ?? c;
      for (const s of surfaces) {
        const r = s.el.getBoundingClientRect();
        out.push({
          id: s.paneId,
          pane: c.paneId,
          kind: s.kind,
          title: s.title ?? "",
          focused: c === this.focused && s === activeS,
          active: s === activeS,
          rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        });
      }
    }
    return out;
  }

  /** Serialize the split tree structurally (for session restore): ratios, dirs,
   *  and each leaf's surface specs + active tab. */
  serializeTree(): TreeSpec {
    const walk = (n: Node): TreeSpec => {
      if (n.kind === "leaf") {
        const c = n.pane;
        const surfaces = c.allSurfaces ?? [c];
        const specs: SurfaceSpec[] = surfaces.map(
          (s) => s.serializeSurface?.() ?? { kind: s.kind },
        );
        const active = surfaces.indexOf(c.activeSurface ?? c);
        return { kind: "leaf", surfaces: specs, active: active < 0 ? 0 : active };
      }
      return { kind: "split", dir: n.dir, ratio: n.ratio, a: walk(n.a), b: walk(n.b) };
    };
    return walk(this.root);
  }

  /** Replace the whole layout from a serialized tree. `makeLeaf` builds a leaf
   *  pane (a container) from its surface specs + active index. Disposes the
   *  current panes first. */
  async loadTree(
    spec: TreeSpec,
    makeLeaf: (surfaces: SurfaceSpec[], active: number) => PaneLike,
  ): Promise<void> {
    await this.disposeAll();
    this.mounted = new WeakSet<PaneLike>();
    this.zoomed = null;
    const build = (s: TreeSpec): Node => {
      if (s.kind === "leaf") {
        const pane = makeLeaf(s.surfaces, s.active);
        this.adopt(pane);
        return { kind: "leaf", pane };
      }
      return { kind: "split", dir: s.dir, ratio: s.ratio, a: build(s.a), b: build(s.b) };
    };
    this.root = build(spec);
    const first = this.firstLeaf(this.root);
    if (first) this.focused = first;
    this.render();
    if (first) this.setFocus(first);
  }

  /** All leaf panes (containers) in the grid, in tree order. */
  panes(): PaneLike[] {
    return this.collectPanes(this.root);
  }

  /** Find a leaf (pane container) by its stable id. */
  paneById(id: number): PaneLike | null {
    return this.collectPanes(this.root).find((p) => p.paneId === id) ?? null;
  }

  /** Find a surface (tab) by its stable id, across all leaves. */
  surfaceById(id: number): PaneLike | null {
    for (const c of this.collectPanes(this.root)) {
      for (const s of c.allSurfaces ?? [c]) if (s.paneId === id) return s;
    }
    return null;
  }

  /** The active surface of the focused leaf (what input/scripts target). */
  get focusedSurface(): PaneLike {
    return this.focused.activeSurface ?? this.focused;
  }

  /** The leaf (container) that holds a given surface id. */
  containerOfSurface(id: number): PaneLike | null {
    for (const c of this.collectPanes(this.root)) {
      for (const s of c.allSurfaces ?? [c]) if (s.paneId === id) return c;
    }
    return null;
  }

  /** Reset every split to 50/50. */
  equalize(): void {
    const walk = (n: Node): void => {
      if (n.kind === "split") {
        n.ratio = 0.5;
        walk(n.a);
        walk(n.b);
      }
    };
    walk(this.root);
    this.render();
  }

  /** Grow (+) or shrink (-) the focused pane within its parent split. */
  resizeFocused(delta: number): void {
    const clamp = (r: number) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
    const adjust = (n: Node): boolean => {
      if (n.kind !== "split") return false;
      if (n.a.kind === "leaf" && n.a.pane === this.focused) {
        n.ratio = clamp(n.ratio + delta);
        return true;
      }
      if (n.b.kind === "leaf" && n.b.pane === this.focused) {
        n.ratio = clamp(n.ratio - delta);
        return true;
      }
      return adjust(n.a) || adjust(n.b);
    };
    if (adjust(this.root)) this.render();
  }

  /** Toggle zooming the focused pane to fill the workspace. */
  toggleZoom(): void {
    this.zoomed = this.zoomed ? null : this.focused;
    this.render();
  }

  /** Briefly flash the focused pane (locate it visually). */
  flashFocused(): void {
    const el = this.focused.el;
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
  }

  /** Wire a freshly created pane into the layout's callbacks. */
  private adopt(pane: PaneLike): void {
    pane.onFocusRequest = (p) => this.setFocus(p);
    pane.onExit = (p) => this.closePane(p);
    pane.onCloseRequest = (p) => this.closePane(p);
    pane.onSplitRequest = (p) => {
      this.setFocus(p);
      this.splitWithNew();
    };
    pane.onNotify = (p, t, b) => this.notifyHandler?.(p, t, b);
    pane.onOpenUrl = (p, url) => {
      if (!this.browserFactory) return;
      this.setFocus(p);
      this.splitFocused(this.browserFactory(url));
    };
    pane.onPaneDragStart = () => this.onPaneDragStart?.();
    pane.onPaneDragEnd = () => this.onPaneDragEnd?.();
    pane.onPaneDrop = (fromId) => this.swapPanes(fromId, pane.paneId);
    pane.keyHandler = this.keyHandler;
  }

  /**
   * Split the focused pane, placing `newPane` beside it. Direction defaults to
   * the longer edge of the focused pane (keeps the grid balanced).
   */
  splitFocused(newPane: PaneLike, dir?: Dir): void {
    this.adopt(newPane);
    // Read through focusedPane so a stale focus self-heals before we split.
    const target = this.focusedPane;
    const chosen = dir ?? this.autoDir(target);
    const leaf = this.findLeaf(this.root, target);
    if (!leaf) return;
    const replacement: SplitNode = {
      kind: "split",
      dir: chosen,
      a: { kind: "leaf", pane: this.focused },
      b: { kind: "leaf", pane: newPane },
      ratio: 0.5,
    };
    this.root = this.replace(this.root, this.focused, replacement);
    this.render();
    this.setFocus(newPane);
  }

  /** Close a pane, collapse its parent split (sibling takes the space). */
  async closePane(pane: PaneLike): Promise<void> {
    const sibling = this.siblingOf(this.root, pane);
    if (sibling === undefined) return; // last pane — keep at least one
    if (this.zoomed === pane) this.zoomed = null;
    this.root = this.removeLeaf(this.root, pane)!;
    this.onPaneClosed?.(pane.paneId);
    this.render();
    // Only move focus if we closed the FOCUSED pane (a background/agent-driven
    // close must not yank the user's focus to the top-left). setFocus runs
    // BEFORE dispose so blurring the old focused pane still works (a disposed
    // container has no active surface to blur and would throw, stranding focus
    // off-tree -> grid "stuck", splits no-op).
    if (this.focused === pane) {
      const next = this.firstLeaf(this.root);
      if (next) this.setFocus(next);
    }
    try {
      await pane.dispose();
    } catch (e) {
      console.error("pane dispose failed", e);
    }
  }

  closeFocused(): void {
    void this.closePane(this.focused);
  }

  setFocus(pane: PaneLike): void {
    if (this.focused && this.focused !== pane) this.focused.blur();
    this.focused = pane;
    pane.focus();
    this.onFocusChange?.(pane);
  }

  /** Move focus to the nearest pane in a direction (geometric). */
  focusDir(direction: "left" | "right" | "up" | "down"): void {
    const panes = this.collectPanes(this.root);
    const cur = this.focused.el.getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;

    let best: PaneLike | null = null;
    let bestScore = Infinity;
    for (const p of panes) {
      if (p === this.focused) continue;
      const r = p.el.getBoundingClientRect();
      const px = r.left + r.width / 2;
      const py = r.top + r.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const ok =
        (direction === "left" && dx < -1) ||
        (direction === "right" && dx > 1) ||
        (direction === "up" && dy < -1) ||
        (direction === "down" && dy > 1);
      if (!ok) continue;
      const score =
        direction === "left" || direction === "right"
          ? Math.abs(dx) + Math.abs(dy) * 2
          : Math.abs(dy) + Math.abs(dx) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) this.setFocus(best);
  }

  // ---- rendering ----

  private render(): void {
    if (this.zoomed) {
      this.zoomed.el.style.flex = "1 1 auto";
      this.container.replaceChildren(this.zoomed.el);
    } else {
      this.container.replaceChildren(this.renderNode(this.root));
    }
    // Elements are now in the DOM and measurable: mount any pane that hasn't
    // been mounted yet (opens xterm, spawns its pty). Must run before the
    // caller's setFocus, which focuses the terminal.
    for (const p of this.collectPanes(this.root)) {
      if (!this.mounted.has(p)) {
        this.mounted.add(p);
        p.mount();
      }
    }
    // After the DOM reflows, re-fit every pane to its final rectangle.
    requestAnimationFrame(() => this.refitAll());
  }

  /** Re-fit all panes to their current element sizes/positions. */
  refitAll(): void {
    for (const p of this.collectPanes(this.root)) p.refit();
  }

  /** Show/hide all panes (used on workspace switch: an inactive workspace must
   *  hide its native browser webviews, which otherwise float over everything). */
  setVisible(visible: boolean): void {
    for (const p of this.collectPanes(this.root)) p.setVisible?.(visible);
  }

  /** Dispose every pane (used when a workspace is closed). allSettled so one
   *  failing dispose doesn't leak the remaining panes' webviews. */
  async disposeAll(): Promise<void> {
    await Promise.allSettled(this.collectPanes(this.root).map((p) => p.dispose()));
  }

  private renderNode(node: Node): HTMLElement {
    if (node.kind === "leaf") {
      node.pane.el.style.flex = "1 1 auto";
      return node.pane.el;
    }
    const split = document.createElement("div");
    split.className = `split ${node.dir}`;

    const wrapA = document.createElement("div");
    wrapA.className = "split-child";
    wrapA.style.flexBasis = `${node.ratio * 100}%`;
    wrapA.appendChild(this.renderNode(node.a));

    const gutter = document.createElement("div");
    gutter.className = `gutter ${node.dir}`;

    const wrapB = document.createElement("div");
    wrapB.className = "split-child";
    wrapB.style.flexBasis = `${(1 - node.ratio) * 100}%`;
    wrapB.appendChild(this.renderNode(node.b));

    split.append(wrapA, gutter, wrapB);
    this.wireGutter(gutter, split, node, wrapA, wrapB);
    return split;
  }

  private wireGutter(
    gutter: HTMLElement,
    split: HTMLElement,
    node: SplitNode,
    wrapA: HTMLElement,
    wrapB: HTMLElement,
  ): void {
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      const move = (ev: MouseEvent) => {
        const rect = split.getBoundingClientRect();
        let r =
          node.dir === "row"
            ? (ev.clientX - rect.left) / rect.width
            : (ev.clientY - rect.top) / rect.height;
        r = Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
        node.ratio = r;
        wrapA.style.flexBasis = `${r * 100}%`;
        wrapB.style.flexBasis = `${(1 - r) * 100}%`;
        // Keep native webviews glued to their panes while dragging.
        this.refitAll();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    gutter.addEventListener("mousedown", onDown);
  }

  // ---- tree helpers ----

  private autoDir(pane: PaneLike): Dir {
    const r = pane.el.getBoundingClientRect();
    return r.width >= r.height ? "row" : "col";
  }

  private findLeaf(node: Node, pane: PaneLike): LeafNode | null {
    if (node.kind === "leaf") return node.pane === pane ? node : null;
    return this.findLeaf(node.a, pane) ?? this.findLeaf(node.b, pane);
  }

  private replace(node: Node, target: PaneLike, replacement: Node): Node {
    if (node.kind === "leaf") return node.pane === target ? replacement : node;
    return {
      ...node,
      a: this.replace(node.a, target, replacement),
      b: this.replace(node.b, target, replacement),
    };
  }

  private removeLeaf(node: Node, pane: PaneLike): Node | null {
    if (node.kind === "leaf") return node.pane === pane ? null : node;
    const a = this.removeLeaf(node.a, pane);
    const b = this.removeLeaf(node.b, pane);
    if (a === null) return b;
    if (b === null) return a;
    return { ...node, a, b };
  }

  private siblingOf(node: Node, pane: PaneLike): Node | undefined {
    if (node.kind === "leaf") return undefined;
    if (node.a.kind === "leaf" && node.a.pane === pane) return node.b;
    if (node.b.kind === "leaf" && node.b.pane === pane) return node.a;
    return this.siblingOf(node.a, pane) ?? this.siblingOf(node.b, pane);
  }

  private firstLeaf(node: Node): PaneLike | null {
    if (node.kind === "leaf") return node.pane;
    return this.firstLeaf(node.a) ?? this.firstLeaf(node.b);
  }

  private collectPanes(node: Node, out: PaneLike[] = []): PaneLike[] {
    if (node.kind === "leaf") out.push(node.pane);
    else {
      this.collectPanes(node.a, out);
      this.collectPanes(node.b, out);
    }
    return out;
  }
}
