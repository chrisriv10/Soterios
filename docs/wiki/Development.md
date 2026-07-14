# Development Guide

Guide for contributors building and extending Soterios.

## Prerequisites

- **Node.js** 22 or newer
- **npm**
- **Git**
- **Windows** (recommended — system features use Windows APIs)

## Clone and run

```bash
git clone https://github.com/chrisriv10/Soterios.git
cd Soterios
npm install    # downloads ClamAV binaries via postinstall
npm start
```

Development mode with extra logging:

```bash
npm run dev
```

## Project structure

```text
src/main/        IPC handlers and service orchestration
src/preload/     contextBridge API for the renderer
src/core/        database, event bus, tool registry, plugin loader
src/security/    scanning, quarantine, audit, firewall, network, processes
src/tools/       built-in tool modules (auto-loaded)
src/scripts/     maintenance scripts and registry.json
src/ui/          HTML shell, CSS themes, page modules
assets/          icons and bundled ClamAV
tests/           Jest and node:test suites
docs/wiki/       version-controlled wiki source (sync to GitHub Wiki)
```

## Building installers

```bash
npm run dist:win    # Windows NSIS .exe → dist/
npm run dist:mac    # macOS dmg (experimental)
npm run dist:linux  # Linux AppImage (experimental)
```

## Running tests

```bash
npm test
```

See `CONTRIBUTING.md` for the full testing section.

## Architecture overview

```
Electron Main Process
  ├── ipcHandlers.js       ← renderer requests
  ├── ScanEngine           ← ClamAV orchestration
  ├── QuarantineManager    ← file isolation
  ├── SystemAudit          ← Windows security checks
  ├── NetworkMonitor       ← connections + interfaces
  └── toolRegistry         ← plugin-style tool modules

Renderer (src/ui/)
  └── pages/*.js           ← one module per sidebar page
```

Communication uses Electron IPC through a hardened preload script — the renderer never gets direct Node.js access.

## Adding a new tool module

1. Create a module in `src/tools/` exporting an array of tool definitions.
2. The plugin loader auto-registers tools on startup.
3. Wire UI if needed in `src/ui/js/pages/`.

## Adding a theme

1. Add CSS variables in `src/ui/css/style.css` under `:root[data-theme="name"]`.
2. Register the name in `src/ui/js/api.js` allowed themes array.
3. Add a `<option>` in `src/ui/js/pages/settings.js`.

## Coding standards

- Keep changes focused — one feature or fix per PR.
- Match existing naming and file layout.
- Handle errors without exposing sensitive data in logs.
- Run `npm test` before submitting.
- Use clear commit messages: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Release process

Releases are built with `electron-builder` via GitHub Actions (`.github/workflows/release.yml`). Version bumps live in `package.json`.

## Contributing workflow

1. Fork the repository.
2. Create a branch: `git checkout -b feat/my-feature`.
3. Commit signed changes with descriptive messages.
4. Push and open a Pull Request against `main`.

See [CONTRIBUTING.md](https://github.com/chrisriv10/Soterios/blob/main/CONTRIBUTING.md) for full guidelines.
