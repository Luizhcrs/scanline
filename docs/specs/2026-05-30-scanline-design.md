# Scanline — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design)

## What

Scanline is a single-window terminal workspace for AI coding agents on Windows.
One window holds a grid of panes; each pane is either a **terminal** (any CLI:
PowerShell, Claude Code, Codex, etc.) or an embedded **browser** (real web via
WebView2). The user never leaves the window — agents, shells, and web side by
side.

Native Windows (no WSL, no tmux). Built as a desktop app (Tauri + WebView2) so
it controls its own layout, embeds web, and looks like a product — not a
borrowed terminal.

## Why (vs alternatives)

- **Claude Squad / agent teams**: tmux-based → require WSL2 on Windows.
- **wmux / psmux**: native Windows muxes, but terminal-text only — no embedded web.
- **Windows Terminal as host** (our earlier attempt): text-only, can't embed web,
  doesn't rebalance panes.

Scanline's edge: **own window with both real terminals and real web**, native
Windows, agent-aware (intercepts agents' tmux calls to spawn panes).

## Non-Goals (v1)

- macOS/Linux (Tauri makes this portable later, but v1 targets Windows).
- Cloud sync / accounts.
- Reimplementing a full browser UI (web panes are minimal: URL bar + WebView2).

## Architecture

```
┌─ Scanline (Tauri desktop app, single window) ───────────────┐
│  Frontend  (TypeScript + Vite)                              │
│    • Grid/layout manager: split, resize, close, focus        │
│    • Terminal pane  = xterm.js (canvas) <-> ConPTY bytes     │
│    • Browser  pane  = WebView2 child (real web page)         │
│    • Keybindings, tab bar                                    │
│                                                              │
│  Backend  (Rust, Tauri core)                                 │
│    • PTY manager: spawn ConPTY per terminal pane             │
│      (crate: portable-pty), stream bytes <-> frontend        │
│    • Control server: named pipe \\.\pipe\scanline            │
│      receives split/focus/new-pane from the agent shim       │
│    • Pane registry: ids, layout state                        │
└──────────────────────────────────────────────────────────────┘
        ▲ named pipe (JSON line protocol)
        │
   scanline-cli  (Go, reused from cmux-cross)
     • busybox shim: invoked as tmux.exe by agents
     • agent launch: fake-tmux env, NODE_OPTIONS patch
     • `scanline claude` etc.
     claude → tmux split-window → shim → pipe → app spawns pane
```

### Components

| Component | Lang | Responsibility |
|-----------|------|----------------|
| `app/` (Tauri) | Rust + TS | Window, grid, panes, PTY, web, pipe server |
| `cli/` | Go | Agent shim (tmux.exe), agent launch, env/NODE_OPTIONS |
| pipe protocol | JSON | `pane.split`, `pane.focus`, `pane.close`, `notify` |

### Data flow — agent spawns a pane

1. User runs `scanline claude` in a terminal pane.
2. CLI sets fake-tmux env (TMUX, TMUX_PANE, PATH with shim dir) and execs claude.
3. Claude runs `tmux split-window -- <cmd>`.
4. Shim (`tmux.exe`, a copy of scanline-cli) → `scanline __tmux-compat split-window …`.
5. CLI connects to `\\.\pipe\scanline`, sends `pane.split {command}`.
6. Rust backend spawns a new ConPTY pane running `<cmd>`; frontend renders it
   in the grid.

### Terminal pane (PTY bridge)

- Rust spawns ConPTY via `portable-pty`, gets a reader/writer.
- Reader bytes → Tauri event → xterm.js `term.write()`.
- xterm.js `onData` → Tauri command → ConPTY writer.
- Resize: xterm.js fit addon → cols/rows → `pty.resize()`.

### Browser pane

- A pane can be a WebView2 child (Tauri webview) instead of xterm.js.
- Minimal chrome: URL input + back/forward/reload.
- Opened via `scanline web <url>`, a keybinding, or a "+" menu.

### Grid / layout

- Frontend owns layout: binary split tree (panes split H/V, resizable dividers).
- Operations: split (H/V), close, focus (arrows), resize (drag or keys).
- Rebalance on close. This fixes the cramped-grid problem of the WT approach.

## Reuse from cmux-cross

Carried over (Go `cli/`):
- busybox tmux.exe shim
- agent launch + fake-tmux env
- NODE_OPTIONS restore module
- JSON-RPC line protocol (ported to Rust on the server side)

Dropped:
- Windows Terminal / Zellij / WezTerm backends (replaced by the Tauri window)
- `cmuxd` daemon (absorbed into the Rust control server)

## Stack

- **Tauri 2** (Rust core + WebView2)
- **Frontend**: TypeScript, Vite, **xterm.js** (+ fit, web-links addons)
- **Rust crates**: `portable-pty` (ConPTY), `serde_json`, `tokio` (pipe server)
- **CLI**: Go 1.22+ (reused)

## Phases

1. **Skeleton + one terminal** — Tauri app opens; one pane runs PowerShell via
   ConPTY, fully interactive (type, output, resize).
2. **Grid** — split H/V, focus, close, resize; multiple terminals in one window.
3. **Control server** — named pipe; `scanline-cli` shim spawns panes; agents'
   tmux calls create panes.
4. **Browser pane** — WebView2 pane + `scanline web <url>`.
5. **Agent integration + polish** — `scanline claude`, theming, installer.

Each phase produces a runnable app.

## Risks

- **ConPTY ↔ xterm.js correctness** (resize, ANSI, mouse). Mitigate: use
  `portable-pty` (battle-tested) and xterm.js (VS Code's terminal engine).
- **WebView2 pane embedding** within a Tauri window layout (child webviews).
  Tauri 2 supports multiple webviews; validate early in Phase 4.
- **Perf** with many panes (each ConPTY + xterm canvas). Acceptable for typical
  agent counts (2–8).

## License

MIT (own product, no GPL deps).
