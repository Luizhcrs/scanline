import { invoke } from "@tauri-apps/api/core";
import { createIcons, PanelLeft, Plus, Bell, Settings } from "lucide";
import { installTooltips } from "./tooltip";

// Replace data-lucide attributes with actual SVGs (titlebar icons).
function initIcons(): void {
  createIcons({ icons: { PanelLeft, Plus, Bell, Settings } });
}
import { listen } from "@tauri-apps/api/event";
import { Pane } from "./pane";
import { BrowserPane } from "./browser";
import { PaneContainer } from "./paneContainer";
import { Layout } from "./layout";
import { NotificationStore } from "./notifications";
import { browserDispatch } from "./browserApi";
import { CommandPalette, FindBar, type PaletteItem } from "./palette";
import { FeedPanel } from "./feed";
import { ContextMenu, type MenuItem } from "./contextmenu";
import { loadConfig, config, saveConfig, type ScanlineConfig } from "./config";
import { setLocale, resolveLocale, t, getLang } from "./i18n";
import { SettingsPanel } from "./settings";
import { onOverlayChange, pushOverlay, popOverlay } from "./overlay";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkForUpdateOnLaunch } from "./updater";
import { hasSeenOnboarding, showOnboarding } from "./onboarding";
import { nextPaneId } from "./types";
import type { PaneLike, SurfaceSpec, TreeSpec } from "./types";

/** A grid leaf: a container that starts with one terminal and can grow tabs. */
const newTerminalLeaf = () => new PaneContainer(new Pane(), () => new Pane());
const newCommandLeaf = (command: string) =>
  new PaneContainer(new Pane(command), () => new Pane());
const newBrowserLeaf = (url?: string) =>
  new PaneContainer(new BrowserPane(url), () => new Pane());

/** Default chords for the rebindable actions (overridable via config). */
const DEFAULT_BINDINGS: Record<string, string> = {
  palette: "ctrl+shift+p",
  switcher: "ctrl+p",
  find: "ctrl+f",
  findInDir: "ctrl+shift+f",
  newWorkspace: "ctrl+n",
  newTab: "ctrl+t",
  settings: "ctrl+,",
  minimal: "ctrl+shift+m",
  fullscreen: "f11",
  help: "ctrl+/",
};

/** Recreate a single surface from its restore spec. */
const paneFromSpec = (s: SurfaceSpec): PaneLike => {
  const p: PaneLike =
    s.kind === "browser" ? new BrowserPane(s.url) : new Pane(s.command, s.cwd, s.scrollback);
  if (s.title) p.setTitle?.(s.title);
  return p;
};

/** Inert placeholder used for non-active workspaces during boot. Holds a grid
 *  slot without opening an xterm or spawning a PTY. Replaced by loadTree when
 *  the workspace is first activated. */
class PlaceholderPane implements PaneLike {
  readonly paneId = nextPaneId();
  readonly kind = "terminal" as const;
  readonly el: HTMLElement;
  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "pane";
  }
  mount(): void {}
  focus(): void {}
  blur(): void {}
  refit(): void {}
  dispose(): Promise<void> { return Promise.resolve(); }
}

/** Recreate a grid leaf (container + its tabs) from serialized surface specs. */
const leafFromSpecs = (specs: SurfaceSpec[], active: number): PaneLike => {
  const list = specs.length ? specs : [{ kind: "terminal" as const }];
  const container = new PaneContainer(paneFromSpec(list[0]), () => new Pane());
  for (let i = 1; i < list.length; i++) container.addSurfaceQuiet(paneFromSpec(list[i]));
  container.setActiveIndex(active);
  return container;
};

