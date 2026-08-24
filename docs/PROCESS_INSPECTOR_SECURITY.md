# Process Inspector security and privacy model

## Privilege boundary

The Electron renderer receives only the narrow preload API. IPC validates object shapes, lengths, action names, paths, sections, and process keys. The Rust helper runs as the current user by default and is neither a service nor a driver. Operations that Windows denies return structured errors. No persistent elevated component is installed.

Before an action, both the main process and helper revalidate PID plus creation time. Soterios denies PID 0/4, core protected names, its own process, and unsafe Explorer operations. Launches use an executable and argument array with `shell: false`; paths and arguments are never interpolated into a command shell.

## Data handling

Live process history is held in RAM for 15 minutes. Nothing is transmitted automatically. File logging is disabled unless explicitly enabled by the user. Action audit entries contain action, PID, duration, and sanitized errors—not paths or command lines.

Manual encrypted traces use Argon2id and AES-256-GCM. Portable exports warn about sensitive fields and default to strict redaction. Diagnostic bundles contain no process records.

VirusTotal integration is explicit, hash-only, rate-limited, cached for seven days, and disabled by Privacy Mode. Its API key is encrypted with Windows-backed secure storage.

## Rule methodology

The readable JavaScript rules produce versioned score, severity, confidence, evidence, and freshness. Trust is scoped evidence, not an allowlist bypass. Critical identity, lineage, signature, behavior, and malicious-reputation findings are never suppressed by trust.

## Driverless limitations

Protected-process access, named-handle enumeration, Wait Chain Traversal, ETW deep capture, GPU accounting, and command-line access can be unavailable. The capability model reports these limitations explicitly. Soterios does not use undocumented kernel hooks or claim unavailable observations are clean.
