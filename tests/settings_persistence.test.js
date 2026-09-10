'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DatabaseService = require('../src/core/database');

describe('DatabaseService settings persistence', () => {
  const tempDbs = [];

  afterEach(() => {
    while (tempDbs.length) {
      const p = tempDbs.pop();
      try { fs.rmSync(p, { force: true }); } catch (_) {}
      try { fs.rmSync(p + '-wal', { force: true }); } catch (_) {}
      try { fs.rmSync(p + '-shm', { force: true }); } catch (_) {}
    }
  });

  function tempDbPath() {
    const p = path.join(os.tmpdir(), `soterios-db-persist-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    tempDbs.push(p);
    return p;
  }

  it('persists settings across separate DatabaseService instances (restart simulation)', () => {
    const dbPath = tempDbPath();
    const allowlist = ['node_modules', 'dist', 'build', '.git'];

    // First instance: save settings
    const db1 = new DatabaseService(dbPath);
    db1.setSetting('scan.allowlist', allowlist);
    db1.setSetting('ui.theme', 'dark');
    db1.setSetting('scan.maxDepth', 5);
    db1.setSetting('alerts.enabled', true);
    db1.db.close();

    // Second instance: read from the same file (simulates a restart)
    const db2 = new DatabaseService(dbPath);
    assert.deepEqual(db2.getSetting('scan.allowlist'), allowlist);
    assert.equal(db2.getSetting('ui.theme'), 'dark');
    assert.equal(db2.getSetting('scan.maxDepth'), 5);
    assert.equal(db2.getSetting('alerts.enabled'), true);
    db2.db.close();
  });

  it('retrieves the same value for complex objects after restart', () => {
    const dbPath = tempDbPath();
    const complexValue = {
      rules: [
        { name: 'rule1', patterns: ['*.exe', '*.dll'], action: 'quarantine' },
        { name: 'rule2', patterns: ['*.tmp'], action: 'ignore' }
      ],
      defaultAction: 'scan'
    };

    const db1 = new DatabaseService(dbPath);
    db1.setSetting('scanning.rules', complexValue);
    db1.db.close();

    const db2 = new DatabaseService(dbPath);
    assert.deepEqual(db2.getSetting('scanning.rules'), complexValue);
    db2.db.close();
  });

  it('returns null (default) for a missing key after restart', () => {
    const dbPath = tempDbPath();

    const db1 = new DatabaseService(dbPath);
    db1.setSetting('existing.key', 'yes');
    db1.db.close();

    const db2 = new DatabaseService(dbPath);
    assert.equal(db2.getSetting('nonexistent.key'), null);
    assert.equal(db2.getSetting('nonexistent.key', 'fallback'), 'fallback');
    assert.equal(db2.getSetting('existing.key'), 'yes');
    db2.db.close();
  });

  it('allows overwriting a setting and persists the new value', () => {
    const dbPath = tempDbPath();

    const db1 = new DatabaseService(dbPath);
    db1.setSetting('version', 1);
    db1.db.close();

    const db2 = new DatabaseService(dbPath);
    assert.equal(db2.getSetting('version'), 1);
    db2.setSetting('version', 2);
    db2.db.close();

    const db3 = new DatabaseService(dbPath);
    assert.equal(db3.getSetting('version'), 2);
    db3.db.close();
  });

  it('handles the full scan settings lifecycle with a real DB', () => {
    const dbPath = tempDbPath();
    const fullSettings = {
      allowlist: ['/home/user/projects'],
      blocklist: ['/tmp/suspicious'],
      maxFileSize: 104857600,
      scanOnStart: false,
      realTimeProtection: true
    };

    // Write all settings in one session
    const db1 = new DatabaseService(dbPath);
    for (const [key, value] of Object.entries(fullSettings)) {
      db1.setSetting(`scan.${key}`, value);
    }
    db1.db.close();

    // Verify all settings survive a restart
    const db2 = new DatabaseService(dbPath);
    assert.deepEqual(db2.getSetting('scan.allowlist'), fullSettings.allowlist);
    assert.deepEqual(db2.getSetting('scan.blocklist'), fullSettings.blocklist);
    assert.equal(db2.getSetting('scan.maxFileSize'), fullSettings.maxFileSize);
    assert.equal(db2.getSetting('scan.scanOnStart'), fullSettings.scanOnStart);
    assert.equal(db2.getSetting('scan.realTimeProtection'), fullSettings.realTimeProtection);
    db2.db.close();
  });
});
