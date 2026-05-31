import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Pane } from "./pane";
import { BrowserPane } from "./browser";
import { PaneContainer } from "./paneContainer";
import { Layout } from "./layout";
import { NotificationStore } from "./notifications";
import { browserDispatch } from "./browserApi";
import type { PaneLike } from "./types";

/** A grid leaf: a container that starts with one terminal and can grow tabs. */
const newTerminalLeaf = () => new PaneContainer(new Pane(), () => new Pane());
const newCommandLeaf = (command: string) =>
  new PaneContainer(new Pane(command), () => new Pane());
const newBrowserLeaf = (url?: string) =>
  new PaneContainer(new BrowserPane(url), () => new Pane());

interface Workspace {
  id: number;
  title: string;
  grid: HTMLElement;
  layout: Layout;
}

interface ControlCommand {
  id?: string;
  method: string;
  dir?: "row" | "col" | "left" | "right" | "up" | "down";
  text?: string;
  title?: string;
  body?: string;
  url?: string;
  command?: string;
  surface?: number;
  workspace?: number;
  name?: string;
  key?: string;
  delta?: number;
  verb?: string;
  ref?: string;
  args?: string[];
}
interface ControlResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Map a named key / ctrl-chord (enter, tab, c-c, up, …) to pty bytes. */
function keyToBytes(key: string): string {
  const k = key.toLowerCase();
  const named: Record<string, string> = {
    enter: "\r",
    tab: "\t",
    escape: "\x1b",
    esc: "\x1b",
    space: " ",
    backspace: "\x7f",
    delete: "\x1b[3~",
    up: "\x1b[A",
    down: "\x1b[B",
    right: "\x1b[C",
    left: "\x1b[D",
    home: "\x1b[H",
    end: "\x1b[F",
    pageup: "\x1b[5~",
    pagedown: "\x1b[6~",
  };
  if (named[k]) return named[k];
  const ctrl = k.match(/^(?:c|ctrl)-(.)$/);
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);
  return key;
}

/**
 * App shell: a vertical-tabs sidebar of workspaces over a content area. Each
 * workspace owns its own tiling Layout (grid); only the active workspace's grid
 * is shown (inactive ones hide their grid + native browser webviews). The
 * control protocol and shortcuts operate on the active workspace's layout.
 */
class App {
  private workspaces: Workspace[] = [];
  private active = 0;
  private nextWsId = 1;
  private sidebarVisible = true;
  private notifs: NotificationStore;
  private meta = new Map<
    number,
    { cwd: string; branch?: string | null; dirty?: boolean; pr?: string | null; ports?: number[] }
  >();

  constructor(
    private sidebar: HTMLElement,
    private content: HTMLElement,
  ) {
    this.notifs = new NotificationStore(
      (leafId) => this.paneElAcrossWs(leafId),
      (leafId) => this.focusPaneAcrossWs(leafId),
    );
    this.notifs.onChange = () => this.renderSidebar();

    this.installResizer();
    this.newWorkspace();

    window.addEventListener("resize", () => this.activeLayout.refitAll());
    // Poll per-workspace sidebar metadata (cwd / git branch / ports).
    setInterval(() => void this.refreshMeta(), 4000);

    void listen<ControlCommand>("control://request", (e) => {
      const cmd = e.payload;
      this.dispatch(cmd)
        .then((r) => invoke("control_reply", { id: cmd.id, response: { id: cmd.id, ...r } }))
        .catch((err) =>
          invoke("control_reply", {
            id: cmd.id,
            response: { id: cmd.id, ok: false, error: String(err) },
          }),
        );
    });
    void listen<ControlCommand>("control://command", (e) => void this.dispatch(e.payload));
  }

  get activeWs(): Workspace {
    return this.workspaces[this.active];
  }
  get activeLayout(): Layout {
    return this.activeWs.layout;
  }

