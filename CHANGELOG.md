# Changelog

All notable changes to Scanline will be documented in this file.

## [2.0.0] - 2026-06-12

### Added
- macOS support with native theme inheritance (dark/light)
- Vibrancy (glassmorphism) on sidebar and titlebar
- Native macOS traffic light buttons
- Liquid Glass effects on overlays (palette, context menu, feed, notifications)
- Light theme with WCAG AA contrast ratios
- Theme selector in Settings (Auto/Light/Dark)
- Drag & drop files into terminal (files, URIs, text)
- Terminal theme auto-adjusts with system theme
- Prefers-reduced-motion support
- Backdrop blur on overlays
- Onboarding shortcuts adapt to macOS/Windows
- Empty state in command palette
- Settings scroll shadow
- Button click transitions
- Notification panel exit animation
- Feed panel entry/exit animation
- CDP method whitelist for security

### Fixed
- Command injection in `repoInfo` (switched to `execFile`)
- `bellBtn` used before declaration in notifications
- Fullscreen toggle was a no-op
- `panePorts` used surfaceId as PID instead of actual PTY PID
- Settings panel had inconsistent colors (2-tone)
- `config:edit` used `exec()` instead of `shell.openPath()`
- `onDone` callback fired twice in `closeOverlay`
- PTY duplicate ID overwrites without cleanup
- Control server buffer overflow (no size limit)
- `win!` non-null assertion crash
- Removed 8 abandoned test files from root

### Changed
- `repoInfo` returns `{branch, dirty, commit}` (was missing `commit`)
- Settings card uses solid background (no liquid glass)
- Sidebar and titlebar follow system theme
- Improved sidebar rendering (incremental diff)

## [1.0.0] - 2026-01-01

### Added
- Initial Windows release
- Grid tiling with splits, zoom, equalize
- Workspaces with vertical tabs
- Terminal panes with xterm.js
- Browser panes with CDP scripting
- Named pipe control server
- CLI with tmux-compat shim
- Session restore
- Bilingual UI (PT-BR/EN)
- Claude Code integration
