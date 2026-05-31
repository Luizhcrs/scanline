import { listen } from "@tauri-apps/api/event";
import { Pane } from "./pane";
import { BrowserPane } from "./browser";
import { Layout } from "./layout";

/** A command from the named-pipe control server (agent shim / CLI / scripts). */
interface ControlCommand {
  method: string;
  dir?: "row" | "col" | "left" | "right" | "up" | "down";
  text?: string;
  url?: string;
  command?: string;
}

function main() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return;

  const first = new Pane();
  const layout = new Layout(workspace, first);
  layout.setPaneFactory(() => new Pane());

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
  void listen<ControlCommand>("control://command", (e) => {
    const cmd = e.payload;
    if (!cmd || typeof cmd.method !== "string") return;
    switch (cmd.method) {
      case "pane.split": {
        const dir = cmd.dir === "col" || cmd.dir === "row" ? cmd.dir : undefined;
        if (cmd.command) layout.splitFocused(new Pane(cmd.command), dir);
        else layout.splitWithNew(dir);
        break;
      }
      case "pane.new":
        if (cmd.command) layout.splitFocused(new Pane(cmd.command));
        else layout.splitWithNew();
        break;
      case "pane.close":
        layout.closeFocused();
        break;
      case "pane.focus":
        if (
          cmd.dir === "left" ||
          cmd.dir === "right" ||
          cmd.dir === "up" ||
          cmd.dir === "down"
        ) {
          layout.focusDir(cmd.dir);
        }
        break;
      case "browser.open":
        layout.splitFocused(new BrowserPane(cmd.url));
        break;
      case "notify":
        console.log("[notify]", cmd.text ?? "");
        break;
      default:
        console.warn("unknown control method:", cmd.method);
    }
  });
}

window.addEventListener("DOMContentLoaded", main);
