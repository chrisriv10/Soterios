'use strict';

const { execFile } = require('child_process');
const { getProvider } = require('../../platform');
const { normalizeApps, findLeftoverCandidates, findLeftoverRegistryCandidates } = require('./uninstallUtils');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

module.exports = async function uninstallerReport(args = {}) {
  const platform = getProvider();
  if (!platform.supports('uninstaller')) {
    return {
      supported: false,
      message: platform.unavailableMessage('uninstaller')
    };
  }

  const script = [
    '$paths = @(',
    '  "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '  "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
    ');',
    'Get-ItemProperty $paths -ErrorAction SilentlyContinue',
    '| Where-Object { $_.DisplayName }',
    '| Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString, EstimatedSize, DisplayIcon',
    '| ConvertTo-Json -Depth 4'
  ].join(' ');

  const stdout = await runPowerShell(script);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const apps = normalizeApps(parsed);

  let leftovers = [];
  if (args.scanLeftoversFor) {
    const target = apps.find((app) => app.name === args.scanLeftoversFor);
    const folderLeftovers = findLeftoverCandidates(args.scanLeftoversFor, target && target.installLocation);
    const registryLeftovers = await findLeftoverRegistryCandidates(args.scanLeftoversFor);
    leftovers = [...folderLeftovers, ...registryLeftovers];
  }

  return {
    supported: true,
    appCount: apps.length,
    apps: apps.slice(0, 200),
    leftovers,
    scannedApp: args.scanLeftoversFor || null
  };
};
