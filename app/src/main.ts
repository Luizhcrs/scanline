import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Pane } from "./pane";
import { BrowserPane } from "./browser";
import { Layout } from "./layout";
import { NotificationStore } from "./notifications";
import type { PaneLike } from "./types";

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

  const first = new Pane();
  const layout = new Layout(workspace, first);
  layout.setPaneFactory(() => new Pane());

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

  const focusedTerminal = (): Pane | null =>
    layout.focusedPane.kind === "terminal" ? (layout.focusedPane as Pane) : null;

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
      layout.splitFocused(new BrowserPane());
      return true;
    }
    // Close focused: Ctrl+Shift+W
    if (e.ctrlKey && e.shiftKey && key === "w") {
      layout.closeFocused();
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
    typeof surface === "number" ? layout.paneById(surface) : layout.focusedPane;

  const dispatch = (cmd: ControlCommand): ControlResult => {
    if (!cmd || typeof cmd.method !== "string") {
      return { ok: false, error: "missing method" };
    }
    switch (cmd.method) {
      case "pane.split": {
        const dir = cmd.dir === "col" || cmd.dir === "row" ? cmd.dir : undefined;
        if (cmd.command) layout.splitFocused(new Pane(cmd.command), dir);
        else layout.splitWithNew(dir);
        return { ok: true };
      }
      case "pane.new":
        if (cmd.command) layout.splitFocused(new Pane(cmd.command));
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
          const p = layout.paneById(cmd.surface);
          if (!p) return { ok: false, error: `no surface ${cmd.surface}` };
          layout.setFocus(p);
          return { ok: true };
        }
        return { ok: false, error: "pane.focus needs dir or surface" };
      case "browser.open":
        layout.splitFocused(new BrowserPane(cmd.url));
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
              "surface.send_text",
              "surface.send_key",
              "surface.read_text",
              "pane.clear",
              "browser.open",
              "notify",
              "system.ping",
              "system.identify",
              "system.capabilities",
            ],
          },
        };
      case "notify": {
        const leaf =
          typeof cmd.surface === "number" ? cmd.surface : layout.focusedPane.paneId;
        notifs.add(leaf, cmd.title ?? "", cmd.body ?? cmd.text ?? "");
        return { ok: true };
      }
      default:
        return { ok: false, error: `unknown method ${cmd.method}` };
    }
  };

  // V2 request/response: compute a result and reply keyed by the request id.
  void listen<ControlCommand>("control://request", (e) => {
    const cmd = e.payload;
    const r = dispatch(cmd);
    void invoke("control_reply", { id: cmd.id, response: { id: cmd.id, ...r } });
  });
  // Legacy fire-and-forget (no id).
  void listen<ControlCommand>("control://command", (e) => {
    dispatch(e.payload);
  });
}

window.addEventListener("DOMContentLoaded", main);
