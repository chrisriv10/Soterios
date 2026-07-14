# Malware Scanning

Soterios uses **ClamAV** for local malware scanning. All scan logic runs on your machine — files are not uploaded to a cloud service.

## Scan types

| Type | Scope |
|------|-------|
| **Quick Scan** | High-risk locations: temp folders, Prefetch, Startup folder |
| **Full Scan** | Entire `C:\` drive |
| **Custom Scan** | Folder(s) you select via the file picker |

## Running a scan

1. Open **Malware Scan** from the sidebar.
2. Choose Quick, Full, or Custom.
3. Watch progress in the scan panel — files scanned, threats found, and elapsed time update live.
4. When complete, review the summary and any detected threats.

Detected threats are **automatically quarantined** unless you configure otherwise.

## Cancelling a scan

Click **Cancel Scan** during an active scan. Soterios stops the ClamAV process and marks the run as `canceled`. Partial results are not saved as a completed report.

## Definition updates

Outdated definitions reduce detection quality. Update from:

- **Dashboard → ClamAV Definitions → Update**, or
- **Malware Scan** page before starting a scan.

Updates download via `freshclam` and require a network connection.

## Scan scheduling

The scanner supports scheduled runs:

- Intervals: every 6 hours, 12 hours, 24 hours, 3 days, or 7 days
- Types: Quick, Full, or Custom (with saved path)

Enable scheduling from the Malware Scan page. Scheduled scans require Soterios to be running.

## Scan reports

Completed scans generate reports when **Scan History** is enabled in Settings:

- Stored locally as JSON and HTML in `~/.soterios/scan-reports/`
- Indexed in the local SQLite database
- Viewable and deletable from the **Reports** page

Report statuses: `completed`, `canceled`, or `failed`.
