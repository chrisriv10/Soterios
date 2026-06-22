# Soterios System Tools

A plugin-based desktop toolkit for local system maintenance, monitoring, and
basic security checks. Built with Electron + vanilla JS — no frameworks, no
cloud calls, everything runs on your machine.

## What's included

- **Dashboard** — composite System Health Score (0-100) blending last scan
  results, password strength, disk space, and CPU load, plus live stat tiles.
- **File Scanner** — hashes files (SHA-256) and checks them against a local
  signature database (`src/av/signatureDB.json`), plus heuristic flags
  (suspicious extension, temp-directory location, high entropy). Flagged
  files can be quarantined (moved to `~/.soterios-quarantine`, never deleted).
- **Passwords** — cryptographically secure password generator (Node's
  `crypto`) and a strength checker with entropy estimation.
- **System Monitor** — CPU, memory, disk, and OS info via `systeminformation`.
- **Processes** — running process list sorted by CPU usage via `ps-list`.
- **Maintenance Scripts** — a small registry of safe, read-only-by-default
  scripts: temp file cleanup (dry-run by default), disk space report,
  startup items report.
- **All Tools** — browses every plugin registered with the tool registry,
  including any stubs.

Nothing in this app phones home. Scanning, hashing, and analysis all happen
locally.

## Getting started

```bash
npm install
npm start
```

