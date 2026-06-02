# Design — i18n PT-BR / English with native auto-detect

Date: 2026-06-01
Status: Approved (design phase)

## Goal

Scanline ships in Portuguese (pt-BR) and English. On first run it detects the
machine's OS locale natively and picks the matching language. The user can
override the choice in Settings; the override persists. Everything else stays as
it is today (vanilla TS + Vite + Tauri, no UI framework).

## Decisions (locked)

- Behaviour: **auto-detect + manual override** in Settings.
- Detection source: **native OS locale** via the Tauri `plugin-os` `locale()` API.
- Engine: **hand-rolled** `t()` + two typed TS dictionaries. No i18n library.
- Apply on manual change: **`location.reload()`** — the session re-hydrates from
  the existing `save_session`/restore path, so panes survive the reload.

## Architecture

### 1. Detection (native)

- Add dependency `@tauri-apps/plugin-os` and register the plugin on the Rust side
  (`app/src-tauri`): add the crate to `Cargo.toml` and `.plugin(tauri_plugin_os::init())`
  to the builder, plus the capability/permission entry the plugin requires.
- `locale()` returns the OS locale string (e.g. `"pt-BR"`, `"en-US"`, or `null`).
- Map to language: take the primary subtag, lowercase it. If it starts with `pt`
  → `"pt"`, otherwise → `"en"`. `null`/unknown → `"en"` (fallback).

### 2. Engine — `app/src/i18n.ts` (zero dependency)

- Two dictionaries: `en` and `pt`, both plain TS objects keyed by string keys.
- `en` is the source of truth for the key set. Type:
  `type Messages = typeof en;` and `const pt: Messages = { ... }`. A missing or
  extra key in `pt` is a **compile-time** error (key parity enforced by tsc).
- Keys grouped by area with dotted names: `settings.*`, `palette.*`, `menu.*`,
  `notif.*`, `updater.*`, `feed.*`, `browser.*`, etc.
- API:
  - `t(key: keyof Messages): string` — synchronous lookup in the active dict.
  - `detectOsLocale(): Promise<Lang>` — calls `plugin-os` `locale()`, maps subtag.
  - `resolveLocale(cfg): Promise<Lang>` — if `cfg.ui.language !== "auto"` return
    that language; else `await detectOsLocale()`.
  - `setLocale(lang: Lang): void` — sets the module-level active dict. Must be
    called before any UI string is rendered.
  - `Lang = "pt" | "en"`.
- Interpolation: keep it minimal. Where a string needs a value (counts, names),
  use a function-valued entry, e.g. `paneCount: (n: number) => \`${n} panes\``,
  rather than a runtime template parser. YAGNI — no pluralization engine.

### 3. Config

- Extend `ScanlineConfig.ui` with `language: "auto" | "pt" | "en"`.
- `DEFAULTS.ui.language = "auto"`.
- The existing deep `merge()` already absorbs the new key from older config files
  (missing → default). No migration code needed.

### 4. Settings UI (`app/src/settings.ts`)

- Add a `selectField` builder (mirrors the existing `textField`/`numberField`
  pattern) and a "Language / Idioma" row with options Auto / Português / English.
- On Save: include `language` in the next config. If the saved language differs
  from the currently active one, call `location.reload()` after `onSave`
  resolves so the UI repaints in the new language.
- All Settings panel labels themselves go through `t()`.

### 5. Boot order (`app/src/main.ts`)

Current boot loads config then renders. New order:

1. `await loadConfig()`
2. `setLocale(await resolveLocale(cfg))`
3. render UI / session restore (unchanged)

This guarantees the first paint uses the correct language. Detection is async
(IPC to Rust), so step 2 is awaited before any `t()`-backed render runs.

### 6. String migration

- ~100 user-facing string sites across ~13 files (`main.ts`, `palette.ts`,
  `settings.ts`, `contextmenu.ts`, `notifications.ts`, `updater.ts`, `feed.ts`,
  `browser.ts`, `paneContainer.ts`, `pane.ts`) replaced with `t("area.key")`.
- Non-user-facing strings (CSS class names, IPC command names, log lines,
  internal identifiers) are **not** translated.

## Out of scope

- README localization — `README.en.md` already exists; docs are separate.
- Languages beyond pt/en. The engine supports adding more later (new dict +
  union member) but only two ship now.
- Full `Intl` date/number formatting pass. Apply `Intl` pointwise only where a
  date or number is actually shown to the user (updater, notifications), no lib.

## Testing — `app/src/i18n.test.ts` (vitest)

- Key parity: every key in `en` exists in `pt` and vice versa (runtime assertion
  backing the compile-time guarantee).
- `resolveLocale`: returns the override when `language` is `pt`/`en`; falls
  through to OS detect when `auto`.
- Subtag mapping: `"pt-BR"` → `pt`, `"pt"` → `pt`, `"en-US"` → `en`,
  `null`/`"de-DE"` → `en`.
- Mock the `plugin-os` `locale()` call in the test (it already mocks Tauri IPC in
  `__mocks__`).

## Risk / notes

- Reload-on-change depends on session restore working; it already runs on every
  boot, so this is the same path users hit on app restart today.
- `plugin-os` adds a capability permission — must be declared or `locale()`
  throws at runtime. Covered in step 1.
