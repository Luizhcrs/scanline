import { Pane } from "./pane";
import { BrowserPane } from "./browser";
import { Layout } from "./layout";

async function newPane(): Promise<Pane> {
  const p = new Pane();
  await p.start();
  return p;
}

async function main() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return;

  const first = await newPane();
  const layout = new Layout(workspace, first);

  // Shortcut handler. Runs inside xterm's key path (see Pane.attachCustomKeyEventHandler).
  // Return true to consume the key (not forwarded to the shell).
  layout.setKeyHandler((e: KeyboardEvent): boolean => {
    const key = e.key.toLowerCase();

    // Split focused pane, auto direction: Alt+Shift+D
    if (e.altKey && e.shiftKey && key === "d") {
      void (async () => layout.splitFocused(await newPane()))();
      return true;
    }
    // Explicit splits: Alt+Shift+Right (side), Alt+Shift+Down (stacked)
    if (e.altKey && e.shiftKey && e.key === "ArrowRight") {
      void (async () => layout.splitFocused(await newPane(), "row"))();
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      void (async () => layout.splitFocused(await newPane(), "col"))();
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
}

window.addEventListener("DOMContentLoaded", main);
