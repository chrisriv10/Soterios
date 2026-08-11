#!/usr/bin/env node
/**
 * Soterios Browser Extension - One-Command Setup (dev) + Policy install (users)
 *
 * DEV FLOW (no args):
 *   Copies browser-extension/ to a fixed stable folder, predicts the unpacked
 *   extension ID from that path, bakes it into the native messaging manifest,
 *   registers the native host for detected browsers, and opens the folder +
 *   extensions page. The user only has to click "Load unpacked".
 *
 *   NOTE: Chrome 137+ removed the --load-extension CLI flag from branded
 *   builds, so "Load unpacked" is the only dev loading path.
 *
 * POLICY FLOW (end users):
 *   Writes/removes the ExtensionInstallForcelist policy for selected
 *   browsers. The browser then installs the signed CRX from GitHub Releases
 *   automatically and keeps it updated. This is what the desktop app uses.
 *
 * Usage:
 *   node tools/install-native-host.js                        dev flow
 *   node tools/install-native-host.js policy on [browser ...]
 *   node tools/install-native-host.js policy off [browser ...]
 *   node tools/install-native-host.js policy status
 *   node tools/install-native-host.js status
 *   browser ids: chrome | edge | brave (default: all detected)
 *
 * Flags:
 *   --set-id <extension-id>   (dev flow only; ID mismatch fallback)
 *   --app-path <soterios.exe>
 *   --update-url <url>        (policy flow; default: GitHub Releases update.xml)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const installer = require('../src/extension/installer');

const {
  IS_WIN,
  detectInstalledBrowsers,
  getNativeHostDir,
  copyExtensionSource,
  findAppPath,
  predictExtensionId,
  writeNativeHostFiles,
  registerNativeHost,
  unregisterNativeHost,
  setExtensionPolicy,
  getPolicyStatus,
  getState,
  EXTENSION_ID,
  EXTENSION_UPDATE_URL,
} = installer;

const SOURCE_DIR = path.resolve(__dirname, '..', 'browser-extension');
const INSTALL_DIR = getNativeHostDir();

function openFolder(manifestPath, log) {
  if (!IS_WIN) return;
  try {
    spawn('explorer.exe', [`/select,${manifestPath}`], { detached: true, stdio: 'ignore' }).unref();
    log('Opened the extension folder in Explorer');
  } catch (_) {}
}

function findBrowser() {
  if (!IS_WIN) return null;
  const detected = detectInstalledBrowsers();
  return detected.length ? detected[0].exe : null;
}

function openExtensionsPage(log) {
  if (!IS_WIN) return;
  const browser = findBrowser();
  if (browser) {
    try {
      const child = spawn(browser, ['chrome://extensions'], { detached: true, stdio: 'ignore' });
      child.unref();
      log(`Opened chrome://extensions in ${path.basename(path.dirname(path.dirname(browser)))}`);
      return;
    } catch (_) {}
  }
  try {
    const { execSync } = require('child_process');
    execSync('cmd /c start "" chrome://extensions', { stdio: 'ignore' });
    log('Opened chrome://extensions in the default browser');
  } catch (_) {}
}

function devFlow(args) {
  const log = (msg) => console.log(`[Soterios] ${msg}`);
  const idOverride = (args.find((a) => a.startsWith('--set-id=')) || '').split('=')[1]
    || (args.indexOf('--set-id') !== -1 ? args[args.indexOf('--set-id') + 1] : '');
  const appPathOverride = (args.find((a) => a.startsWith('--app-path=')) || '').split('=')[1]
    || (args.indexOf('--app-path') !== -1 ? args[args.indexOf('--app-path') + 1] : '');

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('[Soterios] Extension source not found at ' + SOURCE_DIR);
    console.error('Run this from the Soterios project folder.');
    process.exit(1);
  }

  log('Installing browser extension to a fixed path (dev flow)...');
  copyExtensionSource(SOURCE_DIR, INSTALL_DIR);
  log(`Copied extension source to ${INSTALL_DIR}`);

  const appPath = findAppPath(appPathOverride);
  let extensionId = idOverride;
  if (!extensionId) {
    extensionId = predictExtensionId(INSTALL_DIR);
    log(`Predicted unpacked extension ID: ${extensionId}`);
    log('(Chrome derives unpacked extension IDs from the folder path)');
  } else {
    log(`Using provided extension ID: ${extensionId}`);
  }

  const { manifestPath } = writeNativeHostFiles(INSTALL_DIR, appPath, extensionId);
  log(`Wrote native host manifest: ${manifestPath}`);
  log(`Desktop app path: ${appPath}`);

  const detected = detectInstalledBrowsers();
  if (detected.length === 0) {
    log('WARNING: no supported browser (Chrome/Edge/Brave) detected');
  }
  for (const browser of detected) {
    const result = registerNativeHost(browser.id, manifestPath);
    log(result.ok
      ? `Registered native host for ${browser.name}`
      : `WARNING: failed to register native host for ${browser.name}: ${result.error}`);
  }

  openFolder(manifestPath, log);
  openExtensionsPage(log);

  console.log(`
====================================
  Final step (one click)
====================================
  1. In the extensions page that opened, enable Developer mode (top-right)
  2. Click "Load unpacked" and select:
     ${INSTALL_DIR}
  3. The extension card should show ID:
     ${extensionId}

  For end users, ` + '`policy on`' + ` installs via enterprise policy instead
  (no Developer mode, no Load unpacked). The signed-CRX extension ID is:
     ${EXTENSION_ID}
  (update URL: ${EXTENSION_UPDATE_URL})

  The popup shows "Soterios app connected: Yes" once the desktop app is running.
`);
}

function policyFlow(args) {
  const log = (msg) => console.log(`[Soterios] ${msg}`);
  const action = args[1]; // on | off | status
  const requested = args.slice(2).filter((a) => !a.startsWith('--'));
  const updateUrl = (args.find((a) => a.startsWith('--update-url=')) || '').split('=')[1] || EXTENSION_UPDATE_URL;

  if (!IS_WIN) {
    console.error('[Soterios] Policy flow is Windows-only');
    process.exit(1);
  }

  // Machine-scope policy keys need elevation (HKCU\Software\Policies is
  // ACL-locked by Windows). Relaunch elevated with a UAC prompt if needed.
  if (action !== 'status' && !installer.isElevated()) {
    log('Policy changes need administrator rights - requesting elevation...');
    try {
      const { spawnSync } = require('child_process');
      const ps = 'powershell.exe';
      const script = `Start-Process -FilePath '${process.execPath}' -ArgumentList '${args.join(' ').replace(/'/g, "''")}' -Verb RunAs -Wait`;
      const result = spawnSync(ps, ['-NoProfile', '-Command', script], { stdio: 'inherit' });
      process.exit(result.status || 0);
    } catch (e) {
      console.error('[Soterios] Elevation failed:', e.message);
      process.exit(1);
    }
  }

  const allDetected = detectInstalledBrowsers().map((b) => b.id);
  const targets = requested.length ? requested : allDetected;
  const unknown = targets.filter((id) => !installer.getBrowser(id));
  if (unknown.length) {
    console.error(`[Soterios] Unknown browser ids: ${unknown.join(', ')} (use chrome|edge|brave)`);
    process.exit(1);
  }

  if (action === 'status') {
    const state = getState();
    for (const b of state.browsers) {
      const det = allDetected.includes(b.id);
      const pol = b.policyActive ? 'policy:ON' : 'policy:off';
      log(`${b.name.padEnd(18)} ${det ? 'installed' : 'not-found'}  ${pol}`);
    }
    log(`Extension ID: ${EXTENSION_ID}`);
    log(`Update URL: ${updateUrl}`);
    return;
  }

  if (action !== 'on' && action !== 'off') {
    console.error('[Soterios] Usage: policy <on|off|status> [chrome|edge|brave ...]');
    process.exit(1);
  }

  for (const browserId of targets) {
    if (action === 'on') {
      const result = setExtensionPolicy(browserId, true, updateUrl);
      log(result.ok
        ? `Policy ON for ${browserId} -> ${EXTENSION_ID};${updateUrl}`
        : `FAILED to set policy for ${browserId}: ${result.error}`);
    } else {
      const result = setExtensionPolicy(browserId, false);
      log(result.ok
        ? `Policy removed for ${browserId}`
        : `FAILED to remove policy for ${browserId}: ${result.error}`);
    }
  }
  log(action === 'on'
    ? 'Restart the browser (or wait a few minutes) for the extension to appear.'
    : 'The extension will be removed after the browser restarts.');
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'policy') {
    policyFlow(args);
  } else if (args[0] === 'status') {
    const state = getState();
    console.log(`[Soterios] Extension ID: ${state.extensionId}`);
    console.log(`[Soterios] Update URL: ${state.updateUrl}`);
    for (const b of state.browsers) {
      console.log(`[Soterios] ${b.name.padEnd(18)} ${b.installed ? 'installed' : 'not-found'}  policy:${b.policyActive ? 'ON' : 'off'}  native-host:${b.nativeHostActive ? 'ON' : 'off'}`);
    }
  } else {
    devFlow(args);
  }
}

main();
