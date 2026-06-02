Scanline 0.1.0 — first public release.

Windows-native terminal multiplexer with a scriptable browser, built for driving
AI coding agents. tmux-style panes and tabs, an embedded WebView2 browser the
agent can control over the DevTools Protocol, and a native PT-BR / English UI.

## Highlights

- tmux-style layout: split panes (right/down), tabbed workspaces, drag-to-resize,
  zoom, and session restore across restarts.
- Scriptable browser pane: an embedded WebView2 target driven over CDP
  (snapshot / click / fill / eval by element reference) for see-and-act agent loops.
- Native locale: UI auto-detects the OS language on first run (Portuguese or
  English) with a manual override in Settings.
- Single-instance: a second launch focuses the existing window instead of
  starting a parallel process.
- Local-first, no cloud accounts or metered credits. MIT licensed.

## Downloads

Pick one:

- **Scanline_0.1.0_x64-setup.exe** — installer (recommended). Sets up Start Menu
  shortcuts and fetches the WebView2 runtime automatically if it is missing.
- **Scanline_0.1.0_x64_en-US.msi** — MSI installer, for managed / enterprise
  deployment (Group Policy, Intune).
- **Scanline_0.1.0_portable_x64.zip** — portable. Unzip and run `app.exe`, no
  installation. Keep `scanline.exe` next to it. Requires the WebView2 runtime
  (preinstalled on Windows 11).

## Requirements

- Windows 10 / 11, 64-bit.
- Microsoft Edge WebView2 runtime (preinstalled on Windows 11; the installers
  fetch it automatically, the portable build does not).

## Notes

- In-app auto-update is not enabled in this release (the updater signing key is
  not configured yet). Download newer versions from this releases page until it
  is turned on.
