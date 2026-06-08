import { locale } from "@tauri-apps/plugin-os";

export type Lang = "pt" | "en";

/** English is the source of truth for the key set. */
export const en = {
  // Settings panel
  "settings.title": "Settings",
  "settings.uiFont": "Interface font",
  "settings.minimal": "Minimal mode (hide sidebar + tab bars)",
  "settings.termFont": "Terminal font",
  "settings.termSize": "Terminal font size",
  "settings.scrollback": "Scrollback lines",
  "settings.bg": "Background",
  "settings.fg": "Foreground",
  "settings.cursor": "Cursor",
  "settings.save": "Save",
  "settings.cancel": "Cancel",
  "settings.tooltipShortcuts": "Show shortcuts in tooltips",
  "settings.openFile": "Open config file",
  "settings.language": "Language / Idioma",
  "settings.langAuto": "Auto",
  "settings.langPt": "Português",
  "settings.langEn": "English",

  // Help overlay
  "help.title": "Keyboard shortcuts",

  // Command palette (keyed by the command id in main.ts)
  "cmd.ws.new": "New Workspace",
  "cmd.ws.next": "Next Workspace",
  "cmd.ws.prev": "Previous Workspace",
  "cmd.split.right": "Split Right",
  "cmd.split.down": "Split Down",
  "cmd.tab.new": "New Terminal Tab",
  "cmd.browser": "Open Browser",
  "cmd.pane.close": "Close Pane",
  "cmd.zoom": "Toggle Zoom",
  "cmd.equalize": "Equalize Splits",
  "cmd.clear": "Clear Scrollback",
  "cmd.notif": "Notifications",
  "cmd.sidebar": "Toggle Sidebar",
  "cmd.find": "Find…",
  "cmd.help": "Keyboard Shortcuts",
  "cmd.settings": "Settings…",
  "cmd.minimal": "Toggle Minimal Mode",
  "cmd.fullscreen": "Toggle Fullscreen",

  // Context menu
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.selectAll": "Select All",
  "menu.renameTab": "Rename Tab",
  "menu.newTab": "New Tab",
  "menu.splitRight": "Split Right",
  "menu.splitDown": "Split Down",
  "menu.openBrowser": "Open Browser",
  "menu.closeTab": "Close Tab",
  "menu.closePane": "Close Pane",
  "menu.renameWs": "Rename Workspace",
  "menu.newWs": "New Workspace",
  "menu.closeWs": "Close Workspace",

  // Sidebar / workspace strip
  "ws.add": "+ Workspace",
  "ws.defaultTitle": (n: number) => `Workspace ${n}`,
  "feed.allow": "Allow",
  "feed.deny": "Deny",
  "notif.pane": (id: number) => `Pane ${id}`,
  "browser.dlgAlert": "Alert",
  "browser.dlgConfirm": "Confirm",
  "browser.dlgPrompt": "Prompt",
  "ws.renameHint": "Double-click to rename",

  // Palette placeholders
  "palette.cmd": "Type a command…",
  "palette.command": "Command…",
  "palette.switcher": "Go to workspace / surface…",
  "palette.search": "Search…",
  "palette.find": "Find…",

  // Pane container (tab strip)
  "pane.renameHint": "Double-click to rename",
  "pane.newTabTitle": "New terminal tab (Ctrl+T)",
  "pane.dragGrip": "Drag to move this pane",
  "pane.newBrowserTabTitle": "New browser tab",
  "browser.devtools": "Open DevTools",
  "browser.openExternal": "Open in default browser",
  "browser.themeDark": "Force dark mode",
  "browser.themeLight": "Force light mode",
  "browser.themeAuto": "System theme (reset)",

  // Browser pane
  "browser.back": "Back",
  "browser.forward": "Forward",
  "browser.reload": "Reload",
  "browser.url": "Enter URL or search…",
  "browser.dlgLeaveTitle": "Leave page?",
  "browser.dlgStay": "Stay",
  "browser.dlgCancel": "Cancel",
  "browser.dlgLeave": "Leave",
  "browser.dlgOk": "OK",

  // Notifications panel
  "notif.title": "Notifications",
  "notif.clearAll": "Clear all",
  "notif.empty": "No notifications",

  // Agent feed
  "feed.header": "Agent requests",
  "feed.defaultTitle": "Agent request",

  // Updater
  "updater.available": (version: string) => `Scanline ${version} available`,
  "updater.defaultNote": "New version ready to install.",
  "updater.later": "Later",
  "updater.now": "Update",
  "updater.downloading": "Downloading...",
  "updater.progressPct": (pct: number) => `Downloading ${pct}%`,
  "updater.progressMb": (mb: string) => `Downloading ${mb} MB`,
  "updater.installing": "Installing...",
  "updater.restarting": "Restarting...",
  "updater.failed": (err: string) => `Update failed: ${err}`,
};

export type Messages = typeof en;

