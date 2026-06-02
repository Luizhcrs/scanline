<p align="center"><img src="assets/logo.png" width="120" alt="Scanline"></p>
<h1 align="center">Scanline</h1>
<p align="center">Windows-native terminal multiplexer + scriptable browser for AI coding agents.</p>

---

Scanline owns one window. Inside it you tile terminal panes and native WebView2 browser panes side by side, switch contexts with vertical-tab workspaces, and give agents a CDP-scriptable browser so they can snapshot, click, fill, and screenshot a live web app sitting next to the shell that built it.

Native Windows: WebView2 + ConPTY. No WSL, no tmux, no bundled Chromium.

## What it is and why

**The agent loop Scanline is built for:** the agent edits code in one pane, runs the dev server in another, then snapshots and drives its own web app in an adjacent WebView2 pane via CDP — with risky steps gated by blocking Feed approval cards for human-in-the-loop review.

Key capabilities:

- **Tiling grid** — split right or down, resize, zoom, equalize, and navigate panes with the keyboard.
- **Vertical-tab workspaces** — each workspace shows cwd, git branch + dirty marker, listening ports, and PR status via `gh`.
- **Surface tabs** — multiple terminals stacked in one grid leaf, with drag-reorder.
- **Browser panes** — real WebView2 child webviews. They ignore X-Frame-Options, so any site loads. Back/forward/reload, page zoom, and DevTools included.
- **Scriptable browser API** — CDP over `scanline browser`: snapshot interactive elements as `e1`, `e2`, …; click, fill, eval, screenshot, and more. Agents reference elements by tag, not by fragile XPath.
- **Named-pipe control server** — external processes drive the live grid by writing V2 JSON-line requests to `\\.\pipe\scanline` and reading replies back. The Go CLI wraps this for shell use.
- **Agent integration** — `scanline <agent>` launches any agent with a fake-tmux environment so its `tmux split-window` calls become real Scanline panes. Claude Code lifecycle hooks light up pane status dots and post notifications.
- **Feed approval cards** — `scanline ask` blocks until a human clicks a choice; the agent's hook can gate on the reply before proceeding.
- **Session restore** — workspaces, layout tree, cwd, and browser URLs are persisted and restored on launch.

**Why not the alternatives:**

| Tool | Gap |
|---|---|
| cmux (manaflow-ai) | macOS-only, GPL-3.0 |
| wmux | No scriptable browser — cannot close the agent's see-and-act loop |
| Warp | AI is cloud-tied and shell-centric; no agent-driven browser pane |
| Wave Terminal | Browser widget is read-only for the AI, not a CDP-scriptable target |
| Windows Terminal / WezTerm / Tabby | No agent hooks, no scriptable browser, no PR-status sidebar |

Scanline's position: cmux's agent-native UX + CDP-scriptable WebView2 browser, local-first, MIT, lightweight (reuses the OS WebView2 runtime).

## Install

### Download the installer

Download `Scanline_0.1.0_x64-setup.exe` (the NSIS installer) from the GitHub Releases page:

**https://github.com/Luizhcrs/scanline/releases/latest**

Because Scanline is not code-signed yet, Windows SmartScreen will show a "Windows protected your PC" dialog when you run the installer. This is expected for unsigned open-source applications. Click "More info" and then "Run anyway" to proceed — the installer is safe and the source is fully available in this repository.

Once installed, Scanline checks for updates on every launch and offers a one-click download-and-relaunch when a new release is available. No manual reinstall needed.

### Build from source

Prerequisites: Node 20+, Rust stable + MSVC build tools, Go 1.25+.

```powershell
cd app
npm install
npm run tauri build
```

