import { config, type ScanlineConfig } from "./config";
import { pushOverlay, popOverlay } from "./overlay";
import { t, resolveLocale } from "./i18n";
import { relaunch } from "@tauri-apps/plugin-process";
import { createIcons, Palette, Terminal, Settings2, Keyboard } from "lucide";
import { closeOverlay } from "./animate";

type Category = "appearance" | "terminal" | "interface" | "shortcuts";

export class SettingsPanel {
  private overlay: HTMLElement;
  private card: HTMLElement;
  private activeCategory: Category = "appearance";

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
    this.render();
    if (!this.isOpen()) pushOverlay("settings");
    this.overlay.style.display = "flex";
  }

  close(): void {
    if (!this.isOpen()) return;
    popOverlay("settings");
    closeOverlay(this.overlay, () => { this.overlay.style.display = "none"; });
  }

  private render(): void {
    const c = config();
    this.card.replaceChildren();

    // ── Header ──────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "settings-header";
    const title = document.createElement("span");
    title.className = "settings-header-title";
    title.textContent = t("settings.title");
    const closeBtn = document.createElement("button");
    closeBtn.className = "settings-close-btn";
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => this.close();
    header.append(title, closeBtn);

    // ── Body (sidebar + content) ─────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "settings-body";

    // Sidebar
    const sidebar = document.createElement("nav");
    sidebar.className = "settings-sidebar";

    const categories: { id: Category; label: string; icon: string }[] = [
      { id: "appearance", label: "Appearance", icon: "palette" },
      { id: "terminal",   label: "Terminal",   icon: "terminal" },
      { id: "interface",  label: "Interface",  icon: "settings-2" },
      { id: "shortcuts",  label: "Shortcuts",  icon: "keyboard" },
    ];

    const contentArea = document.createElement("div");
    contentArea.className = "settings-content";

    const navItems = categories.map(({ id, label, icon }) => {
      const btn = document.createElement("button");
      btn.className = "settings-nav-item" + (id === this.activeCategory ? " active" : "");
      btn.innerHTML = `<i data-lucide="${icon}" class="settings-nav-icon"></i><span>${label}</span>`;
      btn.onclick = () => {
        this.activeCategory = id;
        navItems.forEach((b, i) => b.classList.toggle("active", categories[i].id === id));
        this.renderContent(contentArea, c, fields);
      };
      return btn;
    });

    navItems.forEach(b => sidebar.appendChild(b));

    // ── Fields (shared state across re-renders) ──────────────────────────
    const fields = this.buildFields(c);
    this.renderContent(contentArea, c, fields);

    body.append(sidebar, contentArea);

    // ── Footer ──────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "settings-footer";

    const file = document.createElement("button");
    file.className = "settings-btn ghost";
    file.textContent = t("settings.openFile");
    file.onclick = () => { this.close(); this.onOpenFile(); };

    const cancel = document.createElement("button");
    cancel.className = "settings-btn";
    cancel.textContent = t("settings.cancel");
    cancel.onclick = () => this.close();

    const save = document.createElement("button");
    save.className = "settings-btn primary";
    save.textContent = t("settings.save");
    save.onclick = () => this.saveFields(c, fields);

    footer.append(file, cancel, save);
    this.card.append(header, body, footer);
    // createIcons after full DOM is mounted so it finds all data-lucide elements
    createIcons({ icons: { Palette, Terminal, Settings2, Keyboard }, attrs: { width: "14", height: "14" } });
  }

  private buildFields(c: ScanlineConfig) {
    const mk = (type: string, value: string | number, min?: number, max?: number) => {
      const i = document.createElement("input");
      i.type = type;
      i.className = type === "color" ? "settings-color" : type === "checkbox" ? "settings-check" : "settings-input";
      if (type === "checkbox") (i as HTMLInputElement).checked = Boolean(value);
      else i.value = String(value);
      if (min !== undefined) i.min = String(min);
      if (max !== undefined) i.max = String(max);
      return i as HTMLInputElement;
    };
    const mkSelect = (value: string, opts: {value: string; label: string}[]) => {
      const s = document.createElement("select");
      s.className = "settings-input";
      opts.forEach(o => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === value) opt.selected = true;
        s.appendChild(opt);
      });
      return s;
    };

    return {
      language:  mkSelect(c.ui.language, [
        { value: "auto", label: t("settings.langAuto") },
        { value: "pt",   label: t("settings.langPt") },
        { value: "en",   label: t("settings.langEn") },
      ]),
      uiFont:    mk("text",     c.ui.fontFamily),
      minimal:   mk("checkbox", c.ui.minimal ? 1 : 0),
      termFont:  mk("text",     c.terminal.fontFamily),
      termSize:  mk("number",   c.terminal.fontSize, 6, 40),
      scrollback:mk("number",   c.terminal.scrollback, 1000, 1000000),
      bg:        mk("color",    c.terminal.theme.background),
      fg:        mk("color",    c.terminal.theme.foreground),
      cursor:    mk("color",    c.terminal.theme.cursor),
    };
  }

  private renderContent(
    area: HTMLElement,
    _c: ScanlineConfig,
    fields: ReturnType<typeof SettingsPanel.prototype.buildFields>,
  ): void {
    area.replaceChildren();

    const section = (title: string) => {
      const s = document.createElement("div");
      s.className = "settings-section-title";
      s.textContent = title;
      area.appendChild(s);
    };
    const row = (label: string, desc: string, control: HTMLElement) => {
      const r = document.createElement("div");
      r.className = "settings-field";
      const left = document.createElement("div");
      left.className = "settings-field-left";
      const lbl = document.createElement("span");
      lbl.className = "settings-field-label";
      lbl.textContent = label;
      left.appendChild(lbl);
      if (desc) {
        const d = document.createElement("span");
        d.className = "settings-field-desc";
        d.textContent = desc;
        left.appendChild(d);
      }
      r.append(left, control);
      area.appendChild(r);
    };

    if (this.activeCategory === "appearance") {
      section("Idioma");
      row(t("settings.language"), "Idioma da interface. Requer reinício para aplicar.", fields.language);
      section("Fonte da interface");
      row(t("settings.uiFont"), "Fonte usada em menus, abas e elementos do app.", fields.uiFont);
      section("Layout");
      row(t("settings.minimal"), "Ocultar barra lateral e abas para uma visão mais limpa.", fields.minimal);
    }

    if (this.activeCategory === "terminal") {
      section("Fonte");
      row(t("settings.termFont"), "Fonte monoespaçada usada no terminal.", fields.termFont);
      row(t("settings.termSize"), "Tamanho da fonte em pixels.", fields.termSize);
      section("Buffer");
      row(t("settings.scrollback"), "Linhas de histórico de rolagem por painel.", fields.scrollback);
      section("Cores");
      row(t("settings.bg"), "Cor de fundo do terminal.", fields.bg);
      row(t("settings.fg"), "Cor do texto do terminal.", fields.fg);
      row(t("settings.cursor"), "Cor do cursor.", fields.cursor);
    }

    if (this.activeCategory === "shortcuts") {
      const SECTIONS: Array<[string, Array<[string, string]>]> = [
        ["General", [
          ["Ctrl+Shift+P", "Command palette"],
          ["Ctrl+P", "Switch workspace / pane"],
          ["Ctrl+,", "Settings"],
          ["Ctrl+/", "This help"],
          ["Ctrl+B", "Toggle sidebar"],
          ["Ctrl+F", "Find"],
          ["F11", "Fullscreen"],
        ]],
        ["Workspaces", [
          ["Ctrl+N", "New workspace"],
          ["Alt+1..8", "Jump to workspace"],
          ["Alt+Shift+, / .", "Previous / next workspace"],
        ]],
        ["Panes & splits", [
          ["Alt+Shift+Right", "Split right"],
          ["Alt+Shift+Down", "Split down"],
          ["Alt+Shift+B", "Open browser pane"],
          ["Alt+Arrows", "Move focus"],
          ["Alt+Shift+Z", "Zoom pane"],
          ["Alt+Shift+E", "Equalize splits"],
          ["Ctrl+Shift+W", "Close pane"],
        ]],
        ["Tabs", [
          ["Ctrl+T", "New terminal tab"],
          ["Ctrl+W", "Close tab"],
          ["Ctrl+Tab", "Next tab"],
          ["Ctrl+1..9", "Jump to tab"],
        ]],
        ["Terminal", [
          ["Ctrl+Shift+K", "Clear scrollback"],
          ["Ctrl+= / Ctrl+-", "Font size"],
          ["Ctrl+Shift+C / V", "Copy / paste"],
        ]],
      ];
      for (const [heading, rows] of SECTIONS) {
        section(heading);
        for (const [keys, desc] of rows) {
          const r = document.createElement("div");
          r.className = "settings-field";
          const d = document.createElement("span");
          d.className = "settings-field-label";
          d.textContent = desc;
          const k = document.createElement("kbd");
          k.className = "settings-kbd";
          k.textContent = keys;
          r.append(d, k);
          area.appendChild(r);
        }
      }
    }

    if (this.activeCategory === "interface") {
      section("Config file");
      const note = document.createElement("p");
      note.className = "settings-field-desc";
      note.style.padding = "0 0 8px";
      note.textContent = "Advanced settings like keybindings are edited directly in scanline.json.";
      area.appendChild(note);
      const openBtn = document.createElement("button");
      openBtn.className = "settings-btn";
      openBtn.textContent = t("settings.openFile");
      openBtn.onclick = () => { this.close(); this.onOpenFile(); };
      area.appendChild(openBtn);
    }
  }

  private saveFields(
    c: ScanlineConfig,
    fields: ReturnType<typeof SettingsPanel.prototype.buildFields>,
  ): void {
    const lang = (fields.language as HTMLSelectElement).value as "auto" | "pt" | "en";
    const next: ScanlineConfig = {
      terminal: {
        fontFamily: fields.termFont.value.trim() || c.terminal.fontFamily,
        fontSize: clampInt(fields.termSize.value, 6, 40, c.terminal.fontSize),
        scrollback: clampInt(fields.scrollback.value, 1000, 1000000, c.terminal.scrollback),
        theme: {
          background: fields.bg.value,
          foreground: fields.fg.value,
          cursor: fields.cursor.value,
        },
      },
      ui: {
        fontFamily: fields.uiFont.value.trim() || c.ui.fontFamily,
        minimal: fields.minimal.checked,
        language: lang,
      },
      keybindings: c.keybindings,
    };
    const langChanged = lang !== c.ui.language;
    void Promise.resolve(this.onSave(next)).then(async () => {
      if (!langChanged) return;
      const target = await resolveLocale(lang);
      const current = await resolveLocale(c.ui.language);
      if (target === current) return;
      await relaunch();
    });
    this.close();
  }
}

function clampInt(s: string, min: number, max: number, fallback: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
