const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const sizes = [16, 32, 48, 128];
const sourcePath = path.join(__dirname, '..', 'assets/icon.png');
const iconsDir = path.join(__dirname, '..', 'browser-extension/icons');

if (!fs.existsSync(sourcePath)) {
  console.error('icon.png not found at:', sourcePath);
  process.exit(1);
}

(async () => {
  try {
    const image = await Jimp.read(sourcePath);
    for (const size of sizes) {
      const outPath = path.join(iconsDir, `icon${size}.png`);
      const resized = image.clone().cover({ w: size, h: size });
      resized.write(outPath);
      console.log(`Generated ${outPath} (${size}x${size})`);
    }
    console.log('\nAll icons generated successfully!');
  } catch (err) {
    console.error('Failed to generate icons:', err.message);
    process.exit(1);
  }
})();
