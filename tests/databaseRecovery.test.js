'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DatabaseService = require('../src/core/database');
const {
  openApplicationDatabaseWithRecovery,
  isConfirmedCorruptionError,
  formatRecoveryId,
  collectFamilySources,
} = require('../src/main/databaseRecovery');

const GARBAGE = 'this is not a sqlite database, just garbage bytes';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-dbrecovery-'));
}

function rmDir(dir) {
  // Windows virus scanners/indexers may briefly hold new temp files; retry
  // cleanup briefly rather than failing the test run on teardown.
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  throw lastError;
}

function dbPathIn(dir) {
  return path.join(dir, 'soterios.db');
}

function writeGarbageDb(dbPath, payload = GARBAGE) {
  fs.writeFileSync(dbPath, payload);
}

function seedHealthyDb(dbPath) {
  const db = new DatabaseService(dbPath);
  db.setSetting('ui.theme', 'dark');
  db.addAlert({ severity: 'info', title: 'seed', message: 'seed alert' });
  db.db.close();
  return dbPath;
}

function corruptNames(dir) {
  return fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'));
}

function failingFs({ renameFailOnCall = -1 } = {}) {
  let calls = 0;
  return {
    existsSync: (...args) => fs.existsSync(...args),
    statSync: (...args) => fs.statSync(...args),
    renameSync: (...args) => {
      calls += 1;
      if (calls === renameFailOnCall) {
        throw new Error('EPERM: operation not permitted, rename');
      }
      return fs.renameSync(...args);
    },
  };
}

const FIXED_DATE = new Date('2026-09-25T23:15:00.123Z');
const FIXED_ID = '20260925T231500123Z';

