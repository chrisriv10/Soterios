const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

// Keys missing from non-English locales (but present in en.json)
const MISSING_KEYS = {
  "settings.browserExtension.cardTitle": "Browser Extension",
  "settings.browserExtension.explainer": "Install the Soterios credential-safety extension in your browsers. It checks passwords against breach databases and sends alerts to the desktop app.",
  "settings.browserExtension.checking": "Checking installed browsers...",
  "settings.browserExtension.noBrowser": "No supported browser detected (Chrome, Edge or Brave). The extension will appear here once one is installed.",
  "settings.browserExtension.chooseBrowsers": "Install the extension in these browsers:",
  "settings.browserExtension.enabledState": "enabled",
  "settings.browserExtension.saveBtn": "Apply",
  "settings.browserExtension.saved": "Done. Open or restart {browsers} to finish the setup.",
  "settings.browserExtension.savedOff": "Extension removed from all browsers. It will disappear after the browser restarts.",
  "settings.browserExtension.savedToast": "Browser extension settings saved",
  "settings.browserExtension.orgNote": "The extension installs via a browser policy, so it appears as \"Installed by your organization\" and can only be removed from here.",
  "settings.browserExtension.partialError": "Some browsers failed: {detail}",
  "settings.browserExtension.error": "Failed to update browser extension",
  "network.vpn.openWindowsSettings": "Windows Settings"
};

const files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json') && f !== 'en.json');

for (const file of files) {
  const fp = path.join(LOCALES_DIR, file);
  const content = fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '');
  const json = JSON.parse(content);
  let added = 0;
  
  for (const [key, value] of Object.entries(MISSING_KEYS)) {
    if (!(key in json)) {
      json[key] = value;
      added++;
    }
  }
  
  if (added > 0) {
    const sorted = {};
    Object.keys(json).sort().forEach(k => sorted[k] = json[k]);
    fs.writeFileSync(fp, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`${file}: added ${added} keys`);
  } else {
    console.log(`${file}: up to date`);
  }
}
console.log('Done.');