  // ---- workspaces ----
  newWorkspace(): Workspace {
    const grid = document.createElement("div");
    grid.className = "ws-grid";
    this.content.appendChild(grid);

    const layout = new Layout(grid, newTerminalLeaf());
    layout.setPaneFactory(newTerminalLeaf);
    layout.setKeyHandler((e) => this.onKey(e));
    const ws: Workspace = {
      id: this.nextWsId++,
      title: `Workspace ${this.nextWsId - 1}`,
      grid,
      layout,
    };
    layout.setNotifyHandler((pane, t, b) => this.notifs.add(pane.paneId, t, b, ws.id));
    layout.onFocusChange = (pane) => this.notifs.clearForPane(pane.paneId);

    this.workspaces.push(ws);
    this.selectWorkspace(this.workspaces.length - 1);
    return ws;
  }

  selectWorkspace(index: number): void {
    if (index < 0 || index >= this.workspaces.length) return;
    const prev = this.workspaces[this.active];
    if (prev && prev !== this.workspaces[index]) {
      prev.layout.setVisible(false);
      prev.grid.style.display = "none";
    }
    this.active = index;
    this.activeWs.grid.style.display = "";
    this.activeWs.layout.setVisible(true);
    this.activeWs.layout.refitAll();
    this.activeWs.layout.focusedPane.focus();
    this.renderSidebar();
  }

  closeWorkspace(id: number): void {
    const i = this.workspaces.findIndex((w) => w.id === id);
    if (i < 0 || this.workspaces.length === 1) return; // keep at least one
    const ws = this.workspaces[i];
    void ws.layout.disposeAll();
    ws.grid.remove();
    this.workspaces.splice(i, 1);
    if (this.active >= this.workspaces.length) this.active = this.workspaces.length - 1;
    else if (i <= this.active && this.active > 0) this.active--;
    this.selectWorkspace(this.active);
  }

  nextWorkspace(): void {
    this.selectWorkspace((this.active + 1) % this.workspaces.length);
  }
  prevWorkspace(): void {
    this.selectWorkspace((this.active - 1 + this.workspaces.length) % this.workspaces.length);
  }

  private paneElAcrossWs(leafId: number): HTMLElement | null {
    for (const w of this.workspaces) {
      const p = w.layout.paneById(leafId);
      if (p) return p.el;
    }
    return null;
  }
  private focusPaneAcrossWs(leafId: number): void {
    for (let i = 0; i < this.workspaces.length; i++) {
      const p = this.workspaces[i].layout.paneById(leafId);
      if (p) {
        this.selectWorkspace(i);
        this.workspaces[i].layout.setFocus(p);
        return;
      }
    }
  }

