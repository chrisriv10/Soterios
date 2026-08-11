/**
 * Soterios Browser Extension - shared install logic.
 *
 * Used by:
 *  - the desktop app (src/main/ipc/system.js) for the Settings UI,
 *  - the CLI (tools/install-native-host.js) for dev/support flows.
 *
 * Distribution model: the extension ships unpacked with Soterios and is
 * loaded per browser once via "Load unpacked". The extension ID is derived
 * deterministically from its fixed install folder, so the native host
 * manifest matches without any manual ID copying. Force-install via
 * ExtensionInstallForcelist was removed: all Chromium browsers block
 * non-Web-Store force-installs on consumer (non-enterprise-managed)
 * machines, so it was a dead path.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const NATIVE_HOST_NAME = 'com.soterios.credential_safety';

const BROWSERS = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    processName: 'chrome.exe',
    exeCandidates: [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    extensionsUrl: 'chrome://extensions',
    userDataCandidates: [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
    ],
    nativeHive: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    processName: 'msedge.exe',
    exeCandidates: [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    extensionsUrl: 'edge://extensions',
    userDataCandidates: [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
    ],
    nativeHive: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  },
  {
    id: 'brave',
    name: 'Brave',
    processName: 'brave.exe',
    exeCandidates: [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
    extensionsUrl: 'brave://extensions',
    userDataCandidates: [
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data'),
    ],
    nativeHive: 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts',
  },
];

function getBrowser(id) {
  return BROWSERS.find((b) => b.id === id) || null;
}

function detectInstalledBrowsers() {
  return BROWSERS.filter((b) => b.exeCandidates.some((c) => c && fs.existsSync(c)))
    .map((b) => ({
      id: b.id,
      name: b.name,
      exe: b.exeCandidates.find((c) => c && fs.existsSync(c)),
    }));
}

function getNativeHostDir() {
  return IS_WIN
    ? path.join(process.env.LOCALAPPDATA || '', 'Soterios', 'browser-extension')
    : path.join(process.env.HOME || '', '.local', 'share', 'soterios', 'browser-extension');
}

function findAppPath(overridden) {
  if (overridden && fs.existsSync(overridden)) return overridden;
  if (process.env.SOTERIOS_APP_PATH && fs.existsSync(process.env.SOTERIOS_APP_PATH)) {
    return process.env.SOTERIOS_APP_PATH;
  }
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Soterios', 'Soterios.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Soterios', 'Soterios.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Soterios', 'Soterios.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'C:\\Program Files\\Soterios\\Soterios.exe';
}

/**
 * Deterministic Chrome extension ID for an unpacked extension: the first
 * 32 hex nibbles of SHA-256(absolute path) mapped 0-15 -> 'a'-'p'.
 * Mirrors Chromium's GenerateIdForPath(). Because the install folder is
 * fixed, the ID is stable across machines, so the native host manifest can
 * be pre-baked with it.
 */
function predictExtensionId(extDir) {
  const hash = crypto.createHash('sha256').update(extDir).digest('hex');
  const chars = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[parseInt(hash[i], 16)];
  }
  return id;
}

function writeNativeHostFiles(extDir, appPath, extensionId) {
  const manifestPath = path.join(extDir, 'native-host-manifest.json');
  const batPath = path.join(extDir, 'src', 'native-host.bat');

  fs.writeFileSync(batPath, `@echo off
REM Soterios Native Messaging Host
set SOTERIOS_APP_PATH=${appPath}
node "%~dp0native-host.js" %*
`);

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Soterios desktop app bridge',
    path: batPath.replace(/\\/g, '\\\\'),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return { manifestPath, batPath };
}

const COPY_SKIP_DIRS = new Set(['tools', 'node_modules']);
const COPY_SKIP_FILES = new Set(['package.json', '.DS_Store', 'native-host.bat']);

/** Copies the extension source tree (packaged app resources or repo folder). */
function copyExtensionSource(srcDir, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  const walk = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const srcPath = path.join(from, entry.name);
      const destPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        if (COPY_SKIP_DIRS.has(entry.name)) continue;
        fs.mkdirSync(destPath, { recursive: true });
        walk(srcPath, destPath);
      } else {
        if (COPY_SKIP_FILES.has(entry.name)) continue;
        if (entry.name.endsWith('.svg')) continue;
        fs.copyFileSync(srcPath, destPath);
        copied += 1;
      }
    }
  };
  walk(srcDir, destDir);
  return copied;
}

