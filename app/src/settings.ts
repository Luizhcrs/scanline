import { config, type ScanlineConfig } from "./config";
import { pushOverlay, popOverlay } from "./overlay";

/**
 * Settings window: a modal form over scanline.json. Edits fonts, theme, and
 * minimal mode with a live form; Save persists + applies. Advanced keys (e.g.
 * keybindings) stay file-editable via "Open config file".
 */
export class SettingsPanel {
  private overlay: HTMLElement;
  private card: HTMLElement;

  constructor(
    private onSave: (cfg: ScanlineConfig) => void | Promise<void>,
    private onOpenFile: () => void,
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "settings-overlay";
    this.overlay.style.display = "none";
    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.card = document.createElement("div");
    this.card.className = "settings-card";
    this.overlay.appendChild(this.card);
    document.body.appendChild(this.overlay);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen()) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  open(): void {
    const c = config();
    this.card.replaceChildren();
    const h = document.createElement("div");
    h.className = "settings-title";
    h.textContent = "Settings";
    this.card.appendChild(h);

    const uiFont = this.textField("Interface font", c.ui.fontFamily);
    const minimal = this.checkField("Minimal mode (hide sidebar + tab bars)", c.ui.minimal);
    const termFont = this.textField("Terminal font", c.terminal.fontFamily);
    const termSize = this.numberField("Terminal font size", c.terminal.fontSize, 6, 40);
    const scrollback = this.numberField("Scrollback lines", c.terminal.scrollback, 1000, 1000000);
    const bg = this.colorField("Background", c.terminal.theme.background);
    const fg = this.colorField("Foreground", c.terminal.theme.foreground);
    const cur = this.colorField("Cursor", c.terminal.theme.cursor);

    const btns = document.createElement("div");
    btns.className = "settings-btns";
    const save = document.createElement("button");
    save.className = "settings-btn primary";
    save.textContent = "Save";
    save.onclick = () => {
      const next: ScanlineConfig = {
        terminal: {
          fontFamily: termFont.value.trim() || c.terminal.fontFamily,
          fontSize: clampInt(termSize.value, 6, 40, c.terminal.fontSize),
          scrollback: clampInt(scrollback.value, 1000, 1000000, c.terminal.scrollback),
          theme: { background: bg.value, foreground: fg.value, cursor: cur.value },
        },
        ui: { fontFamily: uiFont.value.trim() || c.ui.fontFamily, minimal: minimal.checked },
        keybindings: c.keybindings,
      };
      void this.onSave(next);
      this.close();
    };
    const cancel = document.createElement("button");
    cancel.className = "settings-btn";
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.close();
    const file = document.createElement("button");
    file.className = "settings-btn";
    file.textContent = "Open config file";
    file.onclick = () => {
      this.close();
      this.onOpenFile();
    };
    btns.append(file, cancel, save);
    this.card.appendChild(btns);

    if (!this.isOpen()) pushOverlay();
    this.overlay.style.display = "flex";
    uiFont.focus();
  }

  close(): void {
    if (this.isOpen()) popOverlay();
    this.overlay.style.display = "none";
  }

  // ---- field builders ----
  private row(labelText: string, control: HTMLElement): void {
    const row = document.createElement("label");
    row.className = "settings-row";
    const label = document.createElement("span");
    label.className = "settings-label";
    label.textContent = labelText;
    row.append(label, control);
    this.card.appendChild(row);
  }
  private textField(label: string, value: string): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "settings-input";
    i.value = value;
    this.row(label, i);
    return i;
  }
  private numberField(label: string, value: number, min: number, max: number): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "number";
    i.className = "settings-input";
    i.min = String(min);
    i.max = String(max);
    i.value = String(value);
    this.row(label, i);
    return i;
  }
  private colorField(label: string, value: string): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "color";
    i.className = "settings-color";
    i.value = value;
    this.row(label, i);
    return i;
  }
  private checkField(label: string, value: boolean): HTMLInputElement {
    const i = document.createElement("input");
    i.type = "checkbox";
    i.className = "settings-check";
    i.checked = value;
    this.row(label, i);
    return i;
  }
}

function clampInt(s: string, min: number, max: number, fallback: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
