# Privacy and Security

Soterios is built around a **local-first** model: your system data stays on your machine unless you explicitly use a feature that requires network access.

## What stays local

- Malware scanning (ClamAV)
- System audits and firewall inspection
- Process and network monitoring
- Maintenance scripts and disk reports
- Password generation and strength analysis
- Scan reports, quarantine records, and settings (SQLite database)

Default Electron startup disables background networking.

## What Soterios does not collect

- Usage analytics or telemetry
- Crash reporting to third parties
- Automatic upload of scan results or system information

## External services (opt-in by use)

| Feature | Service | When it runs |
|---------|---------|--------------|
| Virus definition updates | ClamAV / freshclam | When you click Update |
| Password breach check | Have I Been Pwned | When you run a breach check |
| Email breach check | XposedOrNot | When you run an email check |
| Connection geolocation | Geo lookup service | When geo map is enabled and Network page is open |

Disable breach checks and geo lookup in **Settings** to keep the app fully offline after definitions are current.

## Data storage locations

| Data | Location |
|------|----------|
| Settings and history | `%APPDATA%\Soterios\soterios.db` |
| Quarantine files | `%USERPROFILE%\.soterios-quarantine\` |
| Scan reports | `%USERPROFILE%\.soterios\scan-reports\` |
| Security reports | `%USERPROFILE%\.soterios\reports\` |

Override the app data directory with the `SOTERIOS_USERDATA` environment variable.

## Security model

- **Context isolation** — Renderer runs with `contextBridge` preload; no direct Node.js access from UI.
- **IPC validation** — Main process handles privileged operations.
- **Quarantine obfuscation** — Prevents accidental execution of isolated files (not a substitute for encryption at rest).
- **Process kill guards** — Blocks termination of critical system processes.

Report security vulnerabilities privately — see `SECURITY.md` in the repository.