describe('database recovery classifier', () => {
  it('confirms real better-sqlite3 corruption codes', () => {
    assert.equal(isConfirmedCorruptionError({ code: 'SQLITE_NOTADB', message: 'file is not a database' }), true);
    assert.equal(isConfirmedCorruptionError({ code: 'SQLITE_CORRUPT', message: 'database disk image is malformed' }), true);
  });

  it('rejects non-corruption SQLite codes even with alarming messages', () => {
    for (const code of ['SQLITE_CANTOPEN', 'SQLITE_READONLY', 'SQLITE_FULL', 'SQLITE_BUSY', 'SQLITE_ERROR', 'SQLITE_MISUSE']) {
      assert.equal(isConfirmedCorruptionError({ code, message: 'database disk image is malformed?' }), false, code);
    }
  });

  it('rejects non-SQLite errors unconditionally', () => {
    assert.equal(isConfirmedCorruptionError(new TypeError('Cannot open database because the directory does not exist')), false);
    assert.equal(isConfirmedCorruptionError(new Error('database connection exploded')), false);
    assert.equal(isConfirmedCorruptionError(new Error('permission denied')), false);
    assert.equal(isConfirmedCorruptionError(new Error('disk full')), false);
    for (const value of [null, undefined, 0, 'SQLITE_CORRUPT', {}, { message: 42 }]) {
      assert.equal(isConfirmedCorruptionError(value), false, JSON.stringify(value));
    }
  });

  it('applies the narrow engine-message fallback only without a usable code', () => {
    assert.equal(isConfirmedCorruptionError({ message: 'file is not a database' }), true);
    assert.equal(isConfirmedCorruptionError({ message: 'DATABASE DISK IMAGE IS MALFORMED' }), true);
    assert.equal(isConfirmedCorruptionError({ code: '', message: 'file is not a database' }), true);
    // A present-but-innocent code wins over message text: fail closed.
    assert.equal(isConfirmedCorruptionError({ code: 'SQLITE_ERROR', message: 'file is not a database' }), false);
  });

  it('formats Windows-safe collision-free recovery IDs', () => {
    assert.equal(formatRecoveryId(FIXED_DATE), FIXED_ID);
    assert.ok(!/[:*?"<>|]/.test(formatRecoveryId(new Date())));
  });
});

describe('database recovery helper: passthrough', () => {
  it('opens a healthy populated database untouched with null recovery', () => {
    const dir = tempDir();
    try {
      const dbPath = seedHealthyDb(dbPathIn(dir));
      const { db, recovery } = openApplicationDatabaseWithRecovery({ dbPath });
      try {
        assert.equal(recovery, null);
        assert.equal(db.getSetting('ui.theme'), 'dark');
        const alerts = db.getUnreadAlerts();
        assert.equal(alerts.length, 1);
        // Opening in WAL mode may create -wal/-shm sidecars; what must not
        // appear is any preserved recovery copy.
        assert.deepEqual(corruptNames(dir), []);
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });

  it('initializes a missing database normally with null recovery', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      const { db, recovery } = openApplicationDatabaseWithRecovery({ dbPath });
      try {
        assert.equal(recovery, null);
        assert.equal(fs.existsSync(dbPath), true);
        db.setSetting('k', 'v');
        assert.equal(db.getSetting('k'), 'v');
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });

  it('initializes a zero-byte database normally (not corruption)', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      fs.writeFileSync(dbPath, Buffer.alloc(0));
      const { db, recovery } = openApplicationDatabaseWithRecovery({ dbPath });
      try {
        assert.equal(recovery, null);
        assert.deepEqual(corruptNames(dir), []);
        db.setSetting('k', 'v');
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });
});

describe('database recovery helper: garbage database', () => {
  it('preserves exact bytes, creates one fresh usable database, reports metadata', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath);
      const { db, recovery } = openApplicationDatabaseWithRecovery({ dbPath, now: () => FIXED_DATE });
      try {
        assert.ok(recovery, 'expected recovery metadata');
        assert.equal(recovery.originalPath, dbPath);
        assert.equal(recovery.preservedPath, `${dbPath}.corrupt-${FIXED_ID}`);
        assert.deepEqual(recovery.preservedFiles, [`${dbPath}.corrupt-${FIXED_ID}`]);
        assert.ok(typeof recovery.reason === 'string' && recovery.reason.length > 0);
        assert.equal(recovery.sqliteCode, 'SQLITE_NOTADB');
        // Original bytes preserved exactly; canonical path is a fresh DB.
        assert.equal(fs.readFileSync(recovery.preservedPath, 'utf8'), GARBAGE);
        const row = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quarantine'").get();
        assert.ok(row, 'fresh schema must exist');
        db.setSetting('after', 'recovery');
        assert.equal(db.getSetting('after'), 'recovery');
        assert.deepEqual(corruptNames(dir), [`soterios.db.corrupt-${FIXED_ID}`]);
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });

  it('preserves WAL/SHM sidecars under the same recovery ID', () => {
    // NOTE: sidecars go through an injected strict-open failure, not a real
    // SQLite open: better-sqlite3 itself manages -wal/-shm on open (creating
    // or dropping foreign files), so byte-level fixtures can only be
    // asserted when the failed open does not touch the filesystem.
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath, 'garbage-main');
      fs.writeFileSync(`${dbPath}-wal`, 'wal-bytes-fixture');
      fs.writeFileSync(`${dbPath}-shm`, 'shm-bytes-fixture');
      const notadb = () => {
        throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
      };
      let calls = 0;
      const { db, recovery } = openApplicationDatabaseWithRecovery({
        dbPath,
        openDatabase: (targetPath) => {
          calls += 1;
          if (calls === 1) return notadb();
          return new DatabaseService(targetPath);
        },
        now: () => FIXED_DATE,
      });
      try {
        assert.deepEqual(recovery.preservedFiles, [
          `${dbPath}.corrupt-${FIXED_ID}`,
          `${dbPath}-wal.corrupt-${FIXED_ID}`,
          `${dbPath}-shm.corrupt-${FIXED_ID}`,
        ]);
        assert.equal(fs.readFileSync(`${dbPath}.corrupt-${FIXED_ID}`, 'utf8'), 'garbage-main');
        assert.equal(fs.readFileSync(`${dbPath}-wal.corrupt-${FIXED_ID}`, 'utf8'), 'wal-bytes-fixture');
        assert.equal(fs.readFileSync(`${dbPath}-shm.corrupt-${FIXED_ID}`, 'utf8'), 'shm-bytes-fixture');
        // The canonical main path is a fresh usable database, not the moved
        // original; SQLite manages its own fresh sidecars from here.
        const row = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quarantine'").get();
        assert.ok(row, 'fresh schema must exist');
        db.setSetting('k', 'v');
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });

  it('collects only existing family members, never directories', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath);
      assert.deepEqual(collectFamilySources(fs, dbPath), [dbPath]);
      fs.writeFileSync(`${dbPath}-wal`, 'x');
      assert.deepEqual(collectFamilySources(fs, dbPath), [dbPath, `${dbPath}-wal`]);
    } finally {
      rmDir(dir);
    }
  });

  it('refuses to omit a sidecar whose inspection fails (stale-WAL protection)', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath, 'garbage-main');
      fs.writeFileSync(`${dbPath}-wal`, 'wal-bytes');
      let openCalls = 0;
      const guardFs = {
        existsSync: (...args) => fs.existsSync(...args),
        statSync: (target, ...rest) => {
          if (target === `${dbPath}-wal`) {
            throw Object.assign(new Error('EPERM: operation not permitted, stat'), { code: 'EPERM' });
          }
          return fs.statSync(target, ...rest);
        },
        renameSync: (...args) => fs.renameSync(...args),
      };
      assert.throws(
        () => openApplicationDatabaseWithRecovery({
          dbPath,
          openDatabase: () => {
            openCalls += 1;
            throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
          },
          fsModule: guardFs,
          now: () => FIXED_DATE,
        }),
        /EPERM/
      );
      assert.equal(openCalls, 1, 'no fresh DB attempt after inspection failure');
      // Nothing moved, nothing created: the family is exactly as found.
      assert.equal(fs.readFileSync(dbPath, 'utf8'), 'garbage-main');
      assert.equal(fs.readFileSync(`${dbPath}-wal`, 'utf8'), 'wal-bytes');
      assert.deepEqual(corruptNames(dir), []);
    } finally {
      rmDir(dir);
    }
  });

  it('treats a raced-away file (ENOENT on stat) as absent, not fatal', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath);
      const vanishingFs = {
        existsSync: (...args) => fs.existsSync(...args),
        statSync: (target, ...rest) => {
          if (String(target).endsWith('-wal')) {
            throw Object.assign(new Error('no such file or directory, stat'), { code: 'ENOENT' });
          }
          return fs.statSync(target, ...rest);
        },
        renameSync: (...args) => fs.renameSync(...args),
      };
      let calls = 0;
      const { db, recovery } = openApplicationDatabaseWithRecovery({
        dbPath,
        openDatabase: (targetPath) => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
          return new DatabaseService(targetPath);
        },
        fsModule: vanishingFs,
        now: () => FIXED_DATE,
      });
      try {
        assert.deepEqual(recovery.preservedFiles, [`${dbPath}.corrupt-${FIXED_ID}`]);
        db.setSetting('k', 'v');
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });

  it('never overwrites a previous recovery (collision suffix)', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      const preoccupied = `${dbPath}.corrupt-${FIXED_ID}`;
      fs.writeFileSync(preoccupied, 'older-recovery');
      writeGarbageDb(dbPath);
      const { db, recovery } = openApplicationDatabaseWithRecovery({ dbPath, now: () => FIXED_DATE });
      try {
        assert.equal(fs.readFileSync(preoccupied, 'utf8'), 'older-recovery');
        assert.equal(recovery.preservedPath, `${dbPath}.corrupt-${FIXED_ID}-1`);
        assert.equal(fs.readFileSync(recovery.preservedPath, 'utf8'), GARBAGE);
      } finally {
        db.db.close();
      }
    } finally {
      rmDir(dir);
    }
  });
});

