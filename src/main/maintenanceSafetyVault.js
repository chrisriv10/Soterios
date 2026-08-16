'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assessMutation, captureSnapshot, isInside, verifySnapshot } = require('../core/pathSafety');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function volumeRoot(filePath) {
  return path.parse(path.resolve(filePath)).root.toLowerCase();
}

function pathSize(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links and reparse points cannot be vaulted.');
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(target, { withFileTypes: true }).reduce((total, entry) => {
    return total + pathSize(path.join(target, entry.name));
  }, 0);
}

function hashPath(target, hash = crypto.createHash('sha256'), relative = '') {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links and reparse points cannot be vaulted.');
  hash.update(relative.replace(/\\/g, '/'));
  if (stat.isFile()) {
    const fd = fs.openSync(target, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let bytesRead;
      do {
        bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target).sort()) {
      hashPath(path.join(target, entry), hash, path.join(relative, entry));
    }
  }
  return hash;
}

function copyPath(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links and reparse points cannot be vaulted.');
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false });
    for (const entry of fs.readdirSync(source)) copyPath(path.join(source, entry), path.join(destination, entry));
    return;
  }
  if (!stat.isFile()) throw new Error('Only regular files and folders can be vaulted.');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function removePath(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Refusing to remove a symbolic link or reparse point.');
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) removePath(path.join(target, entry));
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

