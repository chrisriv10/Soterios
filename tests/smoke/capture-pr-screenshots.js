'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'tests/fixtures/screenshots');
const electronBin = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron');

function capturePage(name, page, extraArgs = []) {
  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, `${name}.png`);
  console.log(`Capturing ${name} ...`);

  const args = [
    ROOT,
    '--dev',
    '--screenshot-capture',
    `--screenshot-page=${page}`,
    `--screenshot-out=${outPath}`,
    ...extraArgs
  ];

  const result = spawnSync(electronBin, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`Screenshot capture failed for ${name} (exit ${result.status ?? 'unknown'})`);
  }
  if (!fs.existsSync(outPath)) {
    throw new Error(`Screenshot file was not created: ${outPath}`);
  }
  console.log(`Saved ${outPath}`);
}

function uninstallerFixtureName() {
  if (process.platform === 'darwin') return '03-uninstaller-unsupported';
  if (process.platform === 'win32') return '03-uninstaller-windows';
  return '03-uninstaller-linux-unsupported';
}

capturePage('01-dashboard', 'dashboard');
capturePage('02-tools-page', 'tools');
capturePage('04-settings-language', 'settings');
capturePage(uninstallerFixtureName(), 'tools', ['--screenshot-run-uninstaller']);

console.log(`Screenshots saved under ${OUT}`);
