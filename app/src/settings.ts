import { config, type ScanlineConfig } from "./config";
import { resetOnboarding, showOnboarding } from "./onboarding";
import { pushOverlay, popOverlay } from "./overlay";
import { t, getLang, resolveLocale } from "./i18n";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { createIcons, Palette, Terminal, Settings2, Keyboard, Info } from "lucide";
import { closeOverlay } from "./animate";

type Category = "appearance" | "terminal" | "interface" | "shortcuts" | "about";

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

    const pt = getLang() === "pt";
    const categories: { id: Category; label: string; icon: string }[] = [
      { id: "appearance", label: pt ? "Aparência"  : "Appearance", icon: "palette" },
      { id: "terminal",   label: "Terminal",                        icon: "terminal" },
      { id: "interface",  label: "Interface",                       icon: "settings-2" },
      { id: "shortcuts",  label: pt ? "Atalhos"    : "Shortcuts",  icon: "keyboard" },
      { id: "about",      label: pt ? "Sobre"      : "About",      icon: "info" },
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
    createIcons({ icons: { Palette, Terminal, Settings2, Keyboard, Info }, attrs: { width: "14", height: "14" } });
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
    // Fully custom dropdown — no native <select> to avoid OS popup outside modal.
    const mkSelect = (initValue: string, opts: {value: string; label: string}[]) => {
      let current = initValue;
      const wrap = document.createElement("div");
      wrap.className = "settings-dropdown";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dropdown-btn";
      const label = document.createElement("span");
      label.className = "settings-dropdown-label";
      const cur = opts.find(o => o.value === initValue) ?? opts[0];
      label.textContent = cur?.label ?? initValue;
      const arrow = document.createElement("span");
      arrow.className = "settings-dropdown-arrow";
      arrow.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.append(label, arrow);

      const list = document.createElement("div");
      list.className = "settings-dropdown-list";
      list.style.display = "none";
      opts.forEach(o => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "settings-dropdown-item" + (o.value === initValue ? " selected" : "");
        item.textContent = o.label;
        item.onclick = (e) => {
          e.stopPropagation();
          current = o.value;
          label.textContent = o.label;
          list.querySelectorAll(".settings-dropdown-item").forEach(el => el.classList.remove("selected"));
          item.classList.add("selected");
          list.style.display = "none";
        };
        list.appendChild(item);
      });

      btn.onclick = (e) => {
        e.stopPropagation();
        const open = list.style.display !== "none";
        list.style.display = open ? "none" : "block";
      };
      // Use a stable ref so the listener can be removed. The overlay's own
      // mousedown-outside close already handles clicking outside settings, but
      // closing the dropdown when clicking elsewhere inside the card still needs this.
      const closeList = () => { list.style.display = "none"; };
      btn.addEventListener("blur", (e) => {
        // Close if focus moves outside the dropdown.
        if (!wrap.contains(e.relatedTarget as Node)) closeList();
      }, true);
      // Single document click handler registered once — close any open list.
      wrap.dataset.dropdownId = String(Math.random());

      wrap.append(btn, list);
      Object.defineProperty(wrap, "value", { get: () => current, enumerable: true });
      return wrap as unknown as HTMLInputElement;
    };

    return {
      language:  mkSelect(c.ui.language, [
        { value: "auto", label: t("settings.langAuto") },
        { value: "pt",   label: t("settings.langPt") },
        { value: "en",   label: t("settings.langEn") },
      ]),
      uiFont:    mk("text",     c.ui.fontFamily),
      minimal:          mk("checkbox", c.ui.minimal ? 1 : 0),
      tooltipShortcuts: mk("checkbox", c.ui.tooltipShortcuts ? 1 : 0),
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

    const pt = getLang() === "pt";

    if (this.activeCategory === "appearance") {
      section(pt ? "Idioma" : "Language");
      row(t("settings.language"), pt ? "Idioma da interface. Requer reinício para aplicar." : "UI language. Changing requires a restart.", fields.language);
      section(pt ? "Layout" : "Layout");
      row(t("settings.minimal"), pt ? "Ocultar barra lateral e abas para uma visão mais limpa." : "Hide sidebar and tab bars for a cleaner view.", fields.minimal);
    }

    if (this.activeCategory === "terminal") {
      section(pt ? "Fonte" : "Font");
      row(t("settings.termFont"), pt ? "Fonte monoespaçada usada no terminal." : "Monospace font for terminal output.", fields.termFont);
      row(t("settings.termSize"), pt ? "Tamanho da fonte em pixels." : "Font size in pixels.", fields.termSize);
      section("Buffer");
      row(t("settings.scrollback"), pt ? "Linhas de histórico de rolagem por painel." : "Lines of scrollback history per pane.", fields.scrollback);
      section(pt ? "Cores" : "Colors");
      row(t("settings.bg"), pt ? "Cor de fundo do terminal." : "Terminal background color.", fields.bg);
      row(t("settings.fg"), pt ? "Cor do texto do terminal." : "Terminal text color.", fields.fg);
      row(t("settings.cursor"), pt ? "Cor do cursor." : "Cursor color.", fields.cursor);
    }

    if (this.activeCategory === "shortcuts") {
      const SECTIONS: Array<[string, Array<[string, string]>]> = [
        [pt ? "Geral" : "General", [
          ["Ctrl+Shift+P", pt ? "Paleta de comandos" : "Command palette"],
          ["Ctrl+P", pt ? "Trocar workspace / painel" : "Switch workspace / pane"],
          ["Ctrl+,", pt ? "Configurações" : "Settings"],
          ["Ctrl+/", pt ? "Atalhos de teclado" : "Keyboard shortcuts"],
          ["Ctrl+B", pt ? "Alternar barra lateral" : "Toggle sidebar"],
          ["Ctrl+F", pt ? "Buscar" : "Find"],
          ["F11", pt ? "Tela cheia" : "Fullscreen"],
        ]],
        [pt ? "Áreas de trabalho" : "Workspaces", [
          ["Ctrl+N", pt ? "Nova área de trabalho" : "New workspace"],
          ["Alt+1..8", pt ? "Ir para área de trabalho" : "Go to workspace"],
          ["Alt+Shift+, / .", pt ? "Área anterior / próxima" : "Previous / next workspace"],
        ]],
        [pt ? "Painéis e divisões" : "Panes & splits", [
          ["Alt+Shift+Right", pt ? "Dividir à direita" : "Split right"],
          ["Alt+Shift+Down", pt ? "Dividir abaixo" : "Split down"],
          ["Alt+Shift+B", pt ? "Abrir painel de navegador" : "Open browser pane"],
          ["Alt+Setas", pt ? "Mover foco" : "Move focus"],
          ["Alt+Shift+Z", pt ? "Zoom no painel" : "Zoom pane"],
          ["Alt+Shift+E", pt ? "Igualar divisões" : "Equalize splits"],
          ["Ctrl+Shift+W", pt ? "Fechar painel" : "Close pane"],
        ]],
        [pt ? "Abas" : "Tabs", [
          ["Ctrl+T", pt ? "Nova aba de terminal" : "New terminal tab"],
          ["Ctrl+W", pt ? "Fechar aba" : "Close tab"],
          ["Ctrl+Tab", pt ? "Próxima aba" : "Next tab"],
          ["Ctrl+1..9", pt ? "Ir para aba" : "Go to tab"],
        ]],
        ["Terminal", [
          ["Ctrl+Shift+K", pt ? "Limpar histórico" : "Clear scrollback"],
          ["Ctrl+= / Ctrl+-", pt ? "Tamanho da fonte" : "Font size"],
          ["Ctrl+Shift+C / V", pt ? "Copiar / colar" : "Copy / paste"],
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
      section(pt ? "Tooltips" : "Tooltips");
      row(t("settings.tooltipShortcuts"),
        pt ? "Exibe o atalho de teclado junto no tooltip de cada botão." : "Show the keyboard shortcut alongside each button's tooltip.",
        fields.tooltipShortcuts);
      section(pt ? "Arquivo de configuração" : "Config file");
      const note = document.createElement("p");
      note.className = "settings-field-desc";
      note.style.padding = "0 0 8px";
      note.textContent = pt
        ? "Configurações avançadas como atalhos de teclado são editadas diretamente no scanline.json."
        : "Advanced settings like keybindings are edited directly in scanline.json.";
      area.appendChild(note);
      const openBtn = document.createElement("button");
      openBtn.className = "settings-btn";
      openBtn.textContent = t("settings.openFile");
      openBtn.onclick = () => { this.close(); this.onOpenFile(); };
      area.appendChild(openBtn);
    }

    if (this.activeCategory === "about") {
      this.renderAbout(area, pt);
    }
  }

  private renderAbout(area: HTMLElement, pt: boolean): void {
    const wrap = document.createElement("div");
    wrap.className = "settings-about";

    const logo = document.createElement("img");
    logo.className = "settings-about-logo";
    logo.src = "/logo-128.png";
    logo.alt = "Scanline";

    const name = document.createElement("div");
    name.className = "settings-about-name";
    name.textContent = "Scanline";

    const versionEl = document.createElement("div");
    versionEl.className = "settings-about-version";
    versionEl.textContent = "…";
    void getVersion().then(v => { versionEl.textContent = `v${v}`; });

    const tagline = document.createElement("div");
    tagline.className = "settings-about-tagline";
    tagline.textContent = pt
      ? "Multiplexador de terminal + navegador scriptável para agentes de IA"
      : "Terminal multiplexer + scriptable browser for AI agents";

    wrap.append(logo, name, versionEl, tagline);

    const links = document.createElement("div");
    links.className = "settings-about-links";

    const mkLink = (label: string, href: string) => {
      const a = document.createElement("a");
      a.className = "settings-about-link";
      a.textContent = label;
      a.href = "#";
      a.onclick = (e) => { e.preventDefault(); void import("@tauri-apps/plugin-opener").then(m => m.openUrl(href)); };
      return a;
    };

    links.append(
      mkLink("GitHub", "https://github.com/luizhcrs/scanline"),
      mkLink(pt ? "Licença AGPL-3.0" : "AGPL-3.0 License", "https://www.gnu.org/licenses/agpl-3.0.html"),
      mkLink(pt ? "Licença comercial" : "Commercial license", "mailto:luizhcrs@gmail.com"),
    );

    const copy = document.createElement("div");
    copy.className = "settings-about-copy";
    copy.textContent = `© 2025 Luiz Henrique`;

    const tutorialBtn = document.createElement("button");
    tutorialBtn.className = "settings-about-tutorial-btn";
    tutorialBtn.textContent = pt ? "Mostrar tutorial de boas-vindas" : "Show welcome tutorial";
    tutorialBtn.addEventListener("click", () => {
      resetOnboarding();
      showOnboarding();
    });

    area.append(wrap, links, copy, tutorialBtn);
  }

  private saveFields(
    c: ScanlineConfig,
    fields: ReturnType<typeof SettingsPanel.prototype.buildFields>,
  ): void {
    const lang = (fields.language as unknown as { value: string }).value as "auto" | "pt" | "en";
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
        tooltipShortcuts: fields.tooltipShortcuts.checked,
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
