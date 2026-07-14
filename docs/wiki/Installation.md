# Installation

Soterios is currently available for **Windows**. macOS and Linux builds are planned for future releases.

## System requirements

| Requirement | Details |
|-------------|---------|
| OS | Windows 10 or later (64-bit) |
| Privileges | Administrator (required for system-level security checks) |
| Disk space | ~500 MB for the app and ClamAV definitions |
| Network | Optional — only needed for definition updates and breach-check features |

## Download

1. Open the [latest release](https://github.com/chrisriv10/Soterios/releases/latest) on GitHub.
2. Download `Soterios-Setup-<version>.exe`.
3. Run the installer and follow the NSIS setup wizard.

The installer supports choosing an install directory and creates Start Menu and desktop shortcuts.

## First launch

After installation:

1. Launch **Soterios** from the Start Menu or desktop shortcut.
2. Allow administrator elevation when prompted — many audit and firewall features require it.
3. Open the **Dashboard** and review your security health score.
4. Run a **Quick Scan** to establish a baseline.
5. Update **ClamAV definitions** from the Dashboard if they are outdated.

## Updating

1. Download the latest installer from GitHub Releases.
2. Run the new installer over your existing installation.
3. Your settings, scan history, and quarantine records are preserved in `%APPDATA%\Soterios\`.

## Uninstalling

1. Open **Settings → Apps → Installed apps** (or **Add/Remove Programs**).
2. Select **Soterios** and uninstall.
3. Optional cleanup:
   - User data: `%APPDATA%\Soterios\`
   - Quarantine folder: `%USERPROFILE%\.soterios-quarantine\`
   - Scan reports: `%USERPROFILE%\.soterios\`

Removing these folders deletes local scan history and quarantined files permanently.
