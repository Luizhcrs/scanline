# Scanline

The Windows-native terminal where your AI agent can both run commands and drive a real browser.

Scanline is a single-window terminal multiplexer and scriptable browser, purpose-built for AI coding agents. It tiles terminal panes and native WebView2 browser panes in one grid, lets agents control the layout over a named pipe, and exposes a CDP-scriptable browser so an agent can snapshot, click, fill, and eval against a live web app sitting next to its terminal. Native Windows: WebView2 + ConPTY. No WSL, no tmux.

## What it is

Scanline owns one window. Inside it you get:

- A tiling grid of panes — every pane is a terminal (any CLI) or an embedded browser.
- Vertical-tabs workspaces in a sidebar, each showing cwd, git branch/dirty, listening ports, and PR status.
- Per-pane surface tabs (multiple terminals stacked in one grid leaf).
- A scriptable browser: native WebView2 panes driven over the Chrome DevTools Protocol (snapshot / click / fill / eval / screenshot).
- Agent hooks (Claude Code) that light up panes with running/waiting/idle/error status and post notifications.
- Blocking Feed approval cards for human-in-the-loop gating.
- A Go CLI plus a tmux-compatibility shim, so agents that expect `tmux split-window` get real panes.
- Session restore, JSONC config, theming, custom keybindings, and a minimal mode.

The agent loop Scanline is built for: the agent edits code in one pane, runs the dev server in another, then snapshots and clicks its own web app in an adjacent WebView2 pane over CDP, with risky steps gated by Feed approval cards — all on the local machine.

## Why Scanline (vs the alternatives)

- cmux (manaflow-ai) defines this category but is macOS-only and GPL-3.0. Scanline is a clean-room MIT reimplementation of its agent-native UX for Windows.
- wmux is the other Windows-native cmux-style tool, but it is terminal + RPC only — no scriptable browser, so it cannot close the agent's see-and-act loop on a live web app.
- Warp shipped on Windows but its AI is shell/code-centric with metered, cloud-tied credits and no agent-driven browser pane.
- Wave Terminal has a browser widget, but it is a viewer for the AI to read — not a CDP-scriptable target the agent drives by element ref.
- Windows Terminal, WezTerm, Tabby, and Hyper have no agent hooks, no scriptable browser, and no PR-status workspace sidebar.

Scanline's wedge is the intersection no single rival hits on Windows: cmux's agent-native UX, a CDP-scriptable WebView2 browser, local-first and free, MIT-licensed, and lightweight because it reuses the OS WebView2 runtime instead of bundling Chromium.

## Features

- Tiling grid: split right/down, resize, zoom, equalize, focus navigation by arrow keys.
- Workspaces: vertical-tabs sidebar; per-workspace metadata (cwd, git branch + dirty marker, listening ports, linked PR via `gh`).
- Surface tabs: multiple terminals per grid leaf, with drag-reorder and jump-to-tab.
- Browser panes: real WebView2 child webviews (ignore X-Frame-Options, so any site loads), with back/forward/reload, page zoom, and devtools.
- Scriptable browser API over CDP: `snapshot` (tags interactive elements as `e1`, `e2`, …), `click`, `fill`, `type`, `eval`, `text`, `exists`, `wait`, `press` (trusted input), `cookies`, `storage`, `viewport`, `screenshot`, and more — targetable by ref or raw CSS selector.
- Control protocol: external processes drive the live grid by writing JSON lines to a named pipe; a V2 request/response model lets callers read results back.
- Agent integration: Claude Code lifecycle hooks set pane status and post notifications; `scanline <agent>` launches any agent inside a fake-tmux environment so its `tmux split-window` calls become real panes.
- Feed approval cards: blocking human-in-the-loop prompts (`scanline ask`) that an agent hook can gate on; the app holds the reply open for a human decision.
- Notifications: per-pane bells and OSC-style notifications, an unread badge per workspace, and a panel.
- Session restore: workspaces, layout tree, cwd, browser URLs — persisted to `%APPDATA%\scanline\session.json` and restored on launch.
- Config and theming: JSONC `scanline.json` for terminal font/size/scrollback/theme, UI font, minimal mode, and keybindings; live reload on window focus.
- Native Windows touches: dark title bar matched to the chrome, crash log to `%APPDATA%\scanline\crash.log`.

## Architecture

