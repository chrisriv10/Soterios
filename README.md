<p align="center">
<img src="assets/soteriosLogo.png" alt="Soterios" width="300" />
</p>

<p align="center">
<strong>Open-source, local-first security and system maintenance suite built for Windows.</strong><br/>
Scan files, inspect processes, audit your system, manage your firewall, test password strength, and check known breaches privately.
</p>

<p align="center">
<a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/v/release/chrisriv10/Soterios?style=flat-square&label=Latest%20Release" alt="Latest Release" /></a>
<a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/downloads/chrisriv10/Soterios/total?style=flat-square&label=Downloads" alt="Downloads" /></a>
<a href="https://github.com/chrisriv10/Soterios/actions/workflows/build-all.yml"><img src="https://github.com/chrisriv10/Soterios/actions/workflows/build-all.yml/badge.svg" alt="Windows Build" /></a>
<a href="https://github.com/chrisriv10/Soterios/actions/workflows/codeql.yml"><img src="https://github.com/chrisriv10/Soterios/actions/workflows/codeql.yml/badge.svg" alt="CodeQL" /></a>
<a href="https://github.com/chrisriv10/Soterios/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

---

## Download & Install

| Requirement | Details |
|-------------|---------|
| OS | Windows 10/11 (x64) |
| Platform | Windows only; macOS and Linux are not supported (`dist:mac` / `dist:linux` scripts are packaging experiments only) |
| Privileges | Administrator required for the installer; privileged features need elevation, everyday features run in a normal session |

Many security and maintenance features rely on Windows-specific APIs and integrations (Defender, Firewall, WMI/CIM, Registry, scheduled tasks).

