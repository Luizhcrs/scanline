# Contributing to Scanline

## Development Setup

### Prerequisites
- Node.js 20+
- Go 1.22+

### Getting Started

```bash
# Clone the repo
git clone https://github.com/Luizhcrs/scanline.git
cd scanline

# Install dependencies and start dev
cd app
npm install
npm run dev
```

The app opens with hot-reload for the renderer (Vite) and auto-rebuild for the Electron main process.

### Build

```bash
cd app
npm run dist
```

Output: `app/dist-installer/` (DMG on macOS, NSIS on Windows).

### CLI

```bash
cd cli
go build
```

This generates `scanline-cli`. Place it in your PATH.

## Project Structure

```
scanline/
  app/                 Electron application
    electron/          Main process (Node.js)
    src/               Renderer (TypeScript, xterm.js)
    index.html         Shell + splash
  cli/                 CLI Go + tmux-compat shim
  docs/                Marketing site
```

## Code Style

- TypeScript strict mode enabled
- 2-space indentation (see `.editorconfig`)
- No comments unless asked
- Follow existing patterns in the codebase

## Testing

```bash
cd app
npm run test          # Run tests
npm run typecheck     # Type checking
```

## Pull Requests

1. Create a feature branch from `master`
2. Make your changes
3. Run `npm run typecheck && npm run test`
4. Submit a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under AGPL-3.0.
