/**
 * Windows-specific ClamAV engine.
 *
 * Overrides binary names to `.exe` and keeps windows hidden.
 */
const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

/**
 * Windows-specific ClamAV engine.
 *
 * Overrides binary names to `.exe` and keeps windows hidden.
 */
class ClamAVEngine extends ClamAVEngineBase {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseDir]
   * @param {string} [options.dbDir]
   */
  constructor(options = {}) {
    super(options);
  }

  /**
   * Resolves the clamscan executable path for Windows.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to clamscan.exe.
   */
  _clamscanPath(baseDir) {
    return baseDir ? path.join(baseDir, 'clamscan.exe') : '';
  }

  /**
   * Resolves the freshclam executable path for Windows.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to freshclam.exe.
   */
  _freshclamPath(baseDir) {
    return baseDir ? path.join(baseDir, 'freshclam.exe') : '';
  }

  /**
   * Returns spawn options for Windows (hidden window).
   *
   * @returns {{ windowsHide: boolean }} Spawn options.
   */
  _spawnOptions() {
    return { windowsHide: true };
  }
}

module.exports = ClamAVEngine;