Download the latest Windows release from the **[releases page](https://github.com/chrisriv10/Soterios/releases/latest)** (NSIS installer, per-machine install). At runtime, privileged features — firewall changes, Defender controls, system audits, process memory dumps, and some maintenance operations — need elevation and report access-denied errors without it. Everyday features such as scanning your own files, viewing reports, and the password tools work in a normal session.

Releases also include a versioned `soterios-extension-<version>.zip`, a Chromium Manifest V3 package for sideloading or store submission. The extension is bundled in the desktop installer resources and can also be built independently (see [Build Installers](#build-installers)).

---

## Features

- **Malware protection** — quick, full, and custom scans powered by ClamAV with definition updates, scheduled scans, live progress metrics, cancellation, and saved reports (PDF/CSV export); quarantine with restore (optionally trusting the file's hash for future scans) or permanent delete; Windows Defender controls including real-time monitoring toggle with state verification and a read-only Defender threat-history viewer; folder watching with automatic scanning of new files; opt-in removable-drive detection with scan prompts and optional auto-scan; one-click Emergency Lockdown with an interface/service/IP allowlist
- **System visibility** — Rust-backed Process Inspector with risk scoring and reputation checks, Task Manager-style actions (terminate, restart, suspend/resume, priority, affinity, memory dumps), detection of Office/PDF-spawned script hosts and processes with an unexpected parent, and persistent process history with configurable retention; Windows Security Audit (Defender, UAC, Windows Update, BitLocker, PowerShell policy, Secure Boot) with per-section management actions; in-app scan and system reports
- **Network & firewall** — firewall profile status, rule summaries, multi-select bulk rule actions, and rule import/export, plus an endpoint activity radar for live connections; active connections, interface activity, an adaptive geo activity map with selectable history ranges, suspicious-connection alerts, and domain/IP blocklists; VPN on/off control with tray toggle, auto-connect, and guided provider setup
- **Privacy & credential safety** — local password generator and strength checker, HIBP k-anonymity password leak checks, and XposedOrNot email breach checks; one-toggle Privacy Mode (desktop app and browser extension) that disables external lookups and history/data-sharing features and restores them when turned off
- **Maintenance & system tools** — Maintenance Scheduler with configurable auto-clean policies, per-script settings, run-now overrides, and a Safety Vault that stages files before deletion; temp file cleanup, disk reports, large file and duplicate finders, secure file shredder, startup and persistence monitoring, and Windows services, scheduled tasks, hosts file, and network reports; power-plan optimization; software uninstaller with leftover cleanup
- **Browser extension** — Chromium Manifest V3 companion with local password reuse detection, breach/reuse toolbar badge, Google Safe Browsing phishing/malware warnings, a signed threat feed (CERT Polska + URLhaus), ad and tracker blocking from packaged filter lists, matching themes, and optional continuous protection for HTTP/HTTPS sites
- **Local AI assistant** — optional Ollama integration restricted to localhost, with a system context snapshot, quick questions, and a fixed set of safe on-request actions (scans, health score, security overview, system monitor, process viewer, password generator, duplicate finder, persistence scan, report generation)
- **Dashboard & usability** — guided first-run setup wizard (theme, language, real-time protection, notifications, privacy mode, browser extension install; replayable from Settings); health score, scan status, warnings, quarantine count, and a tray dashboard; automatic update checks; multiple built-in themes and 15 locales, switchable from Settings

---

## Screenshots

UI screenshots are **not committed to the repo**. To capture for a PR: run `npm run capture:screenshots` (or `npm start` manually) and attach PNGs to the PR (see [tests/fixtures/screenshots/README.md](tests/fixtures/screenshots/README.md)).

---

## Privacy

Soterios does **not** collect telemetry or analytics. Scanning and system analysis run locally on your machine. Network calls occur **only** when a feature that needs them is active.

| Feature | Service | Privacy behavior |
|---------|---------|------------------|
| Password leak checks | [Have I Been Pwned – Pwned Passwords](https://haveibeenpwned.com/Passwords) | K-anonymity: only the first 5 characters of the SHA-1 hash are sent; the browser extension never sends your plaintext password to the desktop app |
| Email breach checks | [XposedOrNot](https://xposedornot.com/) | Queried only when you run an email breach check |
| Page warnings (extension) | [Google Safe Browsing v5](https://developers.google.com/safe-browsing) | Checks the current page's URL only; results are cached in-session to reduce lookups |
| Threat feed (extension) | CERT Polska + URLhaus | Signed indicator feed, fetched on a fixed schedule independently of your browsing activity |

**Privacy Mode** (Settings, with an independent toggle in the extension options page) disables every external lookup and history/data-sharing feature — breach/geo lookups, AI assistant context, traffic and scan history, auto reports — with a single toggle, and restores them when turned off. See [docs/wiki/Privacy-and-Security.md](docs/wiki/Privacy-and-Security.md) for the local-first model, external services, and data locations.

---

## Security & Release Integrity

Soterios is released under the [MIT License](LICENSE). Report vulnerabilities privately via [SECURITY.md](SECURITY.md) (GitHub private vulnerability reporting); do not file public issues for security bugs.

Published GitHub releases include verification artifacts generated by the release workflow (`.github/workflows/release.yml`): `SHA256SUMS.txt` for the installer, a CycloneDX Node SBOM (`soterios-node.cdx.json`), Rust dependency metadata (`soterios-rust-metadata.json`), and the versioned browser extension package with its checksum (`soterios-extension-<version>.zip` plus `.sha256`).

The current Windows installer is not Authenticode-signed. Published releases include SHA-256 checksums and dependency metadata so users can verify downloaded artifacts.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 26 or newer (required by the package engine; see `.nvmrc`)
- [Git](https://git-scm.com/)
- Windows 10/11 (x64) for system-level features; the native helper needs the pinned Rust toolchain (`rust-toolchain.toml`, currently 1.85.1) for `npm run native:process`

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

```bash
# Chromium extension + native host
npm run extension:build
npm run extension:validate
npm run extension:package
npm run native-host:build
npm run feed:verify          # verify the signed threat feed
npm run native:process       # build the Rust process-inspector helper into build/native/
```

Built artifacts are output to the `dist/` directory. The extension source lives in `browser-extension/src` and the threat feed is published on a schedule by the threat-feed workflow. See [docs/wiki/Development.md](docs/wiki/Development.md) for architecture and build details.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SOTERIOS_DISABLE_GPU=1` | Forces software rendering; use when GPU drivers cause rendering glitches or crashes. |
| `SOTERIOS_USERDATA=<path>` | Overrides the user data directory (default `%APPDATA%\Soterios`). |
| `SOTERIOS_LOG_FILE=1` or `SOTERIOS_LOG_FILE=<path>` | Enables file logging to the default location (`1`) or a custom path. |
| `SOTERIOS_LOG_LEVEL=<level>` | Log verbosity (`debug`, `info`, `warn`, `error`; default `info`). |

Set variables before starting Soterios (`set SOTERIOS_DISABLE_GPU=1 && npm start` in Command Prompt, or `$env:SOTERIOS_DISABLE_GPU = "1"; npm start` in PowerShell).

### Testing

```bash
npm test
npm run smoke:integration
npm run smoke:alerts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, testing guidance, and security-reporting rules.

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
browser-extension/ browser extension source (Manifest V3) and threat-feed client
assets/ icons and ClamAV files (downloaded at install time, not committed)
tools/ build and install helpers
tests/ unit tests, smoke checks, and validation fixtures
build/ installer resources
```

---

## Documentation

- [SECURITY.md](SECURITY.md) — private vulnerability reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow, testing, and standards
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — third-party licenses
- [CHANGELOG.md](CHANGELOG.md) — release history
- [docs/wiki/Home.md](docs/wiki/Home.md) and the [GitHub Wiki](https://github.com/chrisriv10/Soterios/wiki) — user and developer guides

---

## Roadmap

These areas are under consideration for future updates. There is no fixed release order, and scope may change based on feedback. Linked issues track active discussion.

- System Restore point management ([#125](https://github.com/chrisriv10/Soterios/issues/125))
- Disk SMART health monitoring and alerts ([#121](https://github.com/chrisriv10/Soterios/issues/121))
- CPU/GPU temperature monitoring ([#120](https://github.com/chrisriv10/Soterios/issues/120))
- Startup impact analysis ([#123](https://github.com/chrisriv10/Soterios/issues/123))
- Additional ideas: secure local credential vault, further cleanup and optimization tools, UI polish

Longer-term ideas that would need significant architectural work:

- Custom real-time protection
- Proprietary scanning engine

---

## Contributing

Soterios is actively developed. Contributions, bug reports, and testing help are welcome.

1. **Fork** the repository.
2. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`.
3. **Commit** your changes with clear messages.
4. **Push** to your fork and open a **Pull Request**.

Verify changes locally (`npm start`) and run `npm test` before submitting. Before starting substantial work, comment on the issue to have it assigned to you — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, testing guidance, and security-reporting rules. Report security issues privately per [SECURITY.md](SECURITY.md), not via public issues.

User and developer guides live in [`docs/wiki/`](docs/wiki/Home.md) and on the [GitHub Wiki](https://github.com/chrisriv10/Soterios/wiki).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of notable changes and release notes.

---

## License

Soterios is released under the [MIT License](LICENSE).

**Copyright © 2026 Christopher Rivera**
