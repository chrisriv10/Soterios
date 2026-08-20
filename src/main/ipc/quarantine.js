const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { hashFileStreaming, clearHashCache } = require('../../security/hashUtils');

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

  ipcMain.handle('quarantine:clearHistory', async () => {
    const result = db.clearQuarantineHistory();
    return { success: true, cleared: result.changes };
  });

  ipcMain.handle('quarantine:deleteHistory', async (_event, ids) => {
    const list = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
    const result = db.deleteQuarantineHistory(list);
    return { success: true, deleted: result.changes };
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
      
      const hashValue = await hashFileStreaming(normalizedPath);
      if (!hashValue) {
        return { success: false, error: 'File could not be read (permission denied or file was removed)' };
      }
      
      db.addTrustedHash(hashValue, normalizedPath, reason);
      clearHashCache(normalizedPath);
      return { success: true, hash: hashValue };
    } catch (err) {
      if (err && err.code === 'HASH_FILE_TOO_LARGE') {
        return { success: false, error: err.message };
      }
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
      
      const hashValue = await hashFileStreaming(normalizedPath);
      if (!hashValue) {
        return { success: false, error: 'File could not be read (permission denied or file was removed)' };
      }
      
      db.removeTrustedHash(hashValue);
      clearHashCache(normalizedPath);
      return { success: true, hash: hashValue };
    } catch (err) {
      if (err && err.code === 'HASH_FILE_TOO_LARGE') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err.message || 'Failed to calculate hash' };
    }
  });

  ipcMain.handle('quarantine:isHashTrusted', async (_event, hash) => {
    return db.isHashTrusted(hash);
  });
}

module.exports = { register };