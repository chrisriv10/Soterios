# Quarantine Management

When a scan detects malware, Soterios moves the file to a local quarantine vault instead of leaving it in place.

## What happens during quarantine

1. The file is read and hashed (SHA-256).
2. Contents are obfuscated with a lightweight XOR transform to prevent accidental execution.
3. The encrypted copy is stored in `%USERPROFILE%\.soterios-quarantine\`.
4. A record is written to the local database (original path, hash, engine, threat name, reason).
5. The original file is removed from its location.

Quarantine is **not** cryptographic encryption — it prevents double-click execution while keeping restore possible.

## Viewing quarantined files

Open **Quarantine** from the sidebar. Each entry shows:

- Original file path
- Threat name and detection engine
- Quarantine date
- File hash

## Restoring a file

1. Select the entry in the Quarantine list.
2. Click **Restore**.
3. Soterios decrypts the file and writes it back to the original path.

Restore fails if a file already exists at the original location. Delete or rename the conflicting file first.

## Permanently deleting

1. Select one or more entries.
2. Click **Delete** (or use **Delete All** for bulk removal).

This removes both the encrypted quarantine file and the database record. The action cannot be undone.

## Bulk actions

- **Restore All** — Attempts to restore every quarantined item.
- **Delete All** — Permanently removes all quarantined items.

Review the list carefully before using bulk delete.
