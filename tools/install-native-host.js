#!/usr/bin/env node
/**
 * Install Soterios Native Messaging Host
 * Run as Administrator on Windows
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSION_ID = process.env.EXTENSION_ID || 'YOUR_EXTENSION_ID_HERE';
const IS_WIN = process.platform === 'win32';

function main() {
  const extDir = path.resolve(__dirname, '..', 'browser-extension');
  const manifestPath = path.join(extDir, 'native-host-manifest.json');
  const batPath = path.join(extDir, 'native-host.bat');
  const jsPath = path.join(extDir, 'native-host.js');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(batPath) || !fs.existsSync(jsPath)) {
    console.error('Extension files not found. Run from project root.');
    process.exit(1);
  }

  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.allowed_origins = [manifest.allowed_origins[0].replace('<EXTENSION_ID>', EXTENSION_ID)];
  
  // Write updated manifest back to disk so registry points to correct file
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  if (IS_WIN) {
    const regPath = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${manifest.name}`;
    const regCmd = `reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`;
    try {
      execSync(regCmd, { stdio: 'inherit' });
      console.log('Registered native host for Chrome (Current User)');
    } catch (e) {
      console.error('Failed to register (run as Administrator):', e.message);
      process.exit(1);
    }

    const regPathEdge = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${manifest.name}`;
    const regCmdEdge = `reg add "${regPathEdge}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`;
    try {
      execSync(regCmdEdge, { stdio: 'inherit' });
      console.log('Registered native host for Edge (Current User)');
    } catch (e) {
      console.warn('Edge registration failed:', e.message);
    }
  } else {
    const dir = process.platform === 'darwin'
      ? path.join(process.env.HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
      : path.join(process.env.HOME, '.config', 'google-chrome', 'NativeMessagingHosts');

    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${manifest.name}.json`);
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
    console.log('Installed manifest to:', target);
  }

  console.log('\nDone! Reload the extension in chrome://extensions');
}

main();