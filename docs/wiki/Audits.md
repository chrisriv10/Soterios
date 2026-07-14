# System Audits

The **Windows Security Audit** page runs local checks against important Windows security settings. No data is sent to external servers.

## Checks performed

| Check | What it verifies |
|-------|------------------|
| **Windows Defender Antivirus** | Antivirus service enabled; reports engine and signature versions |
| **Real-Time Protection** | Defender RTP is active |
| **User Account Control (UAC)** | `EnableLUA` registry value is set |
| **Windows Updates** | Pending updates (0 pending = pass; any pending = warning) |
| **BitLocker** | Volume encryption status (informational on Home editions) |
| **PowerShell Execution Policy** | LocalMachine policy is Restricted, RemoteSigned, or AllSigned |
| **Secure Boot** | UEFI Secure Boot is enabled |

Checks run concurrently. Progress events update the UI as each completes.

## Result statuses

| Status | Meaning |
|--------|---------|
| **Pass** | Setting meets the recommended configuration |
| **Warn** | Setting is suboptimal but not critical |
| **Fail** | Setting fails the security check |
| **Info** | Informational (e.g., BitLocker unavailable on edition) |
| **Error** | Check could not complete (permissions, cmdlet failure) |

## Ignoring warnings

Audit warnings appear on the Dashboard alongside other security warnings. You can:

- **Ignore** a warning if you accept the risk (stored locally).
- **Restore** an ignored warning to show it again.

Ignored audit warnings use IDs prefixed with `audit:`.

## Running an audit

1. Open **Windows Security Audit** from the sidebar.
2. Click **Run Audit**.
3. Review each check and follow Windows guidance to fix failures.

Re-run the audit after making system changes to confirm improvements.
