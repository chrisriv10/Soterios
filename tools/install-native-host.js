#!/usr/bin/env node
/**
 * Soterios Browser Extension - Setup Tool
 *
 * This script helps set up the browser extension native messaging host.
 * The extension files are downloaded automatically by Soterios when you
 * enable the browser extension in Settings.
 *
 * Usage: node tools/install-native-host.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

console.log('[Soterios] Browser Extension Setup Helper\n');

// Find where Soterios installed the extension files
function findExtensionDir() {
  const localExtDir = path.join(process.env.LOCALAPPDATA || '', 'Soterios', 'browser-extension');
  const projectExtDir = path.resolve(__dirname, '..', 'browser-extension');

  if (fs.existsSync(localExtDir)) {
    console.log('[Soterios] Found extension files at:', localExtDir);
    return localExtDir;
  }
  if (fs.existsSync(projectExtDir)) {
    console.log('[Soterios] Found extension files at:', projectExtDir);
    return projectExtDir;
  }

  return null;
}

function setupManifest(extDir, appPath) {
  const manifestPath = path.join(extDir, 'native-host-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('[Soterios] native-host-manifest.json not found!');
    console.error('Enable the browser extension in Soterios settings first.');
    process.exit(1);
  }

  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const batPath = path.join(extDir, 'src', 'native-host.bat');
  manifest.path = batPath;

  // Check if extension ID is already set
  const currentOrigin = manifest.allowed_origins[0];
  if (currentOrigin.includes('__REPLACE_WITH_EXTENSION_ID__')) {
    console.log('\n[Soterios] IMPORTANT: Extension ID not set yet');
    console.log('This script cannot auto-detect the extension ID.');
    console.log('Steps:');
    console.log('  1. Open Chrome/Edge and go to chrome://extensions');
    console.log('  2. Enable Developer mode and load the extension folder:');
    console.log('     ' + extDir);
    console.log('  3. Note the extension ID');
    console.log('  4. Edit native-host-manifest.json');
    console.log('     Replace __REPLACE_WITH_EXTENSION_ID__ with your extension ID');
    console.log('  5. Re-run this script');
    process.exit(0);
  }

  // Update native-host.bat with app path
  const batContent = `@echo off
REM Soterios Native Messaging Host
set SOTERIOS_APP_PATH=${appPath || 'C:\\Program Files\\Soterios\\Soterios.exe'}
set NODE_PATH=%~dp0..\\..\\node_modules
node "%~dp0native-host.js" %*
`;
  fs.writeFileSync(batPath, batContent);
  console.log('[Soterios] Updated native-host.bat');

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('[Soterios] Updated native-host-manifest.json');

  return manifestPath;
}

function registerChrome(manifestPath) {
  if (!IS_WIN) return;
  const manifestName = 'com.soterios.credential_safety';
  const paths = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${manifestName}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${manifestName}`
  ];

  for (const p of paths) {
    try {
      execSync(`reg add "${p}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`, { stdio: 'pipe' });
      console.log('[Soterios] Registered with:', p.split('\\').pop());
    } catch (e) {
      console.warn('[Soterios] Failed to register:', p.split('\\').pop());
    }
  }
}

// Main
const appPath = process.env.SOTERIOS_APP_PATH || 'C:\\Program Files\\Soterios\\Soterios.exe';
const extDir = findExtensionDir();

if (!extDir) {
  console.error('[Soterios] Extension files not found.');
  console.error('Enable the browser extension in Soterios Settings to download them automatically.');
  process.exit(1);
}

const manifestPath = setupManifest(extDir, appPath);
if (IS_WIN) registerChrome(manifestPath);

console.log('\n[Soterios] Done! Reload the extension in chrome://extensions');
