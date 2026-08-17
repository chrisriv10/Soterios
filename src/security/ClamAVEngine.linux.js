const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

/**
 * Linux-specific ClamAV engine.
 *
 * Uses bundled binaries when provided, otherwise falls back to
 * `/usr/bin/clamscan` and `/usr/bin/freshclam`.
 */
class ClamAVEngineLinux extends ClamAVEngineBase {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseDir] - Directory containing bundled ClamAV binaries.
   * @param {string} [options.dbDir] - Virus definition directory.
   */
  constructor(options = {}) {
    super(options);
  }

  /**
   * Resolves the clamscan executable path for Linux.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to clamscan.
   */
  _clamscanPath(baseDir) {
    // On Linux, clamscan is typically in /usr/bin/clamscan or bundled.
    const bundled = baseDir ? path.join(baseDir, 'clamscan') : '';
    return bundled || '/usr/bin/clamscan';
  }

  /**
   * Resolves the freshclam executable path for Linux.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to freshclam.
   */
  _freshclamPath(baseDir) {
    const bundled = baseDir ? path.join(baseDir, 'freshclam') : '';
    return bundled || '/usr/bin/freshclam';
  }

  /**
   * Returns spawn options for Linux.
   *
   * @returns {{}} Spawn options.
   */
  _spawnOptions() {
    return {};
  }
}

module.exports = ClamAVEngineLinux;
