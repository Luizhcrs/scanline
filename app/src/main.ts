import { invoke } from "@tauri-apps/api/core";
import { Pane } from "./pane";
import { BrowserView, tabLabel } from "./browser";
import { Layout } from "./layout";

type Active = "terminal" | number; // "terminal" | browser id

/**
 * App shell: a DOM tab strip on top of a content area. The terminal grid is one
 * tab; each browser is its own full-width tab. Only one tab's content shows at a
 * time — switching tabs hides the others' native webviews, so a browser webview
 * never floats over the terminal grid or its resize gutters.
 */
class Shell {
  private layout: Layout;
  private browsers = new Map<number, BrowserView>();
  private chips = new Map<number, HTMLElement>();
  private terminalChip!: HTMLElement;
  private active: Active = "terminal";

  constructor(
    private tabbar: HTMLElement,
    private content: HTMLElement,
    private workspace: HTMLElement,
  ) {
    const first = new Pane();
    this.layout = new Layout(workspace, first);
    this.layout.setPaneFactory(() => new Pane());
    this.layout.setKeyHandler((e) => this.onKey(e));

    this.buildTabbar();

    // Keep the active browser's webview glued to the content area on resize.
    window.addEventListener("resize", () => {
      if (this.active === "terminal") this.layout.refitAll();
      else this.browsers.get(this.active)?.refit();
    });
  }

  private buildTabbar(): void {
    this.terminalChip = this.mkChip("Terminal", () => this.selectTerminal());
    const add = document.createElement("button");
    add.className = "tab-add";
    add.textContent = "+";
    add.title = "New browser tab (Alt+Shift+B)";
    add.onclick = () => this.openBrowser();
    this.tabbar.append(this.terminalChip, add);
    this.updateChips();
  }

  /** A tab chip; `onClose` (if given) adds a × button. */
  private mkChip(
    label: string,
    onSelect: () => void,
    onClose?: () => void,
  ): HTMLElement {
    const chip = document.createElement("div");
    chip.className = "tab";
    const name = document.createElement("span");
    name.className = "tab-label";
    name.textContent = label;
    chip.onclick = onSelect;
    chip.append(name);
    if (onClose) {
      const x = document.createElement("button");
      x.className = "tab-close";
      x.textContent = "✕";
      x.onclick = (e) => {
        e.stopPropagation();
        onClose();
      };
      chip.append(x);
    }
    return chip;
  }

  private openBrowser(url?: string): void {
    const view = new BrowserView(url ?? "https://duckduckgo.com");
    view.onCloseRequest = (v) => this.closeBrowser(v.id);
    view.onTitleChange = (v) => this.refreshChipLabel(v.id);
    this.content.append(view.el);
    this.browsers.set(view.id, view);

    const chip = this.mkChip(
      tabLabel(view.url),
      () => this.selectBrowser(view.id),
      () => this.closeBrowser(view.id),
    );
    this.chips.set(view.id, chip);
    // Insert before the trailing "+" button.
    this.tabbar.insertBefore(chip, this.tabbar.lastElementChild);

    this.selectBrowser(view.id);
  }

  private closeBrowser(id: number): void {
    const view = this.browsers.get(id);
    if (!view) return;
    void view.dispose();
    this.browsers.delete(id);
    this.chips.get(id)?.remove();
    this.chips.delete(id);
    if (this.active === id) this.selectTerminal();
  }

  private selectTerminal(): void {
    this.active = "terminal";
    for (const v of this.browsers.values()) v.hide();
    this.workspace.style.display = "";
    this.updateChips();
    // Terminals were display:none-collapsed; refit to the restored size and
    // return keyboard focus to the focused pane.
    this.layout.refitAll();
    this.layout.focusedPane.focus();
  }

  private selectBrowser(id: number): void {
    const view = this.browsers.get(id);
    if (!view) return;
    this.active = id;
    // Hide the terminal grid and every other browser; show this one.
    this.workspace.style.display = "none";
    for (const [vid, v] of this.browsers) {
      if (vid !== id) v.hide();
    }
    view.show();
    this.updateChips();
  }

  private refreshChipLabel(id: number): void {
    const view = this.browsers.get(id);
    const chip = this.chips.get(id);
    if (!view || !chip) return;
    const label = chip.querySelector(".tab-label");
    if (label) label.textContent = tabLabel(view.url);
  }

  private updateChips(): void {
    this.terminalChip.classList.toggle("active", this.active === "terminal");
    for (const [id, chip] of this.chips) {
      chip.classList.toggle("active", this.active === id);
    }
  }

  /** App shortcuts. Runs inside xterm's key path (terminal tab only — a focused
   *  browser webview swallows keys, so use the DOM tab strip to leave it). */
  private onKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();

    if (e.altKey && e.shiftKey && key === "d") {
      this.layout.splitWithNew();
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowRight") {
      this.layout.splitWithNew("row");
      return true;
    }
    if (e.altKey && e.shiftKey && e.key === "ArrowDown") {
      this.layout.splitWithNew("col");
      return true;
    }
    // Open a new browser tab: Alt+Shift+B
    if (e.altKey && e.shiftKey && key === "b") {
      this.openBrowser();
      return true;
    }
    // Close focused terminal pane: Ctrl+Shift+W
    if (e.ctrlKey && e.shiftKey && key === "w") {
      this.layout.closeFocused();
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
        this.layout.focusDir(dir);
        return true;
      }
    }
    return false;
  }
}

function main() {
  const tabbar = document.getElementById("tabbar");
  const content = document.getElementById("content");
  const workspace = document.getElementById("workspace");
  if (!tabbar || !content || !workspace) return;
  new Shell(tabbar, content, workspace);

  // Spike 1 (GO/NO-GO): prove the WebView2 DevTools Protocol bridge returns
  // real data. Result is printed to the `tauri dev` terminal by the Rust side.
  invoke<string>("cdp_selftest")
    .then((r) => console.log("CDP selftest:\n" + r))
    .catch((e) => console.error("CDP selftest failed:", e));
}

window.addEventListener("DOMContentLoaded", main);