/** Portuguese mirror. Typed as Messages → missing/extra keys fail tsc. */
export const pt: Messages = {
  "settings.title": "Configurações",
  "settings.uiFont": "Fonte da interface",
  "settings.minimal": "Modo mínimo (ocultar barra lateral + abas)",
  "settings.termFont": "Fonte do terminal",
  "settings.termSize": "Tamanho da fonte do terminal",
  "settings.scrollback": "Linhas de histórico",
  "settings.bg": "Fundo",
  "settings.fg": "Texto",
  "settings.cursor": "Cursor",
  "settings.save": "Salvar",
  "settings.cancel": "Cancelar",
  "settings.tooltipShortcuts": "Mostrar atalhos nos tooltips",
  "settings.openFile": "Abrir arquivo de config",
  "settings.language": "Idioma / Language",
  "settings.langAuto": "Automático",
  "settings.langPt": "Português",
  "settings.langEn": "English",

  "help.title": "Atalhos de teclado",

  "cmd.ws.new": "Novo workspace",
  "cmd.ws.next": "Próximo workspace",
  "cmd.ws.prev": "Workspace anterior",
  "cmd.split.right": "Dividir à direita",
  "cmd.split.down": "Dividir abaixo",
  "cmd.tab.new": "Nova aba de terminal",
  "cmd.browser": "Abrir navegador",
  "cmd.pane.close": "Fechar painel",
  "cmd.zoom": "Alternar zoom",
  "cmd.equalize": "Igualar divisões",
  "cmd.clear": "Limpar histórico",
  "cmd.notif": "Notificações",
  "cmd.sidebar": "Alternar barra lateral",
  "cmd.find": "Buscar…",
  "cmd.help": "Atalhos de teclado",
  "cmd.settings": "Configurações…",
  "cmd.minimal": "Alternar modo mínimo",
  "cmd.fullscreen": "Alternar tela cheia",

  "menu.copy": "Copiar",
  "menu.paste": "Colar",
  "menu.selectAll": "Selecionar tudo",
  "menu.renameTab": "Renomear aba",
  "menu.newTab": "Nova aba",
  "menu.splitRight": "Dividir à direita",
  "menu.splitDown": "Dividir abaixo",
  "menu.openBrowser": "Abrir navegador",
  "menu.closeTab": "Fechar aba",
  "menu.closePane": "Fechar painel",
  "menu.renameWs": "Renomear workspace",
  "menu.newWs": "Novo workspace",
  "menu.closeWs": "Fechar workspace",

  "ws.add": "+ Área de trabalho",
  "ws.defaultTitle": (n: number) => `Área de trabalho ${n}`,
  "feed.allow": "Permitir",
  "feed.deny": "Negar",
  "notif.pane": (id: number) => `Painel ${id}`,
  "browser.dlgAlert": "Alerta",
  "browser.dlgConfirm": "Confirmação",
  "browser.dlgPrompt": "Entrada",
  "ws.renameHint": "Clique duplo para renomear",

  "palette.cmd": "Digite um comando…",
  "palette.command": "Comando…",
  "palette.switcher": "Ir para workspace / superfície…",
  "palette.search": "Buscar…",
  "palette.find": "Buscar…",

  "pane.renameHint": "Clique duplo para renomear",
  "pane.newTabTitle": "Nova aba de terminal (Ctrl+T)",
  "pane.dragGrip": "Arraste para mover este painel",
  "pane.newBrowserTabTitle": "Nova aba de navegador",
  "browser.devtools": "Abrir DevTools",
  "browser.openExternal": "Abrir no navegador padrão",
  "browser.themeDark": "Forçar modo escuro",
  "browser.themeLight": "Forçar modo claro",
  "browser.themeAuto": "Tema do sistema (resetar)",

  "browser.back": "Voltar",
  "browser.forward": "Avançar",
  "browser.reload": "Recarregar",
  "browser.url": "Digite URL ou busque…",
  "browser.dlgLeaveTitle": "Sair da página?",
  "browser.dlgStay": "Ficar",
  "browser.dlgCancel": "Cancelar",
  "browser.dlgLeave": "Sair",
  "browser.dlgOk": "OK",

  "notif.title": "Notificações",
  "notif.clearAll": "Limpar tudo",
  "notif.empty": "Sem notificações",

  "feed.header": "Solicitações do agente",
  "feed.defaultTitle": "Solicitação do agente",

  "updater.available": (version: string) => `Scanline ${version} disponível`,
  "updater.defaultNote": "Nova versão pronta para instalar.",
  "updater.later": "Depois",
  "updater.now": "Atualizar",
  "updater.downloading": "Baixando...",
  "updater.progressPct": (pct: number) => `Baixando ${pct}%`,
  "updater.progressMb": (mb: string) => `Baixando ${mb} MB`,
  "updater.installing": "Instalando...",
  "updater.restarting": "Reiniciando...",
  "updater.failed": (err: string) => `Falha no update: ${err}`,
};

const DICTS: Record<Lang, Messages> = { en, pt };
let active: Messages = en;
let activeLang: Lang = "en";
export function getLang(): Lang { return activeLang; }

/** Synchronous lookup in the active dictionary. */
export function t<K extends keyof Messages>(key: K): Messages[K] {
  return active[key];
}

/** Set the active dictionary. Call before any t()-backed render. */
export function setLocale(lang: Lang): void {
  active = DICTS[lang];
  activeLang = lang;
}

/** Map an OS locale string (e.g. "pt-BR") to a supported language. */
export function mapLocale(raw: string | null | undefined): Lang {
  if (!raw) return "en";
  return raw.toLowerCase().startsWith("pt") ? "pt" : "en";
}

/** Read the OS locale natively via plugin-os and map it. Never throws. */
export async function detectOsLocale(): Promise<Lang> {
  try {
    return mapLocale(await locale());
  } catch {
    return "en";
  }
}

/** Resolve the language: explicit override wins, else OS auto-detect. */
export async function resolveLocale(language: "auto" | Lang): Promise<Lang> {
  if (language === "pt" || language === "en") return language;
  return detectOsLocale();
}
