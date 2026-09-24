const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { hasReparseAncestor } = require('../core/pathSafety');

// XOR key used to obfuscate quarantined files. This is not cryptographic
// security — it's just enough to prevent accidental double-click execution.
// Both quarantine() and restore() must use the same value.
const QUARANTINE_XOR_KEY = 0x55;

/**
 * Allocate a quarantine destination that can never overwrite an existing
 * copy. The basename stays human-readable; the random suffix makes
 * same-millisecond same-basename collisions impossible in practice, and the
 * existence check closes the residual race instead of silently aliasing two
 * records to one file. Suffix characters are hex/underscore only, safe on
 * Windows. Throws after bounded retries rather than overwriting.
 */
function allocateQuarantinePath(quarantineDir, fileName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = path.join(
      quarantineDir,
      `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${fileName}.encrypted`
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a quarantine path without overwriting an existing copy.');
}

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
      quarantinePath = allocateQuarantinePath(this.quarantineDir, fileName);

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
      logger.error('Failed to quarantine', { error: err.message || String(err) });
      // If DB failed but we already encrypted the file, clean it up
      try {
        if (quarantinePath && fs.existsSync(quarantinePath)) {
          fs.unlinkSync(quarantinePath);
        }
      } catch (cleanupErr) {
        logger.error('Failed to cleanup quarantined file after error', {
          error: cleanupErr.message || String(cleanupErr)
        });
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Decrypt a quarantined file back to its original path and mark the record restored.
   *
   * Ordering (issue #163): the filesystem and the SQLite database are not one
   * shared transaction, so safety comes from ordering plus compensation —
   * never from claiming cross-resource atomicity:
   * 1. exclusively create the destination (`wx`, fails closed with EEXIST);
   * 2. record the `restored` DB state and require that one row changed;
   * 3. only then delete the quarantine source copy.
   * If the DB transition fails, the destination created by this attempt is
   * rolled back and the quarantine source is left intact, so a retry stays
   * possible. A post-commit source-cleanup failure keeps success=true with a
   * non-breaking warning: the file IS restored and the DB says so.
   * @param {number} id - Quarantine row id.
   * @returns {Promise<{success:boolean, error?:string, warning?:string}>}
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
      // An ancestor may have become a link or junction since quarantine
      // (reparse redirection). Check before creating directories and again
      // afterwards: mkdirSync is a no-op over a planted junction, so only
      // the second check observes the redirection. Deliberately no
      // maintenance-root policy here: quarantine must restore to its
      // recorded location wherever that legitimately is.
      if (hasReparseAncestor(destDir) || hasReparseAncestor(record.original_path)) {
        return { success: false, error: 'The original location passes through a link or junction and cannot be restored safely.' };
      }
      fs.mkdirSync(destDir, { recursive: true });
      if (hasReparseAncestor(destDir) || hasReparseAncestor(record.original_path)) {
        return { success: false, error: 'The original location changed during restore; refusing to write through a link or junction.' };
      }
      // Fast-path UX check only. The safety boundary is the exclusive
      // creation below: a file appearing after this check still fails
      // closed with EEXIST instead of being overwritten.
      if (fs.existsSync(record.original_path)) {
        return { success: false, error: 'A file already exists at the original location.' };
      }

      // Exclusive creation: the filesystem itself enforces the collision
      // check. createdByUs is true only after openSync succeeds, so cleanup
      // below can never remove a pre-existing or unrelated file.
      let fd = null;
      let createdByUs = false;
      let writeError = null;
      try {
        fd = fs.openSync(record.original_path, 'wx');
        createdByUs = true;
        fs.writeFileSync(fd, data);
      } catch (err) {
        writeError = err;
      } finally {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch (_) { /* close failure follows the write-failure path */ }
        }
      }
      if (writeError) {
        if (createdByUs) {
          try { fs.unlinkSync(record.original_path); } catch (_) { /* partial remains; reported below */ }
        } else if (writeError && writeError.code === 'EEXIST') {
          return { success: false, error: 'A file already exists at the original location.' };
        }
        if (createdByUs && fs.existsSync(record.original_path)) {
          logger.error('Restore destination could not be rolled back and may need manual attention', {
            error: writeError.message || String(writeError)
          });
          return { success: false, error: 'Could not write the restored file, and the partial destination could not be removed and may need manual attention.' };
        }
        return { success: false, error: 'Could not write the restored file.' };
      }

      // Record the restored state BEFORE touching the quarantine source.
      // Require exactly one row changed: changes === 0 means the intended
      // record was not updated and must not be treated as success.
      let statusResult = null;
      let statusError = null;
      try {
        statusResult = this.db.updateQuarantineStatus(id, 'restored');
      } catch (err) {
        statusError = err;
      }
      if (statusError || !statusResult || statusResult.changes !== 1) {
        if (statusError) {
          logger.error('Failed to record quarantine restore in database', { error: statusError.message || String(statusError) });
        } else {
          logger.error('Quarantine restore status update changed no rows', { id });
        }
        let rolledBack = false;
        try {
          fs.unlinkSync(record.original_path);
          rolledBack = !fs.existsSync(record.original_path);
        } catch (_) {
          rolledBack = false;
        }
        if (!rolledBack) {
          logger.error('Restore destination could not be rolled back and may need manual attention', {
            error: (statusError && (statusError.message || String(statusError))) || 'status update changed no rows'
          });
          return { success: false, error: 'Could not record the restore in the database, and the restored destination could not be removed and may need manual attention. The quarantined copy was kept.' };
        }
        return { success: false, error: 'Could not record the restore in the database. The restored destination was removed and the quarantined copy was kept.' };
      }

      // Post-commit source cleanup is best-effort: the file is restored and
      // the database says restored. A leftover encrypted copy is a storage
      // problem, never grounds to report failure (a retry could not rerun).
      try {
        fs.unlinkSync(record.quarantine_path);
      } catch (err) {
        logger.warn('Restored file is in place but the quarantined copy could not be removed', {
          error: err.message || String(err)
        });
        return { success: true, warning: 'The file was restored, but the quarantined copy could not be removed.' };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Decrypt a quarantined file back to its original path, mark the record
   * restored, and add its hash to the trusted (false-positive) whitelist so
   * future scans skip it.
   * @param {number} id - Quarantine row id.
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async restoreAndTrust(id) {
    const res = await this.restore(id);
    if (!res.success) return res;
    try {
      const stmt = this.db.db.prepare('SELECT hash, original_path, threat_name FROM quarantine WHERE id = ?');
      const record = stmt.get(id);
      if (record && record.hash) {
        this.db.addTrustedHash(record.hash, record.original_path, record.threat_name);
      }
    } catch (err) {
      // Restoring succeeded; whitelist failure should not undo the restore.
      logger.error('Failed to trust hash after restore', { error: err.message || String(err) });
    }
    return { success: true };
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
