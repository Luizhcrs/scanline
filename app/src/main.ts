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

/** A command from the named-pipe control server (agent shim / CLI / scripts). */
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

/** Map a named key / ctrl-chord (enter, tab, c-c, up, …) to the bytes a pty
 *  expects; falls back to the literal string. */
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

function main() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return;

  const first = newTerminalLeaf();
  const layout = new Layout(workspace, first);
  layout.setPaneFactory(newTerminalLeaf);

  // Notifications: ring a pane on OSC 9/777/bell or the notify verb; clear on focus.
  const notifs = new NotificationStore(
    (id) => layout.paneById(id)?.el ?? null,
    (id) => {
      const p = layout.paneById(id);
      if (p) layout.setFocus(p);
    },
  );
  layout.setNotifyHandler((pane, title, body) => notifs.add(pane.paneId, title, body));
  layout.onFocusChange = (pane) => notifs.clearForPane(pane.paneId);

  const focusedTerminal = (): Pane | null => {
    const s = layout.focusedSurface;
    return s.kind === "terminal" ? (s as Pane) : null;
  };

  // Keep native browser webviews aligned when the window resizes.
  window.addEventListener("resize", () => layout.refitAll());

  // App shortcuts. Runs inside xterm's key path (Pane.attachCustomKeyEventHandler);
  // return true to consume the key (not forwarded to the shell).
  layout.setKeyHandler((e: KeyboardEvent): boolean => {
    const key = e.key.toLowerCase();

    // Split focused pane, auto direction: Alt+Shift+D
    if (e.altKey && e.shiftKey && key === "d") {
      layout.splitWithNew();
      return true;
    }
    // Explicit splits: Alt+Shift+Right (side), Alt+Shift+Down (stacked)
    if (e.altKey && e.shiftKey && e.key === "ArrowRight") {
      layout.splitWithNew("row");
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      layout.splitWithNew("col");
      return true;
    }
    // Open a browser pane in a split: Alt+Shift+B
    if (e.altKey && e.shiftKey && key === "b") {
      layout.splitFocused(newBrowserLeaf());
      return true;
    }
    // Close focused PANE: Ctrl+Shift+W ; close focused TAB: Ctrl+W
    if (e.ctrlKey && e.shiftKey && key === "w") {
      layout.closeFocused();
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "w") {
      layout.focusedPane.closeActiveSurface?.();
      return true;
    }
    // Surface tabs: new (Ctrl+T), next (Ctrl+Tab), prev (Ctrl+Shift+Tab)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "t") {
      layout.focusedPane.newTerminalTab?.();
      return true;
    }
    if (e.ctrlKey && e.key === "Tab") {
      if (e.shiftKey) layout.focusedPane.prevSurface?.();
      else layout.focusedPane.nextSurface?.();
      return true;
    }
    // Jump to tab: Ctrl+1..8 ; Ctrl+9 = last
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      const n = parseInt(e.key, 10);
      layout.focusedPane.selectSurface?.(n === 9 ? 999 : n - 1);
      return true;
    }
    // Notifications panel: Alt+Shift+N ; jump latest unread: Alt+Shift+U
    if (e.altKey && e.shiftKey && key === "n") {
      notifs.togglePanel();
      return true;
    }
    if (e.altKey && e.shiftKey && key === "u") {
      notifs.jumpLatestUnread();
      return true;
    }
    // Clear scrollback: Ctrl+Shift+K
    if (e.ctrlKey && e.shiftKey && key === "k") {
      focusedTerminal()?.clear();
      return true;
    }
    // Font size: Ctrl+= / Ctrl+- / Ctrl+0
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
    // Copy / paste / select-all: Ctrl+Shift+C / V / A
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
    // Zoom focused pane: Alt+Shift+Z ; equalize: Alt+Shift+E ; flash: Ctrl+Shift+H
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
  });

  // External control: agent tmux-shim / CLI / scripts drive the grid via the
  // named-pipe control server (\\.\pipe\scanline).
  const targetPane = (surface?: number): PaneLike | null =>
    typeof surface === "number" ? layout.surfaceById(surface) : layout.focusedSurface;

  // Resolve a browser surface to drive: explicit surface, else focused, else first.
  const browserSurface = (surface?: number): number | null => {
    if (typeof surface === "number") {
      const s = layout.surfaceById(surface);
      if (s && s.kind === "browser") return s.paneId;
    }
    const fs = layout.focusedSurface;
    if (fs.kind === "browser") return fs.paneId;
    const b = layout.serialize().find((x) => x.kind === "browser");
    return b ? b.id : null;
  };

  const dispatch = async (cmd: ControlCommand): Promise<ControlResult> => {
    if (!cmd || typeof cmd.method !== "string") {
      return { ok: false, error: "missing method" };
    }
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
      case "browser.open":
        layout.splitFocused(newBrowserLeaf(cmd.url));
        return { ok: true };
      case "pane.list":
      case "surface.list":
        return { ok: true, result: layout.serialize() };
      case "surface.send_text":
      case "surface.send_key": {
        const p = targetPane(cmd.surface);
        if (!p) return { ok: false, error: "no target surface" };
        if (p.kind !== "terminal") return { ok: false, error: "surface is not a terminal" };
        const bytes =
          cmd.method === "surface.send_key" ? keyToBytes(cmd.key ?? "") : cmd.text ?? "";
        (p as Pane).sendText(bytes);
        return { ok: true };
      }
      case "surface.read_text": {
        const p = targetPane(cmd.surface);
        if (!p) return { ok: false, error: "no target surface" };
        if (p.kind !== "terminal") return { ok: false, error: "surface is not a terminal" };
        return { ok: true, result: { text: (p as Pane).readText() } };
      }
      case "pane.clear": {
        const p = targetPane(cmd.surface);
        if (p && p.kind === "terminal") (p as Pane).clear();
        return { ok: true };
      }
      case "pane.equalize":
        layout.equalize();
        return { ok: true };
      case "pane.zoom":
        layout.toggleZoom();
        return { ok: true };
      case "pane.resize":
        layout.resizeFocused(typeof cmd.delta === "number" ? cmd.delta : 0.05);
        return { ok: true };
      case "notif.list":
        return { ok: true, result: notifs.list() };
      case "notif.clear":
        notifs.clearAll();
        return { ok: true };
      case "system.ping":
        return { ok: true, result: { pong: true } };
      case "system.identify":
        return { ok: true, result: { focused: layout.focusedPane.paneId } };
      case "system.capabilities":
        return {
          ok: true,
          result: {
            methods: [
              "pane.split",
              "pane.new",
              "pane.close",
              "pane.focus",
              "pane.list",
              "surface.list",
              "surface.new",
              "surface.next",
              "surface.prev",
              "surface.close",
              "surface.select",
              "surface.send_text",
              "surface.send_key",
              "surface.read_text",
              "pane.clear",
              "pane.equalize",
              "pane.zoom",
              "pane.resize",
              "notif.list",
              "notif.clear",
              "browser.open",
              "browser",
              "notify",
              "system.ping",
              "system.identify",
              "system.capabilities",
            ],
          },
        };
      case "notify": {
        const c =
          typeof cmd.surface === "number"
            ? layout.containerOfSurface(cmd.surface)
            : layout.focusedPane;
        notifs.add((c ?? layout.focusedPane).paneId, cmd.title ?? "", cmd.body ?? cmd.text ?? "");
        return { ok: true };
      }
      case "browser": {
        const sid = browserSurface(cmd.surface);
        if (sid == null) return { ok: false, error: "no browser surface" };
        return await browserDispatch(sid, cmd.verb ?? "", cmd.args ?? []);
      }
      default:
        return { ok: false, error: `unknown method ${cmd.method}` };
    }
  };

  // V2 request/response: compute a result and reply keyed by the request id.
  void listen<ControlCommand>("control://request", (e) => {
    const cmd = e.payload;
    dispatch(cmd)
      .then((r) => invoke("control_reply", { id: cmd.id, response: { id: cmd.id, ...r } }))
      .catch((err) =>
        invoke("control_reply", {
          id: cmd.id,
          response: { id: cmd.id, ok: false, error: String(err) },
        }),
      );
  });
  // Legacy fire-and-forget (no id).
  void listen<ControlCommand>("control://command", (e) => {
    void dispatch(e.payload);
  });
}

window.addEventListener("DOMContentLoaded", main);
