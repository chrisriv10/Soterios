# Process and Network Monitoring

## Process Inspector

The Process Inspector is local-only and has two persistent views over one shared data model.

- **Simple** groups application instances and explains resource use and security findings in plain language.
- **Technical** shows a virtualized process tree with stable selection, sorting, filtering, lineage, identity, owner, integrity, architecture, protection level, CPU user/kernel time, memory, I/O, handles, threads, priority, affinity, and efficiency status when Windows makes those facts available.

The bundled Rust/MSVC helper uses documented Windows APIs and communicates with the main process over bounded, versioned stdin/stdout frames. It is an ordinary child process, not a service or driver. If it is missing or fails integrity verification, Soterios enters a clearly labeled compatibility mode and displays unavailable counters as **N/A**, never as zero.

### Live data and privacy

- The default refresh interval is one second. A full snapshot is followed by process deltas, preserving selection, expansion, filters, and scroll position.
- Process identity is `{ PID, creation time }`, preventing actions from targeting a different process after PID reuse.
- Performance history remains in RAM for at most 15 minutes. Exited history ages out with the same limit.
- Soterios does not persist process events or upload process data.
- A trace is written only after an explicit Save action. Encrypted traces use AES-256-GCM with an Argon2id-derived passphrase key. Portable JSON exports default to strict redaction.
- The diagnostic exporter contains versions, capabilities, sanitized errors, and collector timing only. It excludes process names, paths, command lines, users, and connections.

### Assessments

Results use **No concerns detected**, **Unverified**, **Review recommended**, and **High concern**. “No concerns detected” is not a safety guarantee. Each result includes a score, confidence, evidence, rule version, and evaluation time.

Rules cover unusual locations, system-process masquerading, suspicious parent/child chains, encoded PowerShell and LOLBin arguments, invalid signatures, and reputation evidence. A trusted hash or publisher can reduce low-confidence static findings, but it cannot suppress critical identity, invalid-signature, lineage, or active-behavior evidence.

### Actions

Soterios re-reads the target creation time immediately before every action. Protected processes and Soterios itself are denied. Technical actions carry impact-specific confirmation.

Available actions include terminate, restart, suspend, resume, priority, affinity, efficiency mode, and user-mode dumps. Availability depends on the Windows version, target protection level, and access rights. Run Task accepts a structured executable and argument array and never invokes a command shell.

### Optional reputation

Online reputation is off by default and runs only when the user clicks **Check hash reputation**. It sends only the executable SHA-256 to the VirusTotal file-report endpoint. Files, paths, commands, usernames, addresses, and system details are never sent. The user supplies the API key, which is protected with Electron/Windows secure storage. Results are cached locally for seven days. Privacy Mode disables the feature completely.

### Capability boundaries

The current driverless release exposes module and thread enumeration and handle counts. Named-handle search, Windows Wait Chain Traversal, and ETW deep-inspection capture remain capability-gated and are reported as unavailable; Soterios never fabricates partial results. No quarantine, kill-tree, permanent network blocking, kernel driver, or automatic containment is included.

See [Process Inspector protocol](../PROCESS_INSPECTOR_PROTOCOL.md) and [security and privacy model](../PROCESS_INSPECTOR_SECURITY.md).

---

## Network Monitor

The Network Monitor shows active TCP connections and interface statistics, including local/remote endpoints, owning process when resolvable, reverse DNS, service names, and evidence-based classification. Basic scoring requires no API key. Optional geolocation and the Network Perimeter Map are controlled in Settings.

The Firewall page shows Windows Firewall profiles and manages only rules created by Soterios with the `Soterios - ` prefix.
