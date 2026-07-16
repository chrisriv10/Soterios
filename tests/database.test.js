'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const DatabaseService = require('../src/core/database');

describe('DatabaseService quarantine_path migration', () => {
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
    const p = path.join(os.tmpdir(), `soterios-db-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    tempDbs.push(p);
    return p;
  }

  it('adds quarantine_path when migrating a legacy schema', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_path TEXT,
        hash TEXT,
        engine TEXT,
        threat_name TEXT,
        date_quarantined DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        status TEXT DEFAULT 'quarantined'
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    legacy.prepare('INSERT INTO quarantine (original_path, hash, engine, threat_name, reason) VALUES (?, ?, ?, ?, ?)').run(
      'C\\\\temp\\\\old.exe',
      'abc',
      'legacy',
      'LegacyThreat',
      'pre-migration'
    );
    legacy.prepare("INSERT INTO settings (key, value) VALUES ('ui.theme', ?)").run(JSON.stringify('ocean'));
    legacy.close();

    const service = new DatabaseService(dbPath);
    const columns = service.db.prepare('PRAGMA table_info(quarantine)').all().map((c) => c.name);
    assert.ok(columns.includes('quarantine_path'));

    const row = service.db.prepare('SELECT original_path, quarantine_path, threat_name FROM quarantine').get();
    assert.equal(row.original_path, 'C\\\\temp\\\\old.exe');
    assert.equal(row.threat_name, 'LegacyThreat');
    assert.equal(row.quarantine_path, null);

    assert.equal(service.getSetting('ui.theme'), 'ocean');
    service.db.close();
  });

  it('keeps existing quarantine_path schema intact on re-init', () => {
    const dbPath = tempDbPath();
    const service1 = new DatabaseService(dbPath);
    service1.addQuarantineRecord({
      originalPath: 'C\\\\a.exe',
      quarantinePath: 'C\\\\q\\\\a.encrypted',
      hash: 'h1',
      engine: 'test',
      threatName: 'T',
      reason: 'r'
    });
    service1.db.close();

    const service2 = new DatabaseService(dbPath);
    const columns = service2.db.prepare('PRAGMA table_info(quarantine)').all().map((c) => c.name);
    assert.equal(columns.filter((n) => n === 'quarantine_path').length, 1);

    const row = service2.db.prepare('SELECT quarantine_path FROM quarantine').get();
    assert.equal(row.quarantine_path, 'C\\\\q\\\\a.encrypted');
    service2.db.close();
  });

  it('creates missing quarantine table on a blank database file', () => {
    const dbPath = tempDbPath();
    fs.writeFileSync(dbPath, '');
    const service = new DatabaseService(dbPath);
    const tables = service.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('quarantine'));
    const columns = service.db.prepare('PRAGMA table_info(quarantine)').all().map((c) => c.name);
    assert.ok(columns.includes('quarantine_path'));
    service.db.close();
  });

  it('throws when opening a corrupted database file', () => {
    const dbPath = tempDbPath();
    fs.writeFileSync(dbPath, 'this is not a sqlite database');
    assert.throws(() => new DatabaseService(dbPath), /not a database|SQLite|unable to open|disk image/i);
  });

  it('throws when quarantine exists but is not a usable table', () => {
    const dbPath = tempDbPath();
    const broken = new Database(dbPath);
    broken.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE VIEW quarantine AS SELECT 1 AS id;
    `);
    broken.close();
    assert.throws(() => new DatabaseService(dbPath), /./);
  });
});

describe('DatabaseService maintenance_runs', () => {
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
    const p = path.join(os.tmpdir(), `soterios-db-maint-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    tempDbs.push(p);
    return p;
  }

  it('pruneMaintenanceRuns keeps the most recent rows', () => {
    const service = new DatabaseService(tempDbPath());
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const result = service.addMaintenanceRun({
        startedAt: new Date(Date.now() + i).toISOString(),
        results: [{ scriptId: 'disk-space-report', ok: true }],
        dryRunCleanup: false
      });
      ids.push(Number(result.lastInsertRowid));
    }
    service.pruneMaintenanceRuns(2);
    const kept = service.getMaintenanceHistory(10).map((row) => row.id);
    assert.deepEqual(kept, ids.slice(-2));
    service.db.close();
  });

  it('getMaintenanceHistory omits raw results_json from returned rows', () => {
    const service = new DatabaseService(tempDbPath());
    service.addMaintenanceRun({
      startedAt: new Date().toISOString(),
      results: [{ scriptId: 'disk-space-report', ok: true }],
      dryRunCleanup: true
    });
    const [row] = service.getMaintenanceHistory(1);
    assert.ok(Array.isArray(row.results));
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'results_json'), false);
    service.db.close();
  });
});