describe('database recovery helper: failure containment', () => {
  it('rolls back a partial preservation and never creates a fresh DB', () => {
    // The strict open is injected (not real SQLite) so the sidecar fixtures
    // survive until preservation: a real failed open lets SQLite itself drop
    // foreign -wal/-shm files, which would remove the multi-file move this
    // test must exercise.
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath, 'garbage-main');
      fs.writeFileSync(`${dbPath}-wal`, 'wal-bytes');
      fs.writeFileSync(`${dbPath}-shm`, 'shm-bytes');
      let calls = 0;
      assert.throws(
        () => openApplicationDatabaseWithRecovery({
          dbPath,
          openDatabase: () => {
            calls += 1;
            throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
          },
          fsModule: failingFs({ renameFailOnCall: 2 }),
          now: () => FIXED_DATE,
        }),
        /Preservation failed/
      );
      assert.equal(calls, 1, 'no fresh DB attempt after preservation failure');
      // Everything restored byte-for-byte; no leftovers; canonical DB is
      // still the original garbage (proving no fresh DB overwrote it).
      assert.equal(fs.readFileSync(dbPath, 'utf8'), 'garbage-main');
      assert.equal(fs.readFileSync(`${dbPath}-wal`, 'utf8'), 'wal-bytes');
      assert.equal(fs.readFileSync(`${dbPath}-shm`, 'utf8'), 'shm-bytes');
      assert.deepEqual(corruptNames(dir), []);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['soterios.db', 'soterios.db-shm', 'soterios.db-wal']);
    } finally {
      rmDir(dir);
    }
  });

  it('stops after one failed fresh attempt without recursion', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath);
      let calls = 0;
      const countingOpen = (targetPath) => {
        calls += 1;
        if (calls > 1) throw Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' });
        return new DatabaseService(targetPath);
      };
      assert.throws(
        () => openApplicationDatabaseWithRecovery({ dbPath, openDatabase: countingOpen, now: () => FIXED_DATE }),
        /fresh database could not be created/
      );
      assert.equal(calls, 2, 'exactly one strict attempt plus one fresh attempt');
      assert.equal(fs.readFileSync(`${dbPath}.corrupt-${FIXED_ID}`, 'utf8'), GARBAGE);
    } finally {
      rmDir(dir);
    }
  });

  it('propagates non-corruption failures without touching anything', () => {
    const cases = [
      ['cantopen-code', Object.assign(new Error('unable to open database file'), { code: 'SQLITE_CANTOPEN' })],
      ['type-error', new TypeError('Cannot open database because the directory does not exist')],
      ['generic', new Error('disk full')],
      ['full-code', Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' })],
    ];
    for (const [name, failure] of cases) {
      const dir = tempDir();
      try {
        const dbPath = dbPathIn(dir);
        writeGarbageDb(dbPath, `payload-${name}`);
        assert.throws(
          () => openApplicationDatabaseWithRecovery({
            dbPath,
            openDatabase: () => { throw failure; },
          }),
          (thrown) => thrown === failure,
          name
        );
        assert.equal(fs.readFileSync(dbPath, 'utf8'), `payload-${name}`);
        assert.deepEqual(corruptNames(dir), [], name);
      } finally {
        rmDir(dir);
      }
    }
  });

  it('leaves a valid SQLite DB with an incompatible schema alone', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      const Database = require('better-sqlite3');
      const setup = new Database(dbPath);
      setup.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);');
      setup.exec('CREATE VIEW quarantine AS SELECT 1 AS id;');
      setup.close();
      // A failed strict open performs routine SQLite open work (journal-mode
      // header write, sidecar creation), so schema objects — not raw bytes —
      // prove the file was neither replaced nor renamed.
      const beforeObjects = (() => {
        const probe = new Database(dbPath, { readonly: true });
        try {
          return probe.prepare("SELECT type, name FROM sqlite_master WHERE name IN ('settings','quarantine') ORDER BY name").all();
        } finally {
          probe.close();
        }
      })();
      assert.throws(() => openApplicationDatabaseWithRecovery({ dbPath }), /./);
      const afterObjects = (() => {
        const probe = new Database(dbPath, { readonly: true });
        try {
          return probe.prepare("SELECT type, name FROM sqlite_master WHERE name IN ('settings','quarantine') ORDER BY name").all();
        } finally {
          probe.close();
        }
      })();
      assert.deepEqual(afterObjects, beforeObjects);
      assert.deepEqual(corruptNames(dir), []);
    } finally {
      rmDir(dir);
    }
  });
});

describe('DatabaseService failed-init handle safety', () => {
  it('releases the SQLite handle so the file can be renamed immediately', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      writeGarbageDb(dbPath);
      assert.throws(() => new DatabaseService(dbPath), /not a database/i);
      // Would throw EBUSY on Windows if the constructor leaked its handle.
      fs.renameSync(dbPath, `${dbPath}.moved`);
      assert.equal(fs.existsSync(`${dbPath}.moved`), true);
      assert.equal(fs.existsSync(dbPath), false);
    } finally {
      rmDir(dir);
    }
  });

  it('still throws for incompatible schema (strict semantics retained)', () => {
    const dir = tempDir();
    try {
      const dbPath = dbPathIn(dir);
      const Database = require('better-sqlite3');
      const setup = new Database(dbPath);
      setup.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);');
      setup.exec('CREATE VIEW quarantine AS SELECT 1 AS id;');
      setup.close();
      assert.throws(() => new DatabaseService(dbPath), /./);
    } finally {
      rmDir(dir);
    }
  });
});
