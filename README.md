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

## Download & Install

Soterios is currently available for **Windows**. The project is focused on providing the best possible Windows experience first, as many security and maintenance features rely on Windows-specific APIs, services, and system integrations.

Support for **macOS and Linux may come in future releases** as the project evolves. Expanding to additional platforms requires adapting features to each operating system's security model while maintaining the reliability and privacy-first approach of Soterios.

Download the latest Windows release:

| Platform | Installer | Notes |
|----------|-----------|-------|
| **Windows** | `Soterios-Setup-1.2.1.exe` | NSIS installer · requires admin for system-level checks |

---

## Features

- **Security Dashboard** — health score, scan status, warnings, ignored warnings, quarantine count, and real-time protection controls
- **Malware Scan** — quick, full, and custom scans powered by ClamAV with definition updates, progress, cancellation, quarantine, and saved reports
- **Reports** — browse, view, generate, and delete scan and security reports in-app
- **Process Inspector** — risk-first sorting, then highest CPU/RAM impact within the same risk level
- **Windows Security Audit** — Defender, UAC, Windows Update, BitLocker, PowerShell policy, and Secure Boot
- **Firewall Management** — Windows Firewall profile status and rule summaries
- **Network Monitor** — active connections and interface activity
- **Credential Safety Hub** — local password generator, strength checker, HIBP k-anonymity password leak checks, and XposedOrNot email breach checks
- **Real-Time Protection** — toggles Windows Defender real-time monitoring on/off and verifies its state
- **Quarantine Management** — restore or permanently delete isolated files
- **Tools & Maintenance** — temp file cleanup, disk reports, large file finder, browser cache reports, startup items, network reports, Windows services reports, and network interface/connection reports

---

## Privacy

Soterios does **not** collect telemetry or analytics. All scanning and system analysis happens locally on your machine. Network calls occur **only** when you explicitly trigger features that require them (ClamAV updates, HIBP checks, XposedOrNot lookups).

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- [Git](https://git-scm.com/)

### Clone & Run

```bash
git clone https://github.com/chrisriv10/Soterios.git
cd Soterios
npm install
npm start
```

### Build Installers

```bash
# Windows (NSIS .exe)
npm run dist:win

Additional platform builds may be added in the future as cross-platform support develops.
```

Built artifacts are output to the `dist/` directory.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SOTERIOS_DISABLE_GPU=1`   | Setting this will disable GPU acceleration (which is enabled by default), to force full software rendering. Set this if rendering glitches or crashes occur related to GPU drivers.
| `SOTERIOS_USERDATA=<path>` | Allows for specifying a custom path to override the default user data directory (%APPDATA%\Soterios). This may be useful for running isolating instances to retain results.

In order to utilize these environment variables during runtime, the start command can be modified as followed: `set SOTERIOS_DISABLE_GPU=1 && npm start`.

---

## API Notes

| Feature | Service | Privacy |
|---------|---------|---------|
| Password leak checks | [Have I Been Pwned – Pwned Passwords](https://haveibeenpwned.com/Passwords) | Only the first 5 characters of the SHA-1 hash are sent (k-anonymity) |
| Email breach checks | [XposedOrNot](https://xposedornot.com/) | Free public email breach API |

---

## Project Structure

```text
main.js              Electron root entry point
src/preload/         contextBridge API exposed to the renderer
src/main/            IPC handlers and app/service orchestration
src/core/            database, event bus, tool registry, plugin loader
src/security/        scanning, quarantine, audit, firewall, network, process, and realtime services
src/tools/           built-in tool modules
src/scripts/         maintenance scripts and registry
src/ui/              shell, CSS, shared JS, and page modules
assets/              Soterios icons and bundled ClamAV files
build/               installer resources
tests/               test suites
```

---

## Roadmap

| Version | Focus |
|---------|-------|
| **1.3** | System tray with quick actions, toast notification polish, auto-update basics |
| **1.4** | Real-time folder watching (auto-scan new/changed files), USB drive scanning on insert |
| **1.5** | PDF/CSV report export, network traffic graphs over time, startup impact analysis |
| **1.6** | Improved UI polish, more visual displays (graphs, charts)
| **1.7** | Hardware monitoring (CPU/GPU temp, disk SMART, etc), localization framework |
| **1.8** | File shredder (DoD overwrite), duplicate file finder, disk health monitor with SMART alerts |
| **1.9** | System restore point manager, process history tracking, startup manager with impact ratings |
| **2.0** | Privacy settings hub, safe mode lockdown feature, secure local password/credential vault |
| **2.1** | More device maintenance & cleanup optimization scripts |

### Future Considerations

These are longer-term ideas that may require significant architectural work:

- Custom real-time protection 
- Proprietary scanning engine 
- Browser guard companion extension
- Cross-platform support (macOS/Linux) |

*Order and scope may change based on feedback. Releases have no fixed dates*

---

## Contributing

Contributions are welcome! To get started:

1. **Fork** the repository.
2. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`.
3. **Commit** your changes with clear messages.
4. **Push** to your fork and open a **Pull Request**.

Please make sure your changes work locally (`npm start`) and pass linting before submitting.

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

Soterios is released under the [MIT License](build/LICENSE.txt).

**Copyright © 2026 Chris Rivera**
