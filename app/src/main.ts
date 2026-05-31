import { Pane } from "./pane";
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

  // Open Claude in the focused pane (just types the command for now; the
  // scanline CLI integration lands in phase 3).
  async function splitWith(): Promise<void> {
    const p = await newPane();
    layout.splitFocused(p);
  }

  window.addEventListener("keydown", (e) => {
    // Split: Alt+Shift+D (auto direction)
    if (e.altKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault();
      void splitWith();
      return;
    }
    // Split explicit: Alt+Shift+ArrowRight/Down
    if (e.altKey && e.shiftKey && e.key === "ArrowRight") {
      e.preventDefault();
      void (async () => layout.splitFocused(await newPane(), "row"))();
      return;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      e.preventDefault();
      void (async () => layout.splitFocused(await newPane(), "col"))();
      return;
    }
    // Close focused: Ctrl+Shift+W
    if (e.ctrlKey && e.shiftKey && (e.key === "W" || e.key === "w")) {
      e.preventDefault();
      layout.closeFocused();
      return;
    }
    // Focus navigation: Alt+Arrow
    if (e.altKey && !e.shiftKey) {
      const map: Record<string, "left" | "right" | "up" | "down"> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        layout.focusDir(dir);
      }
    }
  });
}

window.addEventListener("DOMContentLoaded", main);
