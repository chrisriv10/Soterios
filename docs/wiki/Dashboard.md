# Dashboard

The Dashboard is the home screen for Soterios. It summarizes your system security posture and provides shortcuts to common actions.

## Security health score

The health score (0–100) reflects several local factors:

| Factor | Weight |
|--------|--------|
| Malware scan results | 30 |
| Scan recency | 10 |
| Disk space | 15 |
| Memory pressure | 10 |
| CPU load | 10 |
| System uptime | 5 |
| Real-time protection | 15 |
| Firewall status | 15 |

Click the score card to open a breakdown of each category.

## Status cards

- **Real-Time Protection** — Toggle Windows Defender real-time monitoring. Soterios verifies the change took effect (Tamper Protection can block changes).
- **Windows Firewall** — Shows whether the firewall is active with a link to the Firewall page.
- **Last Scan** — Date and result of your most recent scan, with Quick Scan and Full Scan shortcuts.
- **ClamAV Definitions** — Age of virus definitions and an **Update** button.
- **Threats Blocked** — Count of files currently in quarantine.
- **Warnings / Ignored Warnings** — Security recommendations from the overview engine. You can ignore or restore individual warnings.

## Recommended workflow

1. Check the health score and address any warnings.
2. Ensure ClamAV definitions are current.
3. Confirm real-time protection and firewall status.
4. Run a scan if none has been completed recently.
