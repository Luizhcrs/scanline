import { invoke } from "./api";

// scanline.json — user config in %APPDATA%\scanline\scanline.json (JSONC:
// // and block comments allowed). Loaded on boot, reloadable live. Unknown/missing
// keys fall back to DEFAULTS.
export interface ScanlineConfig {
  terminal: {
    fontFamily: string;
    fontSize: number;
    scrollback: number;
    theme: { background: string; foreground: string; cursor: string };
  };
  ui: { fontFamily: string; minimal: boolean; language: "auto" | "pt" | "en"; tooltipShortcuts: boolean; theme: "auto" | "light" | "dark" };
  /** Action -> chord overrides (e.g. {"palette":"ctrl+k"}). Empty = defaults. */
  keybindings: Record<string, string>;
}

export const DEFAULTS: ScanlineConfig = {
  terminal: {
    fontFamily: "Consolas, 'Cascadia Mono', monospace",
    fontSize: 14,
    scrollback: 10000,
    theme: { background: "#000000", foreground: "#ffffff", cursor: "#5aa0ff" },
  },
  ui: {
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
    minimal: false,
    language: "auto",
    tooltipShortcuts: true,
    theme: "auto",
  },
  keybindings: {},
};

let current: ScanlineConfig = DEFAULTS;

/** The active config (synchronous; reflects the last load). */
export function config(): ScanlineConfig {
  return current;
}

/** Strip // line and block comments so JSONC parses as JSON. String-aware: a
 *  `//` or `/*` inside a JSON string value is left intact (a regex strip would
 *  corrupt e.g. "//cdn/x" or "a//b", breaking the whole parse). */
export function stripJsonc(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i++; // skip the closing '/'
    } else {
      out += c;
    }
  }
  return out;
}

/** Deep-merge a partial config over the defaults (objects merged, scalars set). */
export function merge(base: any, over: any): any {
  if (over == null || typeof over !== "object") return base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    // Never let user JSON walk the prototype chain.
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const b = base?.[k];
    const o = over[k];
    const baseIsObj = b != null && typeof b === "object";
    const overIsObj = o != null && typeof o === "object";
    // Type-mismatch guard: if the default key is a structured object but the
    // override is a scalar (or vice versa), the user config is malformed for
    // that key. Keep the default to avoid crashing the settings panel on
    // something like `"terminal": "bad"` replacing the entire terminal object.
    if (baseIsObj !== overIsObj) {
      console.warn(`config merge: type mismatch for key "${k}", keeping default`);
      out[k] = b;
      continue;
    }
    out[k] = baseIsObj && overIsObj ? merge(b, o) : o;
  }
  return out;
}

/** Apply document-level config (UI font, minimal mode, theme). */
function apply(): void {
  document.documentElement.style.setProperty("--ui-font", current.ui.fontFamily);
  document.body.classList.toggle("minimal", !!current.ui.minimal);
  const theme = current.ui.theme ?? "auto";
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/** (Re)load scanline.json from disk and apply the UI font. Returns the config.
 *  When no config file exists (fresh install), resets the onboarding flag so the
 *  welcome tutorial shows even if a prior WebView2 profile has the key cached. */
export async function loadConfig(): Promise<ScanlineConfig> {
  try {
    const raw = await invoke<string | null>("load_config");
    if (!raw) localStorage.removeItem("scanline.onboardingSeen");
    current = raw ? (merge(DEFAULTS, JSON.parse(stripJsonc(raw))) as ScanlineConfig) : DEFAULTS;
  } catch (e) {
    console.error("config load failed, using defaults:", e);
    current = DEFAULTS;
  }
  apply();
  return current;
}

/** Persist a new config to disk (pretty JSON) and apply it in memory. */
export async function saveConfig(next: ScanlineConfig): Promise<void> {
  current = merge(DEFAULTS, next) as ScanlineConfig;
  await invoke("save_config", { json: JSON.stringify(current, null, 2) });
  apply();
}
