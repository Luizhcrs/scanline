Scanline 0.1.6

## Fixes and improvements

- **DevTools in production builds** - F12 / Ctrl+Shift+I opens DevTools in release builds.
- **browser_navigate deduplication** - rapid URL changes no longer pile up on the Win32 main thread causing hangs.
- **browser_bounds deduplication** - resize floods no longer queue redundant SetBounds calls.
- **Terminal scrollback restore** - terminal buffer saved to session and replayed after crash or restart.
- **Gemini CLI hooks** - fixed event names to PascalCase (BeforeAgent, BeforeTool, AfterAgent, Notification).
- **Antigravity CLI (agy) hooks** - new integration with PreToolUse/PostToolUse/PreInvocation/PostInvocation and Stop.
- **Notification display names** - shows "Claude Code", "Gemini CLI", "Droid", "Kimi Code", "Antigravity" instead of raw CLI names.
- **tmux shim** - added extensionless tmux shim for MSYS2/Git Bash/Cygwin.

## Downloads

- **Scanline_0.1.6_x64-setup.exe** - installer (recommended)
- **Scanline_0.1.6_x64_en-US.msi** - MSI for enterprise deployment
- **Scanline_0.1.6_portable_x64.zip** - portable, no install required