Output: `app\src-tauri\target\release\bundle\` (NSIS + MSI installers, and the bare `.exe`).

Build the CLI separately:

```powershell
cd cli
go build
```

This emits `scanline.exe` (the Go module is also named `scanline`). Put it on your PATH so agents and scripts can reach the running window.

<details>
<summary><b>Features</b></summary>

- Tiling grid: split right/down, resize, zoom, equalize, focus navigation by arrow key.
- Workspaces: vertical-tab sidebar with cwd, git branch + dirty marker, listening ports, linked PR via `gh`.
- Surface tabs: multiple terminals per grid leaf, drag-reorder, jump-to-tab.
- Browser panes: native WebView2 child webviews (ignore X-Frame-Options), back/forward/reload, page zoom, DevTools.
- Scriptable browser over CDP: `snapshot`, `click`, `fill`, `type`, `eval`, `text`, `html`, `exists`, `wait`, `count`, `find`, `attr`, `value`, `visible`, `checked`, `check`, `uncheck`, `select`, `press`, `scroll`, `zoom`, `viewport`, `cookies`, `storage`, `screenshot`, `navigate`, `back`, `forward`, `reload`, `devtools`.
- Named-pipe control server: V2 JSON-line request/response, so CLI and agents can both command and query the live grid.
- Agent integration: fake-tmux launcher, Claude Code lifecycle hooks, Feed approval cards.
- Notifications: per-pane bells, unread badge per workspace, notification panel.
- Session restore: layout, cwd, browser URLs — persisted to `%APPDATA%\scanline\session.json`.
- Config: JSONC `scanline.json`, live reload on window focus or `scanline config reload`.
- Native touches: dark title bar matched to the app chrome, crash log at `%APPDATA%\scanline\crash.log`.

</details>

<details>
<summary><b>Keyboard shortcuts</b></summary>

### General

| Shortcut | Action |
|---|---|
| Ctrl+Shift+P | Command palette |
| Ctrl+P | Switch workspace / pane |
| Ctrl+/ | Keyboard shortcuts help |
| Ctrl+, | Settings |
| Ctrl+Shift+M | Minimal mode |
| F11 | Fullscreen |
| Ctrl+B | Toggle sidebar |
| Ctrl+F | Find |
| Ctrl+Shift+F | Find in directory |

### Workspaces

| Shortcut | Action |
|---|---|
| Ctrl+N | New workspace |
| Alt+1..8 | Jump to workspace (Alt+9 = last) |
| Alt+Shift+, / . | Previous / next workspace |

### Panes and splits

| Shortcut | Action |
|---|---|
| Alt+Shift+Right | Split right |
| Alt+Shift+Down | Split down |
| Alt+Shift+B | Open browser pane |
| Alt+Arrows | Move focus between panes |
| Alt+Shift+Z | Zoom pane |
| Alt+Shift+E | Equalize splits |
| Ctrl+Shift+H | Flash focused pane |
| Ctrl+Shift+W | Close pane |

### Tabs (surfaces)

| Shortcut | Action |
|---|---|
| Ctrl+T | New terminal tab |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1..9 | Jump to tab |

### Terminal

| Shortcut | Action |
|---|---|
| Ctrl+Shift+K | Clear scrollback |
| Ctrl+= / Ctrl+- / Ctrl+0 | Font size (browser pane: page zoom) |
| Ctrl+Shift+C / V | Copy / paste |
| Ctrl+Shift+A | Select all |

### Notifications

| Shortcut | Action |
|---|---|
| Alt+Shift+N | Notifications panel |
| Alt+Shift+U | Jump to latest unread |

All rebindable actions can be overridden in `scanline.json` under `keybindings`.

</details>

<details>
<summary><b>CLI reference</b></summary>

Scanline must be running. The CLI talks to it over `\\.\pipe\scanline`.

A process running inside a pane inherits `SCANLINE_SURFACE_ID`, so commands like `send`, `status`, and `browser` target the caller's own pane by default — no `--surface` flag needed.

### Layout and panes

```powershell
scanline split [--dir row|col] [-- <command...>]   # split the focused pane
scanline run -- <command...>                       # split and run a command
scanline web <url>                                 # open a browser pane
scanline focus <left|right|up|down>                # move focus
scanline list                                      # list panes (id, kind, focused, rect)
scanline close                                     # close the focused pane
scanline equalize                                  # equalize split sizes
scanline zoom                                      # toggle zoom on focused pane
scanline resize [delta]                            # resize focused pane (default delta: 0.05)
scanline fullscreen                                # toggle fullscreen
```

### Pane I/O

```powershell
scanline read   [--surface N]                      # read scrollback text from a pane
scanline send   [--surface N] <text...>            # send literal text to a pane
scanline key    [--surface N] <key>                # send a key/chord (enter, c-c, up, ...)
scanline status [--surface N] <running|waiting|idle|error>  # set pane status dot
```

### Surface tabs

```powershell
scanline surface new
scanline surface next | prev
scanline surface close
scanline surface select <n>          # 1-based index
scanline surface rename <name>
```

### Workspaces

```powershell
scanline ws list
scanline ws new
scanline ws select <id>
scanline ws close <id>
scanline ws rename <id> <name>
scanline ws current
```

### Notifications

```powershell
scanline notify [--title T] <body...>   # post a notification to a pane
scanline notif                          # list notifications
scanline notif clear                    # clear all notifications
```

### Agent and hooks

```powershell
scanline <agent> [args...]              # launch an agent with fake-tmux environment
scanline claude-teams [args...]         # launch Claude in teammate mode
scanline hooks setup                    # install Claude Code hooks globally (~/.claude/settings.json)
scanline hooks setup --project          # install into ./.claude/settings.json
```

### Misc

```powershell
scanline ask [--title T] [--options a,b,c] <question...>   # blocking approval card; prints choice
scanline config edit                    # open scanline.json in the default editor
scanline config reload                  # reload config live
scanline ping                           # health check
```

</details>

<details>
<summary><b>Scriptable browser API</b></summary>


```powershell
# Navigation
scanline browser open <url>
scanline browser navigate <url> | back | forward | reload
scanline browser devtools

