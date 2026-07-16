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
      installLocation: row.InstallLocation ? String(row.InstallLocation).trim() : '',
      uninstallString: row.QuietUninstallString || row.UninstallString || '',
      estimatedSizeMB: row.EstimatedSize ? +(Number(row.EstimatedSize) / 1024).toFixed(1) : null,
      iconPath: row.DisplayIcon ? String(row.DisplayIcon).split(',')[0].trim().replace(/^"(.*)"$/, '$1') : ''
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

function findLeftoverCandidates(appName, installLocation) {
  const tokens = tokenizeAppName(appName);
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
      if (tokens.some((token) => haystack.includes(token))) {
        seen.add(fullPath.toLowerCase());
        matches.push({ path: fullPath, kind: 'directory' });
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
  findLeftoverRegistryCandidates
};
