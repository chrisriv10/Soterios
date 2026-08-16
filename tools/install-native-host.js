#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');
const installer = require('../src/extension/installer');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'browser-extension', 'dist', 'chromium');
const nativeHostBinary = path.join(repoRoot, 'build', 'native-host', 'SoteriosNativeHost.exe');
const requestedBrowser = process.argv.slice(2).find((value) => ['chrome', 'edge', 'brave'].includes(value));
const browsers = requestedBrowser ? [installer.getBrowser(requestedBrowser)] : installer.detectInstalledBrowsers().map(({ id }) => installer.getBrowser(id));

if (!browsers.length) { console.error('[Soterios] Chrome, Edge, or Brave was not detected.'); process.exit(1); }
for (const browser of browsers) {
  const result = installer.install(browser.id, { srcDir: sourceDir, nativeHostBinary, appPath: installer.findAppPath() });
  if (!result.ok) { console.error(`[Soterios] ${browser.name}: ${result.error}`); process.exitCode = 1; continue; }
  console.log(`[Soterios] ${browser.name}: extension ${result.installedVersion} staged atomically at ${result.extDir}`);
  console.log(`[Soterios] Native host: ${result.nativeHostOk ? 'registered' : 'registration failed'}`);
  try { spawn('explorer.exe', [result.extDir], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
  console.log(`Enable Developer mode, choose “Load unpacked,” and select:\n${result.extDir}\nExpected extension ID: ${result.extensionId}`);
}