interface Workspace {
  id: number;
  title: string;
  grid: HTMLElement;
  layout: Layout;
  /** Tree spec stored for lazy restore (non-active workspaces on boot). */
  pendingTree?: TreeSpec;
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
  args?: string[];
  status?: string;
  options?: string[];
}
interface ControlResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Map a named key / ctrl-chord (enter, tab, c-c, up, …) to pty bytes.
 *  Extended to handle the full set of tmux-compat keys emitted by the Go shim:
 *    F1-F4      -> SS3 sequences (\x1bOP .. \x1bOS)
 *    F5-F12     -> CSI tilde sequences (\x1b[15~ .. \x1b[24~)
 *    S-Tab/BTab -> \x1b[Z  (reverse-tab)
 *  Modifier prefixes C- (ctrl), M- (alt/meta), S- (shift) can be combined
 *  and are resolved recursively so e.g. "C-M-x" works. */
export function keyToBytes(key: string): string {
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
    // F1-F4: SS3 (VT220 / xterm default)
    f1: "\x1bOP",
    f2: "\x1bOQ",
    f3: "\x1bOR",
    f4: "\x1bOS",
    // F5-F12: CSI tilde (xterm)
    f5:  "\x1b[15~",
    f6:  "\x1b[17~",
    f7:  "\x1b[18~",
    f8:  "\x1b[19~",
    f9:  "\x1b[20~",
    f10: "\x1b[21~",
    f11: "\x1b[23~",
    f12: "\x1b[24~",
    // Shift-Tab (reverse-tab)
    "s-tab": "\x1b[Z",
    btab:    "\x1b[Z",
  };
  if (named[k]) return named[k];
  // C-/ctrl- modifier: map to control character (e.g. C-c -> \x03)
  const ctrl = k.match(/^(?:c|ctrl)-(.)$/);
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f);
  // M-/meta-/alt- modifier: prefix with ESC
  const meta = k.match(/^(?:m|meta|alt)-(.+)$/);
  if (meta) return "\x1b" + keyToBytes(meta[1]);
  // S-/shift- modifier: uppercase the base character
  const shift = k.match(/^s-(.+)$/);
  if (shift) return keyToBytes(shift[1]).toUpperCase();
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
  /** Last JSON written by the autosave loop (skip redundant disk writes). */
  private lastSaved = "";
  /** Last applied config JSON (skip reapply when an edit didn't change it). */
  private lastConfigJson = "";
  private nextWsId = 1;
  private sidebarVisible = true;
  /** True while a DOM overlay is open (browsers hidden); see onOverlayChange. */
  private overlayActive = false;
  private notifs: NotificationStore;
  private meta = new Map<
    number,
    { cwd: string; branch?: string | null; dirty?: boolean; pr?: string | null; ports?: number[] }
  >();
  private palette = new CommandPalette();
  private findBar = new FindBar();
  private feed = new FeedPanel();
  private menu = new ContextMenu();
  private settings = new SettingsPanel(
    (cfg) => this.applyConfig(cfg),
    () => void invoke("edit_config"),
  );

  constructor(
    private sidebar: HTMLElement,
    private content: HTMLElement,
  ) {
    this.notifs = new NotificationStore(
      (leafId) => this.paneElAcrossWs(leafId),
      (leafId) => this.focusPaneAcrossWs(leafId),
    );
    this.notifs.onChange = () => {
      this.renderSidebar();
      this.updateBellBadge();
    };

    this.installResizer();
    this.installContextMenu();
    // Native browser webviews paint above all DOM overlays; hide them while any
    // overlay (settings, help, palette, menu, feed) is open, restore after.
    // Track the state so a workspace switch mid-overlay keeps browsers hidden
    // (selectWorkspace consults this), instead of desyncing.
    onOverlayChange((active) => {
      this.overlayActive = active;
      if (!this.activeWs) return;
      this.activeLayout.setVisible(!active);
    });
    // Restore the prior session (or open a fresh workspace) before anything
    // that touches activeWs runs against it.
    void this.boot();

    // Guard matches the onOverlayChange sibling above — activeWs is undefined
    // until boot() finishes creating the first workspace.
    window.addEventListener("resize", () => { if (!this.activeWs) return; this.activeLayout.refitAll(); });
    // Global DevTools shortcut — works regardless of which pane has focus
    // (the xterm-scoped onKey handler only fires when a terminal is focused).
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "f12" || (e.ctrlKey && e.shiftKey && k === "i")) {
        e.preventDefault();
        void invoke("open_devtools");
      }
    });
    // Best-effort final save when the window closes (the 8s autosave covers
    // crashes / power loss).
    window.addEventListener("beforeunload", () => {
      console.log("[shell] beforeunload fired");
      // Don't persist during the async boot window — serializeSession would
      // write an empty workspace list and wipe the saved session.
      if (this.workspaces.length === 0) return;
      void invoke("save_session", { json: JSON.stringify(this.serializeSession()) });
    });
    // Reapply scanline.json after an edit (e.g. returning from Notepad).
    window.addEventListener("focus", () => void this.reloadConfig());
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
    // Signal the Rust control server that the frontend listeners above are now
    // registered. V2 requests arriving before this point would have timed out
    // (20s) instead of being served. The Rust side gates its first emit on this.
    void invoke("control_frontend_ready").catch(() => {});
  }

  get activeWs(): Workspace {
    return this.workspaces[this.active];
  }
  get activeLayout(): Layout {
    return this.activeWs.layout;
  }

  // ---- session restore ----
  /** Restore the prior session if present, else open one fresh workspace. */
  private async boot(): Promise<void> {
    // Load config first so the first panes pick up the configured font/theme.
    const cfg = await loadConfig();
    setLocale(await resolveLocale(cfg.ui.language));
    // Update titlebar tooltips now that locale is resolved.
    applyTitlebarTooltips();
    this.lastConfigJson = JSON.stringify(config());
    let restored = false;
    try {
      const raw = await invoke<string | null>("load_session");
      if (raw) {
        const data = JSON.parse(raw) as {
          active?: number;
          workspaces?: Array<{ title?: string; tree: TreeSpec }>;
        };
        if (data.workspaces?.length) {
          const idx = Math.max(0, Math.min(data.active ?? 0, data.workspaces.length - 1));
          for (let i = 0; i < data.workspaces.length; i++) {
            const w = data.workspaces[i];
            if (i === idx) {
              // Active workspace: full eager restore with staged mounting.
              const ws = this.newWorkspace();
              if (w.title) ws.title = w.title;
              await ws.layout.loadTree(w.tree, leafFromSpecs);
            } else {
              // Non-active workspaces: create a lightweight shell (no PTY, no
              // xterm) and store the spec for on-demand restore when the user
              // first switches to it.
              const grid = document.createElement("div");
              grid.className = "ws-grid";
              grid.style.display = "none";
              this.content.appendChild(grid);
              const layout = new Layout(grid, new PlaceholderPane());
              layout.setPaneFactory(newTerminalLeaf);
              layout.setBrowserFactory((url) => newBrowserLeaf(url));
              layout.setKeyHandler((e) => this.onKey(e));
              const ws: Workspace = {
                id: this.nextWsId++,
                title: w.title ?? t("ws.defaultTitle")(this.nextWsId - 1),
                grid,
                layout,
                pendingTree: w.tree,
              };
              layout.setNotifyHandler((pane, t, b) => {
                const surfaceId = (pane.activeSurface ?? pane).paneId;
                this.notifs.add(surfaceId, t, b, ws.id, ws.title);
                if (layout.focusedSurface.paneId === surfaceId && document.hasFocus()) {
                  this.notifs.clearForPane(surfaceId);
                }
              });
              layout.onFocusChange = (pane) => {
                const surfaceId = (pane.activeSurface ?? pane).paneId;
                this.notifs.clearForPane(surfaceId);
              };
              layout.onPaneClosed = (paneId) => this.notifs.removePane(paneId);
              layout.onPaneDragStart = () => layout.setVisible(false);
              layout.onPaneDragEnd = () => layout.setVisible(!this.overlayActive);
              this.workspaces.push(ws);
            }
          }
          this.selectWorkspace(idx);
          restored = true;
        }
      }
    } catch (err) {
      console.error("session restore failed:", err);
    }
    if (!restored) this.newWorkspace();
    this.renderSidebar();
    this.startAutosave();
    // Non-blocking: offer an update if one is published (silent otherwise).
    void checkForUpdateOnLaunch();
    // loadConfig() already cleared the flag when no config file existed, so
    // this check is now accurate: show onboarding only on true fresh installs.
    if (!hasSeenOnboarding()) {
      this.sidebar.style.visibility = "hidden";
      this.content.style.visibility = "hidden";
      showOnboarding(() => {
        this.sidebar.style.visibility = "";
        this.content.style.visibility = "";
      });
    }
  }

  /** The full app state needed to recreate workspaces + their layouts. */
  private serializeSession(): {
    active: number;
    workspaces: Array<{ title: string; tree: TreeSpec }>;
  } {
    return {
      active: this.active,
      workspaces: this.workspaces.map((w) => ({
        title: w.title,
        tree: w.layout.serializeTree(),
      })),
    };
  }

  /** Persist the session every 8s when it has changed. */
  private startAutosave(): void {
    setInterval(() => {
      // Removed `document.hidden` early-return: CLI/agent dispatch() can mutate
      // layout while minimized, so "hidden == unchanged" was false. The
      // json !== lastSaved dirty-check below is sufficient to suppress I/O
      // when nothing has actually changed.
      const json = JSON.stringify(this.serializeSession());
      if (json !== this.lastSaved) {
        this.lastSaved = json;
        void invoke("save_session", { json });
      }
    }, 8000);
    // Flush one save when the window goes to background so any mutations that
    // accumulated just before minimizing are persisted before the 8s tick fires.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      const json = JSON.stringify(this.serializeSession());
      if (json !== this.lastSaved) {
        this.lastSaved = json;
        void invoke("save_session", { json });
      }
    });
  }

  private helpEl?: HTMLElement;
  /** Toggle the keyboard-shortcut cheat sheet (Ctrl+/). */
  private toggleHelp(): void {
    if (this.helpEl) {
      this.helpEl.remove();
      this.helpEl = undefined;
      popOverlay("help");
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "settings-overlay";
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.toggleHelp();
    });
    const card = document.createElement("div");
    card.className = "settings-card help-card";
    const title = document.createElement("div");
    title.className = "settings-title";
    title.textContent = t("help.title");
    card.appendChild(title);
    const b = (name: string) => config().keybindings[name] || DEFAULT_BINDINGS[name];
    const pt = getLang() === "pt";
    const SECTIONS: Array<[string, Array<[string, string]>]> = [
      [pt ? "Geral" : "General", [
        [b("palette"),    pt ? "Paleta de comandos"           : "Command palette"],
        [b("switcher"),   pt ? "Trocar área / painel"         : "Switch workspace / pane"],
        ["Ctrl+/",        pt ? "Esta ajuda"                   : "This help"],
        [b("settings"),   pt ? "Configurações"                : "Settings"],
        [b("minimal"),    pt ? "Modo mínimo"                  : "Minimal mode"],
        [b("fullscreen"), pt ? "Tela cheia"                   : "Fullscreen"],
        ["Ctrl+B",        pt ? "Alternar barra lateral"       : "Toggle sidebar"],
        [b("find"),       pt ? "Buscar"                       : "Find"],
        [b("findInDir"),  pt ? "Buscar no diretório"          : "Find in directory"],
      ]],
      [pt ? "Áreas de trabalho" : "Workspaces", [
        [b("newWorkspace"), pt ? "Nova área de trabalho"              : "New workspace"],
        ["Alt+1..8",        pt ? "Ir para área (Alt+9 = última)"     : "Jump to workspace (Alt+9 = last)"],
        ["Alt+Shift+, / .", pt ? "Anterior / próxima"                : "Previous / next workspace"],
      ]],
      [pt ? "Painéis e divisões" : "Panes & splits", [
        ["Alt+Shift+Right", pt ? "Dividir à direita"       : "Split right"],
        ["Alt+Shift+Down",  pt ? "Dividir abaixo"          : "Split down"],
        ["Alt+Shift+B",     pt ? "Abrir painel navegador"  : "Open browser pane"],
        ["Alt+Arrows",      pt ? "Mover foco"              : "Move focus between panes"],
        ["Alt+Shift+Z",     pt ? "Zoom no painel"          : "Zoom pane"],
        ["Alt+Shift+E",     pt ? "Igualar divisões"        : "Equalize splits"],
        ["Ctrl+Shift+H",    pt ? "Piscar painel"           : "Flash focused pane"],
        ["Ctrl+Shift+W",    pt ? "Fechar painel"           : "Close pane"],
      ]],
      [pt ? "Abas" : "Tabs", [
        [b("newTab"),                   pt ? "Nova aba de terminal"  : "New terminal tab"],
        ["Ctrl+W",                      pt ? "Fechar aba"            : "Close tab"],
        ["Ctrl+Tab / Ctrl+Shift+Tab",   pt ? "Próxima / anterior"   : "Next / previous tab"],
        ["Ctrl+1..9",                   pt ? "Ir para aba"          : "Jump to tab"],
      ]],
      ["Terminal", [
        ["Ctrl+Shift+K",        pt ? "Limpar histórico"        : "Clear scrollback"],
        ["Ctrl+= / Ctrl+- / Ctrl+0", pt ? "Tamanho da fonte"  : "Font size (browser: page zoom)"],
        ["Ctrl+Shift+C / V",    pt ? "Copiar / colar"          : "Copy / paste"],
        ["Ctrl+Shift+A",        pt ? "Selecionar tudo"         : "Select all"],
      ]],
      [pt ? "Notificações" : "Notifications", [
        ["Alt+Shift+N", pt ? "Painel de notificações" : "Notifications panel"],
        ["Alt+Shift+U", pt ? "Última não lida"        : "Jump to latest unread"],
      ]],
    ];
    for (const [heading, rows] of SECTIONS) {
      const h = document.createElement("div");
      h.className = "help-section";
      h.textContent = heading;
      card.appendChild(h);
      for (const [keys, desc] of rows) {
        const row = document.createElement("div");
        row.className = "help-row";
        const k = document.createElement("kbd");
        k.className = "help-key";
        k.textContent = keys;
        const d = document.createElement("span");
        d.textContent = desc;
        row.append(k, d);
        card.appendChild(row);
      }
    }
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.helpEl = overlay;
    pushOverlay("help");
  }

  private fullscreen = false;
  private async toggleFullscreen(): Promise<void> {
    this.fullscreen = !this.fullscreen;
    try {
      await getCurrentWindow().setFullscreen(this.fullscreen);
    } catch (e) {
      console.error("fullscreen", e);
    }
  }

  /** Re-read scanline.json and apply it live (UI font + every terminal's
   *  font/theme). No-op if the file is unchanged since last applied. */
  async reloadConfig(): Promise<void> {
    await loadConfig();
    const j = JSON.stringify(config());
    if (j === this.lastConfigJson) return;
    this.lastConfigJson = j;
    this.reapplyConfig();
  }

  /** Persist a config (from the settings window) and apply it live. */
  private async applyConfig(cfg: ScanlineConfig): Promise<void> {
    await saveConfig(cfg);
    this.lastConfigJson = JSON.stringify(config());
    this.reapplyConfig();
  }

  /** Push the current config into every terminal + relayout (minimal mode
   *  changes available space, so refit after the class toggles). */
  private reapplyConfig(): void {
    for (const w of this.workspaces) {
      for (const c of w.layout.panes()) {
        for (const s of c.allSurfaces ?? [c]) {
          if (s.kind === "terminal") (s as Pane).applyConfig();
        }
      }
    }
    requestAnimationFrame(() => this.activeLayout.refitAll());
  }

  /** Toggle minimal mode (hide sidebar + tab bars) and persist it. */
  private toggleMinimal(): void {
    const c = config();
    void this.applyConfig({ ...c, ui: { ...c.ui, minimal: !c.ui.minimal } });
  }

  // ---- context menu ----
  private installContextMenu(): void {
    document.addEventListener("contextmenu", (e) => {
      // Replace WebView2's native menu everywhere in the chrome.
      e.preventDefault();
      const target = e.target as HTMLElement;
      const wsRow = target.closest<HTMLElement>(".ws-row");
      if (wsRow) return this.showWsMenu(e.clientX, e.clientY, wsRow);
      const container = this.containerFromEl(target);
      if (container) {
        this.activeLayout.setFocus(container);
        return this.showPaneMenu(e.clientX, e.clientY, container);
      }
      this.menu.show(e.clientX, e.clientY, [
        { label: t("menu.newWs"), hint: "Ctrl+N", action: () => this.newWorkspace() },
      ]);
    });
  }

  /** The grid leaf (container) whose element contains a DOM node, if any. */
  private containerFromEl(el: HTMLElement): PaneLike | null {
    if (!this.activeWs) return null;
    return this.activeLayout.panes().find((p) => p.el.contains(el)) ?? null;
  }

  private showPaneMenu(x: number, y: number, container: PaneLike): void {
    const L = this.activeLayout;
    const c = container as PaneContainer;
    const items: MenuItem[] = [];
    const surf = c.activeSurface;
    if (surf?.kind === "terminal") {
      const pane = surf as Pane;
      if (pane.hasSelection()) {
        items.push({ label: t("menu.copy"), hint: "Ctrl+Shift+C", action: () => void pane.copySelection() });
      }
      items.push(
        { label: t("menu.paste"), hint: "Ctrl+Shift+V", action: () => void pane.paste() },
        { label: t("menu.selectAll"), hint: "Ctrl+Shift+A", action: () => pane.selectAll() },
        { separator: true },
      );
    }
    items.push(
      { label: t("menu.renameTab"), action: () => c.startRenameActive() },
      { label: t("menu.newTab"), hint: "Ctrl+T", action: () => c.newTerminalTab() },
      { separator: true },
      { label: t("menu.splitRight"), action: () => L.splitFocused(newTerminalLeaf(), "row") },
      { label: t("menu.splitDown"), action: () => L.splitFocused(newTerminalLeaf(), "col") },
      { label: t("menu.openBrowser"), action: () => L.splitFocused(newBrowserLeaf()) },
      { separator: true },
      { label: t("menu.closeTab"), action: () => c.closeActiveSurface() },
      { label: t("menu.closePane"), danger: true, action: () => void L.closePane(container) },
    );
    this.menu.show(x, y, items);
  }

  private showWsMenu(x: number, y: number, row: HTMLElement): void {
    const id = Number(row.dataset.wsId);
    const w = this.workspaces.find((ws) => ws.id === id);
    if (!w) return;
    const label = row.querySelector<HTMLElement>(".ws-label");
    const items: MenuItem[] = [
      { label: t("menu.renameWs"), action: () => label && this.beginWsRename(w, label) },
      { label: t("menu.newWs"), hint: "Ctrl+N", action: () => this.newWorkspace() },
      { separator: true },
      { label: t("menu.closeWs"), danger: true, action: () => this.closeWorkspace(w.id) },
    ];
    this.menu.show(x, y, items);
  }

  // ---- workspaces ----
  newWorkspace(): Workspace {
    const grid = document.createElement("div");
    grid.className = "ws-grid";
    this.content.appendChild(grid);

    const layout = new Layout(grid, newTerminalLeaf());
    layout.setPaneFactory(newTerminalLeaf);
    layout.setBrowserFactory((url) => newBrowserLeaf(url));
    layout.setKeyHandler((e) => this.onKey(e));
    const ws: Workspace = {
      id: this.nextWsId++,
      title: t("ws.defaultTitle")(this.nextWsId - 1),
      grid,
      layout,
    };
    // Key notifications by SURFACE paneId (the active tab), not container paneId,
    // so each tab's ring is independent. On focus, clear only the now-active
    // surface's ring — not every tab in the container.
    layout.setNotifyHandler((pane, t, b) => {
      const surfaceId = (pane.activeSurface ?? pane).paneId;
      this.notifs.add(surfaceId, t, b, ws.id, ws.title);
      if (layout.focusedSurface.paneId === surfaceId && document.hasFocus()) {
        this.notifs.clearForPane(surfaceId);
      }
    });
    layout.onFocusChange = (pane) => {
      const surfaceId = (pane.activeSurface ?? pane).paneId;
      this.notifs.clearForPane(surfaceId);
    };
    layout.onPaneClosed = (paneId) => this.notifs.removePane(paneId);
    // While dragging a pane, hide browser webviews so the drop fires on the DOM
    // even over a native browser pane; restore after.
    layout.onPaneDragStart = () => layout.setVisible(false);
    layout.onPaneDragEnd = () => layout.setVisible(!this.overlayActive);

    this.workspaces.push(ws);
    this.selectWorkspace(this.workspaces.length - 1);
    return ws;
  }

  selectWorkspace(index: number): void {
    if (index < 0 || index >= this.workspaces.length) return;
    // Lazy restore: first visit to a non-active workspace that was deferred on boot.
    const target = this.workspaces[index];
    if (target.pendingTree) {
      const tree = target.pendingTree;
      target.pendingTree = undefined;
      void target.layout.loadTree(tree, leafFromSpecs).then(() => this.renderSidebar());
    }
    const prev = this.workspaces[this.active];
    if (prev && prev !== this.workspaces[index]) {
      prev.layout.setVisible(false);
      prev.grid.style.display = "none";
    }
    this.active = index;
    this.activeWs.grid.style.display = "";
    // Keep browsers hidden if an overlay is open, so a switch mid-overlay
    // doesn't paint the new workspace's webviews over it.
    this.activeWs.layout.setVisible(!this.overlayActive);
    this.activeWs.layout.refitAll();
    this.activeWs.layout.focusedPane.focus();
    this.renderSidebar();
    void this.refreshMeta();
  }

  async closeWorkspace(id: number): Promise<void> {
    const i = this.workspaces.findIndex((w) => w.id === id);
    if (i < 0 || this.workspaces.length === 1) return; // keep at least one
    const ws = this.workspaces[i];
    // Prune this workspace's notifications, then await full teardown (webviews)
    // before detaching the grid so nothing leaks.
    for (const s of ws.layout.serialize()) this.notifs.removePane(s.pane);
    await ws.layout.disposeAll();
    ws.grid.remove();
    this.meta.delete(id); // else one stale entry leaks per closed workspace
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
      const p = w.layout.paneById(leafId) ?? w.layout.containerOfSurface(leafId);
      if (p) return p.el;
    }
    return null;
  }
  /** Find the workspace + container holding a surface id, across all workspaces
   *  (agent hooks fire from panes in any workspace, not just the active one). */
  private findContainer(surfaceId: number): { ws: Workspace; container: PaneLike } | null {
    for (const ws of this.workspaces) {
      const c = ws.layout.containerOfSurface(surfaceId);
      if (c) return { ws, container: c };
    }
    return null;
  }

  private focusPaneAcrossWs(leafId: number): void {
    for (let i = 0; i < this.workspaces.length; i++) {
      const layout = this.workspaces[i].layout;
      const p = layout.paneById(leafId) ?? layout.containerOfSurface(leafId);
      if (p) {
        this.selectWorkspace(i);
        layout.setFocus(p);
        // If it's a surface inside a container, make sure it's active
        if (p.allSurfaces && p.selectSurface) {
          const idx = p.allSurfaces.findIndex((s) => s.paneId === leafId);
          if (idx !== -1) p.selectSurface(idx);
        }
        return;
      }
    }
  }

  toggleNotifications(): void {
    this.notifs.togglePanel();
  }

  private updateBellBadge(): void {
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    const count = this.notifs.totalUnread();
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.style.display = "";
      badge.classList.remove("pulse");
      // Force reflow so animation re-triggers on each new notification.
      void badge.offsetWidth;
      badge.classList.add("pulse");
    } else {
      badge.style.display = "none";
    }
  }

  openSettings(): void {
    this.settings.open();
  }

  // ---- sidebar ----
  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    this.sidebar.classList.toggle("hidden", !this.sidebarVisible);
    // Inline flex-basis set by the resizer overrides .hidden's flex:0 0 0 — sync it.
    if (!this.sidebarVisible) {
      this.sidebar.style.flexBasis = "0";
    } else {
      const saved = localStorage.getItem("scanline.sidebarWidth");
      this.sidebar.style.flexBasis = saved ? `${saved}px` : "";
    }
  }

  private renderSidebar(): void {
    const rows = this.workspaces.map((w, i) => {
      const row = document.createElement("div");
      row.className = "ws-row" + (i === this.active ? " active" : "");
      row.dataset.wsId = String(w.id);
      row.onclick = () => this.selectWorkspace(i);

      const top = document.createElement("div");
      top.className = "ws-top";
      const label = document.createElement("span");
      label.className = "ws-label";
      label.textContent = w.title;
      label.title = t("ws.renameHint");
      label.ondblclick = (e) => {
        e.stopPropagation();
        this.beginWsRename(w, label);
      };
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
    add.textContent = t("ws.add");
    add.onclick = () => this.newWorkspace();
    this.sidebar.replaceChildren(...rows, add);
  }

  /** Inline-edit a workspace label. Enter saves, Escape cancels, blur saves. */
  private beginWsRename(w: Workspace, label: HTMLElement): void {
    const input = document.createElement("input");
    input.className = "ws-rename";
    input.value = w.title;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name) w.title = name;
      this.renderSidebar();
    };
    input.onclick = (e) => e.stopPropagation();
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

  /** Refresh the ACTIVE workspace's focused-surface cwd -> git branch/dirty/PR +
   *  ports. Only the active one (hidden workspaces don't spawn git/gh every tick). */
  private metaBusy = false;
  /** Context (workspace+cwd) of the last fetch — gates ONLY the loading line so
   *  the animation shows when you switch pane/dir, not on every 4s poll. */
  private metaLoadingSig = "";
  private async refreshMeta(): Promise<void> {
    if (document.hidden) return; // minimized: don't spawn git/gh/netstat
    if (this.metaBusy) return; // previous poll still in flight (hung git/gh) — don't pile up
    const w = this.activeWs;
    if (!w) return; // boot not finished yet
    const fs = w.layout.focusedSurface;
    const cwd = fs.cwd ?? "";
    if (!cwd) return;
    // The timed poll re-fetches git branch/dirty/PR each tick so in-place changes
    // show (no fetch suppression; the JSON diff below prevents re-render flicker).
    // But the loading line only animates when the CONTEXT changes (new focused
    // pane / cwd) — not every tick — which is what the user asked for.
    const sig = `${w.id}|${cwd}`;
    const showLoading = sig !== this.metaLoadingSig;
    this.metaLoadingSig = sig;
    this.metaBusy = true;
    if (showLoading) this.setMetaLoading(true);
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
      // Re-validate: if the workspace was closed while the awaits were in flight
      // (closeWorkspace deletes meta and splices it out), drop the result —
      // otherwise meta.set re-creates the deleted entry and leaks it forever.
      if (!this.workspaces.includes(w)) return;
      const curr = this.meta.get(w.id);
      const currPorts = curr?.ports || [];
      const nextPorts = next.ports || [];
      let changed = !curr || curr.cwd !== next.cwd || curr.branch !== next.branch || curr.dirty !== next.dirty || curr.pr !== next.pr || currPorts.length !== nextPorts.length;
      if (!changed && curr) {
        for (let i = 0; i < nextPorts.length; i++) {
          if (currPorts[i] !== nextPorts[i]) changed = true;
        }
      }
      if (changed) {
        this.meta.set(w.id, next);
        this.renderSidebar();
      }
    } catch {
      /* git/gh not available or no repo */
    } finally {
      this.metaBusy = false;
      if (showLoading) this.setMetaLoading(false);
    }
  }

  /** Toggle a thin animated progress line on the active workspace row while its
   *  git/ports metadata is being fetched (the fetch can take a few seconds). */
  private setMetaLoading(on: boolean): void {
    const row = this.sidebar.querySelector(
      `.ws-row[data-ws-id="${this.activeWs?.id}"]`,
    ) as HTMLElement | null;
    if (!row) return;
    let bar = row.querySelector(".ws-loading") as HTMLElement | null;
    if (on) {
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "ws-loading";
        row.appendChild(bar);
      }
    } else {
      bar?.remove();
    }
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

  // ---- command palette / switcher / find ----
  private openCommands(): void {
    const L = this.activeLayout;
    const cmds: PaletteItem[] = [
      { id: "ws.new", label: t("cmd.ws.new"), hint: "Ctrl+N", run: () => this.newWorkspace() },
      { id: "ws.next", label: t("cmd.ws.next"), run: () => this.nextWorkspace() },
      { id: "ws.prev", label: t("cmd.ws.prev"), run: () => this.prevWorkspace() },
      { id: "split.right", label: t("cmd.split.right"), hint: "Alt+Shift+Right", run: () => L.splitWithNew("row") },
      { id: "split.down", label: t("cmd.split.down"), hint: "Alt+Shift+Down", run: () => L.splitWithNew("col") },
      { id: "tab.new", label: t("cmd.tab.new"), hint: "Ctrl+T", run: () => L.focusedPane.newTerminalTab?.() },
      { id: "browser", label: t("cmd.browser"), hint: "Alt+Shift+B", run: () => L.splitFocused(newBrowserLeaf()) },
      { id: "pane.close", label: t("cmd.pane.close"), hint: "Ctrl+Shift+W", run: () => L.closeFocused() },
      { id: "zoom", label: t("cmd.zoom"), hint: "Alt+Shift+Z", run: () => L.toggleZoom() },
      { id: "equalize", label: t("cmd.equalize"), hint: "Alt+Shift+E", run: () => L.equalize() },
      {
        id: "clear",
        label: t("cmd.clear"),
        hint: "Ctrl+Shift+K",
        run: () => {
          const s = L.focusedSurface;
          if (s.kind === "terminal") (s as Pane).clear();
        },
      },
      { id: "notif", label: t("cmd.notif"), hint: "Alt+Shift+N", run: () => this.notifs.togglePanel() },
      { id: "sidebar", label: t("cmd.sidebar"), hint: "Ctrl+B", run: () => this.toggleSidebar() },
      { id: "find", label: t("cmd.find"), hint: "Ctrl+F", run: () => this.openFind() },
      { id: "help", label: t("cmd.help"), hint: "Ctrl+/", run: () => this.toggleHelp() },
      { id: "settings", label: t("cmd.settings"), hint: "Ctrl+,", run: () => this.settings.open() },
      { id: "minimal", label: t("cmd.minimal"), hint: "Ctrl+Shift+M", run: () => this.toggleMinimal() },
      { id: "fullscreen", label: t("cmd.fullscreen"), hint: "F11", run: () => void this.toggleFullscreen() },
    ];
    this.palette.open(cmds, t("palette.command"));
  }

  private openSwitcher(): void {
    const items: PaletteItem[] = [];
    this.workspaces.forEach((w, i) => {
      const m = this.meta.get(w.id);
      items.push({
        id: "ws" + w.id,
        label: "⊞ " + w.title,
        hint: m?.branch ? `${m.cwd} ⎇ ${m.branch}` : m?.cwd || undefined,
        run: () => this.selectWorkspace(i),
      });
    });
    for (const s of this.activeLayout.serialize()) {
      items.push({
        id: "sf" + s.id,
        label: (s.kind === "browser" ? "◉ " : "❯ ") + (s.title || s.kind),
        hint: "surface " + s.id,
        run: () => {
          const c = this.activeLayout.containerOfSurface(s.id);
          if (c) this.activeLayout.setFocus(c);
        },
      });
    }
    this.palette.open(items, t("palette.switcher"));
  }

  private openFind(): void {
    // Do NOT capture `s` once at open time — the FindBar is a persistent overlay.
    // If the user closes the pane (Ctrl+W) or switches workspaces while Find is
    // open, a stale closed/disposed surface would be driven. Re-resolve lazily
    // inside each callback so we always target the current focused surface.
    let q = "";
    this.findBar.open({
      search: (query) => {
        q = query;
        this.runFind(this.activeLayout.focusedSurface, q, "next");
      },
      next: () => this.runFind(this.activeLayout.focusedSurface, q, "next"),
      prev: () => this.runFind(this.activeLayout.focusedSurface, q, "prev"),
      closed: () => {
        const s = this.activeLayout.focusedSurface;
        if (s.kind === "terminal") (s as Pane).clearSearch();
      },
    });
  }

  private openFindInDir(): void {
    const cwd = this.activeLayout.focusedSurface.cwd || "";
    this.palette.openAsync(async (q) => {
      if (!q) return [];
      try {
        const rows = await invoke<Array<{ file: string; line: number; text: string }>>("grep_dir", {
          cwd,
          query: q,
        });
        return rows.map((r) => ({
          id: `${r.file}:${r.line}`,
          label: `${r.file}:${r.line}`,
          hint: r.text,
          run: () => {
            const t = this.activeLayout.focusedSurface;
            if (t.kind === "terminal") (t as Pane).sendText(r.file);
          },
        }));
      } catch {
        return [];
      }
    }, `Find in ${cwd ? cwd.split(/[\\/]/).pop() : "dir"}…`);
  }

  private runFind(s: PaneLike, q: string, dir: "next" | "prev"): void {
    if (!q) return;
    if (s.kind === "terminal") {
      if (dir === "next") (s as Pane).findNext(q);
      else (s as Pane).findPrev(q);
    } else if (s.kind === "browser") {
      void invoke("browser_cdp", {
        id: s.paneId,
        method: "Runtime.evaluate",
        params: JSON.stringify({
          expression: `window.find(${JSON.stringify(q)}, false, ${dir === "prev"})`,
        }),
      });
    }
  }

  // ---- shortcuts ----
  private onKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    const layout = this.activeLayout;

    // Rebindable actions: a chord -> action table merged with config overrides,
    // checked before the fixed shortcuts below. Defaults mirror the built-in
    // chords, so unconfigured behavior is unchanged but every action is now
    // remappable via scanline.json "keybindings".
    const chord = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", key]
      .filter(Boolean)
      .join("+");
    const actions: Record<string, () => void> = {
      palette: () => this.openCommands(),
      switcher: () => this.openSwitcher(),
      find: () => this.openFind(),
      findInDir: () => this.openFindInDir(),
      newWorkspace: () => this.newWorkspace(),
      newTab: () => layout.focusedPane.newTerminalTab?.(),
      settings: () => this.settings.open(),
      minimal: () => this.toggleMinimal(),
      fullscreen: () => void this.toggleFullscreen(),
      help: () => this.toggleHelp(),
    };
    // Escape closes the help sheet if open.
    if (key === "escape" && this.helpEl) {
      this.toggleHelp();
      return true;
    }
    // Only match chords that carry a non-printable modifier (ctrl/alt/meta) or
    // are a function key. Without this, a bare-key custom binding (e.g.
    // "newTab": "j") would swallow that character in the terminal.
    const safeChord = e.ctrlKey || e.altKey || e.metaKey || /^f\d{1,2}$/.test(key);
    if (safeChord) {
      const binds = { ...DEFAULT_BINDINGS, ...config().keybindings };
      for (const name of Object.keys(actions)) {
        if (binds[name]?.toLowerCase() === chord) {
          actions[name]();
          return true;
        }
      }
    }

    const focusedTerminal = (): Pane | null => {
      const s = layout.focusedSurface;
      return s.kind === "terminal" ? (s as Pane) : null;
    };

    // Palette/switcher/find/findInDir/newWorkspace/newTab/settings/minimal/
    // fullscreen are handled by the rebindable-actions table above; only the
    // fixed (non-rebindable) shortcuts remain below.
    // F12 / Ctrl+Shift+I — open DevTools for the main window.
    if (key === "f12" || (e.ctrlKey && e.shiftKey && key === "i")) {
      void invoke("open_devtools");
      return true;
    }
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
    if (e.altKey && e.shiftKey && key === "n") {
      this.notifs.togglePanel();
      return true;
    }
    if (e.altKey && e.shiftKey && key === "u") {
      this.notifs.jumpLatestUnread();
      return true;
    }
    if (e.ctrlKey && e.shiftKey && key === "k") {
      focusedTerminal()?.clear();
      return true;
    }
    // Ctrl +/-/0: terminal font size, OR browser page zoom — arbitrated by the
    // focused leaf's kind so the same chord does the right thing in either.
    if (e.ctrlKey && !e.altKey && (key === "=" || key === "+" || key === "-" || key === "0")) {
      const delta = key === "0" ? 0 : key === "-" ? -1 : 1;
      const s = layout.focusedSurface;
      if (s.kind === "browser") (s as BrowserPane).adjustZoom(delta);
      else (s as Pane).adjustFontSize(delta);
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
  /** Resolve a surface for send_text / send_key / read_text / pane.clear.
   *  When surface is a number, searches ALL workspaces (agent hooks fire from
   *  panes in any workspace, not just the active one — mirrors findContainer).
   *  Falls back to the active workspace's focused surface only when surface is
   *  undefined. */
  private targetPane(surface?: number): PaneLike | null {
    if (typeof surface === "number") {
      for (const ws of this.workspaces) {
        const s = ws.layout.surfaceById(surface);
        if (s) return s;
      }
      return null;
    }
    return this.activeLayout.focusedSurface;
  }
  /** Resolve the target browser surface id for the "browser" control verb.
   *  When surface is a number, resolution is STRICT:
   *    - not found across any workspace -> {error}
   *    - found but kind !== "browser"   -> {error}  (never silently retarget)
   *  When surface is undefined, use focused-if-browser else first browser
   *  in tree order (existing fallback behavior, intentional for unaddressed ops). */
  private browserSurface(surface?: number): { paneId: number } | { error: string } | null {
    if (typeof surface === "number") {
      for (const ws of this.workspaces) {
        const s = ws.layout.surfaceById(surface);
        if (s) {
          if (s.kind !== "browser")
            return { error: `surface ${surface} is not a browser (kind: ${s.kind})` };
          return { paneId: s.paneId };
        }
      }
      return { error: `no surface ${surface}` };
    }
    // undefined -> use focused-then-first-browser fallback
    const layout = this.activeLayout;
    const fs = layout.focusedSurface;
    if (fs.kind === "browser") return { paneId: fs.paneId };
    const b = layout.serialize().find((x) => x.kind === "browser");
    return b ? { paneId: b.id } : null;
  }

  private async dispatch(cmd: ControlCommand): Promise<ControlResult> {
    if (!cmd || typeof cmd.method !== "string") return { ok: false, error: "missing method" };
    if (!this.activeWs) return { ok: false, error: "starting up" };
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
      case "surface.rename": {
        // Renames the active tab of the target container (caller pane across
        // workspaces, else the focused pane). Empty name clears to auto.
        const hit =
          typeof cmd.surface === "number"
            ? this.findContainer(cmd.surface)
            : { ws: this.activeWs, container: layout.focusedPane };
        if (!hit) return { ok: false, error: `no surface ${cmd.surface}` };
        hit.container.setTitle?.(cmd.name ?? cmd.text ?? "");
        return { ok: true };
      }
      case "surface.status": {
        // Agent lifecycle (running/waiting/idle/error). Targets the caller pane
        // across any workspace; "waiting" also rings (agent needs input).
        const hit =
          typeof cmd.surface === "number"
            ? this.findContainer(cmd.surface)
            : { ws: this.activeWs, container: layout.focusedPane };
        if (!hit) return { ok: false, error: `no surface ${cmd.surface}` };
        hit.container.setStatus?.(cmd.status ?? "idle");
        return { ok: true };
      }
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
        const bres = this.browserSurface(cmd.surface);
        // null  -> no browser pane exists at all
        // error -> caller supplied an explicit surface id that was wrong/not a browser
        if (bres == null) return { ok: false, error: "no browser surface" };
        if ("error" in bres) return { ok: false, error: bres.error };
        return await browserDispatch(bres.paneId, cmd.verb ?? "", cmd.args ?? []);
      }
      case "notify": {
        const hit =
          typeof cmd.surface === "number"
            ? this.findContainer(cmd.surface)
            : { ws: this.activeWs, container: layout.focusedPane };
        const { ws, container } = hit ?? { ws: this.activeWs, container: layout.focusedPane };
        // Key on the SURFACE paneId (the agent pane that fired the hook =
        // cmd.surface/SCANLINE_SURFACE_ID), matching onFocusChange's clearForPane
        // key. Keying on container.paneId never matched the clear key, so these
        // notifications were never marked read and the sidebar badge only grew.
        const surfaceId =
          typeof cmd.surface === "number"
            ? cmd.surface
            : (container.activeSurface ?? container).paneId;
        this.notifs.add(surfaceId, cmd.title ?? "", cmd.body ?? cmd.text ?? "", ws.id, ws.title);
        return { ok: true };
      }
      case "grep": {
        const cwd = this.activeLayout.focusedSurface.cwd || "";
        if (!cwd) return { ok: false, error: "no cwd (cd in the focused terminal first)" };
        const rows = await invoke("grep_dir", { cwd, query: cmd.text ?? "" });
        return { ok: true, result: rows };
      }
      case "notif.list":
        return { ok: true, result: this.notifs.list() };
      case "notif.clear":
        this.notifs.clearAll();
        return { ok: true };
      // ---- feed: blocking approval cards ----
      case "feed.ask": {
        // Resolves only when the user clicks an option. The pipe client (and
        // thus the agent's hook) stays blocked until then — Rust uses a 600s
        // reply timeout to allow for a human decision.
        const decision = await this.feed.ask({
          title: cmd.title ?? "Agent request",
          body: cmd.body ?? cmd.text ?? "",
          options: cmd.options ?? [],
        });
        return { ok: true, result: { decision } };
      }
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
      case "ui.palette":
        this.openCommands();
        return { ok: true };
      case "ui.switcher":
        this.openSwitcher();
        return { ok: true };
      case "ui.find":
        this.openFind();
        return { ok: true };
      case "ui.findInDir":
        this.openFindInDir();
        return { ok: true };
      case "ui.fullscreen":
        await this.toggleFullscreen();
        return { ok: true };
      case "ui.help":
        this.toggleHelp();
        return { ok: true };
      case "ui.settings":
        this.settings.open();
        return { ok: true };
      case "config.edit":
        await invoke("edit_config");
        return { ok: true };
      case "config.reload":
        await this.reloadConfig();
        return { ok: true };
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
  "surface.status", "surface.rename",
  "surface.send_text", "surface.send_key", "surface.read_text",
  "browser.open", "browser", "notify", "notif.list", "notif.clear", "feed.ask", "grep",
  "workspace.new", "workspace.list", "workspace.current", "workspace.select",
  "workspace.close", "workspace.rename",
  "ui.palette", "ui.switcher", "ui.find", "ui.findInDir", "ui.fullscreen",
  "ui.help", "ui.settings",
  "config.edit", "config.reload",
  "system.ping", "system.identify", "system.capabilities",
];

