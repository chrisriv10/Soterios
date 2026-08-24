# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-08-20

### Added
- First-run setup wizard (theme, language, real-time protection, notifications, privacy mode, browser extension install), with a "Replay setup" entry point in Settings
- Browser Extension 2.0: local password reuse detection, a toolbar badge for breached/reused passwords, check-on-blur checking with opt-in check-as-you-type, desktop-matching themes, Google Safe Browsing v5 phishing/malware warnings, and a signed threat feed (CERT Polska + URLhaus)
- Native process inspector with a Rust helper binary and risk scoring; flags Office/PDF-spawned script hosts and svchost processes running with an unexpected parent
- VPN management: on/off control, tray toggle, auto-connect, and a provider setup wizard
- AI Assistant (local Ollama integration) with a system context snapshot, quick questions, and the ability to run safe Soterios actions
- Tray dashboard, background updater, and ServiceRegistry-based service orchestration
- Software uninstaller, worker-thread support, and a platform-abstraction/i18n foundation
- Maintenance Scheduler: configurable auto-clean policies, per-script settings (temp file age, large-file size threshold, which browsers to clear), run-now overrides, and a Safety Vault that stages files before deletion
- Device Optimization page with power-plan mode switching
- Persistence monitor and an expanded System Audit page with per-section management actions
- Firewall: multi-select rules with bulk enable/disable/delete; the perimeter map was redesigned into an endpoint activity radar
- Network: adaptive geo activity map (replacing the original heatmap), selectable traffic history ranges, and a redesigned traffic history chart
- Folder watch, network alerts, secure file shredder, and duplicate file finder
- PDF and CSV export for scan reports
- Toast notification system with per-action navigation
- Task Manager-style context menu in the Process Inspector
- Detailed scan progress panel with live metrics, and expandable/dismissible scan results
- Privacy Mode: one Settings toggle that disables external lookups, AI context, history, and auto reports (locks the individual toggles while it's on)
- New color themes: Midnight, Rose, Monochrome, Bumblebee, Aurora
- Credential leak alerts now include the breached site's domain

### Improved
- Translation parity pass across all 15 locale files (14 languages plus English)
- Health score, quarantine reliability, and network monitor refinements
- Scan indicator, splash screen, and startup flow polish
- Duplicate finder rebuilt; system audits hardened and re-synced with i18n

### Security
- The browser extension no longer transmits your plaintext password to the desktop app - only the breach count and site domain
- Removed `-ExecutionPolicy Bypass` from PowerShell-based inspection consoles
- Stricter validation on the native messaging host's desktop app path
- Release pipeline hardening: SHA256 checksums, SBOM, and Rust build metadata

### Fixed
- Geo map markers now align correctly with the map graphic (previously could drift toward the wrong region at higher latitudes)
- Numerous smaller fixes across dashboard warnings, the process inspector, audit checks, scanner cancellation, firewall filters, and maintenance history

## [1.2.1] - 2026-07-11

### Added
- Network threat intelligence & world map
- Large Files Report deletion support
- Browser cache clearing
- Startup splash screen
- Process masquerade detection

### Improved
- Health Score improvements
- Child-process scanning improvements
- Password strength checker enhancements
- Process protection improvements

### Security
- Firewall Manager hardening

### Fixed
- Working quarantine restore
- Quarantine reliability improvements
- Network Monitor bug fixes
- Windows Update script fix

### Changed
- Platform availability notes