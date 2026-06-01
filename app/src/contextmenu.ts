/**
 * A custom right-click menu. Replaces WebView2's native context menu (Back /
 * Refresh / Inspect) in the app chrome with Scanline's own actions.
 */
import { pushOverlay, popOverlay } from "./overlay";

export interface MenuItem {
  label?: string;
  hint?: string;
  action?: () => void;
  danger?: boolean;
  separator?: boolean;
}

export class ContextMenu {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "context-menu";
    this.el.style.display = "none";
    document.body.appendChild(this.el);
    // Dismiss on any outside interaction.
    window.addEventListener("blur", () => this.hide());
    document.addEventListener("mousedown", (e) => {
      if (!this.el.contains(e.target as Node)) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
    window.addEventListener("resize", () => this.hide());
  }

  show(x: number, y: number, items: MenuItem[]): void {
    this.el.replaceChildren();
    for (const it of items) {
      if (it.separator) {
        const sep = document.createElement("div");
        sep.className = "context-sep";
        this.el.appendChild(sep);
        continue;
      }
      const row = document.createElement("div");
      row.className = "context-item" + (it.danger ? " danger" : "");
      const label = document.createElement("span");
      label.textContent = it.label ?? "";
      row.appendChild(label);
      if (it.hint) {
        const hint = document.createElement("span");
        hint.className = "context-hint";
        hint.textContent = it.hint;
        row.appendChild(hint);
      }
      row.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        it.action?.();
      };
      this.el.appendChild(row);
    }
    // Show off-screen first to measure, then clamp into the viewport.
    if (this.el.style.display === "none") pushOverlay("menu");
    this.el.style.display = "block";
    this.el.style.left = "0px";
    this.el.style.top = "0px";
    const r = this.el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 4);
    const top = Math.min(y, window.innerHeight - r.height - 4);
    this.el.style.left = `${Math.max(0, left)}px`;
    this.el.style.top = `${Math.max(0, top)}px`;
  }

  hide(): void {
    if (this.el.style.display !== "none") popOverlay("menu");
    this.el.style.display = "none";
  }
}
