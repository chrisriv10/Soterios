/**
 * Manages quarantined threat files using AES-256-GCM encryption.
 *
 * Each quarantined file is encrypted with a machine-specific key derived
 * from a random key stored on disk (with restrictive permissions). Legacy
 * files encrypted with the old hostname-derived key can still be decrypted
 * via a fallback path.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { InvalidInputError } = require('../utils/errors');
const { log, ACTIONS } = require('../core/auditLog');
const { QuarantineKeyStore } = require('../utils/quarantineKeyStore');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'sha256';
const PBKDF2_KEY_LENGTH = 32; // 256-bit AES key
const PBKDF2_SALT = Buffer.from('Soterios-Quarantine-KDF-v1', 'utf8');
const ENCRYPTED_FILE_VERSION = 1; // first 4 bytes: little-endian version marker

/**
 * @param {object} db - DatabaseService with quarantine record helpers.
 * @param {object} [options]
 * @param {string} [options.quarantineDir] - Override quarantine directory (tests).
 * @param {Buffer} [options.key] - Direct encryption key override (tests).
 */
class QuarantineManager {
  /**
   * @param {object} db - DatabaseService with quarantine record helpers.
   * @param {object} [options]
   * @param {string} [options.quarantineDir] - Override quarantine directory (tests).
   * @param {Buffer} [options.key] - Direct encryption key override (tests).
   */
  constructor(db, options = {}) {
    this.db = db;
    this.quarantineDir = options.quarantineDir || path.join(os.homedir(), '.soterios-quarantine');
    if (!fs.existsSync(this.quarantineDir)) {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
    }

    const keyStore = new QuarantineKeyStore({ ...options, storageDir: options.quarantineDir });
    this._key = keyStore.key;

    // Legacy fallback key derived from machine-specific info. Used only when
    // decrypting older quarantined files that were encrypted before the random
    // key store was introduced.
    const machineSecret = `${os.hostname()}\x00${os.userInfo().username}`;
    this._legacyKey = crypto.pbkdf2Sync(machineSecret, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_HASH);
  }

  /**
   * Encrypt a buffer with AES-256-GCM and prepend a version marker.
   * @param {Buffer} data - Plaintext.
   * @returns {Buffer} Encrypted payload.
   */
  _encrypt(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Version marker + iv + tag + encrypted data
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(ENCRYPTED_FILE_VERSION, 0);
    return Buffer.concat([versionBuf, iv, tag, encrypted]);
  }

  /**
   * Decrypt a quarantined file payload. Tries the current random key first,
   * then falls back to the legacy hostname-derived key for old files.
   * @param {Buffer} buffer - Encrypted payload.
   * @returns {Buffer} Plaintext.
   */
  _decrypt(buffer) {
    if (buffer.length < 28) {
      throw new InvalidInputError('Quarantined file is too short to be valid.');
    }

    // Try new format with version marker first.
    const versionMarker = buffer.readUInt32LE(0);
    if (versionMarker === ENCRYPTED_FILE_VERSION) {
      if (buffer.length < 32) {
        throw new InvalidInputError('Quarantined file is too short to be valid.');
      }
      const iv = buffer.slice(4, 16);
      const tag = buffer.slice(16, 32);
      const encrypted = buffer.slice(32);
      return this._decryptWithKey(this._key, iv, tag, encrypted);
    }

    // Legacy format: iv(12) + tag(16) + encrypted (no version marker).
    if (buffer.length >= 28) {
      const iv = buffer.slice(0, 12);
      const tag = buffer.slice(12, 28);
      const encrypted = buffer.slice(28);
      try {
        return this._decryptWithKey(this._key, iv, tag, encrypted);
      } catch (_) {
        // Fall back to legacy hostname-derived key for files quarantined
        // before the random key store was introduced.
        return this._decryptWithKey(this._legacyKey, iv, tag, encrypted);
      }
    }

    throw new InvalidInputError('Quarantined file has an unsupported format.');
  }

  /**
   * Decrypt with an explicit key.
   * @param {Buffer} key
   * @param {Buffer} iv
   * @param {Buffer} tag
   * @param {Buffer} encrypted
   * @returns {Buffer}
   */
  _decryptWithKey(key, iv, tag, encrypted) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * AES-256-GCM-encrypt a threat file into quarantine, record it, then remove the original.
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

      const data = fs.readFileSync(originalPath);
      const encrypted = this._encrypt(data);
      fs.writeFileSync(quarantinePath, encrypted);

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

      log(this.db, ACTIONS.QUARANTINE_ADD, { originalPath, hash, engine, threatName, reason }, { success: true, id: res.lastInsertRowid });
      return { success: true, id: res.lastInsertRowid };
    } catch (err) {
      logger.error('Failed to quarantine', { error: err.message || String(err) });
      try {
        if (quarantinePath && fs.existsSync(quarantinePath)) {
          fs.unlinkSync(quarantinePath);
        }
      } catch (cleanupErr) {
        logger.error('Failed to cleanup quarantined file after error', {
          error: cleanupErr.message || String(cleanupErr)
        });
      }
      log(this.db, ACTIONS.QUARANTINE_ADD, { originalPath, hash, engine, threatName, reason }, { success: false, error: err.message });
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

      const encrypted = fs.readFileSync(record.quarantine_path);
      let data;
      try {
        data = this._decrypt(encrypted);
      } catch (decErr) {
        return { success: false, error: 'Quarantined file integrity check failed — file may have been tampered with.' };
      }

      const destDir = path.dirname(record.original_path);
      fs.mkdirSync(destDir, { recursive: true });
      if (fs.existsSync(record.original_path)) {
        return { success: false, error: 'A file already exists at the original location.' };
      }
      fs.writeFileSync(record.original_path, data);
      fs.unlinkSync(record.quarantine_path);

      this.db.updateQuarantineStatus(id, 'restored');
      log(this.db, ACTIONS.QUARANTINE_RESTORE, { id, originalPath: record.original_path }, { success: true });
      return { success: true };
    } catch (err) {
      log(this.db, ACTIONS.QUARANTINE_RESTORE, { id }, { success: false, error: err.message });
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
      log(this.db, ACTIONS.QUARANTINE_DELETE, { id, originalPath: record.original_path }, { success: true });
      return { success: true };
    } catch (err) {
      log(this.db, ACTIONS.QUARANTINE_DELETE, { id }, { success: false, error: err.message });
      return { success: false, error: err.message };
    }
  }
}
module.exports = QuarantineManager;
