'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DatabaseService = require('../src/core/database');
const QuarantineManager = require('../src/security/QuarantineManager');

describe('QuarantineManager workflow', () => {
  let tmpRoot;
  let db;
  let manager;
  let originalPath;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-quarantine-'));
    const dbPath = path.join(tmpRoot, 'test.db');
    const quarantineDir = path.join(tmpRoot, 'quarantine');
    db = new DatabaseService(dbPath);
    manager = new QuarantineManager(db, { quarantineDir });

    originalPath = path.join(tmpRoot, 'sample.txt');
    fs.writeFileSync(originalPath, 'hello-quarantine-payload');
  });

  afterEach(() => {
    try { db.db.close(); } catch (_) {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('quarantines a file with XOR obfuscation and removes the original', async () => {
    const result = await manager.quarantine(originalPath, 'hash1', 'test', 'EICAR', 'unit-test');
    assert.equal(result.success, true);
    assert.ok(result.id);

    assert.equal(fs.existsSync(originalPath), false);

    const row = db.db.prepare('SELECT * FROM quarantine WHERE id = ?').get(result.id);
    assert.ok(row);
    assert.equal(row.status, 'quarantined');
    assert.ok(row.quarantine_path);
    assert.equal(fs.existsSync(row.quarantine_path), true);

    const encrypted = fs.readFileSync(row.quarantine_path);
    assert.notEqual(encrypted.toString('utf8'), 'hello-quarantine-payload');
  });

  it('restores quarantined file contents byte-for-byte', async () => {
    const created = await manager.quarantine(originalPath, 'hash2', 'test', 'Threat', 'restore-test');
    const restored = await manager.restore(created.id);
    assert.equal(restored.success, true);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');

    const row = db.db.prepare('SELECT * FROM quarantine WHERE id = ?').get(created.id);
    assert.equal(row.status, 'restored');
    assert.equal(fs.existsSync(row.quarantine_path), false);
  });

  it('deletes a quarantined file permanently', async () => {
    const created = await manager.quarantine(originalPath, 'hash3', 'test', 'Threat', 'delete-test');
    const qPath = db.db.prepare('SELECT quarantine_path FROM quarantine WHERE id = ?').get(created.id).quarantine_path;
    const deleted = await manager.delete(created.id);
    assert.equal(deleted.success, true);
    assert.equal(fs.existsSync(qPath), false);

    const row = db.db.prepare('SELECT status FROM quarantine WHERE id = ?').get(created.id);
    assert.equal(row.status, 'deleted');
  });

  it('returns an error when the original file does not exist', async () => {
    const missing = path.join(tmpRoot, 'missing.bin');
    const result = await manager.quarantine(missing, 'hash4', 'test', 'Threat', 'missing');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('rejects restore for an already-processed record', async () => {
    const created = await manager.quarantine(originalPath, 'hash5', 'test', 'Threat', 'twice');
    await manager.delete(created.id);
    const restored = await manager.restore(created.id);
    assert.equal(restored.success, false);
  });

  it('returns an error when the source file cannot be read due to permissions', async () => {
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = (p, ...args) => {
      if (p === originalPath) throw new Error('EACCES: permission denied, read \'' + originalPath + '\'');
      return originalReadFileSync(p, ...args);
    };
    try {
      const result = await manager.quarantine(originalPath, 'hash6', 'test', 'Threat', 'perms');
      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.match(String(result.error), /EACCES|permission|EPERM|read/i);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('restoreAndTrust restores the file and adds its hash to the whitelist', async () => {
    const created = await manager.quarantine(originalPath, 'trustedhash1', 'test', 'Threat', 'trust-test');
    const result = await manager.restoreAndTrust(created.id);
    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');

    const row = db.db.prepare('SELECT * FROM quarantine WHERE id = ?').get(created.id);
    assert.equal(row.status, 'restored');
    assert.equal(db.isHashTrusted('trustedhash1'), true);

    const trusted = db.getTrustedHashes();
    assert.ok(trusted.some((h) => h.hash === 'trustedhash1'));
    assert.equal(trusted.find((h) => h.hash === 'trustedhash1').original_path, originalPath);
  });

  it('restoreAndTrust reports failure when restore fails', async () => {
    const created = await manager.quarantine(originalPath, 'trustedhash2', 'test', 'Threat', 'trust-fail');
    await manager.delete(created.id);
    const result = await manager.restoreAndTrust(created.id);
    assert.equal(result.success, false);
    assert.equal(db.isHashTrusted('trustedhash2'), false);
  });
});
