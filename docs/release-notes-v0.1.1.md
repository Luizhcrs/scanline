Scanline 0.1.1 — bugfix release.

## Fixes

- **Changing the UI language no longer hangs the app.** Switching language in
  Settings used a webview reload to repaint, which left the backend terminal
  processes alive and streaming over dead IPC channels while a second set was
  spawned — the resulting churn stalled the main thread and closed the app
  (Windows "Application Hang"). The language change now does a clean process
  relaunch instead, which shuts the terminals down and restores the session
  normally.

Upgrading from 0.1.0 is recommended for anyone who switches language.

## Downloads

Pick one:

- **Scanline_0.1.1_x64-setup.exe** — installer (recommended). Sets up Start Menu
  shortcuts and fetches the WebView2 runtime automatically if it is missing.
- **Scanline_0.1.1_x64_en-US.msi** — MSI installer, for managed / enterprise
  deployment (Group Policy, Intune).
- **Scanline_0.1.1_portable_x64.zip** — portable. Unzip and run `app.exe`, no
  installation. Keep `scanline.exe` next to it. Requires the WebView2 runtime
  (preinstalled on Windows 11).

## Requirements

- Windows 10 / 11, 64-bit.
- Microsoft Edge WebView2 runtime (preinstalled on Windows 11; the installers
  fetch it automatically, the portable build does not).

## Notes

- In-app auto-update is still not enabled (the updater signing key is not
  configured yet). Download from this releases page.
