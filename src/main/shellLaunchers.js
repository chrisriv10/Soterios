'use strict';

const CONTROL_PANEL_COMMANDS = new Map([
  ['control userpasswords2', ['userpasswords2']],
  ['control /name Microsoft.BitLockerDriveEncryption', ['/name', 'Microsoft.BitLockerDriveEncryption']]
]);

const POWERSHELL_CONTEXTS = new Map([
  ['', ['-NoExit', '-NoLogo', '-NoProfile']],
  ['execution-policy', ['-NoExit', '-NoLogo', '-NoProfile', '-Command', 'Get-ExecutionPolicy -List | Format-Table -AutoSize']],
  ['network-protection', ['-NoExit', '-NoLogo', '-NoProfile', '-Command', 'Get-MpPreference | Select-Object EnableNetworkProtection | Format-List']],
  ['lsa-protection', ['-NoExit', '-NoLogo', '-NoProfile', '-Command', "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' | Select-Object RunAsPPL | Format-List"]],
  ['password-policy', ['-NoExit', '-NoLogo', '-NoProfile', '-Command', 'net.exe accounts']],
  ['guest-account', ['-NoExit', '-NoLogo', '-NoProfile', '-Command', "Get-LocalUser -Name 'Guest' | Format-List Name,Enabled,Description"]]
]);

const WINDOWS_UTILITIES = new Map([
  ['services', { file: 'mmc.exe', args: ['services.msc'] }],
  ['tasks', { file: 'mmc.exe', args: ['taskschd.msc'] }],
  ['uac', { file: 'UserAccountControlSettings.exe', args: [] }],
  ['windows-features', { file: 'OptionalFeatures.exe', args: [] }]
]);

const TRUSTED_GITHUB_DESTINATIONS = new Set([
  'https://github.com/chrisriv10/Soterios',
  'https://github.com/chrisriv10/Soterios/wiki',
  'https://github.com/chrisriv10/Soterios/wiki/Troubleshooting',
  'https://github.com/chrisriv10/Soterios/issues',
  'https://github.com/chrisriv10/Soterios/issues/new?template=bug_report.yml',
  'https://github.com/chrisriv10/Soterios/issues/new?template=feature_request.yml',
  'https://github.com/chrisriv10/Soterios/discussions/categories/general',
  'https://github.com/chrisriv10/Soterios/security/advisories/new',
  'https://github.com/chrisriv10/Soterios/blob/main/SECURITY.md',
  'https://github.com/chrisriv10/Soterios/releases/latest'
]);

function failure(error, fallback) {
  return { success: false, error: error?.message || fallback };
}

function spawnDetached(spawnImpl, file, args) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      child = spawnImpl(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.once('error', (err) => finish(failure(err, `Unable to open ${file}.`)));
      child.once('spawn', () => {
        child.unref();
        finish({ success: true });
      });
    } catch (err) {
      finish(failure(err, `Unable to open ${file}.`));
    }
  });
}

async function openExternal(shell, url) {
  if (!isTrustedExternalUrl(url)) return { success: false, error: 'Invalid URL.' };

  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return failure(err, 'Unable to open the requested destination.');
  }
}

function isTrustedExternalUrl(value) {
  if (typeof value !== 'string') return false;

  const windowsSettings = new Set([
    'ms-settings:appsfeatures',
    'ms-settings:deviceencryption',
    'ms-settings:network-vpn',
    'ms-settings:recovery',
    'ms-settings:remotedesktop',
    'ms-settings:windowsdefender',
    'ms-settings:windowsupdate'
  ]);
  if (windowsSettings.has(value.toLowerCase())) return true;
  if (/^windowsdefender:\/\/(?:threat|threatsettings)\/$/i.test(value)) return true;

  let destination;
  try {
    destination = new URL(value);
  } catch (_) {
    return false;
  }
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.port) {
    return false;
  }

  if (destination.hostname === 'github.com') {
    return !destination.hash
      && TRUSTED_GITHUB_DESTINATIONS.has(`${destination.origin}${destination.pathname}${destination.search}`);
  }

  if (destination.hostname === 'ollama.com') {
    return destination.pathname === '/download' && !destination.search && !destination.hash;
  }

  if (destination.hostname === 'chrisriv10.github.io' && destination.pathname === '/Soterios/feedback/') {
    const queryEntries = [...destination.searchParams.entries()];
    const version = destination.searchParams.get('appVersion');
    const validVersion = version == null
      || /^(?:v)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
    const validQuery = queryEntries.length === (version == null ? 0 : 1)
      && queryEntries.every(([key]) => key === 'appVersion');
    const validSection = !destination.hash
      || /^#(?:bug-reports|feature-requests|general-feedback|security|documentation)$/.test(destination.hash);
    return validVersion && validQuery && validSection;
  }

  return false;
}

function openPowerShell(spawnImpl, context) {
  const key = context == null ? '' : String(context);
  const args = POWERSHELL_CONTEXTS.get(key);
  if (!args) return Promise.resolve({ success: false, error: 'Unsupported PowerShell action.' });
  // Launch through the Windows `start` command so Electron reliably creates a
  // visible, independent console window instead of leaving PowerShell behind
  // the app window. All arguments still come from the fixed allowlist above.
  return spawnDetached(spawnImpl, 'cmd.exe', ['/d', '/c', 'start', 'Soterios PowerShell', 'powershell.exe', ...args]);
}

function openControlPanel(spawnImpl, command) {
  const args = CONTROL_PANEL_COMMANDS.get(command);
  if (!args) return Promise.resolve({ success: false, error: 'Unsupported control panel command.' });
  return spawnDetached(spawnImpl, 'control.exe', args);
}

function openWindowsUtility(spawnImpl, utility) {
  const target = WINDOWS_UTILITIES.get(utility);
  if (!target) return Promise.resolve({ success: false, error: 'Unsupported Windows utility.' });
  return spawnDetached(spawnImpl, target.file, target.args);
}

module.exports = {
  openExternal,
  openPowerShell,
  openControlPanel,
  openWindowsUtility,
  spawnDetached
};
