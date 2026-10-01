# Windows Debloat

Review optional Windows Store (AppX/MSIX) applications and remove the ones you explicitly select, for the current Windows user only. Find it under **Tools & Maintenance → App Management → Windows Debloat**.

## What it removes

Only packages that satisfy **all** of these conditions:

1. Listed in the small Soterios-owned removal catalog (`src/scripts/safeScripts/windowsDebloatCatalog.js`).
2. Currently installed for the current interactive user.
3. Resolved to an exact current `PackageFullName` at removal time.
4. Not protected: not a framework, resource, or system package, not marked `NonRemovable`, and healthy.
5. Explicitly selected and confirmed by you.

Packages are grouped as **Recommended** (clearly optional consumer software), **Optional** (legitimate functionality you may rely on, never pre-selected silently beyond the recommended set), and **Protected** (Store, security UI, runtimes, shell components, and everything outside the catalog — never offered for removal).

## Scope limits

- Current user only. No `-AllUsers`, no provisioned-package changes, no other users affected.
- No service, registry, telemetry, Defender, firewall, task, startup, Edge, OneDrive, feature, DISM, WinGet, or scheduled changes.
- Never runs automatically: the tool is analyze-only in scheduled maintenance and has no one-click-remove-everything behavior.

## Safety flow

1. **Scan** to preview the exact inventory with per-package reasons.
2. Select packages and confirm explicitly (typed confirmation).
3. Optionally create a Windows **System Restore** checkpoint first (enabled by default). If checkpoint creation fails, Soterios asks for a second explicit confirmation before proceeding without one. A restore point is a recovery aid, not a guaranteed AppX rollback mechanism.
4. Soterios re-checks every selection immediately before removal. Anything that changed, disappeared, or became protected is skipped with a reason — a stale preview can never remove a different package.
5. Removal runs package-by-package with isolated errors, then **re-scans** and reports removed, failed, and skipped items from observed state.

Removed apps can usually be reinstalled from the Microsoft Store, but Soterios cannot restore them automatically.

## Catalog maintenance

The catalog is intentionally small. An entry needs a stable package family name, a friendly name, a category, a recommendation level, and a written rationale. When in doubt, a package stays out of the catalog (uncataloged packages are listed for transparency but can never be selected).
