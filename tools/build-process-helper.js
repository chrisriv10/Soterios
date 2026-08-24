'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { windowsRustEnvironment } = require('./windows-rust-env');

const root = path.join(__dirname, '..');
const crate = path.join(root, 'native', 'process-inspector');
const outputDir = path.join(root, 'build', 'native');
const executable = path.join(crate, 'target', 'release', 'soterios-process-inspector.exe');

if (process.platform !== 'win32') {
  console.log('Process helper is Windows-only; skipping native build.');
  process.exit(0);
}

const result = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml')], {
  cwd: root,
  env: windowsRustEnvironment(),
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.existsSync(executable)) throw new Error(`Native process helper was not produced: ${executable}`);

fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, path.basename(executable));
fs.copyFileSync(executable, target);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(path.join(outputDir, 'checksums.json'), JSON.stringify({ [path.basename(target)]: sha256 }, null, 2) + '\n');
console.log(`Built ${target}`);
console.log(`SHA-256 ${sha256}`);
