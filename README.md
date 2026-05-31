# Scanline

Single-window terminal workspace for AI coding agents on Windows. One window, a
grid of panes — each pane a **terminal** (any CLI) or an embedded **browser**.
Run Claude Code, Codex, shells, and web side by side without leaving the window.

Native Windows: WebView2 + ConPTY. No WSL, no tmux.

> Status: early. Phase 1 (interactive terminal in a Tauri window) working.

## Why

- Agent teams / Claude Squad use tmux → need WSL2 on Windows.
- wmux / psmux are native but terminal-text only (no embedded web).
- Scanline owns its window: real terminals **and** real web, native Windows.

## Stack

- **Tauri 2** (Rust core + WebView2)
- **Frontend:** TypeScript + Vite + [xterm.js](https://xtermjs.org)
- **PTY:** Rust [`portable-pty`](https://crates.io/crates/portable-pty) (ConPTY)
- **CLI/shim:** Go (reused from cmux-cross) — added in phase 3

## Develop

Prereqs: Rust, Node 18+, WebView2 (ships with Win11).

```powershell
cd app
npm install
npm run tauri dev      # run the app
npm run tauri build    # produce an installer
```

## Layout

```
scanline/
  app/            Tauri app
    src/          frontend (TypeScript, xterm.js)
    src-tauri/    Rust core (PTY bridge, control server)
  cli/            Go agent shim + launcher (phase 3)
  docs/specs/     design spec
```

## Roadmap

1. ✅ Skeleton + one interactive terminal (xterm.js + ConPTY)
2. Grid — split / resize / close / focus panes
3. Control server — agent tmux calls spawn panes (named pipe + Go shim)
4. Browser pane — embedded WebView2 + `scanline web <url>`
5. Agent integration + theming + installer

## License

MIT
