const fs = require('fs');
const path = require('path');

/**
 * Validate the browser extension native host manifest.
 *
 * Ensures `allowed_origins` is populated with real extension IDs
 * and that the referenced host script exists on disk.
 */

function validateNativeHostManifest() {
  const manifestPath = path.join(__dirname, '..', 'browser-extension', 'native-host-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('[validate-native-host] Manifest not found:', manifestPath);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  const hasPlaceholder = origins.some((origin) => {
    const trimmed = String(origin || '').trim();
    return trimmed === 'chrome-extension://<EXTENSION_ID>/'
      || trimmed === 'chrome-extension://__EXTENSION_ID_PLACEHOLDER__/';
  });

  if (hasPlaceholder) {
    console.error('[validate-native-host] allowed_origins contains a placeholder. Replace __EXTENSION_ID_PLACEHOLDER__ with the actual Chrome extension ID before release.');
    process.exit(1);
  }

  if (!origins.length) {
    console.error('[validate-native-host] allowed_origins is empty. Add at least one allowed origin.');
    process.exit(1);
  }

  // Verify the native-host.bat file referenced in manifest.path exists.
  const hostScript = path.join(__dirname, '..', 'browser-extension', manifest.path);
  if (!fs.existsSync(hostScript)) {
    console.error('[validate-native-host] Native host script not found:', hostScript);
    process.exit(1);
  }

  console.log('[validate-native-host] OK — allowed_origins:', origins.join(', '));
}

validateNativeHostManifest();
