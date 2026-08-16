'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isProtected } = require('./protectedPaths');

function normalizeApps(parsed) {
  const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  return rows
    .filter((row) => row && row.DisplayName)
    .map((row) => ({
      name: String(row.DisplayName).trim(),
      version: row.DisplayVersion ? String(row.DisplayVersion).trim() : '',
      publisher: row.Publisher ? String(row.Publisher).trim() : '',
      installDate: row.InstallDate ? String(row.InstallDate).trim() : '',
      installLocation: row.InstallLocation ? String(row.InstallLocation).trim() : '',
      uninstallString: row.UninstallString || row.QuietUninstallString || '',
      quietUninstallString: row.QuietUninstallString || '',
      estimatedSizeMB: row.EstimatedSize ? +(Number(row.EstimatedSize) / 1024).toFixed(1) : null,
      iconPath: row.DisplayIcon ? String(row.DisplayIcon).split(',')[0].trim().replace(/^"(.*)"$/, '$1') : '',
      appType: row.AppType || 'desktop',
      storePackageName: row.PackageFullName || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tokenizeAppName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function inspectCandidate(candidatePath) {
  let sizeBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let truncated = false;
  function walk(current, depth) {
    if (depth > 8 || fileCount + directoryCount >= 10000) { truncated = true; return; }
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { directoryCount += 1; walk(fullPath, depth + 1); }
      else if (entry.isFile()) {
        fileCount += 1;
        try { sizeBytes += fs.statSync(fullPath).size; } catch (_) {}
      }
      if (fileCount + directoryCount >= 10000) { truncated = true; break; }
    }
  }
  walk(candidatePath, 0);
  return { sizeBytes, fileCount, directoryCount, truncated };
}

function findLeftoverCandidates(appName, installLocation) {
  const common = new Set(['app', 'application', 'software', 'suite', 'desktop', 'windows', 'edition', 'update', 'updater']);
  const tokens = tokenizeAppName(appName).filter((token) => !common.has(token));
  if (!tokens.length) return [];

  const roots = [
    path.join(os.homedir(), 'AppData', 'Local'),
    path.join(os.homedir(), 'AppData', 'Roaming'),
    path.join(process.env.ProgramData || 'C:\\ProgramData')
  ];
  if (installLocation) roots.unshift(installLocation);

  const matches = [];
  const seen = new Set();

  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(root, entry.name);
      if (isProtected(fullPath) || seen.has(fullPath.toLowerCase())) continue;
      const haystack = entry.name.toLowerCase();
      const matchedTokens = tokens.filter((token) => haystack.includes(token));
      const requiredMatches = Math.min(2, tokens.length);
      if (matchedTokens.length >= requiredMatches) {
        seen.add(fullPath.toLowerCase());
        matches.push({ path: fullPath, kind: 'directory', matchedTokens, ...inspectCandidate(fullPath) });
      }
    }
  }

  return matches;
}

async function findLeftoverRegistryCandidates(appName) {
  if (process.platform !== 'win32') return [];
  const tokens = tokenizeAppName(appName);
  if (!tokens.length) return [];

  const { execFile } = require('child_process');
  const util = require('util');
  const execFilePromise = util.promisify(execFile);
  const tokenList = tokens.slice(0, 4).map((token) => `'${token.replace(/'/g, "''")}'`).join(',');
  const script = [
    `$tokens = @(${tokenList})`,
    '$roots = @("HKCU:\\Software","HKLM:\\Software\\WOW6432Node","HKLM:\\Software")',
    '$results = @()',
    'foreach ($root in $roots) {',
    '  Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {',
    '    $name = $_.PSChildName.ToLower()',
    '    foreach ($token in $tokens) {',
    '      if ($name -like ("*" + $token + "*")) {',
    '        $results += [PSCustomObject]@{ path = ($root + "\\" + $_.PSChildName); kind = "registry" }',
    '        break',
    '      }',
    '    }',
    '  }',
    '}',
    '$results | Select-Object -First 40 | ConvertTo-Json -Depth 3'
  ].join('; ');

  try {
    const { stdout } = await execFilePromise(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter((row) => row && row.path).map((row) => ({
      path: String(row.path),
      kind: 'registry'
    }));
  } catch (_) {
    return [];
  }
}

module.exports = {
  normalizeApps,
  tokenizeAppName,
  findLeftoverCandidates,
  findLeftoverRegistryCandidates,
  inspectCandidate
};
