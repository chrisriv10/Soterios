const fs = require('fs');
const path = require('path');

/**
 * Copy the app icon into the browser extension at multiple sizes.
 *
 * This is a simple copy operation; the browser handles scaling.
 * For true resizing, an image-processing library would be required.
 */

const sizes = [16, 32, 48, 128];
const sourcePath = path.join(__dirname, '../assets/icon.png');
const iconsDir = path.join(__dirname, '../browser-extension/icons');

if (!fs.existsSync(sourcePath)) {
  console.error('icon.png not found');
  process.exit(1);
}

// Copy the source icon to all required sizes
// Note: This doesn't resize the images - the browser will scale them appropriately
// For proper resizing, you would need an image processing library like sharp or canvas
// which requires native dependencies that may not be available in all environments
for (const size of sizes) {
  const outPath = path.join(iconsDir, `icon${size}.png`);
  try {
    fs.copyFileSync(sourcePath, outPath);
    console.log(`Copied ${outPath} (using original size, browser will scale)`);
  } catch (e) {
    console.error(`Failed to copy ${size}px icon:`, e.message);
    process.exit(1);
  }
}