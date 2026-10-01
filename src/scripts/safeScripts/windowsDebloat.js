'use strict';

// Safe Windows AppX consumer-app cleanup.
//
// Two modes, one module:
// - analyze (default): enumerate current-user AppX packages and classify
//   each against the Soterios-owned catalog. Never mutates.
// - remove: revalidate an explicitly confirmed selection and remove each
//   package with current-user-only Remove-AppxPackage, then rescan.
//
// Trust model: the renderer is untrusted. Removal accepts only catalog ids;
// every id is re-resolved against a FRESH enumeration immediately before
// mutation, and only an exact, still-matching PackageFullName is ever passed
// to PowerShell (as child-process environment data, never interpolated into
// script source). Wildcards, -AllUsers, and provisioned-package cmdlets are
// never used anywhere in this file.

const childProcess = require('child_process');
const { findEntry, isProtectedFamily, validateCatalog } = require('./windowsDebloatCatalog');

const DISCOVERY_TIMEOUT_MS = 60_000;
const DISCOVERY_MAX_BUFFER = 8 * 1024 * 1024;
const REMOVAL_TIMEOUT_MS = 60_000;
const REMOVAL_MAX_BUFFER = 1024 * 1024;
const MAX_SELECTIONS = 100;
// Generous fixed caps: legitimate family names stay well under 100
// characters and full names under 200. These bound per-string work before
// any catalog lookup, enumeration scan, or comparison happens.
const MAX_SELECTION_ID_LENGTH = 256;
const MAX_FULLNAME_LENGTH = 512;
const FULLNAME_ENV_VAR = 'SOTERIOS_DEBLOAT_FULLNAME';
// PackageFullName shape: Name_Version_Arch_Resource_PublisherId. The
// resource section is frequently empty (double underscore), so it may be
// zero-length; everything else must be present and shell-safe.
const FULLNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*_[0-9][A-Za-z0-9._-]*_(neutral|x86|x64|arm|arm64)_([A-Za-z0-9._-]*)_([A-Za-z0-9]+)$/i;

