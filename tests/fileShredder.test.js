'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers } = require('../src/tools/fileShredder');

describe('fileShredder', () => {
  let tmp;
  let filePath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-shred-'));
    filePath = path.join(tmp, 'secret.txt');
    fs.writeFileSync(filePath, 'sensitive-data-' + 'x'.repeat(2000));
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('dry-run lists files without deleting', async () => {
    const result = await helpers.shredTargets({
      targets: [filePath],
      method: 'simple',
      dryRun: true
    });
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.fileCount, 1);
    assert.ok(fs.existsSync(filePath));
  });

  it('refuses to shred without confirm', async () => {
    const result = await helpers.shredTargets({
      targets: [filePath],
      method: 'simple',
      dryRun: false,
      confirm: false
    });
    assert.equal(result.success, false);
    assert.match(result.error, /confirm/i);
    assert.ok(fs.existsSync(filePath));
  });

  it('overwrites and deletes with confirm', async () => {
    const result = await helpers.shredTargets({
      targets: [filePath],
      method: 'simple',
      confirm: true
    });
    assert.equal(result.success, true);
    assert.equal(result.fileCount, 1);
    assert.equal(fs.existsSync(filePath), false);
  });

  it('rejects unknown methods', async () => {
    const result = await helpers.shredTargets({
      targets: [filePath],
      method: 'nope',
      dryRun: true
    });
    assert.equal(result.success, false);
  });
});
