'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE_NAME = 'quarantine.key';
const KEY_LENGTH = 32; // 256-bit AES key

/**
 * Simple file-backed key store with OS-level file restrictions.
 *
 * On Windows the key file is additionally locked down with icacls so that
 * only the current user can read it. On other platforms the file is created
 * with 0o600 permissions.
 *
 * For tests or one-off overrides, pass `options.key` directly.
 */
class QuarantineKeyStore {
  /**
   * @param {object} [options]
   * @param {Buffer} [options.key] - Direct key override (tests).
   * @param {string} [options.storageDir] - Directory for key file.
   */
  constructor(options = {}) {
    if (options.key) {
      this._key = options.key;
      return;
    }

    const storageDir = options.storageDir || path.join(os.homedir(), '.soterios-quarantine');
    this._keyPath = path.join(storageDir, KEY_FILE_NAME);
    this._key = this._loadOrCreateKey(storageDir);
  }

  /**
   * The 256-bit AES key used for quarantine operations.
   *
   * @type {Buffer}
   */
  get key() {
    return this._key;
  }

  /**
   * Loads the persisted quarantine key or generates a new one.
   *
   * @param {string} storageDir - Directory for key storage.
   * @returns {Buffer} Quarantine key.
   */
  _loadOrCreateKey(storageDir) {
    try {
      if (fs.existsSync(this._keyPath)) {
        const stored = fs.readFileSync(this._keyPath);
        if (stored.length === KEY_LENGTH) {
          return stored;
        }
      }
    } catch (_) {
      // Fall through to key generation on any read error.
    }

    const key = crypto.randomBytes(KEY_LENGTH);
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(this._keyPath, key);
      this._restrictKeyFile();
    } catch (_) {
      // If we cannot persist the key, keep it in memory only. Quarantine
      // functionality will be limited to this process lifetime.
    }
    return key;
  }

  /**
   * Restricts key file permissions to owner-only read/write.
   */
  _restrictKeyFile() {
    try {
      fs.chmodSync(this._keyPath, 0o600);
    } catch (_) {
      // Best-effort.
    }
    if (process.platform === 'win32') {
      try {
        const { execFileSync } = require('child_process');
        execFileSync('icacls', [this._keyPath, '/inheritance:r', '/grant:r', `%USERNAME%:R`], { stdio: 'ignore', timeout: 5000 });
      } catch (_) {
        // Best-effort.
      }
    }
  }
}

module.exports = { QuarantineKeyStore };
