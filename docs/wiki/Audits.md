# System Audits

The **Windows Security Audit** page runs local checks against important Windows security settings. No data is sent to external servers.

## Checks performed

Results are grouped into four sections.

### Antivirus & Protection

| Check | What it verifies |
|-------|------------------|
| **Windows Defender Antivirus** | Antivirus service enabled; reports engine and signature versions |
| **Real-Time Protection** | Defender RTP is active |
| **Tamper Protection** | Defender protections cannot be disabled by malware |
| **Cloud-delivered Protection** | Cloud-delivered/automatic sample submission is on |
| **Network Protection** | Malicious connections and phishing sites are blocked |

### System Security

| Check | What it verifies |
|-------|------------------|
| **User Account Control (UAC)** | `EnableLUA` registry value is set |
| **BitLocker** | Volume encryption status (informational on Home editions) |
| **Secure Boot** | UEFI Secure Boot is enabled |
| **LSA Protection** | Credential-dumping tools cannot read LSA memory (`RunAsPPL`) |
| **SMBv1** | Legacy SMBv1 protocol with known wormable vulnerabilities is disabled |
| **Remote Desktop** | RDP is off, or on with Network Level Authentication |

### Accounts & Access

| Check | What it verifies |
|-------|------------------|
| **Automatic Logon** | No stored plaintext credentials; no unattended sign-in |
| **Password Policy** | Minimum length, lockout threshold, and complexity requirements |
| **Guest Account** | Local Guest account is disabled |

### Updates & Policies

| Check | What it verifies |
|-------|------------------|
| **Windows Updates** | Pending updates (0 pending = pass; any pending = warning) |
| **PowerShell Execution Policy** | LocalMachine policy is Restricted, RemoteSigned, or AllSigned |

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
