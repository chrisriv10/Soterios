'use strict';

const { spawn } = require('child_process');
const { getProvider } = require('../../platform');
const { parseUninstallCommand, validateUninstallLaunch } = require('./uninstallLaunchUtils');

module.exports = async function launchUninstaller(args = {}) {
  const platform = getProvider();
  if (!platform.supports('uninstaller')) {
    return { ok: false, error: platform.unavailableMessage('uninstaller') };
  }

  const parsed = parseUninstallCommand(args.uninstallString);
  const validation = validateUninstallLaunch(parsed);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const launch = validation.parsed || parsed;

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(launch.exe, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({
        ok: true,
        launched: true,
        command: `${launch.exe} ${launch.args.join(' ')}`.trim()
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: err.message || String(err) });
    });
  });
};
