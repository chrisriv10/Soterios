const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { ipcMain } = require('electron');

function enrichSizes(records) {
  return (records || []).map((r) => {
    let sizeBytes = null;
    if (r.quarantine_path) {
      try {
        sizeBytes = fs.statSync(r.quarantine_path).size;
      } catch (_) {
        sizeBytes = null;
      }
    }
    return { ...r, size_bytes: sizeBytes };
  });
}

function register(mainWindow, { quarantineManager, db }) {
  ipcMain.handle('quarantine:restore', async (_event, id) => {
    return quarantineManager.restore(id);
  });

  ipcMain.handle('quarantine:restoreAndTrust', async (_event, id) => {
    return quarantineManager.restoreAndTrust(id);
  });

  ipcMain.handle('quarantine:delete', async (_event, id) => {
    return quarantineManager.delete(id);
  });

  ipcMain.handle('quarantine:list', async (_event, status) => {
    return enrichSizes(db.getQuarantineHistory(status || null));
  });

  ipcMain.handle('quarantine:getTrusted', async () => {
    return db.getTrustedHashes();
  });

  ipcMain.handle('quarantine:removeTrusted', async (_event, hash) => {
    db.removeTrustedHash(hash);
    return { success: true };
  });

  ipcMain.handle('quarantine:addTrustedHash', async (_event, hash, path, reason) => {
    db.addTrustedHash(hash, path, reason);
    return { success: true };
  });

  ipcMain.handle('quarantine:calculateAndTrustHash', async (_event, filePath, reason) => {
    try {
      // Input validation
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path' };
      }
      
      // Sanitize path
      const normalizedPath = path.normalize(filePath);
      
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'File does not exist' };
      }
      
      // Check file size to prevent memory issues (limit to 100MB)
      const stats = fs.statSync(normalizedPath);
      if (stats.size > 100 * 1024 * 1024) {
        return { success: false, error: 'File too large for hash calculation (max 100MB)' };
      }
      
      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(normalizedPath);
      hash.update(data);
      const hashValue = hash.digest('hex');
      
      db.addTrustedHash(hashValue, normalizedPath, reason);
      return { success: true, hash: hashValue };
    } catch (err) {
      return { success: false, error: err.message || 'Failed to calculate hash' };
    }
  });

  ipcMain.handle('quarantine:calculateAndUntrustHash', async (_event, filePath) => {
    try {
      // Input validation
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Invalid file path' };
      }
      
      // Sanitize path
      const normalizedPath = path.normalize(filePath);
      
      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'File does not exist' };
      }
      
      // Check file size to prevent memory issues (limit to 100MB)
      const stats = fs.statSync(normalizedPath);
      if (stats.size > 100 * 1024 * 1024) {
        return { success: false, error: 'File too large for hash calculation (max 100MB)' };
      }
      
      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(normalizedPath);
      hash.update(data);
      const hashValue = hash.digest('hex');
      
      db.removeTrustedHash(hashValue);
      return { success: true, hash: hashValue };
    } catch (err) {
      return { success: false, error: err.message || 'Failed to calculate hash' };
    }
  });

  ipcMain.handle('quarantine:isHashTrusted', async (_event, hash) => {
    return db.isHashTrusted(hash);
  });
}

module.exports = { register };