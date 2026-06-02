# Scanline backlog

Running list of bugs found during real-use testing + pending work, so we can
pick up across sessions. Newest bugs on top.

## Bugs found during testing

- [x] FIXED (in repo, ships next build) — Sidebar notification badge only ever
      grows, never clears (stuck showing 3+, only goes up). Cause: the `notify`
      control RPC (Claude `Notification` hook) keyed the stored notification on
      `container.paneId`, but onFocusChange clears by the active SURFACE paneId.
      The keys never matched, so hook notifications were never marked read and
      `unreadForWs` only accumulated. Fix: notify RPC now keys on the surface id
      (cmd.surface / SCANLINE_SURFACE_ID), matching the clear key (main.ts:1251).

(append new bugs here: date, what he was doing, symptom, scanline.log stall /
crash.log if any)

## Stability gate (before public launch)

- [ ] Soak: run real projects under load (2+ Claude Code panes streaming,
      browser pane, resize/maximize) for hours. Watchdog (`%APPDATA%\scanline\
      scanline.log`) must stay silent — any `stall` line = a main-thread block
      to fix.
- [ ] Proactive audit of the main-thread-block bug CLASS: every
      `run_on_main_thread`, WebView2 interaction, `emit`/Channel, and lock held
      across I/O. Find blockers before they crash, not after.
- Known hang causes already fixed: CDP url poll, browser_bounds flood (rAF),
  WebView2 script dialogs (deferral + in-pane overlay), PTY emit storm
  (migrated to IPC Channel + 16ms coalesce). Watchdog kept as permanent net.

## Release pipeline (after stability gate)

- [ ] Updater signing key fails with "Wrong password for that key" — the
      ed25519 key at `~/.scanline-updater.key` won't decrypt. Regenerate
      cleanly (or with a known password stored as a secret) so
      `createUpdaterArtifacts` signs and CI can publish `latest.json`.
- [ ] Create public GitHub repo `Luizhcrs/scanline`, push, set
      `TAURI_SIGNING_PRIVATE_KEY` (+ password) as Actions secrets.
- [ ] Tag `v0.1.0` -> release.yml builds, signs, publishes installer + updater
      feed. On-launch auto-update goes live.
- No paid code signing: installer is unsigned, SmartScreen "More info -> Run
  anyway" documented in README.

## Features (post-launch)

- [ ] Per-pane Claude session restore: capture each pane's `session_id` from
      the hook stdin (hook already runs per pane via SCANLINE_SURFACE_ID),
      persist it in session.json, and on restore relaunch
      `claude --resume <session_id>` instead of a bare shell. Solves recovering
      N agents in the SAME project (cwd) automatically — `claude -c` only gets
      the most recent one.
- [ ] Browser panes: handle basic-auth (HTTP 401) and permission prompts
      (camera/mic/notifications) non-blockingly, same deferral pattern as the
      script-dialog fix (also block the main thread otherwise).
- [ ] Wave 4 refactor (deferred): split the ~1400-line lib.rs into modules
      (pty/meta/browser/cdp/control/persist/window/log) and extract main.ts
      (control.ts/help.ts/factories.ts). Behavior-neutral; do on a branch.
- [ ] First-run consent prompt for installing Claude Code hooks into the global
      `~/.claude/settings.json` (currently auto-installs on launch).
