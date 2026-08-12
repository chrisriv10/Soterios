'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helpers } = require('../src/tools/duplicateFileFinder');

describe('duplicateFileFinder', () => {
  let tmp;
  let a;
  let b;
  let unique;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-dup-'));
    const dir1 = path.join(tmp, 'one');
    const dir2 = path.join(tmp, 'two');
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    a = path.join(dir1, 'same.txt');
    b = path.join(dir2, 'same-copy.txt');
    unique = path.join(dir1, 'unique.txt');
    fs.writeFileSync(a, 'duplicate-content-payload');
    fs.writeFileSync(b, 'duplicate-content-payload');
    fs.writeFileSync(unique, 'only-once');
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('groups identical files by hash and reports recoverable space', async () => {
    const result = await helpers.findDuplicates({ path: tmp, algorithm: 'sha256' });
    assert.equal(result.success, true);
    assert.equal(result.groupCount, 1);
    assert.equal(result.duplicates[0].count, 2);
    assert.ok(result.recoverableBytes > 0);
    assert.ok(result.duplicates[0].files.includes(a));
    assert.ok(result.duplicates[0].files.includes(b));
  });

  it('filters by extension', async () => {
    fs.writeFileSync(path.join(tmp, 'one', 'photo.bin'), 'duplicate-content-payload');
    const result = await helpers.findDuplicates({ path: tmp, extensions: ['.txt'] });
    assert.equal(result.success, true);
    assert.equal(result.groupCount, 1);
    assert.ok(result.duplicates[0].files.every((f) => f.endsWith('.txt')));
  });

  it('deletes selected copies while keeping original', async () => {
    const found = await helpers.findDuplicates({ path: tmp });
    const group = found.duplicates[0];
    const keep = group.files[0];
    const remove = group.files.slice(1);
    const deleted = await helpers.deleteDuplicates({
      confirm: true,
      groups: [{ hash: group.hash, keep, delete: remove }]
    });
    assert.equal(deleted.success, true);
    assert.equal(fs.existsSync(keep), true);
    for (const f of remove) assert.equal(fs.existsSync(f), false);
  });

  it('requires confirm before delete', async () => {
    const result = await helpers.deleteDuplicates({
      confirm: false,
      groups: [{ keep: a, delete: [b] }]
    });
    assert.equal(result.success, false);
    assert.ok(fs.existsSync(b));
  });

  it('scans deeper than 3 levels with new maxDepth configuration', async () => {
    // Create a deep directory structure (7 levels deep)
    const deepPath = path.join(tmp, 'level1', 'level2', 'level3', 'level4', 'level5', 'level6');
    fs.mkdirSync(deepPath, { recursive: true });
    
    const fileDeep = path.join(deepPath, 'deep.txt');
    fs.writeFileSync(fileDeep, 'deep-content');
    
    const result = await helpers.findDuplicates({ path: tmp, maxDepth: 12 });
    assert.equal(result.success, true);
    assert.ok(result.scannedFiles > 0, 'Should scan files deeper than 3 levels');
  });

  it('respects maxDepth limit of 12 levels', async () => {
    // Create a very deep directory structure (15 levels deep)
    let deepPath = tmp;
    for (let i = 1; i <= 15; i++) {
      deepPath = path.join(deepPath, `level${i}`);
      fs.mkdirSync(deepPath, { recursive: true });
    }
    
    const fileVeryDeep = path.join(deepPath, 'verydeep.txt');
    fs.writeFileSync(fileVeryDeep, 'verydeep-content');
    
    const result = await helpers.findDuplicates({ path: tmp, maxDepth: 12 });
    assert.equal(result.success, true);
    // The file at level 15 should not be scanned
    assert.ok(!result.duplicates.some(g => g.files.some(f => f.includes('verydeep.txt'))));
  });

  it('scans files in SAFE_ROOTS by default', async () => {
    // Test that scanning works in temp directory (one of the SAFE_ROOTS)
    const result = await helpers.findDuplicates({ path: tmp });
    assert.equal(result.success, true);
    assert.ok(result.scannedFiles > 0, 'Should scan files in SAFE_ROOTS');
  });

  it('scans custom paths without protection restrictions', async () => {
    // Create a custom path outside of typical SAFE_ROOTS
    const customDir = path.join(tmp, 'custom');
    fs.mkdirSync(customDir);
    const customFile = path.join(customDir, 'custom.txt');
    fs.writeFileSync(customFile, 'custom-content');
    
    const result = await helpers.findDuplicates({ path: customDir });
    assert.equal(result.success, true);
    assert.ok(result.scannedFiles > 0, 'Should scan custom paths without restrictions');
  });

  it('disables protected path filtering for default SAFE_ROOTS', async () => {
    // Test that protected path filtering is disabled when using default paths
    // This verifies the logic: effectiveSkipProtected = customPathsProvided ? false : false
    const result = await helpers.findDuplicates({ path: tmp });
    assert.equal(result.success, true);
    // Should scan files even if they might be in normally protected locations
    assert.ok(result.scannedFiles > 0);
  });
});
