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

module.exports = {
  normalizeApps,
  tokenizeAppName,
  findLeftoverCandidates
};
