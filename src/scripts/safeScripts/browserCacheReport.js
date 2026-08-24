'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const home = os.homedir();
const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const DEFINITIONS = [
  { id: 'chrome', name: 'Chrome', process: 'chrome.exe', type: 'chromium', root: path.join(local, 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Edge', process: 'msedge.exe', type: 'chromium', root: path.join(local, 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', name: 'Brave', process: 'brave.exe', type: 'chromium', root: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { id: 'vivaldi', name: 'Vivaldi', process: 'vivaldi.exe', type: 'chromium', root: path.join(local, 'Vivaldi', 'User Data') },
  { id: 'opera', name: 'Opera', process: 'opera.exe', type: 'opera', root: path.join(roaming, 'Opera Software', 'Opera Stable') },
  { id: 'opera-gx', name: 'Opera GX', process: 'opera.exe', type: 'opera', root: path.join(roaming, 'Opera Software', 'Opera GX Stable') },
  { id: 'firefox', name: 'Firefox', process: 'firefox.exe', type: 'firefox', root: path.join(local, 'Mozilla', 'Firefox', 'Profiles') }
];
const CHROMIUM_CACHE_NAMES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache'];
const FIREFOX_CACHE_NAMES = ['cache2', 'startupCache', 'shader-cache', 'OfflineCache'];

function runningProcesses() {
  if (process.platform !== 'win32') return Promise.resolve(new Set());
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (_error, stdout) => {
      const names = new Set(String(stdout || '').split(/\r?\n/).map((line) => {
        const match = line.match(/^"([^"]+)"/);
        return match ? match[1].toLowerCase() : '';
      }).filter(Boolean));
      resolve(names);
    });
  });
}

function dirSize(dirPath) {
  let total = 0;
  let files = 0;
  let skipped = 0;
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_) { skipped += 1; return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) { skipped += 1; continue; }
      try {
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile()) { total += fs.statSync(fullPath).size; files += 1; }
      } catch (_) { skipped += 1; }
    }
  }
  if (fs.existsSync(dirPath)) walk(dirPath);
  return { bytes: total, files, skipped };
}

function profileRoots(definition) {
  if (!fs.existsSync(definition.root)) return [];
  if (definition.type === 'opera') return [{ name: 'Default', root: definition.root }];
  let entries = [];
  try { entries = fs.readdirSync(definition.root, { withFileTypes: true }); } catch (_) { return []; }
  if (definition.type === 'firefox') {
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, root: path.join(definition.root, entry.name) }));
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && (entry.name === 'Default' || /^Profile \d+$/i.test(entry.name)))
    .map((entry) => ({ name: entry.name, root: path.join(definition.root, entry.name) }));
}

function cachePathsFor(definition, profile) {
  const names = definition.type === 'firefox' ? FIREFOX_CACHE_NAMES : CHROMIUM_CACHE_NAMES;
  return names.map((name) => path.join(profile.root, name)).filter(fs.existsSync);
}

async function discoverBrowserCaches(onProgress) {
  const processSet = await runningProcesses();
  const browsers = [];
  for (let index = 0; index < DEFINITIONS.length; index += 1) {
    const definition = DEFINITIONS[index];
    const profiles = profileRoots(definition).map((profile) => {
      const cachePaths = cachePathsFor(definition, profile);
      const totals = cachePaths.map(dirSize);
      return {
        name: profile.name,
        root: profile.root,
        cachePaths,
        sizeBytes: totals.reduce((sum, value) => sum + value.bytes, 0),
        fileCount: totals.reduce((sum, value) => sum + value.files, 0),
        skippedCount: totals.reduce((sum, value) => sum + value.skipped, 0)
      };
    });
    const sizeBytes = profiles.reduce((sum, profile) => sum + profile.sizeBytes, 0);
    browsers.push({
      id: definition.id,
      name: definition.name,
      root: definition.root,
      exists: profiles.length > 0,
      running: processSet.has(definition.process),
      processName: definition.process,
      sizeBytes,
      sizeMB: +(sizeBytes / 1024 / 1024).toFixed(1),
      profileCount: profiles.length,
      profiles
    });
    onProgress?.({
      phase: 'measuring', label: `Measuring ${definition.name} cache`,
      count: index + 1, total: DEFINITIONS.length,
      pct: Math.round(((index + 1) / DEFINITIONS.length) * 100),
      currentActivity: definition.root, cancelable: true
    });
  }
  return browsers;
}

module.exports = async function browserCacheReport(_args = {}, onProgress) {
  const browsers = await discoverBrowserCaches(onProgress);
  const found = browsers.filter((browser) => browser.exists);
  const totalBytes = found.reduce((sum, browser) => sum + browser.sizeBytes, 0);
  return {
    totalBytes,
    totalMB: +(totalBytes / 1024 / 1024).toFixed(1),
    browserCount: found.length,
    runningBrowsers: found.filter((browser) => browser.running).map((browser) => browser.name),
    browsers: found,
    privacyGuarantee: 'Only cache folders are measured. Cookies, history, passwords, bookmarks, and site storage are excluded.'
  };
};

module.exports.DEFINITIONS = DEFINITIONS;
module.exports.CANDIDATES = DEFINITIONS;
module.exports.CHROMIUM_CACHE_NAMES = CHROMIUM_CACHE_NAMES;
module.exports.FIREFOX_CACHE_NAMES = FIREFOX_CACHE_NAMES;
module.exports.discoverBrowserCaches = discoverBrowserCaches;
module.exports.dirSize = dirSize;
module.exports.browserIds = DEFINITIONS.map((definition) => definition.id);

async function listInstalledBrowsers() {
  const processSet = await runningProcesses();
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    exists: profileRoots(definition).length > 0,
    running: processSet.has(definition.process)
  }));
}
module.exports.listInstalledBrowsers = listInstalledBrowsers;