// Fixed discovery script: current user only (no -AllUsers), metadata only,
// bounded JSON output. No caller input reaches this source.
const DISCOVERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$pkgs = @(Get-AppxPackage | ForEach-Object {",
  "  [PSCustomObject]@{",
  "    Name=$_.Name; PackageFullName=$_.PackageFullName; PackageFamilyName=$_.PackageFamilyName;",
  "    Version=[string]$_.Version; Publisher=$_.Publisher; Architecture=[string]$_.Architecture;",
  "    InstallLocation=$_.InstallLocation; IsFramework=[bool]$_.IsFramework;",
  "    IsResourcePackage=[bool]$_.IsResourcePackage; IsBundle=[bool]$_.IsBundle;",
  "    NonRemovable=[bool]$_.NonRemovable; Status=[string]$_.Status",
  "  }",
  "})",
  "$pkgs | ConvertTo-Json -Depth 4 -Compress"
].join('\n');

// Fixed removal script. The exact PackageFullName arrives via the child
// environment and is validated server-side before spawning; it is never
// embedded in script source and no wildcards are possible. Current user
// only: no -AllUsers, no provisioned-package cmdlets.
const REMOVAL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$fullName = $env:${FULLNAME_ENV_VAR}`,
  "if ([string]::IsNullOrWhiteSpace($fullName)) { throw 'SOTERIOS_DEBLOAT_MISSING_FULLNAME' }",
  "Remove-AppxPackage -Package $fullName -ErrorAction Stop",
  "Write-Output 'SOTERIOS_DEBLOAT_REMOVED'"
].join('\n');

function powershellEncoded(script) {
  return Buffer.from(`\ufeff${script}`, 'utf16le').toString('base64');
}

function launchFor(script) {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)]
  };
}

function runPs(script, { env = {}, timeoutMs, maxBuffer } = {}) {
  const launch = launchFor(script);
  return new Promise((resolve, reject) => {
    // Dereferenced at call time so the worker entry can track children and
    // tests can stub child_process.execFile.
    childProcess.execFile(launch.file, launch.args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer,
      env: { ...process.env, ...env }
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error((stderr && String(stderr).trim()) || error.message || 'PowerShell invocation failed.');
        err.timedOut = !!error.killed;
        err.code = error.code;
        reject(err);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function toTriState(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function normalizePackage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const familyName = typeof raw.PackageFamilyName === 'string' ? raw.PackageFamilyName : '';
  const fullName = typeof raw.PackageFullName === 'string' ? raw.PackageFullName : '';
  if (!familyName || !fullName) return null;
  // Safety metadata is tri-state: true, false, or null (missing/invalid).
  // Unknown safety state must never be silently converted to false; the
  // classifier blocks removal unless every required field is explicitly
  // known.
  return {
    name: typeof raw.Name === 'string' && raw.Name ? raw.Name : familyName,
    packageFullName: fullName,
    packageFamilyName: familyName,
    version: typeof raw.Version === 'string' ? raw.Version : '',
    publisher: raw.Publisher == null ? '' : String(raw.Publisher),
    architecture: typeof raw.Architecture === 'string' ? raw.Architecture : '',
    installLocation: typeof raw.InstallLocation === 'string' ? raw.InstallLocation : '',
    isFramework: toTriState(raw.IsFramework),
    isResourcePackage: toTriState(raw.IsResourcePackage),
    isBundle: toTriState(raw.IsBundle),
    nonRemovable: toTriState(raw.NonRemovable),
    status: typeof raw.Status === 'string' && raw.Status ? raw.Status : null
  };
}

function classifyPackage(pkg, context = {}) {
  const entry = findEntry(pkg.packageFamilyName);
  const catalogId = entry ? entry.id : null;
  const verdict = (extra) => ({ ...pkg, catalogId, uncataloged: false, ...extra });
  // A family with multiple installed identities is ambiguous: neither record
  // may be selected, because revalidation could otherwise resolve the wrong
  // PackageFullName. This check precedes all metadata handling.
  if (context.ambiguousFamilies instanceof Set
    && context.ambiguousFamilies.has(String(pkg.packageFamilyName).toLowerCase())) {
    return verdict({ recommendation: 'protected', reason: 'Multiple installed packages share this family; identity is ambiguous.', canRemove: false });
  }
  // Fail closed on unknown safety state: any required metadata that is
  // missing or invalid blocks removal, even for cataloged families.
  const safetyUnknown = pkg.isFramework == null || pkg.isResourcePackage == null || pkg.isBundle == null
    || pkg.nonRemovable == null || typeof pkg.status !== 'string' || !pkg.status;
  if (safetyUnknown) {
    return verdict({ recommendation: 'protected', reason: 'Incomplete or invalid AppX safety metadata; removal blocked.', canRemove: false });
  }
  if (pkg.isFramework || pkg.isResourcePackage) {
    return verdict({ recommendation: 'protected', reason: 'Framework/resource package required by other apps.', canRemove: false });
  }
  if (pkg.isBundle) {
    return verdict({ recommendation: 'protected', reason: 'Bundle package: removal is not supported.', canRemove: false });
  }
  if (pkg.nonRemovable) {
    return verdict({ recommendation: 'protected', reason: 'Marked NonRemovable by Windows.', canRemove: false });
  }
  if (pkg.status !== 'Ok') {
    return verdict({ recommendation: 'protected', reason: `Package status is '${pkg.status}', not healthy.`, canRemove: false });
  }
  if (entry && entry.recommendation === 'protected') {
    return verdict({ recommendation: 'protected', reason: entry.rationale, canRemove: false });
  }
  if (isProtectedFamily(pkg.packageFamilyName)) {
    return verdict({ recommendation: 'protected', reason: 'System, runtime, or shell component: never offered for removal.', canRemove: false });
  }
  if (!entry) {
    return verdict({ recommendation: 'protected', reason: 'Not in the Soterios removal catalog.', canRemove: false, uncataloged: true });
  }
  return verdict({ recommendation: entry.recommendation, reason: entry.rationale, canRemove: true });
}

async function discoverPackages() {
  const stdout = await runPs(DISCOVERY_SCRIPT, { timeoutMs: DISCOVERY_TIMEOUT_MS, maxBuffer: DISCOVERY_MAX_BUFFER });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    throw new Error('AppX discovery returned unparseable output.');
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const packages = [];
  let malformed = 0;
  for (const row of rows) {
    const normalized = normalizePackage(row);
    if (normalized) packages.push(normalized);
    else malformed += 1;
  }
  const familyCounts = new Map();
  for (const pkg of packages) {
    const key = pkg.packageFamilyName.toLowerCase();
    familyCounts.set(key, (familyCounts.get(key) || 0) + 1);
  }
  const ambiguousFamilies = new Set(
    [...familyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  );
  return { packages, malformed, ambiguousFamilies };
}

function analyzeResult(packages, malformed, ambiguousFamilies = new Set()) {
  const classified = packages.map((pkg) => classifyPackage(pkg, { ambiguousFamilies }));
  const counts = { installed: classified.length, recommended: 0, optional: 0, protected: 0, uncataloged: 0 };
  for (const pkg of classified) {
    if (pkg.uncataloged) counts.uncataloged += 1;
    else if (pkg.canRemove && pkg.recommendation === 'recommended') counts.recommended += 1;
    else if (pkg.canRemove && pkg.recommendation === 'optional') counts.optional += 1;
    else counts.protected += 1;
  }
  return {
    supported: true,
    mode: 'analyze',
    generatedAt: new Date().toISOString(),
    counts,
    malformed,
    packages: classified
  };
}

function validateSelections(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('Select at least one package to remove.');
  }
  if (selections.length > MAX_SELECTIONS) {
    throw new Error(`Select at most ${MAX_SELECTIONS} packages at a time.`);
  }
  const seen = new Set();
  const ids = [];
  for (const selection of selections) {
    if (!selection || typeof selection !== 'string') {
      throw new Error('Invalid package selection.');
    }
    const id = selection.trim();
    if (!id || seen.has(id.toLowerCase())) continue;
    if (id.length > MAX_SELECTION_ID_LENGTH) {
      throw new Error('Invalid package selection.');
    }
    const entry = findEntry(id);
    if (!entry) {
      throw new Error(`Unknown package identifier: ${id}`);
    }
    if (entry.recommendation === 'protected') {
      throw new Error(`Package is protected and cannot be removed: ${id}`);
    }
    seen.add(id.toLowerCase());
    ids.push(entry.id);
  }
  if (!ids.length) {
    throw new Error('Select at least one package to remove.');
  }
  return ids;
}

function validateFullName(fullName) {
  if (typeof fullName !== 'string' || fullName.length > MAX_FULLNAME_LENGTH || !FULLNAME_PATTERN.test(fullName.trim())) {
    throw new Error('Refusing to remove a package with an unexpected identity format.');
  }
  return fullName.trim();
}

async function removeOnePackage(fullName) {
  const validated = validateFullName(fullName);
  const stdout = await runPs(REMOVAL_SCRIPT, {
    env: { [FULLNAME_ENV_VAR]: validated },
    timeoutMs: REMOVAL_TIMEOUT_MS,
    maxBuffer: REMOVAL_MAX_BUFFER
  });
  if (!stdout.includes('SOTERIOS_DEBLOAT_REMOVED')) {
    throw new Error('Removal did not confirm success.');
  }
  return validated;
}

async function removeFlow(args = {}, onProgress) {
  if (args.confirmed !== true) {
    throw new Error('Removal requires explicit confirmation.');
  }
  const ids = validateSelections(args.selections);
  validateCatalog();

  onProgress?.({ phase: 'revalidating', label: 'Re-checking selected packages', pct: 10, cancelable: true });
  const before = await discoverPackages();
  const byFamily = new Map();
  for (const pkg of before.packages) {
    const key = pkg.packageFamilyName.toLowerCase();
    // Ambiguous families never enter the map: with several identities under
    // one family, no single PackageFullName can be safely selected.
    if (!before.ambiguousFamilies.has(key) && !byFamily.has(key)) byFamily.set(key, pkg);
  }
  const previewById = {};
  if (args.preview && typeof args.preview === 'object' && !Array.isArray(args.preview)) {
    // Read only the entries for explicitly selected ids so an oversized
    // preview object cannot force unbounded work.
    for (const id of ids) {
      const fullName = args.preview[id];
      if (typeof fullName === 'string' && fullName.length <= MAX_FULLNAME_LENGTH) previewById[id.toLowerCase()] = fullName;
    }
  }

  const removed = [];
  const failed = [];
  const skipped = [];
  let index = 0;
  for (const id of ids) {
    index += 1;
    if (before.ambiguousFamilies.has(id.toLowerCase())) {
      skipped.push({ id, reason: 'Multiple installed packages share this family; refresh required.' });
      continue;
    }
    const current = byFamily.get(id.toLowerCase());
    if (!current) {
      skipped.push({ id, reason: 'Package is no longer installed; refresh required.' });
      continue;
    }
    const expectedFullName = previewById[id.toLowerCase()];
    if (expectedFullName && current.packageFullName !== expectedFullName) {
      skipped.push({ id, reason: 'Package changed since preview; refresh required.' });
      continue;
    }
    const classified = classifyPackage(current, { ambiguousFamilies: before.ambiguousFamilies });
    if (!classified.canRemove) {
      skipped.push({ id, reason: classified.reason });
      continue;
    }
    onProgress?.({ phase: 'removing', label: `Removing ${classified.name}`, pct: 10 + Math.round((index / ids.length) * 70), cancelable: true });
    try {
      await removeOnePackage(current.packageFullName);
      removed.push({ id, packageFullName: current.packageFullName, name: classified.name });
    } catch (err) {
      failed.push({ id, packageFullName: current.packageFullName, name: classified.name, error: err.message || String(err) });
    }
  }

  onProgress?.({ phase: 'verifying', label: 'Re-scanning installed packages', pct: 90, cancelable: true });
  const after = await discoverPackages();
  const remaining = new Set(after.packages.map((pkg) => pkg.packageFullName));
  const verifiedRemoved = removed.filter((item) => !remaining.has(item.packageFullName));
  const stillInstalled = removed.filter((item) => remaining.has(item.packageFullName));
  for (const item of stillInstalled) {
    failed.push({ id: item.id, packageFullName: item.packageFullName, name: item.name, error: 'Package is still installed after removal.' });
  }

  onProgress?.({ phase: 'complete', label: 'Debloat removal complete', pct: 100, cancelable: false });
  return {
    supported: true,
    mode: 'remove',
    generatedAt: new Date().toISOString(),
    selected: ids,
    removed: verifiedRemoved,
    failed,
    skipped,
    rescan: {
      remaining: stillInstalled.map((item) => item.packageFullName),
      removedCount: verifiedRemoved.length,
      installedCount: after.packages.length
    }
  };
}

module.exports = async function windowsDebloat(args = {}, onProgress) {
  if (process.platform !== 'win32') {
    return { supported: false, message: 'Windows AppX cleanup is only available on Windows.' };
  }
  if (args.mode === 'remove') {
    return removeFlow(args, onProgress);
  }
  onProgress?.({ phase: 'collecting', label: 'Reading installed AppX packages', pct: 5, cancelable: true });
  const { packages, malformed, ambiguousFamilies } = await discoverPackages();
  onProgress?.({ phase: 'analyzing', label: 'Classifying packages against the Soterios catalog', pct: 75, cancelable: true });
  const result = analyzeResult(packages, malformed, ambiguousFamilies);
  onProgress?.({ phase: 'complete', label: 'AppX inventory ready', pct: 100, count: packages.length, total: packages.length, cancelable: false });
  return result;
};

// Exported for tests: launch shape, patterns, and pure classification logic.
module.exports.launchFor = launchFor;
module.exports.normalizePackage = normalizePackage;
module.exports.classifyPackage = classifyPackage;
module.exports.validateSelections = validateSelections;
module.exports.validateFullName = validateFullName;
module.exports.FULLNAME_ENV_VAR = FULLNAME_ENV_VAR;
module.exports.DISCOVERY_SCRIPT = DISCOVERY_SCRIPT;
module.exports.REMOVAL_SCRIPT = REMOVAL_SCRIPT;