# Inspection
scanline browser snapshot               # tag interactive elements as e1, e2, ...
scanline browser url
scanline browser text [css]
scanline browser html [css]
scanline browser exists <css>
scanline browser wait <css>
scanline browser count <css>
scanline browser find <text...>
scanline browser attr <ref> <name>
scanline browser value <ref>
scanline browser visible <ref>
scanline browser checked <ref>

# Interaction
scanline browser click <ref|css>
scanline browser fill <ref|css> <text...>
scanline browser type <ref|css> <text...>
scanline browser check <ref> | uncheck <ref>
scanline browser select <ref> <value>
scanline browser press <key>
scanline browser scroll [ref]

# Page state
scanline browser eval <js>
scanline browser zoom <factor>
scanline browser viewport <width> <height>
scanline browser cookies [clear]
scanline browser storage [get [key] | set <key> <value> | clear]

# Output
scanline browser screenshot [--out file.png]

# All browser verbs accept --surface N to target a specific browser pane.
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

</details>

<details>
<summary><b>Agent integration</b></summary>

### Fake-tmux launcher

`scanline <agent>` launches any agent binary with a fake-tmux environment: a `tmux.cmd` shim is written to `%USERPROFILE%\.scanline\shim\` and prepended to PATH, and `TMUX` / `TMUX_PANE` are set so the agent believes it is inside a tmux session. When the agent runs `tmux split-window`, the shim forwards it to `scanline __tmux-compat`, which translates it into a real pane split.

Translated tmux verbs: `split-window`, `select-pane`, `kill-pane`, `resize-pane`, `send-keys`, `list-panes`, `capture-pane`, `has-session`.

```powershell
scanline claude             # Claude Code with tmux-compat
scanline claude-teams       # Claude in teammate mode (SCANLINE_CLAUDE_TEAMS=1)
scanline codex              # or any other agent on PATH
```

### Claude Code hooks

Scanline installs these hooks automatically on launch (idempotent — it only
adds its own entries and never clobbers an unparseable config), so pane status
dots and notifications work out of the box. To (re)install manually, e.g. into
a project-local config:

```powershell
scanline hooks setup            # writes to %USERPROFILE%\.claude\settings.json
scanline hooks setup --project  # writes to .\.claude\settings.json
```

The hook is a no-op outside a Scanline pane, so it never disturbs Claude
sessions you run in a normal terminal.

Event mapping:

| Claude Code event | Pane status |
|---|---|
| UserPromptSubmit | running |
| PreToolUse / PostToolUse | running |
| Notification | waiting + notification posted |
| Stop / SubagentStop | idle |

</details>

<details>
<summary><b>Configuration</b></summary>


Config lives at `%APPDATA%\scanline\scanline.json`. The format is JSONC (`//` and `/* */` comments are allowed). The file is loaded on boot and reloaded live on window focus or `scanline config reload`. Open it with `scanline config edit` or Ctrl+, in the Settings panel.