function applyTitlebarTooltips(): void {
  const pt = getLang() === "pt";
  const showShortcut = config().ui.tooltipShortcuts;
  const tip = (label: string, shortcut: string) =>
    showShortcut ? `${label} (${shortcut})` : label;
  const tt: Record<string, string> = {
    "tb-minimize":       pt ? "Minimizar"             : "Minimize",
    "tb-maximize":       pt ? "Maximizar"             : "Maximize",
    "tb-close":          pt ? "Fechar"                : "Close",
    "tb-sidebar-toggle": tip(pt ? "Alternar barra lateral" : "Toggle Sidebar", "Ctrl+B"),
    "tb-new-workspace":  tip(pt ? "Nova área de trabalho"  : "New Workspace",  "Ctrl+N"),
    "tb-notifications":  tip(pt ? "Notificações"           : "Notifications",  "Alt+Shift+N"),
    "tb-settings":       tip(pt ? "Configurações"          : "Settings",       "Ctrl+,"),
  };
  for (const [id, title] of Object.entries(tt)) {
    const el = document.getElementById(id);
    if (el) el.title = title;
  }
}

function wireTitlebarControls(): void {
  const win = getCurrentWindow();
  document.getElementById("tb-minimize")?.addEventListener("click", () => win.minimize());
  document.getElementById("tb-maximize")?.addEventListener("click", () => win.toggleMaximize());
  document.getElementById("tb-close")?.addEventListener("click", () => win.close());
}