`npm install` downloads the Electron binary itself, so it needs normal
internet access (this won't work behind a restrictive proxy/firewall that
blocks Electron's CDN).

For dev tools (Chromium devtools open automatically):

```bash
npm run dev
```

## Building the Windows installer

You have two options. Both produce the same installer:
`dist/Soterios System Tools-Setup-1.0.0.exe`.

### Option A — On your own Windows machine

```bash
npm install
npm run dist:win
```

This requires actual internet access (it downloads Electron's prebuilt
Windows binary and NSIS itself on first run) and works on Windows, macOS,
or Linux as a build host — electron-builder cross-compiles fine, but NSIS
packaging is most reliable when run on Windows directly or via the GitHub
Actions workflow below.

### Option B — GitHub Actions (no Windows machine needed)

A workflow is included at `.github/workflows/build-windows.yml`. Push this
project to a GitHub repo, then either:

- Push a version tag (`git tag v1.0.0 && git push --tags`) — this builds
  the installer **and** attaches it to a GitHub Release automatically, so
  the public can download it directly from your repo's Releases page, or
- Trigger it manually from the **Actions** tab → "Build Windows Installer"
  → "Run workflow", then download the installer from the run's artifacts.

This is the easiest path to a working public download link with zero local
setup.

### What the installer does

Built with `nsis` via electron-builder, configured for:

- A standard install wizard (not silent/one-click) — shows the license
  (`build/LICENSE.txt`), lets the user pick the install directory
- Desktop + Start Menu shortcuts
- A proper uninstaller registered with Windows (Add/Remove Programs)
- A multi-resolution `.ico` (16–256px) so the icon looks correct in the
  taskbar, Start Menu, and file explorer at every size

## Making it truly public: code signing

**An unsigned `.exe` will trigger Windows SmartScreen** ("Windows protected
your PC" warning) on first run for anyone who downloads it, and some
antivirus engines flag unsigned Electron apps more readily — this app's
file-scanning feature in particular can superficially resemble malware
behavior to a heuristic AV engine even though it's benign (hashing files
and reading directories). Users can still click "More info → Run anyway,"
but this is a real adoption barrier for an unfamiliar app.

To remove that warning, you need a **code signing certificate**:

1. **EV (Extended Validation) code signing certificate** — the gold
   standard. Gives Windows SmartScreen reputation immediately, no warning
   at all from day one. Costs roughly $300–500/year from a CA (DigiCert,
   SSL.com, Sectigo) and requires a hardware token + identity verification
   (business registration, in most cases).
2. **Standard (OV) code signing certificate** — cheaper (~$70–200/year),
   removes the "Unknown Publisher" line and shows your verified name, but
   SmartScreen still needs to build reputation over time/downloads before
   warnings stop entirely.
3. **Azure Trusted Signing** — Microsoft's newer, cheaper option (~$10/month),
   works similarly to OV signing, requires an Azure account and a registered
   business or 3+ years of identity history for individuals.

Once you have a certificate, add this to the `win` block in `package.json`:

```json
"win": {
  "certificateFile": "path/to/cert.pfx",
  "certificatePassword": "env:CSC_KEY_PASSWORD"
}
```

(or use `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables, which is what
electron-builder picks up automatically — better for CI, since you'd add
the cert as a GitHub Actions secret rather than committing it).

Without signing, the app is still fully functional and fine to share with
people who trust the source (e.g. a GitHub repo with visible source code) —
it's specifically the "stranger downloads it cold" scenario where signing
matters most.

## Building for other platforms

```bash
npm run dist          # build for your current OS
npm run dist:mac
npm run dist:linux
```

Output goes to `dist/`.

## Architecture

```
main.js                # Electron main process — window + IPC routing
preload.js              # contextBridge — the only thing the renderer can call into Node with

src/core/
  pluginLoader.js        # scans src/tools/*.js and registers each exported tool
  toolRegistry.js        # holds all registered tools, exposes list()/run()
  eventBus.js             # internal pub/sub (not currently used cross-module, but available)

src/tools/                # one file per tool area; each exports a tool or array of tools
  passwordTools.js
  systemMonitor.js
  processViewer.js
  fileScanner.js
  cleanupTool.js
  healthScore.js

src/av/
  scanner.js              # hashing, signature matching, heuristics, quarantine
  signatureDB.json        # SHA-256 signatures to flag — edit this directly to add your own

src/scripts/
  registry.json           # list of available maintenance scripts
  scriptRunner.js         # loads registry.json and dispatches to a script file
  safeScripts/            # the actual script implementations

src/ui/
  pages/shell.html        # app shell: sidebar + main content mount point
  css/style.css           # design tokens + all styling
  js/api.js               # thin wrapper around window.soterios (the preload bridge)
  js/components.js        # shared render helpers (icons, formatters)
  js/router.js             # swaps the active page based on sidebar clicks
  js/state.js              # tiny shared state (last scan summary, last password score)
  js/pages/*.js            # one file per page, each registers on window.Pages
```

### Adding a new tool

1. Create a file in `src/tools/` exporting an object (or array of objects)
   shaped like:

   ```js
   module.exports = {
     id: 'my-tool',            // unique, used in IPC calls
     name: 'My Tool',
     description: 'What it does',
     category: 'Security',     // groups it in the All Tools page
     icon: 'shield',           // see Icons in components.js, add a new one if needed
     run: async (args, ctx) => {
       // ctx.sendProgress({...}) is available for long-running tools
       return { some: 'result' };
     }
   };
   ```

2. That's it — `pluginLoader.js` picks it up automatically on next launch.
   No registration step needed elsewhere.

3. To surface it with a dedicated UI (rather than just the generic "All
   Tools" listing), add a page module in `src/ui/js/pages/` following the
   pattern in the existing pages, and add a sidebar entry + script tag in
   `shell.html`.

### Adding signatures to the scanner

Edit `src/av/signatureDB.json` directly:

```json
{
  "signatures": [
    { "name": "some-known-bad-file", "hash": "sha256-hash-in-lowercase-hex" }
  ]
}
```

The shipped entry is the industry-standard EICAR test signature (a harmless
string every AV product recognizes) — useful for confirming the scanner
pipeline works end-to-end.

### Adding a maintenance script

1. Add a file under `src/scripts/safeScripts/` exporting an async function.
2. Add an entry to `src/scripts/registry.json` pointing at it.
3. It'll show up automatically on the Scripts page.

Scripts that delete or modify anything should default to a `dryRun: true`
behavior, following the pattern in `clearTemp.js`.

## Notes on scope

This is a **local heuristic/signature scanner**, not a replacement for a
real antivirus engine — it won't catch most real-world malware, since it
only matches hashes you've explicitly added plus a few simple heuristics
(suspicious extension, temp-folder location, high entropy). Treat it as a
maintenance/sanity tool, not a security boundary.
