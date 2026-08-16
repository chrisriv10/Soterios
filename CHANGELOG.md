# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Native process inspector with a Rust helper binary and risk scoring
- Browser extension 2.0 with signed threat feed (CERT Polska + URLhaus)
- Tool run manager with cancel and live progress
- Maintenance safety vault
- Persistence monitor
- Audit page management actions and expanded system checks
- Traffic history range selection and adaptive geo activity map
- Firewall perimeter activity radar

### Improved
- Translation parity pass across all 14 locales

### Security
- Release pipeline hardening: SHA256 checksums, SBOM, and Rust metadata

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
