const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

class ClamAVEngineLinux extends ClamAVEngineBase {
  constructor(options = {}) {
    super(options);
  }

  _clamscanPath(baseDir) {
    // On Linux, clamscan is typically in /usr/bin/clamscan or bundled.
    const bundled = baseDir ? path.join(baseDir, 'clamscan') : '';
    return bundled || '/usr/bin/clamscan';
  }

  _freshclamPath(baseDir) {
    const bundled = baseDir ? path.join(baseDir, 'freshclam') : '';
    return bundled || '/usr/bin/freshclam';
  }

  _spawnOptions() {
    return {};
  }
}

module.exports = ClamAVEngineLinux;
