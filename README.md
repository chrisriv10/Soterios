<p align="center">
  <img src="assets/icon.png" alt="Soterios" width="128" />
</p>

<h1 align="center">Soterios</h1>

<p align="center">
  <strong>Open-source, local-first Windows security and system maintenance suite.</strong><br/>
  Scan files, inspect processes, audit your system, manage your firewall, test password strength, and check known breaches privately.
</p>

<p align="center">
  <a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/v/release/chrisriv10/Soterios?style=flat-square&label=Latest%20Release" alt="Latest Release" /></a>
  <a href="https://github.com/chrisriv10/Soterios/blob/main/build/LICENSE.txt"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/chrisriv10/Soterios/releases/latest"><img src="https://img.shields.io/github/downloads/chrisriv10/Soterios/total?style=flat-square&label=Downloads" alt="Downloads" /></a>
</p>

---

## Download & Install

Pick the installer for your operating system from the [latest release](https://github.com/chrisriv10/Soterios/releases/latest):

| Platform | Installer | Notes |
|----------|-----------|-------|
| **Windows** | `Soterios-Setup-x.x.x.exe` | NSIS installer · requires admin for system-level checks |
| **macOS** | `Soterios-x.x.x.dmg` | Drag to Applications · may require Gatekeeper approval |
| **Linux** | `Soterios-x.x.x.AppImage` | `chmod +x` and run · no install needed |

---

## Features

- **Security Dashboard** — health score, scan status, warnings, ignored warnings, quarantine count, and real-time protection controls
- **Malware Scan** — quick, full, and custom scans powered by ClamAV with definition updates, progress, cancellation, quarantine, and saved reports
- **Reports** — browse, view, generate, and delete scan and security reports in-app
- **Process Inspector** — risk-first sorting, then highest CPU/RAM impact within the same risk level
- **Windows Security Audit** — Defender, UAC, Windows Update, BitLocker, PowerShell policy, and Secure Boot
- **Firewall Management** — Windows Firewall profile status and rule summaries
- **Network Monitor** — active connections and interface activity
- **Password Tools** — local generator, strength checker, HIBP k-anonymity password leak checks, and XposedOrNot email breach checks
- **Real-Time Protection** — local file-system watcher for live threat detection
- **Quarantine Management** — restore or permanently delete isolated files
- **Tools & Maintenance** — temp cleanup, disk reports, large file finder, browser cache reports, startup items, network reports, and Windows services reports

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

# macOS (.dmg)
npm run dist:mac

# Linux (.AppImage)
npm run dist:linux
```

Built artifacts are output to the `dist/` directory.

---

## Usage

1. **Dashboard** — review your health score, active warnings, and real-time protection status.
2. **Virus Scan** — run a quick, full, or custom scan.
3. **Reports** — view detailed scan results without leaving the app.
4. **Windows Audit** — check Defender, UAC, BitLocker, and other Windows security settings.
5. **Firewall** — inspect firewall profile status and rules.
6. **Process Inspector** — review high-risk or resource-heavy processes.
7. **Passwords** — generate secure passwords, check strength locally, and optionally look up breaches.

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

## Contributing

Contributions are welcome! To get started:

1. **Fork** the repository.
2. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`.
3. **Commit** your changes with clear messages.
4. **Push** to your fork and open a **Pull Request**.

Please make sure your changes work locally (`npm start`) before submitting.

---

## ⚠️ Project Status & Contributions

Soterios is currently in early development.

Some features are fully functional, while others are still being implemented or refined. The project is actively evolving and may contain incomplete or experimental systems.

Because of this, feedback and contributions are especially valuable.

### 🛠️ Areas that need help

- Stabilizing and improving the malware scanning system
- Expanding and refining system audit coverage
- Improving UI consistency and user experience
- Performance optimization across system monitoring tools
- Strengthening overall architecture and modularity
- Identifying and fixing bugs

### 🤝 How you can contribute

If you're interested in system tools, security software, or Electron-based applications, contributions, testing, and feedback are welcome as the project grows.

Even small improvements, bug reports, or suggestions are appreciated.

## License

Soterios is released under the [MIT License](build/LICENSE.txt).

**Copyright © 2026 Chris Rivera**