```
+---------------------------------------------------------------+
|  Scanline window (WebView2)                                    |
|                                                                |
|  Sidebar (workspaces)  |  Grid: terminal + browser panes       |
|                        |    xterm.js (DOM renderer)            |
|                        |    native WebView2 child webviews     |
+------------------------+--------------------------------------+
        |  Tauri IPC (commands + events)        ^  CDP via with_webview
        v                                       |  (CallDevToolsProtocolMethod)
+---------------------------------------------------------------+
|  Rust core (Tauri 2)                                           |
|   - ConPTY bridge (portable-pty): spawn / read / write / size |
|   - Browser manager: child webviews + CDP bridge              |
|   - Named-pipe control server  \\.\pipe\scanline (V2 JSON)    |
|   - Session + config persistence (%APPDATA%\scanline)         |
+---------------------------------------------------------------+
        ^  JSON lines over named pipe
        |
+---------------------------------------------------------------+
|  Go CLI  (scanline.exe)                                        |
|   - direct commands: split / run / web / browser / send / ... |
|   - tmux-compat shim (tmux split-window -> real panes)        |
|   - agent launcher + Claude Code hooks                        |
+---------------------------------------------------------------+
```

- Frontend: TypeScript + Vite + xterm.js. The terminal uses the DOM renderer on purpose; the WebGL addon wedges the WebView2 renderer on this stack.
- PTY: each terminal pane is a ConPTY via `portable-pty`. Output is coalesced and base64-encoded before crossing the IPC bridge to keep firehose output cheap.
- Browser panes: native WebView2 child webviews positioned over the DOM grid. The scriptable API reaches the raw `ICoreWebView2` through Tauri's `with_webview` escape hatch and calls `CallDevToolsProtocolMethodAsync` for real CDP.
- Control: a single-instance named-pipe server forwards requests to the frontend and routes replies back, so CLI/agents can both command and query the running grid.

## Install and build

Prerequisites:

- Windows 10/11 with the WebView2 Evergreen runtime (ships with Windows 11).
- Rust (stable) and the MSVC build tools.
- Node 18+ and npm.
- Go 1.25+ (for the CLI).

### Run the app (dev)

```powershell
cd app
npm install
npm run tauri dev
```

### Build an installer

```powershell
cd app
npm run tauri build
```

This produces the Windows bundle (NSIS + MSI) under `app/src-tauri/target/release/bundle/`.

### Build the CLI

```powershell
cd cli
go build
```

This emits `scanline.exe` (the Go module is named `scanline`). Put it on your PATH so agents and scripts can reach the running window.

## Usage

Scanline must be running; the CLI talks to it over `\\.\pipe\scanline`.

### CLI (control the running window)

```powershell
scanline split [--dir row|col] [-- <command...>]   # split the focused pane
scanline run -- <command...>                       # split and run a command
scanline web <url>                                 # open a browser pane
scanline focus <left|right|up|down>                # move focus
scanline list                                      # list panes (id, kind, focused, rect)
scanline read [--surface N]                        # read a pane's scrollback
scanline send [--surface N] <text...>              # send literal text to a pane
scanline key  [--surface N] <key>                  # send a key/chord (enter, c-c, up, ...)
scanline notify [--title T] <body...>              # post a notification
scanline close                                     # close the focused pane
scanline surface [new|next|prev|close|select <n>|rename <name>]   # per-pane tabs
scanline ws [list|new|select <id>|close <id>|rename <id> <name>|current]
scanline equalize | zoom | resize [delta]          # layout
scanline status [--surface N] <running|waiting|idle|error>        # set pane status dot
scanline config [edit|reload]                      # open scanline.json / reload live
scanline fullscreen                                # toggle fullscreen
scanline ask [--title T] [--options a,b,c] <q...>  # blocking approval card; prints choice
scanline ping                                      # health check
```

### Scriptable browser

```powershell
scanline browser open <url>
scanline browser snapshot                 # interactive elements tagged e1, e2, ...
scanline browser click <ref|css>
scanline browser fill  <ref|css> <text...>
scanline browser type  <ref|css> <text...>
scanline browser eval  <js>
scanline browser text [css] | html [css] | exists <css> | wait <css> | count <css>
scanline browser press <key> | scroll [ref] | zoom <f> | viewport <w> <h>
scanline browser cookies [clear] | storage [get [k] | set <k> <v> | clear]
scanline browser navigate <url> | back | forward | reload | devtools
scanline browser screenshot [--out file.png]
# all verbs accept --surface N to pick a specific browser pane
```

Example agent loop:

```powershell
scanline run -- npm run dev
scanline web http://localhost:5173
scanline browser snapshot
scanline browser click e7
scanline browser fill e3 "hello@example.com"
scanline browser screenshot --out after.png
```

### Agent integration

Launch an agent inside a fake-tmux environment so its `tmux split-window` calls become real Scanline panes:

```powershell
scanline claude          # launches Claude Code; tmux calls land as panes
scanline claude-teams    # Claude in teammate mode
scanline <agent> [args]  # any agent on PATH
```

Wire Claude Code lifecycle hooks so panes light up with agent status and post notifications:

