# Soterios Wiki

Version-controlled wiki source for [Soterios](https://github.com/chrisriv10/Soterios). These pages mirror the [GitHub Wiki](https://github.com/chrisriv10/Soterios/wiki) and can be synced by maintainers.

## User guides

- [Installation](Installation.md) — requirements, download, update, uninstall
- [Dashboard](Dashboard.md) — health score, status cards, workflow
- [Malware Scanning](Scanning.md) — scan types, scheduling, reports, cancellation
- [Quarantine](Quarantine.md) — restore, delete, bulk actions
- [System Audits](Audits.md) — Windows security checks
- [System Tools](System-Tools.md) — maintenance utilities
- [Process and Network Monitoring](Process-and-Network-Monitoring.md) — processes, connections, firewall
- [Password Security](Password-Security.md) — generator, strength checker, breach checks
- [Browser Extension](Browser-Extension.md) — local-first credential and phishing protection with explicit online-service controls

## Privacy and support

- [Privacy and Security](Privacy-and-Security.md) — local-first model, external services, data paths
- [Troubleshooting](Troubleshooting.md) — common issues and FAQ
- [Glossary](Glossary.md) — security and app terminology

## Developer documentation

- [Development Guide](Development.md) — setup, architecture, contributing

## Syncing to GitHub Wiki

Maintainers can sync pages to the wiki git repository with the repository helper (it also converts relative links to GitHub Wiki page URLs):

```bash
npm run sync-wiki
```

For a manual copy, run `node tools/convert-wiki-links.js Soterios.wiki` after copying the Markdown files and before committing.

GitHub Wiki uses page names without the `.md` extension in links (e.g., `[Installation](Installation)`).

