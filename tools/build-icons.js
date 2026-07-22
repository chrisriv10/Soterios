const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const svgPath = path.join(__dirname, '../browser-extension/icons/icon.svg');
const iconsDir = path.join(__dirname, '../browser-extension/icons');

if (!fs.existsSync(svgPath)) {
  console.error('icon.svg not found');
  process.exit(1);
}

for (const size of sizes) {
  const outPath = path.join(iconsDir, `icon${size}.png`);
  try {
    execSync(`npx -y svgexport "${svgPath}" "${outPath}" ${size}:${size}`, { stdio: 'inherit' });
    console.log(`Generated ${outPath}`);
  } catch (e) {
    console.error(`Failed to generate ${size}px icon:`, e.message);
  }
}