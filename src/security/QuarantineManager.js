const path = require('path');
const fs = require('fs');
const os = require('os');

// XOR key used to obfuscate quarantined files. This is not cryptographic
// security — it's just enough to prevent accidental double-click execution.
// Both quarantine() and restore() must use the same value.
const QUARANTINE_XOR_KEY = 0x55;

/**
 * QuarantineManager — isolates detected threat files by XOR-encrypting
 * them (key `0x55`) and moving them to a dedicated quarantine directory.
 * Files can later be restored to their original path or permanently deleted.
 */
class QuarantineManager {
  /**
   * @param {object} db - DatabaseService with quarantine record helpers.
   * @param {object} [options]
   * @param {string} [options.quarantineDir] - Override quarantine directory (tests).
   */
  constructor(db, options = {}) {
    this.db = db;
    this.quarantineDir = options.quarantineDir || path.join(os.homedir(), '.soterios-quarantine');
    if (!fs.existsSync(this.quarantineDir)) {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
    }
  }

  /**
   * XOR-encrypt a threat file into quarantine, record it, then remove the original.
   * @param {string} originalPath
   * @param {string} hash
   * @param {string} engine
   * @param {string} threatName
   * @param {string} reason
   * @returns {Promise<{success:boolean, id?:number, error?:string}>}
   */
  async quarantine(originalPath, hash, engine, threatName, reason) {
    let quarantinePath = null;
    try {
      const fileName = path.basename(originalPath);
      const safeName = `${Date.now()}_${fileName}.encrypted`;
      quarantinePath = path.join(this.quarantineDir, safeName);

      // Basic XOR encryption to prevent accidental execution
      const data = fs.readFileSync(originalPath);
      for (let i = 0; i < data.length; i++) {
        data[i] ^= QUARANTINE_XOR_KEY;
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

  /**
   * Decrypt a quarantined file back to its original path and mark the record restored.
   * @param {number} id - Quarantine row id.
   * @returns {Promise<{success:boolean, error?:string}>}
   */
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
        data[i] ^= QUARANTINE_XOR_KEY;
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

  /**
   * Permanently delete a quarantined file from disk and mark the record deleted.
   * @param {number} id - Quarantine row id.
   * @returns {Promise<{success:boolean, error?:string}>}
   */
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
