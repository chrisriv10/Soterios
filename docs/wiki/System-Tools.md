# System Tools

The **Tools & Maintenance** page provides built-in utilities for disk cleanup, startup inspection, and system reporting. All scripts run locally on your machine.

## Available tools

| Tool | Description |
|------|-------------|
| **Clear Temp Files** | Removes old files from Windows temp directories (default: older than 7 days). Supports dry-run preview. |
| **List Startup Items** | Read-only report of programs configured to run at login (registry and Startup folder). |
| **Disk Space Report** | Per-volume used/free space summary. |
| **Large Files Report** | Finds large files under your user profile. Can select files for deletion. |
| **Browser Cache Report** | Reports cache sizes for Chromium-based browsers. Includes option to clear cache. |
| **Windows Services Report** | Lists auto-start services; flags services running from unsigned paths. |

## Running a tool

1. Open **Tools & Maintenance**.
2. Select a tool card.
3. Review options (e.g., dry-run for temp cleanup).
4. Click **Run** and read the output panel.

## Safety notes

- **Clear Temp Files** defaults to dry-run — review the file list before confirming deletion.
- **Delete Selected Files** (from Large Files Report) permanently removes chosen files.
- **Clear Browser Cache** closes browser cache data — save work in open browser tabs first.

## Script architecture

Tools are defined in `src/scripts/registry.json` and executed in isolated child processes via `scriptRunner.js`. This keeps maintenance scripts separate from the main Electron process.
