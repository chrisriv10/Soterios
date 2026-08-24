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
    assert.ok(tables.includes('trusted_hashes'));
    const columns = service.db.prepare('PRAGMA table_info(quarantine)').all().map((c) => c.name);
    assert.ok(columns.includes('quarantine_path'));
    service.db.close();
  });

  it('add, list, and remove trusted hashes', () => {
    const service = new DatabaseService(tempDbPath());
    assert.equal(service.isHashTrusted('abc123'), false);
    service.addTrustedHash('abc123', 'C:\\x\\fp.exe', 'Some-Signature');
    service.addTrustedHash('abc123', 'C:\\x\\other.exe', 'ignored-dup');
    assert.equal(service.isHashTrusted('abc123'), true);
    assert.equal(service.isHashTrusted(''), false);

    const list = service.getTrustedHashes();
    assert.equal(list.length, 1);
    assert.equal(list[0].hash, 'abc123');
    assert.equal(list[0].original_path, 'C:\\x\\fp.exe');

    service.removeTrustedHash('abc123');
    assert.equal(service.isHashTrusted('abc123'), false);
    assert.equal(service.getTrustedHashes().length, 0);
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
    assert.deepEqual([...kept].sort((a, b) => a - b), ids.slice(-2));
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

  it('deleteMaintenanceRun removes exactly the requested row', () => {
    const service = new DatabaseService(tempDbPath());
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const result = service.addMaintenanceRun({
        startedAt: new Date(Date.now() + i).toISOString(),
        results: [{ scriptId: 'disk-space-report', ok: true }],
        dryRunCleanup: false
      });
      ids.push(Number(result.lastInsertRowid));
    }
    const target = ids[1];
    const deleted = service.deleteMaintenanceRun(target);
    assert.equal(deleted.changes, 1);
    const remaining = service.getMaintenanceHistory(10).map((row) => row.id);
    assert.deepEqual([...remaining].sort((a, b) => a - b), [ids[0], ids[2]].sort((a, b) => a - b));
    assert.equal(service.deleteMaintenanceRun(target).changes, 0);
    service.db.close();
  });

  it('addMaintenanceRun persists the source column', () => {
    const service = new DatabaseService(tempDbPath());
    const manual = service.addMaintenanceRun({
      startedAt: new Date().toISOString(),
      results: [{ scriptId: 'disk-space-report', ok: true }],
      dryRunCleanup: false,
      source: 'manual'
    });
    const row = service.db.prepare('SELECT source FROM maintenance_runs WHERE id = ?').get(Number(manual.lastInsertRowid));
    assert.equal(row.source, 'manual');
    service.db.close();
  });

  it('getScheduledMaintenanceHistory returns only scheduled and manual-scheduled runs', () => {
    const service = new DatabaseService(tempDbPath());
    const sources = ['scheduled', 'manual-scheduled', 'manual'];
    for (let i = 0; i < sources.length; i += 1) {
      service.addMaintenanceRun({
        startedAt: new Date(Date.now() + i).toISOString(),
        results: [{ scriptId: 'disk-space-report', ok: true }],
        dryRunCleanup: false,
        source: sources[i]
      });
    }
    const scheduled = service.getScheduledMaintenanceHistory(10);
    assert.equal(scheduled.length, 2);
    assert.ok(scheduled.every((row) => row.source === 'scheduled' || row.source === 'manual-scheduled'));
    assert.ok(!scheduled.some((row) => row.source === 'manual'));
    service.db.close();
  });
});

describe('DatabaseService audit_warnings', () => {
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
    const p = path.join(os.tmpdir(), `soterios-db-audit-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    tempDbs.push(p);
    return p;
  }

  it('replaceAuditWarnings stores rows and getAuditWarnings returns them', () => {
    const service = new DatabaseService(tempDbPath());
    service.replaceAuditWarnings([
      { id: 'audit:test-one', title: 'Test one', detail: 'Details', level: 'warn', scannedAt: new Date().toISOString() },
      { id: 'audit:test-two', title: 'Test two', detail: 'More details', level: 'danger', scannedAt: new Date().toISOString() }
    ]);
    const rows = service.getAuditWarnings();
    assert.equal(rows.length, 2);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId['audit:test-one'].level, 'warn');
    assert.equal(byId['audit:test-two'].level, 'danger');
    service.db.close();
  });

  it('replaceAuditWarnings overwrites previous findings', () => {
    const service = new DatabaseService(tempDbPath());
    service.replaceAuditWarnings([
      { id: 'audit:old', title: 'Old', detail: 'x', level: 'warn', scannedAt: new Date().toISOString() }
    ]);
    service.replaceAuditWarnings([]);
    assert.equal(service.getAuditWarnings().length, 0);
    service.db.close();
  });
});

describe('DatabaseService quarantine history', () => {
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
    const p = path.join(os.tmpdir(), `soterios-db-qhistory-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    tempDbs.push(p);
    return p;
  }

  function seed(service) {
    const rows = [
      { status: 'quarantined', engine: 'clamav', threatName: 'Active', originalPath: 'C:\\a.exe', quarantinePath: null, hash: null, reason: null },
      { status: 'deleted', engine: 'clamav', threatName: 'Deleted', originalPath: 'C:\\b.exe', quarantinePath: null, hash: null, reason: null },
      { status: 'restored', engine: 'clamav', threatName: 'Restored', originalPath: 'C:\\c.exe', quarantinePath: null, hash: null, reason: null }
    ];
    return rows.map((r) => {
      const id = Number(service.addQuarantineRecord(r).lastInsertRowid);
      if (r.status !== 'quarantined') service.updateQuarantineStatus(id, r.status);
      return id;
    });
  }

  it('clearQuarantineHistory removes only non-quarantined rows', () => {
    const service = new DatabaseService(tempDbPath());
    seed(service);
    const result = service.clearQuarantineHistory();
    assert.equal(result.changes, 2);
    const remaining = service.db.prepare("SELECT * FROM quarantine WHERE status = 'quarantined'").all();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].threat_name, 'Active');
    service.db.close();
  });

  it('deleteQuarantineHistory removes selected history rows by id', () => {
    const service = new DatabaseService(tempDbPath());
    const ids = seed(service);
    const result = service.deleteQuarantineHistory([ids[1], ids[2]]);
    assert.equal(result.changes, 2);
    const remaining = service.db.prepare('SELECT * FROM quarantine').all();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, ids[0]);
    service.db.close();
  });

  it('deleteQuarantineHistory never removes active quarantined rows', () => {
    const service = new DatabaseService(tempDbPath());
    const ids = seed(service);
    const result = service.deleteQuarantineHistory([ids[0], ids[1]]);
    assert.equal(result.changes, 1);
    const active = service.db.prepare("SELECT * FROM quarantine WHERE status = 'quarantined'").all();
    assert.equal(active.length, 1);
    assert.equal(active[0].id, ids[0]);
    service.db.close();
  });

  it('deleteQuarantineHistory with empty array is a no-op', () => {
    const service = new DatabaseService(tempDbPath());
    seed(service);
    const result = service.deleteQuarantineHistory([]);
    assert.equal(result.changes, 0);
    assert.equal(service.db.prepare('SELECT COUNT(*) AS n FROM quarantine').get().n, 3);
    service.db.close();
  });
});
