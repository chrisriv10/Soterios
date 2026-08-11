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

The browser extension files ship with Soterios.

SETUP INSTRUCTIONS:

  1. Ensure Soterios is installed (default: C:\\Program Files\\Soterios\\Soterios.exe)
  2. Run: node tools/install-native-host.js
     (This configures the native messaging host for Chrome/Edge)
  3. Open Chrome/Edge and go to: chrome://extensions
  4. Enable "Developer mode" (top-right toggle)
  5. Click "Load unpacked" and select: ${extDir}
  6. Note the extension ID that appears
  7. Edit native-host-manifest.json and replace __REPLACE_WITH_EXTENSION_ID__
  8. Re-run: node tools/install-native-host.js
  9. Reload the extension

TROUBLESHOOTING:
  - If popup shows "Soterios app connected: No"
    - Ensure Soterios desktop app is running
    - Re-run: node tools/install-native-host.js

For support: https://github.com/chrisriv10/Soterios/issues
`);
