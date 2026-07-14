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

## Privacy and support

- [Privacy and Security](Privacy-and-Security.md) — local-first model, external services, data paths
- [Troubleshooting](Troubleshooting.md) — common issues and FAQ
- [Glossary](Glossary.md) — security and app terminology

## Developer documentation

- [Development Guide](Development.md) — setup, architecture, contributing

## Syncing to GitHub Wiki

Maintainers can copy pages to the wiki git repository:

```bash
git clone https://github.com/chrisriv10/Soterios.wiki.git
cp docs/wiki/*.md Soterios.wiki/
# Rename Home.md if using as wiki home page
git commit -am "Sync wiki from docs/wiki"
git push
```

GitHub Wiki uses page names without the `.md` extension in links (e.g., `[Installation](Installation)`).
