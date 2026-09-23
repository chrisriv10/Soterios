# Startup Impact Measurement Investigation

## Status

- Date: 2026-09-23
- Issue: [#123](https://github.com/chrisriv10/Soterios/issues/123) — "Investigate reliable startup impact metrics for startup applications"
- Scope: research and design only. No production code, UI, telemetry, or monitoring was added in this investigation.
- Outcome: **C — No defensible supported per-entry metric exists for ordinary Soterios operation** (see Conclusion).

## Executive Summary

Soterios should **not** display Low/Medium/High startup-impact ratings today. Microsoft documents what Task Manager's Startup impact *means* (CPU time and disk I/O consumed by each startup app, with explicit thresholds), but this investigation found no supported public API exposing that measurement for ordinary Soterios operation. The underlying data lives in undocumented per-boot trace artifacts (`Bootckcl.etl` confirmed absent here; the `WDI\LogFiles` directory itself is access-denied in the tested session), the Diagnostics-Performance event log denied read access in the tested session, and every live-queryable alternative (process timestamps, cumulative CPU/I/O counters, `Win32_StartupCommand`) measures registration or wall-clock facts — never causal boot-path delay. A defensible rating would additionally require stable attribution from measurement back to Soterios's persistence entries (Run values, `.lnk` files, tasks, services), which breaks on wrapper launchers, script hosts, and child processes. The honest product surface is **Unknown or no impact column**. A separate opt-in boot-trace workflow (WPR/ETW, reboot, elevation, ADK analysis tooling) is the only evidence-backed future path and is sketched below without being implemented.

## Existing Soterios Startup Model

`src/tools/startupPersistence.js` (tool id `startup-persistence-scan`) enumerates four persistence sources via `src/security/windowsChecks.js` PowerShell collectors:

| Source | Identifier fields available |
|---|---|
| Registry Run / RunOnce (HKCU/HKLM, incl. WOW6432Node) | value name, raw command string, registry key location; `path` is null |
| Startup folders (per-user + ProgramData) | `.lnk` file path (name + folder location) |
| Scheduled tasks (non-disabled, first action only) | task name, task path, `Execute + Arguments` command, executable path, state |
| Windows services (Auto start or Running) | display/service name, `PathName` command, parsed executable path, start mode, state |

Enrichment adds Authenticode signature data and a security-risk score (`buildSignals`). There is deliberately **no performance measurement** anywhere in this pipeline: it answers "what is configured to launch," never "what did it cost."

Related infrastructure that does *not* solve the problem: `src/main/processService.js` samples live processes (no boot history; processes that exited before Soterios started are invisible, and services predate any logon-time observation); Process History (#122) records lifecycles from first observation, not boot causality; `src/tools/systemMonitor.js` reports instantaneous CPU/memory/disk, not historical per-process boot cost.

## What "Startup Impact" Means

These are distinct, non-interchangeable concepts:

- **Startup registration** — whether an app is configured to launch. (What Soterios and `Win32_StartupCommand` enumerate.)
- **Launch timing** — when a process started relative to boot/logon (e.g. `Win32_Process.CreationDate`). A timestamp, not a cost.
- **Startup duration** — how long an app took to initialize, if measurable. Requires observing start *and* ready states.
- **CPU consumption** — CPU time burned in a defined window. Cumulative process CPU time is lifetime total, not boot-window cost.
- **Disk I/O** — bytes read/written in a defined window. Same windowing problem.
- **Boot/logon critical-path delay** — how much the app actually delayed a usable desktop. The only true "impact"; requires causal analysis, not counters.
- **Task Manager "Startup impact"** — Microsoft's documented category: CPU time and disk I/O consumed by each startup app during startup, bucketed Low/Medium/High. The *definition* is public; the *per-app measurement feed* is not exposed as an API.

A process starting early does not prove it slowed boot. A large executable does not prove high impact. High post-login CPU does not prove logon delay. Any rating that conflates these is a guess, not a measurement.

## Requirements for a Defensible Metric

A Low/Medium/High rating is viable only with all of: (1) a measurable quantity, (2) documented repeatable acquisition, (3) a defined measurement window, (4) stable entry→measurement mapping, (5) hardware-independent (or normalized) interpretation, (6) documented or defensibly calibrated thresholds, (7) repeatability across boots, (8) no fabricated attribution. No candidate below satisfies all eight for ordinary operation.

## Candidate Data Sources

### Win32_StartupCommand
Provides: `Name`, `Command`, `Location`, `User` (+ `Caption`, `Description`, `SettingID`, `UserSID`) — registration data from Run keys and startup folders. Provides no duration, CPU, I/O, score, or timestamp fields (verified against the documented MOF in MicrosoftDocs/win32). Readable without elevation in the probed configuration (the class MOF does declare a restore-privilege requirement, so this is not proven for every configuration); live probe returned 17 entries on the development machine. Verdict: registration enumerator, **not a performance source**. (Soterios additionally covers scheduled tasks and services, though `Win32_StartupCommand` documents some locations Soterios does not read, such as legacy RunServices keys.)

### Boot-related WMI/CIM
`Win32_BootConfiguration` describes boot configuration (scratch directory), not performance. No documented WMI/CIM class identified in this investigation exposes per-application boot cost; `Win32_Process` exposes only live-process properties. Verdict: **no per-entry metric exists** in this family.

### Process creation timestamps
`Win32_Process.CreationDate` (and Soterios's own `startedAt` identity) is trivially readable and gives launch order. It does not measure cost; processes that exited before Soterios started are invisible; services predate logon; launchers spawn children whose cost belongs ambiguously to the parent. Verdict: **timing fact, not impact** — cannot support a rating alone.

### CPU / I/O counters
Cumulative per-process CPU time and I/O counters (`Win32_Process`, `GetProcessTimes`, `GetProcessIoCounters`) describe lifetime totals. An open handle can outlive its process, but Soterios retains neither handles nor counter history across the boot window, so it cannot reconstruct that window after the fact; counters also cannot isolate logon initialization from later activity. Disk activity alone does not establish critical-path delay. Verdict: **counters without a window are not impact**.

### Windows Diagnostics-Performance Event Log
`Microsoft-Windows-Diagnostics-Performance/Operational` event 100 records aggregate boot duration and degradation signals — a whole-boot verdict, not per-application attribution, and its detailed payload schema is not officially documented as a stable contract. On the investigated machine, a non-elevated read was denied (`UnauthorizedAccessException`). Regardless of access configuration, the source remains unsuitable for a routine per-entry metric because it provides aggregate boot information and lacks a documented stable per-application schema. Verdict: **unsuitable** (aggregate-only, undocumented schema, access denied in the tested session).

### ETW
The kernel logger and provider model (usually capped at 64 simultaneous non-private sessions, plus the Global/NT Kernel Logger specials; private loggers are separate) can in principle capture process, disk-I/O, and scheduling data. But: a useful measurement requires tracing *during* boot/logon, i.e. before Soterios itself is running; kernel-provider sessions require elevated controllers with explicit profile grants (`SystemTraceProvider`); continuous tracing costs non-paged pool, disk, and analysis complexity. Soterios starting after login cannot retroactively observe the boot window. Verdict: **technically expressive, operationally unsuitable** for passive monitoring — viable only inside an explicit opt-in trace workflow.

### Windows Performance Recorder (boot scenarios)
`wpr.exe` ships inbox (confirmed present, v10.0.26100) and supports boot-scenario recording (autologger configuration, reboot, then merge; on/off-transition scenarios are a separate documented option set). However: boot tracing requires a reboot cycle, elevated privileges, unbounded file-mode growth risk, and analysis via WPA, which requires a separate Windows ADK install. Verdict: **the correct heavyweight tool, wrong shape for automatic consumer monitoring**; suitable only as an explicit user-driven diagnostic.

### WPA / xperf
WPA is analysis software for ETL files, not a data API; it requires ADK installation. Xperf remains supported for *collection* (per current Microsoft support material) with Xperfview dead — so neither deprecation nor availability changes the conclusion: both demand traces that do not exist yet. Verdict: **analysis layer only**.

### Task Manager Startup Impact
Microsoft documents the *meaning and thresholds* (Compatibility Cookbook, "Desktop Startup apps"): impact is CPU + disk usage at startup; High is >1s CPU or >3MB disk I/O; Medium is 300ms–1s CPU or 300KB–3MB disk; Low is <300ms CPU and <300KB disk; ADK boot assessment is the developer-facing measurement path. Critically, **this investigation identified no supported public API exposing the per-app values**. Community sources attribute the data to per-boot WDI traces (`System32\WDI\LogFiles\Bootckcl.etl` plus per-user `StartupInfo\<SID>_StartupInfoN.xml`); on the investigated machine `Bootckcl.etl` is confirmed absent while the `WDI\LogFiles` directory itself (including any `StartupInfo` contents) is access-denied without elevation, and in any case these are undocumented implementation files, not a stable contract — Task Manager coverage is also limited to Run/RunOnce/startup-folder apps, a strict subset of Soterios's four-source model (tasks, services excluded). Verdict: **definition public, feed private** — not consumable.

### Packaged StartupTask APIs
`Windows.ApplicationModel.StartupTask` / manifest `desktop:StartupTask` provide registration and enablement for packaged apps. No performance surface exists. Verdict: **registration only**.

## Attribution Challenges

Even a perfect per-process boot measurement would still need mapping onto Soterios entries, and the mapping is unreliable: Run values like `"...\Steam\steam.exe" -silent` spawn helpers/services whose cost lands on children; scheduled tasks routinely invoke `powershell.exe`, `cmd.exe`, `rundll32`, or script hosts shared by dozens of unrelated tasks; services spawn workers under generic hosts; `.lnk` targets resolve indirectly. Live probe illustration: this machine's 17 startup commands include game-platform launchers with `-silent`/`--autostarted` flags whose real cost lives in child processes. Any aggregate score would hide — not resolve — this ambiguity.

## Boot vs Logon Phases

System boot (kernel/services), user logon (Explorer/shell), Run-key app launch, delayed tasks, and post-login background activity are distinct phases with distinct measurement requirements. Services predate Soterios's earliest possible observation; Run-key apps race the shell; Fast Startup (enabled on the investigated machine, `HiberbootEnabled=1`) replaces cold boots with hybrid resume, invalidating naive boot-to-boot comparisons. A single per-entry number spanning these phases has no coherent definition.

## Privilege and Tooling Requirements

| Approach | Privilege | Tooling |
|---|---|---|
| `Win32_StartupCommand`, process timestamps/counters | Standard user | None (already used patterns) |
| Diagnostics-Performance log reads | **Read denied in the tested session** (proven live; elevation not attempted) | None |
| WDI trace artifacts | Read access where present (`Bootckcl.etl` absent here; `LogFiles` access-denied) | None, but undocumented |
| ETW kernel/boot tracing | **Elevated controller** + profile grants | Inbox APIs, complex session lifecycle |
| WPR boot recording | **Elevated privileges** + reboot | Inbox `wpr.exe`; WPA needs ADK install |
| Task Manager feed | N/A (no API) | N/A |

Soterios must not silently elevate for a cosmetic rating; elevation here would buy, at best, aggregate boot data with no per-entry attribution.

## Hardware / Run-to-Run Variability

CPU, storage speed, RAM, cache state, antivirus activity, updates, power state, background load, network, account profile, launch ordering, cold vs Fast-Startup resume, and first-run-after-update effects all move any raw timing. Without a normalization model — which Microsoft does not publish — a millisecond count cannot transfer between machines, defeating fixed thresholds further.

## Approaches Rejected as Heuristics

Executable size, framework/runtime (Electron/Java/Python/.NET), child-process counts, DLL counts, signature status, install location, current memory/CPU/disk use, process counts, delayed-start flags, service start types, and command-line complexity may correlate with startup work in isolated cases, but none is sufficient, normalized, or calibrated to measure boot-path delay — and *current* resource use measures the present, not the boot window. All are rejected as MEASUREMENT-substitutes: at best weak proxies, more honestly guesses for rating purposes.

## Comparative Matrix

| Source | Measures | Historical? | Per-process? | Maps to entry? | Std user? | Prior monitoring? | Extra tooling? | Documented/stable? | Suitable? |
|---|---|---|---|---|---|---|---|---|---|
| `Win32_StartupCommand` | Registration | N/A | N/A | Yes (subset) | Yes | No | No | Yes | No (not perf) |
| Boot WMI classes | Config | No | No | No | Yes | No | No | Yes | No |
| Process timestamps | Launch order | Partially | Yes | Ambiguous | Yes | No | No | Yes | No |
| CPU/I/O counters | Lifetime totals | No | Live only | Ambiguous | Yes | **Yes (required)** | No | Yes | No |
| Diagnostics-Performance log | Whole-boot verdict | Yes | No | No | **No (denied in tested session)** | No | No | Schema undocumented | No |
| ETW (passive) | Nothing retroactively | No | — | — | No | **Yes** | Complex | Yes | No |
| WPR boot trace | Full boot resource profile | Via reboot | Yes | Partially | No (elevated+reboot) | **Yes (trace first)** | ADK for WPA | Yes | Only as opt-in diagnostic |
| WPA/xperf | Analysis of ETL | Via trace | Yes | Partially | — | Via trace | ADK install | Yes | Analysis only |
| Task Manager feed | Per-app CPU+disk at startup | Via WDI files | Yes | Run-key subset | Dir access-denied here | No (OS traces) | No | **Undocumented** | No |
| Packaged StartupTask | Registration | N/A | N/A | Packaged only | Yes | No | No | Yes | No |
| Heuristics | Nothing causal | No | — | No | Yes | No | No | N/A | **Rejected** |

## Local Windows Validation

Read-only probes on one development machine (no elevation, no mutations): `Win32_StartupCommand` returned 17 entries (registration fields only); `Win32_Process.CreationDate` readable; `Bootckcl.etl` confirmed absent while `WDI\LogFiles` (including any per-user `StartupInfo` data) is access-denied without elevation; Diagnostics-Performance Operational log read **denied** (`UnauthorizedAccessException`); `wpr.exe` v10.0.26100 present inbox, `xperf`/`wpa` absent (ADK required); Fast Startup enabled (`HiberbootEnabled=1`). No reboots, tracing, installs, or mutations performed. Machine/user identifiers redacted.

## Conclusion

**C — No defensible supported per-entry metric exists for ordinary Soterios operation.** Task Manager documents a per-app CPU/disk startup-impact classification, but this investigation found no supported public API exposing those per-app values for ordinary Soterios operation. Microsoft's documented ADK/WPR/WPA tooling can measure startup performance through explicit trace/assessment workflows instead — but that tooling is not equivalent to a passive runtime API. The closest on-disk artifacts are undocumented (`Bootckcl.etl` absent here; `WDI\LogFiles` access-denied); the event log was inaccessible in the tested non-elevated session, while its documented/useful surface remains aggregate rather than a supported per-entry metric; live counters cannot reconstruct the boot window; and attribution from any measurement back to Soterios's four persistence sources is unreliable by construction.

## Product Recommendation

Keep startup impact as **Unknown** (or omit any impact column): do not display Low/Medium/High. Do not invent thresholds. If Soterios ever shows per-entry timing, label it exactly for what it is (e.g. "first observed running at …", never "impact"). A separate opt-in diagnostic trace workflow may be proposed as future advanced functionality, never as silent background monitoring.

## Future Implementation Path

Only the opt-in WPR/ETW trace workflow is evidence-backed, and only as a future proposal: (1) user explicitly starts a diagnostic capture with a plain-language explanation; (2) reboot/logoff as required by the scenario; (3) trace analyzed locally after the fact; (4) per-process CPU/I/O mapped back to startup entries where unambiguous, Unknown elsewhere; (5) traces deleted or retained only with consent. Requires: elevation disclosure, ADK/WPA availability handling, multi-GB trace-size guards, local-only processing, cleanup guarantees, failure modes for unattributable entries. Privacy: traces embed paths, command lines, usernames, file and process activity — local-only by default, never uploaded, never telemetry. Security: no shell-constructed trace commands with user paths, safe ETL temp handling, no privileged tracing without explicit consent.

Suggested follow-up issue (not created): `Design an opt-in Windows boot trace workflow for startup performance analysis`.

## References

Accessed 2026-09-23. Preference given to Microsoft Learn/official docs; community sources marked [S] for secondary:

- Microsoft Learn, "Desktop Startup apps — Compatibility Cookbook" (impact definition + High/Medium/Low thresholds; ADK assessment path): https://learn.microsoft.com/en-us/windows/compatibility/startup-apps
- Microsoft Learn, "Delivering a great startup and shutdown experience" (Fast Startup, boot-path guidance): https://learn.microsoft.com/en-us/windows-hardware/test/weg/delivering-a-great-startup-and-shutdown-experience
- Microsoft Learn, "Windows Performance Recorder" / "Introduction to WPR" (inbox wpr.exe, ADK inclusion, profiles): https://learn.microsoft.com/en-us/windows-hardware/test/wpt/windows-performance-recorder
- Microsoft Learn, "Introduction to WPR" (WPR extends ETW with recording profiles; trace/analysis tooling, not a passive per-app API): https://learn.microsoft.com/en-us/windows-hardware/test/wpt/introduction-to-wpr
- Microsoft Learn, "WPR Command-Line Options" (`-addboot`/`-startboot`, on/off scenarios): https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpr-command-line-options
- Microsoft Learn, "Windows Performance Toolkit" (WPR+WPA composition; Xperf collection still supported, Xperfview dead): https://learn.microsoft.com/en-us/windows-hardware/test/wpt
- Microsoft Learn, "Event Tracing Sessions" (64-session cap; Global/NT Kernel Logger specials): https://learn.microsoft.com/en-us/windows/win32/etw/event-tracing-sessions
- MicrosoftDocs/win32 (GitHub), `SystemTraceProvider` doc (third-party kernel-provider use requires profile privilege grants): https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/ETW/configuring-and-starting-a-systemtraceprovider-session.md
- MicrosoftDocs/win32 (GitHub), `win32-startupcommand.md` (MOF: 8 registration fields, no perf): https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/CIMWin32Prov/win32-startupcommand.md
- Microsoft Learn, `desktop:StartupTask` schema (registration/enablement only): https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-startuptask
- Microsoft Learn, "Operating System Classes" (class catalog incl. `Win32_StartupCommand`, `Win32_Process`): https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/operating-system-classes
- [S] Winhelponline, "What is Startup Impact in Task Manager and How is it Calculated?" (WDI `Bootckcl.etl` + per-user `StartupInfo\<SID>_StartupInfoN.xml` attribution; used only as a lead, verified locally absent): https://www.winhelponline.com/blog/task-manager-startup-impact-calculated-bootckcl
- [S] Microsoft Q&A threads on Diagnostics-Performance event 100 (aggregate boot-duration semantics; corroborates no per-app contract): https://learn.microsoft.com/en-us/answers/questions/2487535/source-microsoft-windows-diagnostics-performance-i
