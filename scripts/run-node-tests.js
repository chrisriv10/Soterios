'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const JEST_ONLY = new Set(['passwordTools.test.js', 'reportExport.test.js']);
const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js') && !JEST_ONLY.has(name))
  .map((name) => path.join('tests', name))
  .sort();

if (!files.length) {
  console.error('No node:test files found under tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false
});
process.exit(result.status == null ? 1 : result.status);
