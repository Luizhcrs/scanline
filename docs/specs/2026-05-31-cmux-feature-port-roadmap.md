# cmux → Scanline — Feature Port Roadmap

**Date:** 2026-05-31
**Status:** Active
**Source:** 14-agent feature-cataloging workflow over the cmux source + README. Full per-feature detail in [cmux-feature-catalog.md](./cmux-feature-catalog.md) (291 features, 12 areas). Architecture/strategy in [2026-05-31-cmux-windows-port-plan.md](./2026-05-31-cmux-windows-port-plan.md).

## State

~291 features cataloged: **9 done, 29 partial, 253 todo**. The hardest, riskiest foundations are done — what remains is mostly breadth (TS/Go/Rust plumbing), not depth.

**Done (load-bearing core):** tiling split tree (split/focus/resize/close/rebalance), ConPTY terminals with byte-accurate IO, native WebView2 browser leaf that ignores X-Frame-Options, proven CDP bridge (Runtime.evaluate returns values, getFullAXTree, captureScreenshot), tokio named-pipe control server, Go CLI + tmux shim, run-command-in-pane, exit cleanup, MSI/NSIS targets.

**Shape:** control plane first → notification store (rings before toasts) → scriptable browser API (highest agent value, low risk since CDP is proven) → per-pane surface tabs → workspace/sidebar layer → agent hooks/resume → session/settings/theming → packaging/updater/CI.

## Milestones

| # | Name | ~wk | Goal |
|---|------|-----|------|
| **M1** | Control-plane foundation | 3 | V2 JSON-RPC on the pipe (id/method/params → ok/result/error), stable surface-id registry, `pane.list`/`surface.list`, caller-pane env (`SCANLINE_SURFACE_ID`), `system.ping/capabilities/identify`, `scanline rpc` |
| **M2** | Terminal scripting + UX | 4 | `surface.send_text`/`send_key`/`read_text` (addon-serialize), tmux-compat expansion (send-keys/capture-pane/list-panes), copy/paste (bracketed), clear scrollback, font size, resize/equalize, flash ring, split zoom |
| **M3** | Notification subsystem | 5 | TS notification store, pane ring + flash, `notify` → real UI, OSC 9/777/99 parsing, bell→flash, OSC 0/2 title + OSC 7 cwd, panel (Ctrl+I), jump-unread, OS toast (tauri-plugin-notification + foreground suppression) |
| **M4** | Scriptable browser API | 6 | `browser.*` per-pane via CDP: eval + a11y snapshot w/ refs (keystone), click/fill/type/press, getters, state checks, wait, scroll, screenshot, locators, cookies/storage, **zoom**, devtools, plus the under-specced verbs (viewport/geo/offline/network-route/screencast/input) as real impls |
| **M5** | Per-pane surface tabs | 5 | per-pane `surfaces[]` + activeIndex (hide, never destroy), new/next/prev/jump/close, tab strip with live title, reorder, **duplicate/pin/close-left/right/others** |
| **M6** | Workspaces + sidebar | 8 | workspace data model, vertical-tabs sidebar (toggle Ctrl+B), new/close/jump/next/prev, row metadata (cwd via OSC 7, git branch+dirty, ports via GetExtendedTcpTable, PR via gh, latest notif+unread), **pin/color/close-others**, **CMUX_PORT range** |
| **M7** | Command palette + find | 5 | palette (Ctrl+Shift+P) + fuzzy (nucleo), switcher (Ctrl+P), find (Ctrl+F, addon-search / CDP window.find), find-in-dir (Ctrl+Shift+F, bundled rg.exe), routing arbitration |
| **M8** | Agent hooks + lifecycle + resume | 7 | lifecycle/status→UI, per-agent hook dispatch (`scanline hooks AGENT EVENT`), generic installer (12 agents + Claude wrapper), claude-teams, launch-command sanitizer, session resume, **Feed panel** (approval cards), fork w/ destinations |
| **M9** | Session restore + settings + theming | 6 | `scanline.json` (JSONC), auto session restore (tree+cwd+url to APPDATA, 8s autosave), settings window (Ctrl+,) + watcher, terminal theming (ITheme/font), shortcut customization, **fullscreen**, app modes (minimal/menu-bar-only) |
| **M10** | Packaging + signing + updater + CI | 6 | real icon, updater keypair, tauri-plugin-updater + appcast, Authenticode signing + timestamp, release CI (NSIS+MSI, latest.json), winget, tray + ITaskbarList3 badge, telemetry opt-out |

