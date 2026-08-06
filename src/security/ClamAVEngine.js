/**
 * Windows-specific ClamAV engine.
 *
 * Overrides binary names to `.exe` and keeps windows hidden.
 */
const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

class ClamAVEngine extends ClamAVEngineBase {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseDir]
   * @param {string} [options.dbDir]
   */
  constructor(options = {}) {
    super(options);
  }

  _clamscanPath(baseDir) {
    return baseDir ? path.join(baseDir, 'clamscan.exe') : '';
  }

  _freshclamPath(baseDir) {
    return baseDir ? path.join(baseDir, 'freshclam.exe') : '';
  }

  _spawnOptions() {
    return { windowsHide: true };
  }
}

module.exports = ClamAVEngine;
