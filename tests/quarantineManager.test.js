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

  it('keeps distinct quarantine copies for same-basename files quarantined in the same millisecond', async () => {
    const dirA = path.join(tmpRoot, 'dirA');
    const dirB = path.join(tmpRoot, 'dirB');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const fileA = path.join(dirA, 'setup.exe');
    const fileB = path.join(dirB, 'setup.exe');
    fs.writeFileSync(fileA, 'payload-A-bytes');
    fs.writeFileSync(fileB, 'payload-B-bytes-different');
    const realNow = Date.now;
    Date.now = () => 1789785600000;
    let first;
    let second;
    try {
      first = await manager.quarantine(fileA, 'hashA', 'test', 'ThreatA', 'collision');
      second = await manager.quarantine(fileB, 'hashB', 'test', 'ThreatB', 'collision');
    } finally {
      Date.now = realNow;
    }
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    const rowA = db.db.prepare('SELECT quarantine_path FROM quarantine WHERE id = ?').get(first.id);
    const rowB = db.db.prepare('SELECT quarantine_path FROM quarantine WHERE id = ?').get(second.id);
    assert.notEqual(rowA.quarantine_path, rowB.quarantine_path);
    const readBack = (row) => {
      const data = fs.readFileSync(row.quarantine_path);
      for (let i = 0; i < data.length; i += 1) data[i] ^= 0x55;
      return data.toString('utf8');
    };
    assert.equal(readBack(rowA), 'payload-A-bytes');
    assert.equal(readBack(rowB), 'payload-B-bytes-different');
    const restoredA = await manager.restore(first.id);
    const restoredB = await manager.restore(second.id);
    assert.equal(restoredA.success, true);
    assert.equal(restoredB.success, true);
    assert.equal(fs.readFileSync(fileA, 'utf8'), 'payload-A-bytes');
    assert.equal(fs.readFileSync(fileB, 'utf8'), 'payload-B-bytes-different');
  });

  it('refuses to overwrite an existing file on restore', async () => {
    const created = await manager.quarantine(originalPath, 'hash-overwrite', 'test', 'Threat', 'overwrite-test');
    fs.writeFileSync(originalPath, 'innocent replacement');
    const result = await manager.restore(created.id);
    assert.equal(result.success, false);
    assert.match(String(result.error), /already exists/i);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'innocent replacement');
    const row = db.db.prepare('SELECT status, quarantine_path FROM quarantine WHERE id = ?').get(created.id);
    assert.equal(row.status, 'quarantined');
    assert.equal(fs.existsSync(row.quarantine_path), true);
  });

  it('fails closed when a junction ancestor redirects the restore destination', { skip: process.platform !== 'win32' && 'requires Windows junctions (mklink /J)' }, async () => {
    const { execFileSync } = require('child_process');
    const outerDir = path.join(tmpRoot, 'victim');
    const innerDir = path.join(outerDir, 'sub');
    fs.mkdirSync(innerDir, { recursive: true });
    const victimFile = path.join(innerDir, 'evil.exe');
    fs.writeFileSync(victimFile, 'threat-payload');
    const created = await manager.quarantine(victimFile, 'hash-junction', 'test', 'Threat', 'junction-test');
    assert.equal(created.success, true);
    const redirectDir = path.join(tmpRoot, 'redirect-target');
    fs.mkdirSync(redirectDir, { recursive: true });
    fs.rmSync(innerDir, { recursive: true, force: true });
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', innerDir, redirectDir], { windowsHide: true });
    const before = db.db.prepare('SELECT status, quarantine_path FROM quarantine WHERE id = ?').get(created.id);
    const result = await manager.restore(created.id);
    assert.equal(result.success, false);
    assert.match(String(result.error), /link|junction|reparse| safely/i);
    // Nothing was written through the redirected path.
    assert.equal(fs.existsSync(path.join(redirectDir, 'evil.exe')), false);
    // The quarantine copy remains intact and the row stays quarantined.
    assert.equal(fs.existsSync(before.quarantine_path), true);
    const after = db.db.prepare('SELECT status FROM quarantine WHERE id = ?').get(created.id);
    assert.equal(after.status, 'quarantined');
  });

  it('restores outside maintenance-only roots without imposing a root policy', async () => {
    // A sibling of the OS temp dir is outside defaultMutationRoots and is
    // not protected: restore must still succeed there.
    const outsideRoot = path.join(path.dirname(os.tmpdir()), `soterios-qroot-${Date.now()}`);
    const outsideFile = path.join(outsideRoot, 'note.txt');
    fs.mkdirSync(outsideRoot, { recursive: true });
    try {
      fs.writeFileSync(outsideFile, 'outside-payload');
      const created = await manager.quarantine(outsideFile, 'hash-outside', 'test', 'Threat', 'outside-test');
      assert.equal(created.success, true);
      const result = await manager.restore(created.id);
      assert.equal(result.success, true);
      assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside-payload');
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe('QuarantineManager restore atomicity (#163)', () => {
  let tmpRoot;
  let db;
  let manager;
  let originalPath;
  let quarantineDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-qatomic-'));
    const dbPath = path.join(tmpRoot, 'test.db');
    quarantineDir = path.join(tmpRoot, 'quarantine');
    db = new DatabaseService(dbPath);
    manager = new QuarantineManager(db, { quarantineDir });

    originalPath = path.join(tmpRoot, 'sample.txt');
    fs.writeFileSync(originalPath, 'hello-quarantine-payload');
  });

  afterEach(() => {
    try { db.db.close(); } catch (_) {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function rowOf(id) {
    return db.db.prepare('SELECT * FROM quarantine WHERE id = ?').get(id);
  }

  async function quarantineSample(hash = 'hash-atomic') {
    const created = await manager.quarantine(originalPath, hash, 'test', 'Threat', 'atomic-test');
    assert.equal(created.success, true);
    return created.id;
  }

  it('rolls back the destination and keeps the source when the DB update throws, then retry succeeds', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realUpdate = db.updateQuarantineStatus;
    let calls = 0;
    db.updateQuarantineStatus = (...args) => {
      calls += 1;
      if (calls === 1) throw new Error('SQLITE_FULL: database or disk is full');
      return realUpdate.apply(db, args);
    };
    try {
      const failed = await manager.restore(id);
      assert.equal(failed.success, false);
      assert.match(String(failed.error), /database/i);
      // Destination created by this attempt is gone; source and row retained.
      assert.equal(fs.existsSync(originalPath), false);
      assert.equal(fs.existsSync(qPath), true);
      assert.equal(rowOf(id).status, 'quarantined');
    } finally {
      db.updateQuarantineStatus = realUpdate;
    }
    // Retry after DB recovery restores byte-for-byte.
    const retried = await manager.restore(id);
    assert.equal(retried.success, true);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');
    assert.equal(rowOf(id).status, 'restored');
    assert.equal(fs.existsSync(qPath), false);
  });

  it('treats a zero-row DB update as failure and compensates the destination', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realUpdate = db.updateQuarantineStatus;
    db.updateQuarantineStatus = () => ({ changes: 0, lastInsertRowid: 0 });
    try {
      const result = await manager.restore(id);
      assert.equal(result.success, false);
      assert.equal(fs.existsSync(originalPath), false);
      assert.equal(fs.existsSync(qPath), true);
      assert.equal(rowOf(id).status, 'quarantined');
    } finally {
      db.updateQuarantineStatus = realUpdate;
    }
  });

  it('closes the destination race: a file appearing before exclusive create is never overwritten', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realOpenSync = fs.openSync;
    const openFlags = [];
    let planted = false;
    fs.openSync = (p, flags, mode) => {
      if (p === originalPath) openFlags.push(String(flags));
      if (p === originalPath && String(flags) === 'wx' && !planted) {
        planted = true;
        // Competitor wins the race after any preflight check.
        fs.writeFileSync(p, 'competitor-bytes');
      }
      return realOpenSync(p, flags, mode);
    };
    try {
      const result = await manager.restore(id);
      assert.equal(result.success, false);
      assert.match(String(result.error), /already exists/i);
    } finally {
      fs.openSync = realOpenSync;
    }
    assert.ok(openFlags.includes('wx'), 'destination must be created exclusively');
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'competitor-bytes');
    assert.equal(fs.existsSync(qPath), true);
    assert.equal(rowOf(id).status, 'quarantined');
  });

  it('creates the destination exclusively on the success path', async () => {
    const id = await quarantineSample();
    const realOpenSync = fs.openSync;
    const destOpens = [];
    fs.openSync = (p, flags, mode) => {
      if (p === originalPath) destOpens.push(String(flags));
      return realOpenSync(p, flags, mode);
    };
    try {
      const result = await manager.restore(id);
      assert.equal(result.success, true);
    } finally {
      fs.openSync = realOpenSync;
    }
    assert.deepEqual(destOpens, ['wx']);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');
  });

  it('records DB status before deleting the quarantine source, leaving no artifacts', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const events = [];
    const realUpdate = db.updateQuarantineStatus;
    const realUnlink = fs.unlinkSync;
    db.updateQuarantineStatus = (...args) => {
      events.push(`update:${args[1]}`);
      return realUpdate.apply(db, args);
    };
    fs.unlinkSync = (p) => {
      events.push(`unlink:${p === qPath ? 'source' : 'other'}`);
      return realUnlink(p);
    };
    try {
      const result = await manager.restore(id);
      assert.equal(result.success, true);
    } finally {
      db.updateQuarantineStatus = realUpdate;
      fs.unlinkSync = realUnlink;
    }
    const updateAt = events.indexOf('update:restored');
    const unlinkAt = events.indexOf('unlink:source');
    assert.ok(updateAt !== -1 && unlinkAt !== -1 && updateAt < unlinkAt, `order was ${JSON.stringify(events)}`);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');
    assert.equal(rowOf(id).status, 'restored');
    assert.deepEqual(fs.readdirSync(quarantineDir), []);
  });

  it('removes only its own partial destination when the write fails', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realWrite = fs.writeFileSync;
    fs.writeFileSync = (...args) => {
      // Fail only the restore write through the descriptor, not quarantine setup.
      if (typeof args[0] === 'number') throw new Error('ENOSPC: no space left on device');
      return realWrite(...args);
    };
    try {
      const result = await manager.restore(id);
      assert.equal(result.success, false);
      assert.match(String(result.error), /write/i);
    } finally {
      fs.writeFileSync = realWrite;
    }
    assert.equal(fs.existsSync(originalPath), false);
    assert.equal(fs.existsSync(qPath), true);
    assert.equal(rowOf(id).status, 'quarantined');
  });

  it('reports truthful success with a warning when post-commit source cleanup fails', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realUnlink = fs.unlinkSync;
    fs.unlinkSync = (p) => {
      if (p === qPath) throw new Error('EPERM: operation not permitted');
      return realUnlink(p);
    };
    let result;
    try {
      result = await manager.restore(id);
    } finally {
      fs.unlinkSync = realUnlink;
    }
    assert.equal(result.success, true);
    assert.ok(result.warning, 'cleanup failure must surface as a non-breaking warning');
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');
    assert.equal(rowOf(id).status, 'restored');
    assert.equal(fs.existsSync(qPath), true);
  });

  it('restoreAndTrust still trusts after a cleanup-warning success', async () => {
    const id = await quarantineSample('trustedhash-warn');
    const qPath = rowOf(id).quarantine_path;
    const realUnlink = fs.unlinkSync;
    fs.unlinkSync = (p) => {
      if (p === qPath) throw new Error('EPERM: operation not permitted');
      return realUnlink(p);
    };
    let result;
    try {
      result = await manager.restoreAndTrust(id);
    } finally {
      fs.unlinkSync = realUnlink;
    }
    assert.equal(result.success, true);
    assert.equal(db.isHashTrusted('trustedhash-warn'), true);
  });

  it('restoreAndTrust never trusts after a DB-rollback failure', async () => {
    const id = await quarantineSample('trustedhash-rollback');
    const realUpdate = db.updateQuarantineStatus;
    db.updateQuarantineStatus = () => { throw new Error('SQLITE_FULL: database or disk is full'); };
    let result;
    try {
      result = await manager.restoreAndTrust(id);
    } finally {
      db.updateQuarantineStatus = realUpdate;
    }
    assert.equal(result.success, false);
    assert.equal(db.isHashTrusted('trustedhash-rollback'), false);
    assert.equal(rowOf(id).status, 'quarantined');
  });

  it('reports manual attention when destination rollback also fails', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    const realUpdate = db.updateQuarantineStatus;
    const realUnlink = fs.unlinkSync;
    db.updateQuarantineStatus = () => { throw new Error('SQLITE_FULL: database or disk is full'); };
    fs.unlinkSync = (p) => {
      if (p === originalPath) throw new Error('EPERM: operation not permitted');
      return realUnlink(p);
    };
    let result;
    try {
      result = await manager.restore(id);
    } finally {
      db.updateQuarantineStatus = realUpdate;
      fs.unlinkSync = realUnlink;
    }
    assert.equal(result.success, false);
    assert.match(String(result.error), /manual attention/i);
    assert.equal(fs.existsSync(qPath), true);
    assert.equal(rowOf(id).status, 'quarantined');
  });

  it('treats descriptor-close failure as a write failure and compensates', async () => {
    const id = await quarantineSample();
    const qPath = rowOf(id).quarantine_path;
    // Target only the restore destination descriptor: readFileSync uses
    // closeSync internally, so a blanket patch would break the read path.
    const realOpen = fs.openSync;
    const realClose = fs.closeSync;
    let destFd = null;
    let closeAttempts = 0;
    fs.openSync = (p, flags, mode) => {
      const fd = realOpen(p, flags, mode);
      if (p === originalPath && String(flags) === 'wx') destFd = fd;
      return fd;
    };
    fs.closeSync = (fd, ...rest) => {
      if (fd === destFd) {
        closeAttempts += 1;
        // Release the descriptor before reporting the failure, mirroring
        // real close-error semantics (the fd is gone even when close
        // reports an error). Otherwise rollback would unlink a file that
        // is still open, which some platforms block.
        realClose(fd, ...rest);
        throw new Error('EBADF: bad file descriptor, close');
      }
      return realClose(fd, ...rest);
    };
    let result;
    try {
      result = await manager.restore(id);
    } finally {
      fs.openSync = realOpen;
      fs.closeSync = realClose;
    }
    assert.ok(destFd !== null, 'restore must open the destination exclusively');
    assert.equal(closeAttempts, 1, 'restore must attempt exactly one destination close');
    assert.equal(result.success, false);
    assert.match(String(result.error), /write/i);
    // Unconfirmed destination is rolled back; source and row stay recoverable.
    assert.equal(fs.existsSync(originalPath), false);
    assert.equal(fs.existsSync(qPath), true);
    assert.equal(rowOf(id).status, 'quarantined');
    const retried = await manager.restore(id);
    assert.equal(retried.success, true);
    assert.equal(fs.readFileSync(originalPath, 'utf8'), 'hello-quarantine-payload');
  });

  it('restoreAndTrust preserves a non-fatal cleanup warning', async () => {
    const id = await quarantineSample('trustedhash-warn-passthrough');
    const qPath = rowOf(id).quarantine_path;
    const realUnlink = fs.unlinkSync;
    fs.unlinkSync = (p) => {
      if (p === qPath) throw new Error('EPERM: operation not permitted');
      return realUnlink(p);
    };
    let result;
    try {
      result = await manager.restoreAndTrust(id);
    } finally {
      fs.unlinkSync = realUnlink;
    }
    assert.equal(result.success, true);
    assert.ok(result.warning, 'warning must survive restoreAndTrust');
    assert.equal(db.isHashTrusted('trustedhash-warn-passthrough'), true);
    assert.equal(rowOf(id).status, 'restored');
  });
});