## Next batch (implement now — M1 + M2 send-keys)

High value, low risk, builds on the working control server + CLI + CDP bridge:

1. **V2 request/response on the pipe** — parse `{id, method, params}`, per-request oneshot, reply `{id, ok, result/error}` keyed by id. Unblocks every data-returning command. (lib.rs + main.ts + cli)
2. **Stable surface-id registry + `pane.list`** — stable id/ref per leaf; serialize the tree (id, ref, type, focused, geometry). First V2 query proving round-trip.
3. **Caller-pane env** — inject `SCANLINE_SURFACE_ID` at pty_spawn keyed to the leaf; CLI reads it as default `--surface`.
4. **`surface.send_text` + `surface.send_key`** — write literal text / named key chords to a target pty (key-name→byte table: c-c 0x03, enter 0x0d, tab 0x09, esc 0x1b). The send-keys primitive that drives any agent/REPL.
5. **`surface.read_text`** — serialize a target xterm buffer (addon-serialize) → V2 result. Lets agents read output.
6. **Expand tmux-compat** — send-keys→send_text, capture-pane→read_text, list-panes, has-session.

## Non-goals (drop on Windows)

- Ghostty config/Metal GPU/WebGL renderer — no Ghostty on Windows; WebGL hangs WebView2 (reverted). Native scanline config + DOM renderer. (See [[webgl-terminal-hangs-webview2]].)
- Ligatures, Kitty graphics / Sixel — need the reverted WebGL renderer; low value.
- Sparkle, macOS notarization/Gatekeeper, DMG — replaced by tauri-plugin-updater + Authenticode + NSIS/MSI.
- AppleScript, NSAlert, SF Symbols, menu-bar popover, Dock badge — macOS UI; use WebView2 dialogs, Windows tray, ITaskbarList3.
- Cloud VM / sandbox CLI, auth/login, feedback — tied to cmux's hosted backend Scanline lacks.
- SSH remote workspaces + cmuxd-remote daemon/relay/proxy — XL subsystem, deferred (basic `scanline ssh` = ssh.exe in a ConPTY pane is a cheap future win).
- Move-workspace-to-new-window + full multi-window — per-window resource namespacing, high plumbing cost; single implicit window for v1.
- Agent hibernation, signed-resume auto-run trust, per-pane notification policy hooks — depend on config + trust model that don't exist yet; defer.
- i18n/localization — noted P3 (affects every UI string); defer.

## Critic-flagged additions (fold in before the relevant milestone)

- **Right-sidebar panel ecosystem** (before M6/M8): Feed (approval cards + decision semantics), Vault/Sessions (+ custom agent registration in config), Dock (config-driven pinned controls), Files explorer + file/markdown/image previews, React Grab.
- **Context-menu action sets** (M5/M6): workspace pin/color/close-others/above/below/mark-read; tab duplicate/pin/close-left/right/others/new-terminal-right.
- **App modes** (M9): minimal mode, menu-bar-only, focusPaneOnFirstClick, reorderOnNotification.
- **Corrections:** terminal font-size vs browser-zoom share Ctrl+=/-/0 → arbitrate by focused-leaf kind. Terminal bell double-counted (dedupe). Supported agents = 12 + Claude wrapper (Antigravity/Hermes were not real cmux agents). `CMUX_TAB_ID` is a third caller-context env var.
