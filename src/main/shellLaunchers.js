'use strict';

const CONTROL_PANEL_COMMANDS = new Map([
  ['control userpasswords2', ['userpasswords2']],
  ['control /name Microsoft.BitLockerDriveEncryption', ['/name', 'Microsoft.BitLockerDriveEncryption']]
]);

const POWERSHELL_CONTEXTS = new Map([
  ['', ['-NoExit']],
  ['execution-policy', ['-NoExit', '-Command', 'Get-ExecutionPolicy -List | Format-Table -AutoSize']],
  ['network-protection', ['-NoExit', '-Command', 'Get-MpPreference | Select-Object EnableNetworkProtection | Format-List']],
  ['lsa-protection', ['-NoExit', '-Command', "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' | Select-Object RunAsPPL | Format-List"]],
  ['password-policy', ['-NoExit', '-Command', 'net.exe accounts']],
  ['guest-account', ['-NoExit', '-Command', "Get-LocalUser -Name 'Guest' | Format-List Name,Enabled,Description"]]
]);

const WINDOWS_UTILITIES = new Map([
  ['services', { file: 'mmc.exe', args: ['services.msc'] }],
  ['tasks', { file: 'mmc.exe', args: ['taskschd.msc'] }],
  ['uac', { file: 'UserAccountControlSettings.exe', args: [] }],
  ['windows-features', { file: 'OptionalFeatures.exe', args: [] }]
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
  const allowed = typeof url === 'string' && (
    /^https?:\/\//i.test(url)
    || /^ms-settings:[A-Za-z0-9._/?=&%-]*$/i.test(url)
    || /^windowsdefender:\/\/[A-Za-z0-9._/?=&%-]*$/i.test(url)
  );
  if (!allowed) return { success: false, error: 'Invalid URL.' };

  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return failure(err, 'Unable to open the requested destination.');
  }
}

function openPowerShell(spawnImpl, context) {
  const key = context == null ? '' : String(context);
  const args = POWERSHELL_CONTEXTS.get(key);
  if (!args) return Promise.resolve({ success: false, error: 'Unsupported PowerShell action.' });
  return spawnDetached(spawnImpl, 'powershell.exe', args);
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
