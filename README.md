<p align="center">
<img src="assets/soteriosLogo.png" alt="Soterios" width="300" />
</p>

<p align="center">
<strong>Open-source, local-first security and system maintenance suite built for Windows.</strong><br/>
Scan files, inspect processes, audit your system, manage your firewall, test password strength, and check known breaches privately.
</p>

<p align="center">
<a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/v/release/chrisriv10/Soterios?style=flat-square&label=Latest%20Release" alt="Latest Release" /></a>
<a href="https://github.com/chrisriv10/Soterios/blob/main/build/LICENSE.txt"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" /></a>
<a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/downloads/chrisriv10/Soterios/total?style=flat-square&label=Downloads" alt="Downloads" /></a>
</p>

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of notable changes and release notes.

---

## Download & Install

Soterios is built for **Windows 10/11 (x64)**. Many security and maintenance features rely on Windows-specific APIs, services, and system integrations (Defender, Firewall, WMI/CIM, Registry, scheduled tasks), so **Windows is currently the only supported platform**. macOS and Linux are not supported; the `dist:mac` / `dist:linux` package scripts are packaging experiments only.

Download the latest Windows release from the **[releases page](https://github.com/chrisriv10/Soterios/releases/latest)** (NSIS installer, per-machine install).

The installer requires administrator privileges. At runtime, privileged features — firewall changes, Defender controls, system audits, process memory dumps, and some maintenance operations — need elevation and report access-denied errors without it. Everyday features such as scanning your own files, viewing reports, and the password tools work in a normal session.

The release build also produces a versioned `soterios-extension-<version>.zip`, a Chromium Manifest V3 package for sideloading or store submission. The extension is included in the desktop installer resources and can also be built independently (see [Build Installers](#build-installers)).

---

## Features

- **First-Run Setup Wizard** — theme, language, real-time protection, notifications, privacy mode, and browser extension install in one guided flow; replay it anytime from Settings
- **Security Dashboard** — health score, scan status, warnings, ignored warnings, quarantine count, and real-time protection controls, plus a tray dashboard for at-a-glance status
- **Malware Scan** — quick, full, and custom scans powered by ClamAV with definition updates, scheduled scans, live progress metrics, cancellation, quarantine, and saved reports (PDF/CSV export)
- **Process Inspector** — native Rust-backed inspector with risk scoring and reputation checks, Task Manager-style context menu (terminate, restart, suspend/resume, priority, affinity, memory dumps), and detection for Office/PDF-spawned script hosts and processes with an unexpected parent
- **Reports** — browse, view, generate, and delete scan and system reports in-app
- **Windows Security Audit** — Defender, UAC, Windows Update, BitLocker, PowerShell policy, and Secure Boot, with per-section management actions
- **Firewall Management** — profile status, rule summaries, multi-select bulk rule actions, rule import/export, and an endpoint activity radar visualizing live connections
- **Network Monitor** — active connections, interface activity, an adaptive geo activity map, selectable traffic history ranges, suspicious-connection alerts, and domain/IP blocklists
- **VPN Management** — on/off control, tray toggle, auto-connect, guided provider setup, and removal of Soterios-created profiles
- **Credential Safety Hub** — local password generator, strength checker, HIBP k-anonymity password leak checks, and XposedOrNot email breach checks
- **Browser Extension** — local password reuse detection, breach/reuse toolbar badge, Google Safe Browsing phishing/malware warnings, a signed threat feed, matching themes, and optional continuous protection for HTTP/HTTPS sites
- **Local AI Assistant** — Ollama integration restricted to localhost, with a system context snapshot, quick questions, and the ability to run a fixed set of safe Soterios actions on request (scans, health score, security overview, system monitor, process viewer, password generator, duplicate finder, persistence scan, report generation)
- **Emergency Lockdown** — one-click network and service isolation for emergencies, with an interface/service/IP allowlist
- **Real-Time Protection** — toggles Windows Defender real-time monitoring on/off and verifies its state, plus folder watching with automatic scanning of new files
- **Privacy Mode** — one Settings toggle that disables Soterios's data-sharing and history features (external breach/geo lookups, AI assistant context, traffic and scan history, auto reports) and restores them when turned off
- **Quarantine Management** — restore (optionally trusting the file's hash for future scans) or permanently delete isolated files, with status history and safe recovery controls
- **Maintenance Scheduler** — configurable auto-clean policies with per-script settings, run-now overrides, and a Safety Vault that stages files before deletion instead of removing them immediately
- **Device Optimization** — switch power plan modes to trade performance for battery life or vice versa
- **Tools & Maintenance** — temp file cleanup, disk reports, large file finder, duplicate file finder, secure file shredder, folder watch, network alerts, browser cache reports, startup items and persistence monitoring, network reports, Windows services reports, scheduled tasks reports, hosts file integrity checks, and network interface/connection reports
- **Software Uninstaller** — locate and remove installed applications, including leftover files
- **Automatic Updates** — in-app update checks with status surfaced in the UI
- **Themes & Languages** — multiple built-in themes and 15 locales (English plus 14 translations), switchable from Settings

---

## Screenshots

UI screenshots are **not committed to the repo**. To capture for a PR: run `npm run capture:screenshots` (or `npm start` manually) and attach PNGs to the PR (see [tests/fixtures/screenshots/README.md](tests/fixtures/screenshots/README.md)).

---

## Privacy

Soterios does **not** collect telemetry or analytics. All scanning and system analysis happens locally on your machine. Network calls occur **only** when a feature that needs them is active (ClamAV updates, HIBP checks, XposedOrNot lookups, browser extension Safe Browsing checks and threat feed updates).

**Privacy Mode**, available from Settings, disables every external lookup and history/data-sharing feature (breach/geo lookups, AI assistant context, traffic and scan history, auto reports) with a single toggle, and locks those settings until you turn it back off. The browser extension has its own equivalent Privacy Mode toggle in its options page, which disables its third-party calls (HIBP, Safe Browsing) independently of the desktop app — local-only features like password reuse detection keep working either way, since that data never leaves your device.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 26 or newer (required by the package engine; see `.nvmrc`)
- [Git](https://git-scm.com/)
- Windows 10/11 (x64) for system-level features; the native helper also needs the pinned Rust toolchain (`rust-toolchain.toml`, currently 1.85.1) for `npm run native:process`
- Rust toolchain 1.85.1 for native process inspector builds on Windows

Set up the pinned Windows Rust toolchain:

```bash
rustup toolchain install 1.85.1-x86_64-pc-windows-msvc --profile minimal --component clippy,rustfmt
```

### Clone & Run

```bash
git clone https://github.com/chrisriv10/Soterios.git
cd Soterios
npm install
npm start
```

`npm install` downloads the Windows ClamAV binaries into `assets/clamav/` (pinned release, SHA-256 verified). For day-to-day development, `npm run dev` opens the DevTools automatically.

### Build Installers

```bash
# Windows (NSIS .exe)
npm run dist:win
```

To build and package the Chromium extension separately:

```bash
npm run extension:build
npm run extension:validate
npm run extension:package
```

Built artifacts are output to the `dist/` directory.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SOTERIOS_DISABLE_GPU=1` | Disables GPU acceleration and forces software rendering. This can help when GPU drivers cause rendering glitches or crashes. |
| `SOTERIOS_USERDATA=<path>` | Overrides the default user data directory (`%APPDATA%\Soterios`) with a custom path, which can be useful for isolated instances. |
| `SOTERIOS_LOG_FILE=1` or `SOTERIOS_LOG_FILE=<path>` | Enables file logging. Use `1` for the default user data log location or provide a custom log file path. |
| `SOTERIOS_LOG_LEVEL=<level>` | Log verbosity (`debug`, `info`, `warn`, `error`; default `info`). |

To use an environment variable at runtime on Windows, set it before starting Soterios. For example:

```bat
set SOTERIOS_DISABLE_GPU=1 && npm start
```

With PowerShell:

```powershell
$env:SOTERIOS_DISABLE_GPU = "1"; npm start
```

### Testing

```bash
npm test
npm run smoke:integration
npm run smoke:alerts
```

`npm test` runs the Node unit suite followed by the three Jest suites. `smoke:alerts` exercises the network-alert pipeline against live system data and skips cleanly (exit 0) when its test address is unreachable, e.g. on offline machines. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Native Components

The process inspector is backed by a Rust helper (`native/process-inspector`):

```bash
npm run native:process   # build release binary + checksums.json into build/native/
npm run native:check     # verify the built helper
```

The build is Windows-only and skips on other platforms. At runtime the main process verifies the helper against `build/native/checksums.json` when the manifest is present. The browser extension's native host is built separately with `npm run native-host:build`.

### Browser Extension Development

```bash
npm run extension:build      # build from browser-extension/src
npm run extension:validate   # validate the built package
npm run feed:verify          # verify the signed threat feed
```

The extension source lives in `browser-extension/src`; built output goes to `browser-extension/dist`. Installation into Chrome, Edge, or Brave is handled by the in-app setup wizard or `npm run extension:install` (which also builds the native host). The threat feed (CERT Polska + URLhaus sources, signed) is published on a schedule by the threat-feed workflow.

---

## API Notes

| Feature | Service | Privacy |
|---------|---------|---------|
| Password leak checks | [Have I Been Pwned – Pwned Passwords](https://haveibeenpwned.com/Passwords) | Only the first 5 characters of the SHA-1 hash are sent (k-anonymity); the browser extension never sends your plaintext password to the desktop app either |
| Email breach checks | [XposedOrNot](https://xposedornot.com/) | Free public email breach API |
| Browser extension phishing/malware warnings | [Google Safe Browsing v5](https://developers.google.com/safe-browsing) | Only checks the current page's URL; results are cached in-session to reduce lookups |
| Browser extension threat feed | CERT Polska + URLhaus | Signed feed of known-malicious domains, fetched independently of your browsing activity |

All of the above are gated behind **Privacy Mode**, which disables every external lookup with one toggle (see Features above).

---

## Project Structure

```text
main.js Electron root entry point (delegates to src/main/main.js)
src/preload/ contextBridge API exposed to the renderer
src/main/ IPC handlers, ServiceRegistry, and app/service orchestration
src/core/ database, event bus, tool registry, plugin loader
src/security/ scanning, quarantine, audit, firewall, network, process, and realtime services
src/tools/ built-in tool modules
src/scripts/ safe script modules and registry (maintenance, cleanup, reports)
src/ui/ shell, CSS, shared JS, and page modules
native/ Rust process-inspector helper source
browser-extension/ Soterios browser extension source (Manifest V3) and threat-feed client
assets/ Soterios icons and ClamAV files (downloaded at install time, not committed)
tools/ build and install helpers (ClamAV download, extension packaging, feed tools)
tests/ unit tests, smoke checks, and validation fixtures
build/ installer resources
```

---

## Roadmap

These areas are under consideration for future updates. There is no fixed release order, and scope may change based on feedback. Linked issues track active discussion.

- USB/removable-drive scanning ([#124](https://github.com/chrisriv10/Soterios/issues/124))
- System Restore point management ([#125](https://github.com/chrisriv10/Soterios/issues/125))
- Disk SMART health monitoring and alerts ([#121](https://github.com/chrisriv10/Soterios/issues/121))
- CPU/GPU temperature monitoring ([#120](https://github.com/chrisriv10/Soterios/issues/120))
- Process history with configurable retention ([#122](https://github.com/chrisriv10/Soterios/issues/122))
- Startup impact analysis ([#123](https://github.com/chrisriv10/Soterios/issues/123))
- Secure local credential vault
- Additional cleanup and optimization tools
- UI polish

Longer-term ideas that would need significant architectural work:

- Custom real-time protection
- Proprietary scanning engine

---

## Contributing

Contributions are welcome! To get started:

1. **Fork** the repository.
2. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`.
3. **Commit** your changes with clear messages.
4. **Push** to your fork and open a **Pull Request**.

Please make sure your changes work locally (`npm start`) before submitting. Before starting substantial work, comment on the issue to have it assigned to you — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, testing guidance, and security-reporting rules.

**Documentation:** User and developer guides live in [`docs/wiki/`](docs/wiki/Home.md) and on the [GitHub Wiki](https://github.com/chrisriv10/Soterios/wiki).

---

## Project Status & Contributions

Soterios is actively developed and continuing to mature.

The project is functional and usable, but some features are still being refined and additional improvements are planned for future releases.

Because of this, feedback and contributions are especially valuable.

### Areas that need help

- Stabilizing and improving the malware scanning system
- Expanding and refining system audit coverage
- Improving UI consistency and user experience
- Performance optimization across system monitoring tools
- Strengthening overall architecture and modularity
- Identifying and fixing bugs

### How you can contribute

If you're interested in system tools, security software, or Electron-based applications, contributions, testing, and feedback are welcome as the project grows.

Even small improvements, bug reports, or suggestions are appreciated.

## License

Soterios is released under the [MIT License](LICENSE).

**Copyright © 2026 Christopher Rivera**