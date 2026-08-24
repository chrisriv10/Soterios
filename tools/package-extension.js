#!/usr/bin/env node
/**
 * Soterios Browser Extension Setup Guide
 *
 * Run: node tools/package-extension.js
 *
 * This prints setup instructions. The extension files ship with Soterios.
 */

const path = require('path');

const extDir = path.resolve(__dirname, '..', 'browser-extension');

console.log(`
====================================
  Soterios Browser Extension Setup
====================================

The browser extension ships with Soterios.

QUICK SETUP (recommended):
  1. Ensure Soterios is installed (default: C:\\Program Files\\Soterios\\Soterios.exe)
  2. Run: npm run extension:install
     - Copies the extension to %LOCALAPPDATA%\\Soterios\\browser-extension
     - Predicts the extension ID from that fixed path and bakes it into
       the native host manifest (no manual ID copying or JSON editing)
     - Registers the native messaging host for Chrome, Edge and Brave
     - Opens chrome://extensions and the extension folder
  3. Click "Load unpacked" and select the folder shown in the console

  If the ID the browser shows differs from the predicted one:
  npm run extension:install -- --set-id <id-shown-by-browser>

MANUAL SETUP (fallback):
  1. Enable "Developer mode" in chrome://extensions
  2. Click "Load unpacked" and select: ${extDir}
  3. Note the extension ID
  4. Edit native-host-manifest.json and replace __REPLACE_WITH_EXTENSION_ID__
  5. Run: node tools/install-native-host.js
  6. Reload the extension

TROUBLESHOOTING:
  - If popup shows "Soterios app connected: No"
    - Ensure the Soterios desktop app is running
    - Re-run: npm run extension:install

For support: https://github.com/chrisriv10/Soterios/issues
`);
