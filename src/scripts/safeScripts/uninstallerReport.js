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

module.exports = async function uninstallerReport(args = {}, onProgress) {
  const platform = getProvider();
  if (!platform.supports('uninstaller')) {
    return {
      supported: false,
      message: platform.unavailableMessage('uninstaller')
    };
  }

  onProgress?.({ phase: 'collecting', label: 'Reading installed desktop applications', pct: 5, cancelable: true });
  const script = `
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$desktop = @(Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, InstallLocation,
    UninstallString, QuietUninstallString, EstimatedSize, DisplayIcon,
    @{N='AppType';E={'desktop'}}, @{N='PackageFullName';E={$null}})
$store = @(Get-AppxPackage -ErrorAction SilentlyContinue |
  Where-Object { -not $_.IsFramework -and -not $_.NonRemovable } |
  ForEach-Object {
    [PSCustomObject]@{
      DisplayName=$(if ($_.Name) {$_.Name} else {$_.PackageFamilyName})
      DisplayVersion=[string]$_.Version; Publisher=$_.Publisher; InstallDate=''
      InstallLocation=$_.InstallLocation; UninstallString=''; QuietUninstallString=''
      EstimatedSize=$null; DisplayIcon=''; AppType='store'; PackageFullName=$_.PackageFullName
    }
  })
@($desktop) + @($store) | ConvertTo-Json -Depth 5 -Compress
`;

  const stdout = await runPowerShell(script);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const apps = normalizeApps(parsed);
  onProgress?.({ phase: 'analyzing', label: 'Normalizing installed application details', pct: 75, count: apps.length, cancelable: true });

  let leftovers = [];
  let leftoverBlocked = null;
  if (args.scanLeftoversFor) {
    const target = apps.find((app) => app.name === args.scanLeftoversFor);
    if (target) {
      leftoverBlocked = 'The application is still installed. Finish uninstalling it and refresh this report before scanning for leftovers.';
    } else {
      const folderLeftovers = findLeftoverCandidates(args.scanLeftoversFor, null);
      const registryLeftovers = (await findLeftoverRegistryCandidates(args.scanLeftoversFor))
        .map((entry) => ({ ...entry, readOnly: true }));
      leftovers = [...folderLeftovers, ...registryLeftovers];
    }
  }

  onProgress?.({ phase: 'complete', label: 'Installed software report ready', pct: 100, count: apps.length, total: apps.length, cancelable: false });

  return {
    supported: true,
    appCount: apps.length,
    apps,
    leftovers,
    scannedApp: args.scanLeftoversFor || null,
    leftoverBlocked,
    registrySuggestionsReadOnly: true
  };
};
