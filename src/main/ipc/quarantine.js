const fs = require('fs');
const crypto = require('crypto');
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
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist' };
      }
      
      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(filePath);
      hash.update(data);
      const hashValue = hash.digest('hex');
      
      db.addTrustedHash(hashValue, filePath, reason);
      return { success: true, hash: hashValue };
    } catch (err) {
      return { success: false, error: err.message || 'Failed to calculate hash' };
    }
  });

  ipcMain.handle('quarantine:calculateAndUntrustHash', async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist' };
      }
      
      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(filePath);
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