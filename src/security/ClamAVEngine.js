const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

class ClamAVEngine extends ClamAVEngineBase {
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