function registerNativeHost(browserId, manifestPath) {
  if (!IS_WIN) return { ok: false, error: 'Windows only' };
  const browser = getBrowser(browserId);
  if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` };
  const key = `${browser.nativeHive}\\${NATIVE_HOST_NAME}`;
  try {
    execSync(
      `reg add "${key}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`,
      { stdio: 'pipe' }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function unregisterNativeHost(browserId) {
  if (!IS_WIN) return { ok: false, error: 'Windows only' };
  const browser = getBrowser(browserId);
  if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` };
  const key = `${browser.nativeHive}\\${NATIVE_HOST_NAME}`;
  try {
    execSync(`reg delete "${key}" /f`, { stdio: 'pipe' });
    return { ok: true };
  } catch (_) {
    return { ok: true }; // already absent
  }
}

function getNativeHostStatus(browserId) {
  if (!IS_WIN) return false;
  const browser = getBrowser(browserId);
  if (!browser) return false;
  const key = `${browser.nativeHive}\\${NATIVE_HOST_NAME}`;
  try {
    execSync(`reg query "${key}"`, { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Whether the unpacked extension with the given ID is loaded in the browser:
 * scans every profile's Preferences for extensions.settings[extensionId].
 */
function isExtensionLoaded(browserId, extensionId) {
  if (!IS_WIN) return false;
  const browser = getBrowser(browserId);
  if (!browser) return false;
  for (const userDataDir of browser.userDataCandidates) {
    if (!userDataDir || !fs.existsSync(userDataDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const prefsPath = path.join(userDataDir, entry.name, 'Preferences');
      if (!fs.existsSync(prefsPath)) continue;
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
        if (prefs?.extensions?.settings?.[extensionId]) return true;
      } catch (_) {
        // unreadable/corrupt profile - ignore
      }
    }
  }
  return false;
}

function openExtensionsPage(browserId) {
  const browser = getBrowser(browserId);
  if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` };
  const exe = browser.exeCandidates.find((c) => c && fs.existsSync(c));
  if (!exe) return { ok: false, error: `${browser.name} is not installed` };
  try {
    spawn(exe, [browser.extensionsUrl], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Manual install flow: copy the extension source to the fixed folder,
 * bake the predicted ID into the native host manifest, register the native
 * host for the browser, and open its extensions page. The user then loads
 * the folder once via "Load unpacked".
 */
function install(browserId, { srcDir, appPath } = {}) {
  const browser = getBrowser(browserId);
  if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` };
  if (!browser.exeCandidates.some((c) => c && fs.existsSync(c))) {
    return { ok: false, error: `${browser.name} is not installed` };
  }
  if (!srcDir || !fs.existsSync(path.join(srcDir, 'manifest.json'))) {
    return { ok: false, error: 'Browser extension source is missing from the app installation' };
  }

  const extDir = getNativeHostDir();
  copyExtensionSource(srcDir, extDir);
  const extensionId = predictExtensionId(extDir);
  const { manifestPath } = writeNativeHostFiles(extDir, appPath || findAppPath(), extensionId);
  const host = registerNativeHost(browser.id, manifestPath);
  const page = openExtensionsPage(browser.id);

  return {
    ok: true,
    browser: browser.id,
    extensionId,
    extDir,
    manifestPath,
    extensionsUrl: browser.extensionsUrl,
    nativeHostOk: host.ok,
    pageOpened: page.ok,
  };
}

/** Full state snapshot for the Settings UI. */
function getState() {
  const extDir = getNativeHostDir();
  const extDirExists = fs.existsSync(extDir);
  const extensionId = predictExtensionId(extDir);
  return {
    extensionId,
    extDir,
    extDirExists,
    browsers: BROWSERS.map((b) => ({
      id: b.id,
      name: b.name,
      installed: b.exeCandidates.some((c) => c && fs.existsSync(c)),
      extensionsUrl: b.extensionsUrl,
      loaded: extDirExists ? isExtensionLoaded(b.id, extensionId) : false,
      nativeHostActive: getNativeHostStatus(b.id),
    })),
  };
}

module.exports = {
  IS_WIN,
  BROWSERS,
  NATIVE_HOST_NAME,
  getBrowser,
  detectInstalledBrowsers,
  getNativeHostDir,
  copyExtensionSource,
  findAppPath,
  predictExtensionId,
  writeNativeHostFiles,
  registerNativeHost,
  unregisterNativeHost,
  getNativeHostStatus,
  isExtensionLoaded,
  openExtensionsPage,
  install,
  getState,
};
