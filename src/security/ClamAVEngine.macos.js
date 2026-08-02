const path = require('path');
const ClamAVEngineBase = require('./ClamAVEngineBase');

class ClamAVEngineMacOS extends ClamAVEngineBase {
  constructor(options = {}) {
    super(options);
  }

  _clamscanPath(baseDir) {
    // On macOS, clamscan is typically in /usr/local/bin/clamscan or bundled.
    const bundled = baseDir ? path.join(baseDir, 'clamscan') : '';
    return bundled || '/usr/local/bin/clamscan';
  }

  _freshclamPath(baseDir) {
    const bundled = baseDir ? path.join(baseDir, 'freshclam') : '';
    return bundled || '/usr/local/bin/freshclam';
  }

  _spawnOptions() {
    return {};
  }
}

module.exports = ClamAVEngineMacOS;