```powershell
scanline hooks setup            # writes ~/.claude/settings.json
scanline hooks setup --project  # writes ./.claude/settings.json
```

Hooks map agent events to pane status: `PreToolUse`/`PostToolUse`/`UserPromptSubmit` -> running, `Notification` -> waiting (plus a notification), `Stop` -> idle.

### Scriptable from inside a pane

A process running in a pane inherits `SCANLINE_SURFACE_ID`, so `scanline send`, `scanline status`, `scanline browser`, and hooks target the caller's own pane by default — no `--surface` needed.

## Configuration

Config lives in `%APPDATA%\scanline\scanline.json` (JSONC — `//` and `/* */` comments allowed). It is loaded on boot and reloaded live on window focus or `scanline config reload`. Open it with `scanline config edit` or Ctrl+, in the Settings panel.

```jsonc
{
  "terminal": {
    "fontFamily": "Consolas, 'Cascadia Mono', monospace",
    "fontSize": 14,
    "scrollback": 10000,
    "theme": { "background": "#0d1017", "foreground": "#c5c8c6", "cursor": "#5aa0ff" }
  },
  "ui": {
    "fontFamily": "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
    "minimal": false
  },
  // Rebind actions, e.g. "palette": "ctrl+k". Format: ctrl+alt+shift+key.
  // Actions: palette, switcher, find, findInDir, newWorkspace, newTab,
  //          settings, minimal, fullscreen, help.
  "keybindings": {}
}
```

Other state: session layout is persisted to `%APPDATA%\scanline\session.json`; crashes are logged to `%APPDATA%\scanline\crash.log`.

## Keyboard shortcuts

General

- Ctrl+Shift+P — Command palette
- Ctrl+P — Switch workspace / pane
- Ctrl+/ — Keyboard shortcuts help
- Ctrl+, — Settings
- Ctrl+Shift+M — Minimal mode
- F11 — Fullscreen
- Ctrl+B — Toggle sidebar
- Ctrl+F — Find
- Ctrl+Shift+F — Find in directory

Workspaces

- Ctrl+N — New workspace
- Alt+1..8 — Jump to workspace (Alt+9 = last)
- Alt+Shift+, / . — Previous / next workspace

Panes and splits

- Alt+Shift+Right — Split right
- Alt+Shift+Down — Split down
- Alt+Shift+B — Open browser pane
- Alt+Arrows — Move focus between panes
- Alt+Shift+Z — Zoom pane
- Alt+Shift+E — Equalize splits
- Ctrl+Shift+H — Flash focused pane
- Ctrl+Shift+W — Close pane

Tabs

- Ctrl+T — New terminal tab
- Ctrl+W — Close tab
- Ctrl+Tab / Ctrl+Shift+Tab — Next / previous tab
- Ctrl+1..9 — Jump to tab

Terminal

- Ctrl+Shift+K — Clear scrollback
- Ctrl+= / Ctrl+- / Ctrl+0 — Font size (browser pane: page zoom)
- Ctrl+Shift+C / V — Copy / paste
- Ctrl+Shift+A — Select all

Notifications

- Alt+Shift+N — Notifications panel
- Alt+Shift+U — Jump to latest unread

All rebindable actions can be overridden in `scanline.json` under `keybindings`.

## Project layout

```
scanline/
  app/                  Tauri app
    index.html          shell + dark splash
    src/                frontend (TypeScript, xterm.js)
      main.ts           app shell: workspaces, shortcuts, control dispatch
      layout.ts         tiling grid (splits, focus, zoom, serialize)
      pane.ts           terminal pane (xterm + ConPTY bridge)
      browser.ts        browser pane (WebView2 child webview)
      browserApi.ts     scriptable browser API over CDP
      paneContainer.ts  surface tabs within a grid leaf
      palette.ts        command palette + find bar
      feed.ts           blocking approval cards
      notifications.ts  notification store + panel
      settings.ts       settings panel
      config.ts         scanline.json load/merge/apply
    src-tauri/          Rust core
      src/lib.rs        PTY bridge, browser/CDP bridge, control server, config
      tauri.conf.json   window + bundle config
      Cargo.toml        Rust dependencies
  cli/                  Go CLI + tmux-compat shim
    main.go             command dispatch + pipe RPC
    tmux.go             tmux-compat translation + agent launcher
    browser.go          scriptable-browser CLI
    hooks.go            Claude Code hook dispatch + setup
    feed.go             blocking approval (scanline ask)
  docs/design/          UI normalization plan
```

## License

MIT. Scanline is a clean-room reimplementation of the agent-native terminal UX pioneered by cmux (manaflow-ai/cmux, GPL-3.0). No code is copied from cmux; the behavior of the tmux-compat shim and agent integration is modeled, not derived. See LICENSE.