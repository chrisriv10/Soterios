/** Commercial-grade unpacked extension and native-host installation for Chrome, Edge, and Brave. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const NATIVE_HOST_NAME = 'com.soterios.credential_safety';
const EXPECTED_EXTENSION_VERSION = '2.0.0';

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', exeCandidates: [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')], extensionsUrl: 'chrome://extensions', userDataCandidates: [path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')], nativeHive: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts' },
  { id: 'edge', name: 'Microsoft Edge', exeCandidates: [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')], extensionsUrl: 'edge://extensions', userDataCandidates: [path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')], nativeHive: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts' },
  { id: 'brave', name: 'Brave', exeCandidates: [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')], extensionsUrl: 'brave://extensions', userDataCandidates: [path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data')], nativeHive: 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts' }
];

function getBrowser(id) { return BROWSERS.find((browser) => browser.id === id) || null; }
function detectInstalledBrowsers() { return BROWSERS.filter((browser) => browser.exeCandidates.some((candidate) => candidate && fs.existsSync(candidate))).map((browser) => ({ id: browser.id, name: browser.name, exe: browser.exeCandidates.find((candidate) => candidate && fs.existsSync(candidate)) })); }
function getNativeHostDir() { return IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Soterios', 'browser-extension') : path.join(process.env.HOME || '', '.local', 'share', 'soterios', 'browser-extension'); }

function findAppPath(overridden) {
  if (overridden && fs.existsSync(overridden)) return path.resolve(overridden);
  const candidates = [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Soterios', 'Soterios.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Soterios', 'Soterios.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Soterios', 'Soterios.exe')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function predictExtensionId(extDir) {
  const hash = crypto.createHash('sha256').update(path.resolve(extDir)).digest('hex'); const chars = 'abcdefghijklmnop'; let id = '';
  for (let index = 0; index < 32; index += 1) id += chars[parseInt(hash[index], 16)];
  return id;
}

function validateExtensionDirectory(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('The built extension manifest is missing.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3 || manifest.version !== EXPECTED_EXTENSION_VERSION) throw new Error(`Expected extension ${EXPECTED_EXTENSION_VERSION}, found ${manifest.version || 'an invalid manifest'}.`);
  if (manifest.content_scripts || (manifest.permissions || []).includes('<all_urls>')) throw new Error('The extension build contains an unsafe static site-access declaration.');
  for (const required of ['background.js', 'content.js', 'popup.html', 'options.html', 'onboarding.html', 'activity.html', 'icons/icon128.png']) if (!fs.existsSync(path.join(directory, required))) throw new Error(`The extension build is missing ${required}.`);
  return manifest;
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true }); let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copied += copyDirectory(from, to); else { fs.copyFileSync(from, to); copied += 1; }
  }
  return copied;
}

function writeNativeHostFiles(stagingDir, finalDir, appPath, extensionId, nativeHostBinary) {
  if (!nativeHostBinary || !fs.existsSync(nativeHostBinary)) throw new Error('The standalone native host is missing from this Soterios build.');
  const hostDir = path.join(stagingDir, 'native-host'); fs.mkdirSync(hostDir, { recursive: true });
  const executableName = 'SoteriosNativeHost.exe'; const stagedExecutable = path.join(hostDir, executableName); fs.copyFileSync(nativeHostBinary, stagedExecutable);
  fs.writeFileSync(path.join(hostDir, 'native-host-config.json'), `${JSON.stringify({ schema: 2, appPath: path.resolve(appPath) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const manifest = { name: NATIVE_HOST_NAME, description: 'Soterios local browser protection bridge', path: path.join(finalDir, 'native-host', executableName), type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] };
  const manifestPath = path.join(stagingDir, 'native-host-manifest.json'); fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifestPath: path.join(finalDir, 'native-host-manifest.json'), executablePath: path.join(finalDir, 'native-host', executableName) };
}

function atomicStageExtension(srcDir, destination, options) {
  validateExtensionDirectory(srcDir);
  const parent = path.dirname(destination); fs.mkdirSync(parent, { recursive: true });
  const staging = `${destination}.staging-${process.pid}`; const backup = `${destination}.backup-${process.pid}`;
  for (const target of [staging, backup]) if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  let movedExisting = false;
  try {
    const copied = copyDirectory(srcDir, staging);
    const extensionId = predictExtensionId(destination);
    const native = writeNativeHostFiles(staging, destination, options.appPath, extensionId, options.nativeHostBinary);
    validateExtensionDirectory(staging);
    const stagedHost = JSON.parse(fs.readFileSync(path.join(staging, 'native-host-manifest.json'), 'utf8'));
    if (stagedHost.allowed_origins[0] !== `chrome-extension://${extensionId}/` || !fs.existsSync(path.join(staging, 'native-host', 'SoteriosNativeHost.exe'))) throw new Error('Native-host staging validation failed.');
    if (fs.existsSync(destination)) { fs.renameSync(destination, backup); movedExisting = true; }
    fs.renameSync(staging, destination);
    if (movedExisting && fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    return { copied, extensionId, ...native };
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (movedExisting && !fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
    throw error;
  }
}

function registerNativeHost(browserId, manifestPath) {
  if (!IS_WIN) return { ok: false, error: 'Windows only' }; const browser = getBrowser(browserId); if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` };
  try { execFileSync('reg.exe', ['add', `${browser.nativeHive}\\${NATIVE_HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true, stdio: 'pipe' }); return { ok: true }; } catch (error) { return { ok: false, error: error.message || String(error) }; }
}
function unregisterNativeHost(browserId) { if (!IS_WIN) return { ok: false, error: 'Windows only' }; const browser = getBrowser(browserId); if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` }; try { execFileSync('reg.exe', ['delete', `${browser.nativeHive}\\${NATIVE_HOST_NAME}`, '/f'], { windowsHide: true, stdio: 'pipe' }); } catch (_) {} return { ok: true }; }
function getNativeHostStatus(browserId) { if (!IS_WIN) return false; const browser = getBrowser(browserId); if (!browser) return false; try { execFileSync('reg.exe', ['query', `${browser.nativeHive}\\${NATIVE_HOST_NAME}`, '/ve'], { windowsHide: true, stdio: 'pipe' }); return true; } catch (_) { return false; } }

function isExtensionLoaded(browserId, extensionId) {
  if (!IS_WIN) return false; const browser = getBrowser(browserId); if (!browser) return false;
  for (const userDataDir of browser.userDataCandidates) {
    if (!userDataDir || !fs.existsSync(userDataDir)) continue;
    let profiles = []; try { profiles = fs.readdirSync(userDataDir, { withFileTypes: true }); } catch (_) { continue; }
    for (const profile of profiles) { if (!profile.isDirectory()) continue; const preferences = path.join(userDataDir, profile.name, 'Preferences'); if (!fs.existsSync(preferences)) continue; try { const data = JSON.parse(fs.readFileSync(preferences, 'utf8')); if (data?.extensions?.settings?.[extensionId]) return true; } catch (_) {} }
  }
  return false;
}
function openExtensionsPage(browserId) { const browser = getBrowser(browserId); if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` }; const executable = browser.exeCandidates.find((candidate) => candidate && fs.existsSync(candidate)); if (!executable) return { ok: false, error: `${browser.name} is not installed` }; try { spawn(executable, [browser.extensionsUrl], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; } catch (error) { return { ok: false, error: error.message || String(error) }; } }

function readVersion(directory) { try { return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).version || null; } catch (_) { return null; } }
function install(browserId, { srcDir, appPath, nativeHostBinary } = {}) {
  const browser = getBrowser(browserId); if (!browser) return { ok: false, error: `Unknown browser: ${browserId}` }; if (!browser.exeCandidates.some((candidate) => candidate && fs.existsSync(candidate))) return { ok: false, error: `${browser.name} is not installed` };
  try {
    const extDir = getNativeHostDir(); const staged = atomicStageExtension(srcDir, extDir, { appPath: appPath || findAppPath(), nativeHostBinary });
    const host = registerNativeHost(browser.id, staged.manifestPath); const page = openExtensionsPage(browser.id);
    return { ok: true, browser: browser.id, extensionId: staged.extensionId, extDir, manifestPath: staged.manifestPath, installedVersion: readVersion(extDir), extensionsUrl: browser.extensionsUrl, nativeHostOk: host.ok, nativeHostBinaryPresent: fs.existsSync(staged.executablePath), pageOpened: page.ok };
  } catch (error) { return { ok: false, error: error.message || String(error) }; }
}
function getState({ bundledDir } = {}) {
  const extDir = getNativeHostDir(); const extDirExists = fs.existsSync(extDir); const extensionId = predictExtensionId(extDir); const hostBinary = path.join(extDir, 'native-host', 'SoteriosNativeHost.exe');
  return { extensionId, extDir, extDirExists, installedVersion: readVersion(extDir), bundledVersion: bundledDir ? readVersion(bundledDir) : null, nativeHostBinaryPresent: fs.existsSync(hostBinary), browsers: BROWSERS.map((browser) => ({ id: browser.id, name: browser.name, installed: browser.exeCandidates.some((candidate) => candidate && fs.existsSync(candidate)), extensionsUrl: browser.extensionsUrl, loaded: extDirExists ? isExtensionLoaded(browser.id, extensionId) : false, nativeHostActive: getNativeHostStatus(browser.id) })) };
}

module.exports = { IS_WIN, BROWSERS, NATIVE_HOST_NAME, EXPECTED_EXTENSION_VERSION, getBrowser, detectInstalledBrowsers, getNativeHostDir, findAppPath, predictExtensionId, validateExtensionDirectory, copyExtensionSource: copyDirectory, writeNativeHostFiles, registerNativeHost, unregisterNativeHost, getNativeHostStatus, isExtensionLoaded, openExtensionsPage, install, getState };
