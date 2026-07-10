const path = require('path');
const fs = require('fs');
const os = require('os');

class QuarantineManager {
  constructor(db) {
    this.db = db;
    this.quarantineDir = path.join(os.homedir(), '.soterios-quarantine');
    if (!fs.existsSync(this.quarantineDir)) {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
    }
  }

  async quarantine(originalPath, hash, engine, threatName, reason) {
    try {
      const fileName = path.basename(originalPath);
      const safeName = `${Date.now()}_${fileName}.encrypted`;
      const quarantinePath = path.join(this.quarantineDir, safeName);

      // Basic XOR encryption to prevent accidental execution
      const data = fs.readFileSync(originalPath);
      for (let i = 0; i < data.length; i++) {
        data[i] ^= 0x55;
      }
      fs.writeFileSync(quarantinePath, data);

      const res = this.db.addQuarantineRecord({
        originalPath,
        quarantinePath,
        hash,
        engine,
        threatName,
        reason
      });

      // Only delete original file after DB record is successfully created
      fs.unlinkSync(originalPath);

      return { success: true, id: res.lastInsertRowid };
    } catch (err) {
      console.error('Failed to quarantine:', err);
      // If DB failed but we already encrypted the file, clean it up
      try {
        if (quarantinePath && fs.existsSync(quarantinePath)) {
          fs.unlinkSync(quarantinePath);
        }
      } catch (cleanupErr) {
        console.error('Failed to cleanup quarantined file after error:', cleanupErr);
      }
      return { success: false, error: err.message };
    }
  }

  async restore(id) {
    try {
      const stmt = this.db.db.prepare('SELECT * FROM quarantine WHERE id = ?');
      const record = stmt.get(id);
      if (!record || record.status !== 'quarantined') {
        return { success: false, error: 'Record not found or already processed' };
      }
      if (!record.quarantine_path || !fs.existsSync(record.quarantine_path)) {
        return { success: false, error: 'Quarantined file is missing from disk.' };
      }

      const data = fs.readFileSync(record.quarantine_path);
      for (let i = 0; i < data.length; i++) {
        data[i] ^= 0x55; // reverse the same XOR used to quarantine
      }

      const destDir = path.dirname(record.original_path);
      fs.mkdirSync(destDir, { recursive: true });
      if (fs.existsSync(record.original_path)) {
        return { success: false, error: 'A file already exists at the original location.' };
      }
      fs.writeFileSync(record.original_path, data);
      fs.unlinkSync(record.quarantine_path);

      this.db.updateQuarantineStatus(id, 'restored');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async delete(id) {
    try {
      const stmt = this.db.db.prepare('SELECT * FROM quarantine WHERE id = ?');
      const record = stmt.get(id);
      if (!record || record.status !== 'quarantined') {
        return { success: false, error: 'Record not found or already processed' };
      }
      if (record.quarantine_path && fs.existsSync(record.quarantine_path)) {
        fs.unlinkSync(record.quarantine_path);
      }
      this.db.updateQuarantineStatus(id, 'deleted');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
module.exports = QuarantineManager;
