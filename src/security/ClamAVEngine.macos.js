const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

/**
 * macOS-specific ClamAV engine.
 *
 * Uses bundled binaries when provided, otherwise falls back to
 * `/usr/local/bin/clamscan` and `/usr/local/bin/freshclam`.
 */
class ClamAVEngineMacOS extends ClamAVEngineBase {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseDir] - Directory containing bundled ClamAV binaries.
   * @param {string} [options.dbDir] - Virus definition directory.
   */
  constructor(options = {}) {
    super(options);
  }

  /**
   * Resolves the clamscan executable path for macOS.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to clamscan.
   */
  _clamscanPath(baseDir) {
    // On macOS, clamscan is typically in /usr/local/bin/clamscan or bundled.
    const bundled = baseDir ? path.join(baseDir, 'clamscan') : '';
    return bundled || '/usr/local/bin/clamscan';
  }

  /**
   * Resolves the freshclam executable path for macOS.
   *
   * @param {string} [baseDir] - Engine base directory.
   * @returns {string} Absolute path to freshclam.
   */
  _freshclamPath(baseDir) {
    const bundled = baseDir ? path.join(baseDir, 'freshclam') : '';
    return bundled || '/usr/local/bin/freshclam';
  }

  /**
   * Returns spawn options for macOS.
   *
   * @returns {{}} Spawn options.
   */
  _spawnOptions() {
    return {};
  }
}

module.exports = ClamAVEngineMacOS;
