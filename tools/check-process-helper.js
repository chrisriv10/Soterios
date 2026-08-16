'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { windowsRustEnvironment } = require('./windows-rust-env');

const root = path.join(__dirname, '..');
const manifest = path.join(root, 'native', 'process-inspector', 'Cargo.toml');
const env = windowsRustEnvironment();
const commands = [
  ['fmt', '--manifest-path', manifest, '--', '--check'],
  ['clippy', '--locked', '--manifest-path', manifest, '--', '-D', 'warnings'],
];

for (const args of commands) {
  const result = spawnSync('cargo', args, { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