```jsonc
{
  "terminal": {
    "fontFamily": "Consolas, 'Cascadia Mono', monospace",
    "fontSize": 14,
    "scrollback": 10000,
    "theme": {
      "background": "#0d1017",
      "foreground": "#c5c8c6",
      "cursor": "#5aa0ff"
    }
  },
  "ui": {
    "fontFamily": "\"Segoe UI Variable Text\", \"Segoe UI\", system-ui, sans-serif",
    "minimal": false
  },
  // Rebind actions. Format: "ctrl+alt+shift+key".
  // Actions: palette, switcher, find, findInDir, newWorkspace, newTab,
  //          settings, minimal, fullscreen, help.
  "keybindings": {}
}
```

Other state files (not user-edited):

| File | Contents |
|---|---|
| `%APPDATA%\scanline\session.json` | Workspace layout, cwd, browser URLs |
| `%APPDATA%\scanline\crash.log` | Crash reports |

## Architecture

```
+---------------------------------------------------------------+
|  Scanline window (WebView2)                                   |
|                                                               |
|  Sidebar (workspaces)  |  Grid: terminal + browser panes      |
|                        |    xterm.js (DOM renderer)           |
|                        |    native WebView2 child webviews    |
+------------------------+--------------------------------------+
        |  Tauri IPC (commands + events)       ^  CDP via with_webview
        v                                      |  (CallDevToolsProtocolMethod)
+---------------------------------------------------------------+
|  Rust core (Tauri 2)                                          |
|   - ConPTY bridge (portable-pty): spawn / read / write / size |
|   - Browser manager: child webviews + CDP bridge             |
|   - Named-pipe control server  \\.\pipe\scanline (V2 JSON)   |
|   - Session + config persistence (%APPDATA%\scanline)        |
+---------------------------------------------------------------+
        ^  JSON lines over named pipe
        |
+---------------------------------------------------------------+
|  Go CLI  (scanline.exe)                                       |
|   - Direct commands: split / run / web / browser / send / …  |
|   - tmux-compat shim (tmux split-window -> real panes)       |
|   - Agent launcher + Claude Code hooks                       |
+---------------------------------------------------------------+
```

- **Frontend:** TypeScript + Vite + xterm.js. The terminal uses the DOM renderer deliberately — the WebGL addon wedges the WebView2 renderer on this stack.
- **PTY:** each terminal pane is a ConPTY via `portable-pty`. Output is coalesced and base64-encoded before crossing the Tauri IPC bridge.
- **Browser panes:** native WebView2 child webviews positioned over the DOM grid. The scriptable API reaches `ICoreWebView2` through Tauri's `with_webview` escape hatch and calls `CallDevToolsProtocolMethodAsync` for real CDP.
- **Control:** a single-instance named-pipe server (`\\.\pipe\scanline`) forwards requests to the frontend and routes replies back, enabling both fire-and-forget commands and request/response queries.

## Project layout

```
scanline/
  app/                   Tauri application
    index.html           shell + dark splash
    src/                 Frontend (TypeScript, xterm.js)
      main.ts            App shell: workspaces, shortcuts, control dispatch
      layout.ts          Tiling grid (splits, focus, zoom, serialize)
      pane.ts            Terminal pane (xterm + ConPTY bridge)
      browser.ts         Browser pane (WebView2 child webview)
      browserApi.ts      Scriptable browser API over CDP
      paneContainer.ts   Surface tabs within a grid leaf
      palette.ts         Command palette + find bar
      feed.ts            Blocking approval cards
      notifications.ts   Notification store + panel
      settings.ts        Settings panel
      config.ts          scanline.json load / merge / apply
    src-tauri/           Rust core
      src/lib.rs         PTY bridge, browser/CDP bridge, control server, config
      tauri.conf.json    Window + bundle config (version 0.1.0)
      Cargo.toml         Rust dependencies
  cli/                   Go CLI + tmux-compat shim
    main.go              Command dispatch + pipe RPC
    tmux.go              tmux-compat translation + agent launcher
    browser.go           Scriptable-browser CLI verbs
    hooks.go             Claude Code hook dispatch + setup
    feed.go              Blocking approval (scanline ask)
  docs/design/           UI normalization plan
```

## License

MIT. Scanline is a clean-room reimplementation of the agent-native terminal UX pioneered by cmux (manaflow-ai/cmux, GPL-3.0). No code is copied from cmux; the behavior of the tmux-compat shim and agent integration is modeled, not derived. See [LICENSE](LICENSE).
