import { config, type ScanlineConfig } from "./config";
import { pushOverlay, popOverlay } from "./overlay";
import { t, resolveLocale } from "./i18n";

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
    h.textContent = t("settings.title");
    this.card.appendChild(h);

    const language = this.selectField(t("settings.language"), c.ui.language, [
      { value: "auto", label: t("settings.langAuto") },
      { value: "pt", label: t("settings.langPt") },
      { value: "en", label: t("settings.langEn") },
    ]);
    const uiFont = this.textField(t("settings.uiFont"), c.ui.fontFamily);
    const minimal = this.checkField(t("settings.minimal"), c.ui.minimal);
    const termFont = this.textField(t("settings.termFont"), c.terminal.fontFamily);
    const termSize = this.numberField(t("settings.termSize"), c.terminal.fontSize, 6, 40);
    const scrollback = this.numberField(t("settings.scrollback"), c.terminal.scrollback, 1000, 1000000);
    const bg = this.colorField(t("settings.bg"), c.terminal.theme.background);
    const fg = this.colorField(t("settings.fg"), c.terminal.theme.foreground);
    const cur = this.colorField(t("settings.cursor"), c.terminal.theme.cursor);

    const btns = document.createElement("div");
    btns.className = "settings-btns";
    const save = document.createElement("button");
    save.className = "settings-btn primary";
    save.textContent = t("settings.save");
    save.onclick = () => {
      const lang = language.value as "auto" | "pt" | "en";
      const next: ScanlineConfig = {
        terminal: {
          fontFamily: termFont.value.trim() || c.terminal.fontFamily,
          fontSize: clampInt(termSize.value, 6, 40, c.terminal.fontSize),
          scrollback: clampInt(scrollback.value, 1000, 1000000, c.terminal.scrollback),
          theme: { background: bg.value, foreground: fg.value, cursor: cur.value },
        },
        ui: {
          fontFamily: uiFont.value.trim() || c.ui.fontFamily,
          minimal: minimal.checked,
          language: lang,
        },
        keybindings: c.keybindings,
      };
      const langChanged = lang !== c.ui.language;
      void Promise.resolve(this.onSave(next)).then(async () => {
        if (langChanged) {
          // The whole UI is built at boot in the active language; the cleanest,
          // fully-correct way to repaint is a reload. The session restores.
          const target = await resolveLocale(lang);
          const current = await resolveLocale(c.ui.language);
          if (target !== current) location.reload();
        }
      });
      this.close();
    };
    const cancel = document.createElement("button");
    cancel.className = "settings-btn";
    cancel.textContent = t("settings.cancel");
    cancel.onclick = () => this.close();
    const file = document.createElement("button");
    file.className = "settings-btn";
    file.textContent = t("settings.openFile");
    file.onclick = () => {
      this.close();
      this.onOpenFile();
    };
    btns.append(file, cancel, save);
    this.card.appendChild(btns);

    if (!this.isOpen()) pushOverlay("settings");
    this.overlay.style.display = "flex";
    uiFont.focus();
  }

  close(): void {
    if (this.isOpen()) popOverlay("settings");
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
  private selectField(
    label: string,
    value: string,
    opts: { value: string; label: string }[],
  ): HTMLSelectElement {
    const s = document.createElement("select");
    s.className = "settings-input";
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    }
    this.row(label, s);
    return s;
  }
}

function clampInt(s: string, min: number, max: number, fallback: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
