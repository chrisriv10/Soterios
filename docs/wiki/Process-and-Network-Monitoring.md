# Process and Network Monitoring

## Process Inspector

The **Processes** page lists running processes with risk scoring and resource usage.

### Sorting and filters

- Default sort: **risk score** (highest first), then **CPU + memory** within the same risk level.
- Filter by risk level or search by process name, path, or PID.
- Auto-refreshes every 3 seconds.

### Risk signals

The risk engine flags processes that show suspicious patterns:

- Running from `%AppData%`, `%Temp%`, or other user-writable paths
- Double file extensions (e.g., `document.pdf.exe`)
- Names mimicking system processes
- Encoded PowerShell command lines
- Known LOLBins (mshta, regsvr32, certutil, bitsadmin, etc.)
- Executables on UNC or non-system drives

### Ending a process

Select a process and click **Kill Process**. Soterios blocks termination of protected system processes (System, csrss.exe, lsass.exe, and others).

---

## Network Monitor

The **Network Monitor** page shows active TCP connections and interface statistics.

### Connection details

Each connection can display:

- Local and remote addresses and ports
- Associated process name
- Reverse DNS hostname (when resolvable)
- Service name for well-known ports
- Risk classification: **Safe**, **Unknown**, or **Malicious**

Classification uses private IP detection, blocklist membership, and port/hostname heuristics. No API keys are required for basic scoring.

### Interface statistics

Per-network-interface receive/transmit rates and totals (via system information APIs).

### Optional features

Enable in **Settings**:

- **Geo Lookup** — Adds geolocation context to connections (requires network).
- **Network Perimeter Map** — Visual heat map of connection destinations.

### Firewall page

The **Firewall** page complements network monitoring with:

- Windows Firewall profile status (Domain, Private, Public)
- Rule summaries
- Management of Soterios-created rules (prefixed `Soterios - `)

Auto-refreshes every 3 seconds when the page is open.