function wireTitlebarActions(app: App): void {
  document.getElementById("tb-sidebar-toggle")?.addEventListener("click", () => app.toggleSidebar());
  document.getElementById("tb-new-workspace")?.addEventListener("click", () => app.newWorkspace());
  document.getElementById("tb-settings")?.addEventListener("click", () => app.openSettings());
  document.getElementById("tb-notifications")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    const panel = document.querySelector(".notif-panel") as HTMLElement | null;
    if (panel) {
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.left = `${rect.left}px`;
    }
    app.toggleNotifications();
    requestAnimationFrame(() => {
      const p = document.querySelector(".notif-panel") as HTMLElement | null;
      if (p && p.style.display !== "none") {
        p.style.top = `${rect.bottom + 4}px`;
        p.style.left = `${rect.left}px`;
      }
    });
  });
}

function main() {
  window.addEventListener("error", (e) => {
    console.error("[Global Error]", e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[Unhandled Promise Rejection]", e.reason);
  });

  const sidebar = document.getElementById("sidebar");
  const content = document.getElementById("content");
  if (!sidebar || !content) return;
  installTooltips();
  initIcons();
  wireTitlebarControls();

  const app = new App(sidebar, content);
  wireTitlebarActions(app);
  document.getElementById("splash")?.remove();
}

window.addEventListener("DOMContentLoaded", main);