function conflictPath(originalPath) {
  if (!fs.existsSync(originalPath)) return originalPath;
  const parsed = path.parse(originalPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(parsed.dir, `${parsed.name} (restored ${stamp})${parsed.ext}`);
}

class MaintenanceSafetyVault {
  constructor({ db, rootPath, applicationDataPath, log } = {}) {
    this.db = db;
    this.rootPath = path.resolve(rootPath);
    this.applicationDataPath = applicationDataPath || path.dirname(this.rootPath);
    this.log = typeof log === 'function' ? log : () => {};
    this.timer = null;
    fs.mkdirSync(this.rootPath, { recursive: true });
  }

  start() {
    this.purgeExpired().catch((error) => this.log('warn', 'Vault expiry purge failed', { error: error.message }));
    this.timer = setInterval(() => {
      this.purgeExpired().catch((error) => this.log('warn', 'Vault expiry purge failed', { error: error.message }));
    }, 24 * 60 * 60 * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list() {
    return this.db.getVaultItems();
  }

  async stage(items, { operation = 'user cleanup', onProgress } = {}) {
    if (!Array.isArray(items) || !items.length) throw new Error('Select at least one file or folder.');
    const results = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = typeof items[index] === 'string' ? { path: items[index] } : items[index];
      try {
        results.push({ ok: true, item: await this.stageOne(input, operation) });
      } catch (error) {
        results.push({ ok: false, path: input.path, error: error.message });
      }
      onProgress?.({ count: index + 1, total: items.length, pct: Math.round(((index + 1) / items.length) * 100), currentActivity: input.path });
    }
    return {
      staged: results.filter((result) => result.ok).map((result) => result.item),
      failed: results.filter((result) => !result.ok),
      stagedBytes: results.filter((result) => result.ok).reduce((sum, result) => sum + result.item.sizeBytes, 0),
      reclaimedBytes: 0
    };
  }

  async stageOne(input, operation) {
    const source = path.resolve(String(input.path || ''));
    const safety = assessMutation(source, {
      applicationDataPath: this.applicationDataPath,
      allowedRoots: [path.parse(source).root]
    });
    if (!safety.ok) throw new Error(safety.reason);
    if (input.snapshot) {
      const verified = verifySnapshot(input.snapshot);
      if (!verified.ok) throw new Error(verified.reason);
    }
    const snapshot = input.snapshot || captureSnapshot(source);
    const sizeBytes = pathSize(source);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
    const destination = path.join(this.rootPath, `${id}-${path.basename(source)}`);
    const record = {
      id,
      originalPath: source,
      vaultPath: destination,
      itemType: snapshot.isDirectory ? 'folder' : 'file',
      operation,
      sizeBytes,
      createdAt,
      expiresAt,
      status: 'staging',
      metadata: { snapshot, sourceVolume: volumeRoot(source) }
    };
    this.db.addVaultItem(record);
    try {
      if (volumeRoot(source) === volumeRoot(destination)) {
        fs.renameSync(source, destination);
        record.metadata.transfer = 'atomic-move';
      } else {
        this._ensureCapacity(destination, sizeBytes);
        const sourceHash = hashPath(source).digest('hex');
        copyPath(source, destination);
        const destinationHash = hashPath(destination).digest('hex');
        if (sourceHash !== destinationHash) throw new Error('Vault copy verification failed; the source was not removed.');
        try {
          removePath(source);
        } catch (removeError) {
          // The verified Vault copy is now the safety copy. Keep it even if
          // a source child could not be removed; never discard both sides.
          record.metadata.sourceCleanupIncomplete = removeError.message;
        }
        record.metadata.transfer = 'copy-verify-remove';
        record.metadata.hash = sourceHash;
      }
      record.status = 'staged';
      this.db.updateVaultItem(id, 'staged', record.metadata);
      return record;
    } catch (error) {
      try {
        if (fs.existsSync(destination) && fs.existsSync(source) && isInside(destination, this.rootPath)) removePath(destination);
      } catch (_) {}
      this.db.updateVaultItem(id, 'failed', { ...record.metadata, error: error.message });
      throw error;
    }
  }

  async restore(id) {
    const item = this.db.getVaultItem(id);
    if (!item || item.status !== 'staged') throw new Error('Vault item is not available to restore.');
    if (!isInside(item.vaultPath, this.rootPath) || !fs.existsSync(item.vaultPath)) {
      this.db.updateVaultItem(id, 'missing', { ...item.metadata, error: 'Vault data is missing.' });
      throw new Error('Vault data is missing.');
    }
    const destination = conflictPath(item.originalPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (volumeRoot(item.vaultPath) === volumeRoot(destination)) {
      fs.renameSync(item.vaultPath, destination);
    } else {
      const sizeBytes = pathSize(item.vaultPath);
      this._ensureCapacity(destination, sizeBytes);
      const sourceHash = hashPath(item.vaultPath).digest('hex');
      copyPath(item.vaultPath, destination);
      if (sourceHash !== hashPath(destination).digest('hex')) {
        try { removePath(destination); } catch (_) {}
        throw new Error('Restore verification failed; the vault copy was preserved.');
      }
      removePath(item.vaultPath);
    }
    this.db.updateVaultItem(id, 'restored', { ...item.metadata, restoredPath: destination, restoredAt: new Date().toISOString() });
    return { ...item, status: 'restored', restoredPath: destination, conflictRenamed: destination !== item.originalPath };
  }

  async purge(id) {
    const item = this.db.getVaultItem(id);
    if (!item) throw new Error('Vault item was not found.');
    if (item.status === 'staged' && fs.existsSync(item.vaultPath)) {
      if (!isInside(item.vaultPath, this.rootPath)) throw new Error('Invalid vault path.');
      removePath(item.vaultPath);
    }
    this.db.updateVaultItem(id, 'purged', { ...item.metadata, purgedAt: new Date().toISOString() });
    return { ...item, status: 'purged', reclaimedBytes: item.sizeBytes };
  }

  async purgeExpired(now = new Date()) {
    const expired = this.db.getVaultItems({ status: 'staged', expiredBefore: now.toISOString() });
    const results = [];
    for (const item of expired) {
      try { results.push({ ok: true, item: await this.purge(item.id) }); }
      catch (error) { results.push({ ok: false, id: item.id, error: error.message }); }
    }
    return results;
  }

  _ensureCapacity(destination, sizeBytes) {
    if (typeof fs.statfsSync !== 'function') return;
    const stats = fs.statfsSync(path.dirname(destination));
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (available < sizeBytes) throw new Error('The Safety Vault does not have enough free space.');
  }
}

module.exports = { MaintenanceSafetyVault, RETENTION_MS, conflictPath, hashPath, pathSize };
