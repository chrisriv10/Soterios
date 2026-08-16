'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MaintenanceSafetyVault } = require('../src/main/maintenanceSafetyVault');

function fakeDb() {
  const items = new Map();
  return {
    addVaultItem(item) { items.set(item.id, { ...item }); },
    updateVaultItem(id, status, metadata) { Object.assign(items.get(id), { status, ...(metadata ? { metadata } : {}) }); },
    getVaultItem(id) { return items.get(id) || null; },
    getVaultItems({ status, expiredBefore } = {}) {
      return [...items.values()].filter((item) => (!status || item.status === status) && (!expiredBefore || item.expiresAt <= expiredBefore));
    }
  };
}

describe('MaintenanceSafetyVault', () => {
  let base;
  let sourceDir;
  let vault;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-vault-'));
    sourceDir = path.join(base, 'source');
    const appData = path.join(base, 'appdata');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(appData);
    vault = new MaintenanceSafetyVault({ db: fakeDb(), rootPath: path.join(appData, 'vault'), applicationDataPath: appData });
  });

  afterEach(() => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {}
  });

  it('stages with a move and restores without overwriting a conflict', async () => {
    const original = path.join(sourceDir, 'report.txt');
    fs.writeFileSync(original, 'vault copy');
    const staged = await vault.stage([{ path: original }], { operation: 'test cleanup' });
    assert.equal(staged.staged.length, 1);
    assert.equal(staged.reclaimedBytes, 0);
    assert.equal(fs.existsSync(original), false);
    fs.writeFileSync(original, 'new original');
    const restored = await vault.restore(staged.staged[0].id);
    assert.equal(restored.conflictRenamed, true);
    assert.equal(fs.readFileSync(original, 'utf8'), 'new original');
    assert.equal(fs.readFileSync(restored.restoredPath, 'utf8'), 'vault copy');
  });

  it('purges a staged item and reports reclaimed bytes', async () => {
    const original = path.join(sourceDir, 'old.bin');
    fs.writeFileSync(original, Buffer.alloc(2048, 7));
    const staged = await vault.stage([original], { operation: 'test cleanup' });
    const purged = await vault.purge(staged.staged[0].id);
    assert.equal(purged.status, 'purged');
    assert.equal(purged.reclaimedBytes, 2048);
    assert.equal(fs.existsSync(staged.staged[0].vaultPath), false);
  });
});

