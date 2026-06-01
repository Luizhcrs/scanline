import { invoke } from "@tauri-apps/api/core";

/**
 * scanline.json — user config in %APPDATA%\scanline\scanline.json (JSONC: //
 * and /* *​/ comments allowed). Loaded on boot, reloadable live. Unknown/missing
 * keys fall back to DEFAULTS.
 */
export interface ScanlineConfig {
  terminal: {
    fontFamily: string;
    fontSize: number;
    scrollback: number;
    theme: { background: string; foreground: string; cursor: string };
  };
  ui: { fontFamily: string };
}

export const DEFAULTS: ScanlineConfig = {
  terminal: {
    fontFamily: "Consolas, 'Cascadia Mono', monospace",
    fontSize: 14,
    scrollback: 100000,
    theme: { background: "#0d1017", foreground: "#c5c8c6", cursor: "#5ff967" },
  },
  ui: {
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
  },
};

let current: ScanlineConfig = DEFAULTS;

/** The active config (synchronous; reflects the last load). */
export function config(): ScanlineConfig {
  return current;
}

/** Strip // line and /* *​/ block comments so JSONC parses as JSON. */
function stripJsonc(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Deep-merge a partial config over the defaults (objects merged, scalars set). */
function merge(base: any, over: any): any {
  if (over == null || typeof over !== "object") return base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const b = base?.[k];
    const o = over[k];
    out[k] = b && typeof b === "object" && o && typeof o === "object" ? merge(b, o) : o;
  }
  return out;
}

/** (Re)load scanline.json from disk and apply the UI font. Returns the config. */
export async function loadConfig(): Promise<ScanlineConfig> {
  try {
    const raw = await invoke<string | null>("load_config");
    current = raw ? (merge(DEFAULTS, JSON.parse(stripJsonc(raw))) as ScanlineConfig) : DEFAULTS;
  } catch (e) {
    console.error("config load failed, using defaults:", e);
    current = DEFAULTS;
  }
  document.documentElement.style.setProperty("--ui-font", current.ui.fontFamily);
  return current;
}