  // ---- sidebar ----
  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    this.sidebar.style.display = this.sidebarVisible ? "" : "none";
  }

  private renderSidebar(): void {
    const rows = this.workspaces.map((w, i) => {
      const row = document.createElement("div");
      row.className = "ws-row" + (i === this.active ? " active" : "");
      row.onclick = () => this.selectWorkspace(i);

      const top = document.createElement("div");
      top.className = "ws-top";
      const label = document.createElement("span");
      label.className = "ws-label";
      label.textContent = w.title;
      top.append(label);
      const unread = this.notifs.unreadForWs(w.id);
      if (unread > 0) {
        const badge = document.createElement("span");
        badge.className = "ws-badge";
        badge.textContent = String(unread);
        top.append(badge);
      }
      if (this.workspaces.length > 1) {
        const x = document.createElement("button");
        x.className = "ws-close";
        x.textContent = "✕";
        x.onclick = (e) => {
          e.stopPropagation();
          this.closeWorkspace(w.id);
        };
        top.append(x);
      }
      row.append(top);

      // Metadata line: cwd · branch* · :ports · PR
      const m = this.meta.get(w.id);
      if (m && (m.cwd || m.branch)) {
        const meta = document.createElement("div");
        meta.className = "ws-meta";
        const parts: string[] = [];
        if (m.cwd) parts.push(m.cwd.replace(/\/+$/, "").split(/[\\/]/).pop() || m.cwd);
        if (m.branch) parts.push(`⎇ ${m.branch}${m.dirty ? "*" : ""}`);
        if (m.ports && m.ports.length) parts.push(":" + m.ports.slice(0, 3).join(" :"));
        if (m.pr) parts.push(`PR ${m.pr}`);
        meta.textContent = parts.join("  ");
        row.append(meta);
      }
      return row;
    });
    const add = document.createElement("button");
    add.className = "ws-add";
    add.textContent = "+ Workspace";
    add.onclick = () => this.newWorkspace();
    this.sidebar.replaceChildren(...rows, add);
  }

  /** Poll each workspace's focused-surface cwd -> git branch/dirty/PR + ports. */
  private async refreshMeta(): Promise<void> {
    let changed = false;
    for (const w of this.workspaces) {
      const fs = w.layout.focusedSurface;
      const cwd = fs.cwd ?? "";
      if (!cwd) continue;
      try {
        const info = await invoke<{ branch: string | null; dirty: boolean; pr: string | null }>(
          "repo_info",
          { cwd },
        );
        const ports =
          fs.kind === "terminal"
            ? await invoke<number[]>("pane_ports", { id: (fs as Pane).getPtyId() })
            : [];
        const next = { cwd, branch: info.branch, dirty: info.dirty, pr: info.pr, ports };
        if (JSON.stringify(next) !== JSON.stringify(this.meta.get(w.id))) {
          this.meta.set(w.id, next);
          changed = true;
        }
      } catch {
        /* git/gh not available or no repo */
      }
    }
    if (changed) this.renderSidebar();
  }

  /** Draggable divider to resize the sidebar; width persisted in localStorage. */
  private installResizer(): void {
    const saved = localStorage.getItem("scanline.sidebarWidth");
    if (saved) this.sidebar.style.flexBasis = saved + "px";
    const resizer = document.createElement("div");
    resizer.className = "sidebar-resizer";
    this.sidebar.after(resizer);
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const move = (ev: MouseEvent) => {
        const w = Math.max(120, Math.min(420, ev.clientX));
        this.sidebar.style.flexBasis = w + "px";
        this.activeLayout.refitAll();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
        localStorage.setItem("scanline.sidebarWidth", String(parseInt(this.sidebar.style.flexBasis || "180", 10)));
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }

  // ---- shortcuts ----
  private onKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    const layout = this.activeLayout;
    const focusedTerminal = (): Pane | null => {
      const s = layout.focusedSurface;
      return s.kind === "terminal" ? (s as Pane) : null;
    };

    if (e.altKey && e.shiftKey && key === "d") {
      layout.splitWithNew();
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowRight") {
      layout.splitWithNew("row");
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      layout.splitWithNew("col");
      return true;
    }
    if (e.altKey && e.shiftKey && key === "b") {
      layout.splitFocused(newBrowserLeaf());
      return true;
    }
    // New workspace (Ctrl+N), toggle sidebar (Ctrl+B)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "n") {
      this.newWorkspace();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "b") {
      this.toggleSidebar();
      return true;
    }
    // Jump workspace: Alt+1..8 ; Alt+9 = last ; next/prev: Alt+Shift+. / ,
    if (e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const n = parseInt(e.key, 10);
      this.selectWorkspace(n === 9 ? this.workspaces.length - 1 : n - 1);
      return true;
    }
    // Close pane (Ctrl+Shift+W) vs close tab (Ctrl+W)
    if (e.ctrlKey && e.shiftKey && key === "w") {
      layout.closeFocused();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "w") {
      layout.focusedPane.closeActiveSurface?.();
      return true;
    }
    // Surface tabs
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "t") {
      layout.focusedPane.newTerminalTab?.();
      return true;
    }
    if (e.ctrlKey && e.key === "Tab") {
      if (e.shiftKey) layout.focusedPane.prevSurface?.();
      else layout.focusedPane.nextSurface?.();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const n = parseInt(e.key, 10);
      layout.focusedPane.selectSurface?.(n === 9 ? 999 : n - 1);
      return true;
    }
    // Notifications
    if (e.altKey && e.shiftKey && key === "n") {
      this.notifs.togglePanel();
      return true;
    }
    if (e.altKey && e.shiftKey && key === "u") {
      this.notifs.jumpLatestUnread();
      return true;
    }
    // Terminal UX
    if (e.ctrlKey && e.shiftKey && key === "k") {
      focusedTerminal()?.clear();
      return true;
    }
    if (e.ctrlKey && !e.altKey && (key === "=" || key === "+")) {
      focusedTerminal()?.adjustFontSize(1);
      return true;
    }
    if (e.ctrlKey && !e.altKey && key === "-") {
      focusedTerminal()?.adjustFontSize(-1);
      return true;
    }
    if (e.ctrlKey && !e.altKey && key === "0") {
      focusedTerminal()?.adjustFontSize(0);
      return true;
    }
    if (e.ctrlKey && e.shiftKey && key === "c") {
      void focusedTerminal()?.copySelection();
      return true;
    }
    if (e.ctrlKey && e.shiftKey && key === "v") {
      void focusedTerminal()?.paste();
      return true;
    }
    if (e.ctrlKey && e.shiftKey && key === "a") {
      focusedTerminal()?.selectAll();
      return true;
    }
    if (e.altKey && e.shiftKey && key === "z") {
      layout.toggleZoom();
      return true;
    }
    if (e.altKey && e.shiftKey && key === "e") {
      layout.equalize();
      return true;
    }
    if (e.ctrlKey && e.shiftKey && key === "h") {
      layout.flashFocused();
      return true;
    }
    // Focus navigation: Alt+Arrow (no shift)
    if (e.altKey && !e.shiftKey) {
      const map: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const dir = map[e.key];
      if (dir) {
        layout.focusDir(dir);
        return true;
      }
    }
    return false;
  }

  // ---- control protocol ----
  private targetPane(surface?: number): PaneLike | null {
    return typeof surface === "number"
      ? this.activeLayout.surfaceById(surface)
      : this.activeLayout.focusedSurface;
  }
  private browserSurface(surface?: number): number | null {
    const layout = this.activeLayout;
    if (typeof surface === "number") {
      const s = layout.surfaceById(surface);
      if (s && s.kind === "browser") return s.paneId;
    }
    const fs = layout.focusedSurface;
    if (fs.kind === "browser") return fs.paneId;
    const b = layout.serialize().find((x) => x.kind === "browser");
    return b ? b.id : null;
  }

  private async dispatch(cmd: ControlCommand): Promise<ControlResult> {
    if (!cmd || typeof cmd.method !== "string") return { ok: false, error: "missing method" };
    const layout = this.activeLayout;
    switch (cmd.method) {
      case "pane.split": {
        const dir = cmd.dir === "col" || cmd.dir === "row" ? cmd.dir : undefined;
        if (cmd.command) layout.splitFocused(newCommandLeaf(cmd.command), dir);
        else layout.splitWithNew(dir);
        return { ok: true };
      }
      case "pane.new":
        if (cmd.command) layout.splitFocused(newCommandLeaf(cmd.command));
        else layout.splitWithNew();
        return { ok: true };
      case "pane.close":
        layout.closeFocused();
        return { ok: true };
      case "pane.focus":
        if (cmd.dir === "left" || cmd.dir === "right" || cmd.dir === "up" || cmd.dir === "down") {
          layout.focusDir(cmd.dir);
          return { ok: true };
        }
        if (typeof cmd.surface === "number") {
          const c = layout.containerOfSurface(cmd.surface);
          if (!c) return { ok: false, error: `no surface ${cmd.surface}` };
          layout.setFocus(c);
          return { ok: true };
        }
        return { ok: false, error: "pane.focus needs dir or surface" };
      case "pane.list":
      case "surface.list":
        return { ok: true, result: layout.serialize() };
      case "pane.equalize":
        layout.equalize();
        return { ok: true };
      case "pane.zoom":
        layout.toggleZoom();
        return { ok: true };
      case "pane.resize":
        layout.resizeFocused(typeof cmd.delta === "number" ? cmd.delta : 0.05);
        return { ok: true };
      case "pane.clear": {
        const p = this.targetPane(cmd.surface);
        if (p && p.kind === "terminal") (p as Pane).clear();
        return { ok: true };
      }
      case "surface.new":
        layout.focusedPane.newTerminalTab?.();
        return { ok: true };
      case "surface.next":
        layout.focusedPane.nextSurface?.();
        return { ok: true };
      case "surface.prev":
        layout.focusedPane.prevSurface?.();
        return { ok: true };
      case "surface.close":
        layout.focusedPane.closeActiveSurface?.();
        return { ok: true };
      case "surface.select":
        layout.focusedPane.selectSurface?.(typeof cmd.delta === "number" ? cmd.delta : 0);
        return { ok: true };
      case "surface.send_text":
      case "surface.send_key": {
        const p = this.targetPane(cmd.surface);
        if (!p) return { ok: false, error: "no target surface" };
        if (p.kind !== "terminal") return { ok: false, error: "surface is not a terminal" };
        const bytes =
          cmd.method === "surface.send_key" ? keyToBytes(cmd.key ?? "") : cmd.text ?? "";
        (p as Pane).sendText(bytes);
        return { ok: true };
      }
      case "surface.read_text": {
        const p = this.targetPane(cmd.surface);
        if (!p) return { ok: false, error: "no target surface" };
        if (p.kind !== "terminal") return { ok: false, error: "surface is not a terminal" };
        return { ok: true, result: { text: (p as Pane).readText() } };
      }
      case "browser.open":
        layout.splitFocused(newBrowserLeaf(cmd.url));
        return { ok: true };
      case "browser": {
        const sid = this.browserSurface(cmd.surface);
        if (sid == null) return { ok: false, error: "no browser surface" };
        return await browserDispatch(sid, cmd.verb ?? "", cmd.args ?? []);
      }
      case "notify": {
        const c =
          typeof cmd.surface === "number"
            ? layout.containerOfSurface(cmd.surface)
            : layout.focusedPane;
        const ws =
          this.workspaces.find((w) => w.layout.paneById((c ?? layout.focusedPane).paneId)) ??
          this.activeWs;
        this.notifs.add(
          (c ?? layout.focusedPane).paneId,
          cmd.title ?? "",
          cmd.body ?? cmd.text ?? "",
          ws.id,
        );
        return { ok: true };
      }
      case "notif.list":
        return { ok: true, result: this.notifs.list() };
      case "notif.clear":
        this.notifs.clearAll();
        return { ok: true };
      // ---- workspaces ----
      case "workspace.new": {
        const ws = this.newWorkspace();
        return { ok: true, result: { id: ws.id, title: ws.title } };
      }
      case "workspace.list":
        return {
          ok: true,
          result: this.workspaces.map((w, i) => ({
            id: w.id,
            title: w.title,
            active: i === this.active,
            unread: this.notifs.unreadForWs(w.id),
          })),
        };
      case "workspace.current":
        return { ok: true, result: { id: this.activeWs.id, title: this.activeWs.title } };
      case "workspace.select": {
        const i = this.workspaces.findIndex((w) => w.id === cmd.workspace);
        if (i < 0) return { ok: false, error: `no workspace ${cmd.workspace}` };
        this.selectWorkspace(i);
        return { ok: true };
      }
      case "workspace.close":
        if (typeof cmd.workspace !== "number") return { ok: false, error: "workspace id required" };
        this.closeWorkspace(cmd.workspace);
        return { ok: true };
      case "workspace.rename": {
        const w = this.workspaces.find((x) => x.id === cmd.workspace) ?? this.activeWs;
        w.title = cmd.name ?? w.title;
        this.renderSidebar();
        return { ok: true };
      }
      case "system.ping":
        return { ok: true, result: { pong: true } };
      case "system.identify":
        return {
          ok: true,
          result: { focused: layout.focusedSurface.paneId, workspace: this.activeWs.id },
        };
      case "system.capabilities":
        return { ok: true, result: { methods: CAPABILITIES } };
      default:
        return { ok: false, error: `unknown method ${cmd.method}` };
    }
  }
}

const CAPABILITIES = [
  "pane.split", "pane.new", "pane.close", "pane.focus", "pane.list", "surface.list",
  "pane.equalize", "pane.zoom", "pane.resize", "pane.clear",
  "surface.new", "surface.next", "surface.prev", "surface.close", "surface.select",
  "surface.send_text", "surface.send_key", "surface.read_text",
  "browser.open", "browser", "notify", "notif.list", "notif.clear",
  "workspace.new", "workspace.list", "workspace.current", "workspace.select",
  "workspace.close", "workspace.rename",
  "system.ping", "system.identify", "system.capabilities",
];

function main() {
  const sidebar = document.getElementById("sidebar");
  const content = document.getElementById("content");
  if (!sidebar || !content) return;
  new App(sidebar, content);
  document.getElementById("splash")?.remove();
}

window.addEventListener("DOMContentLoaded", main);
