const logger = require('../utils/logger');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// If clamscan produces no output for this long, the subprocess is considered
// hung (blocked I/O, stuck on a locked file, etc.) and is killed so a scan can
// never leave isScanning stuck true indefinitely.
//
// Windows pipes block-buffer clamscan's stdout, so a healthy scan can easily
// go quiet for several minutes while a large or locked file is scanned. The
// window must be generous enough that real scans never hit it.
const DEFAULT_SCAN_INACTIVITY_TIMEOUT_MS = 1800000; // Increased from 10 min to 30 min for large file scans
// freshclam has its own Connect/Receive timeouts but the process itself can
// still hang (e.g. stuck DNS); cap the whole update so it always resolves.
const DEFAULT_UPDATE_TIMEOUT_MS = 300000;

class ClamAVEngine {
  constructor(options = {}) {
    const candidates = [
      options.baseDir,
      process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'clamav') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'clamav') : null,
      path.join(__dirname, '..', '..', 'assets', 'clamav')
    ].filter(Boolean);

    this.baseDir = candidates.find(dir => fs.existsSync(path.join(dir, 'clamscan.exe'))) || candidates[candidates.length - 1];
    this.clamscanPath = path.join(this.baseDir, 'clamscan.exe');
    this.freshclamPath = path.join(this.baseDir, 'freshclam.exe');
    this.certsDir = path.join(this.baseDir, 'certs');
    this.dbDir = options.dbDir || path.join(this.baseDir, 'database');
    this.isReady = false;
    this.lastUpdateError = null;
    this.activeScanProcess = null;
    this.activeUpdateProcess = null;
    this.activeUpdatePromise = null;
    this.cancelScanRequested = false;
    this.cancelUpdateRequested = false;
  }

  async init() {
    if (!fs.existsSync(this.clamscanPath)) {
      logger.warn('ClamAV executable not found at ' + this.clamscanPath);
      this.isReady = false;
      return;
    }

    fs.mkdirSync(this.dbDir, { recursive: true });

    if (!this.hasVirusDatabase()) {
      logger.warn('ClamAV virus definitions not found in ' + this.dbDir + '; downloading with freshclam.');
      const updateResult = await this.updateDefinitions();
      if (!updateResult.success) {
        this.lastUpdateError = updateResult.error || updateResult.output || 'Unable to update ClamAV definitions';
        logger.warn('ClamAV definition update failed: ' + this.lastUpdateError);
      }
    }

    this.isReady = true;
    logger.info('ClamAV engine initialized at ' + this.baseDir);
  }

  getStatus() {
    return {
      ready: this.isReady,
      hasDefinitions: this.hasVirusDatabase(),
      baseDir: this.baseDir,
      dbDir: this.dbDir,
      lastUpdateError: this.lastUpdateError
    };
  }

  hasVirusDatabase() {
    const dbFiles = [
      'main.cvd',
      'daily.cvd',
      'bytecode.cvd',
      'main.cld',
      'daily.cld',
      'bytecode.cld'
    ];
    if (dbFiles.some(file => fs.existsSync(path.join(this.dbDir, file)))) return true;

    try {
      return fs.readdirSync(this.dbDir).some(file => /\.(hdb|hsb|ndb|ldb|yara|yar)$/i.test(file));
    } catch (_) {
      return false;
    }
  }

  updateDefinitions(onProgress, options = {}) {
    if (!fs.existsSync(this.freshclamPath)) {
      return Promise.resolve({ success: false, error: 'freshclam.exe not found at ' + this.freshclamPath, output: '' });
    }

    // Startup initialization and a manual update can overlap. Share the
    // in-flight operation instead of spawning competing freshclam processes,
    // which otherwise contend for freshclam's database lock and both fail.
    if (this.activeUpdatePromise) return this.activeUpdatePromise;

    const timeoutMs = options.timeoutMs || DEFAULT_UPDATE_TIMEOUT_MS;

    fs.mkdirSync(this.dbDir, { recursive: true });
    const configPath = this.ensureFreshclamConfig();

    const updatePromise = new Promise((resolve) => {
      const args = [
        '--config-file=' + configPath,
        '--stdout',
        '--show-progress',
        '--datadir=' + this.dbDir
      ];

      if (fs.existsSync(this.certsDir)) {
        args.push('--cvdcertsdir=' + this.certsDir);
      }

      let output = '';
      let freshclam;
      try {
        freshclam = spawn(this.freshclamPath, args, {
          cwd: this.baseDir,
          windowsHide: true
        });
        this.activeUpdateProcess = freshclam;
      } catch (err) {
        resolve({ success: false, error: err.message, output });
        return;
      }

      let timedOut = false;
      const updateTimeout = setTimeout(() => {
        timedOut = true;
        if (this.activeUpdateProcess === freshclam) {
          try { this.activeUpdateProcess.kill(); } catch (_) {}
        }
      }, timeoutMs);
      if (typeof updateTimeout.unref === 'function') updateTimeout.unref();

      const finish = (result) => {
        clearTimeout(updateTimeout);
        if (this.activeUpdateProcess === freshclam) this.activeUpdateProcess = null;
        resolve(result);
      };

      const handleData = (data) => {
        const chunk = data.toString();
        output += chunk;
        if (onProgress) onProgress({ phase: 'update', text: chunk });
      };

      freshclam.stdout.on('data', handleData);
      freshclam.stderr.on('data', handleData);

      freshclam.on('close', (code) => {
        const wasCanceled = this.cancelUpdateRequested;
        if (this.activeUpdateProcess === freshclam) {
          this.activeUpdateProcess = null;
          this.cancelUpdateRequested = false;
        }

        if (timedOut) {
          finish({ success: false, error: 'Definition update timed out', output });
          return;
        }

        if (wasCanceled) {
          finish({ success: false, canceled: true, error: 'Definition update canceled', output });
          return;
        }

        const hasDb = this.hasVirusDatabase();
        if (code === 0 || hasDb) {
          this.lastUpdateError = null;
          finish({ success: true, code, output });
          return;
        }

        const error = output.trim() || 'freshclam exited with code ' + code;
        finish({ success: false, code, output, error });
      });

      freshclam.on('error', (err) => {
        finish({ success: false, error: err.message, output });
      });
    });
    let trackedPromise;
    trackedPromise = updatePromise.finally(() => {
      if (this.activeUpdatePromise === trackedPromise) this.activeUpdatePromise = null;
    });
    this.activeUpdatePromise = trackedPromise;
    return trackedPromise;
  }

  ensureFreshclamConfig() {
    const configPath = path.join(this.dbDir, 'freshclam.conf');
    const lines = [
      'DatabaseDirectory "' + this.toClamPath(this.dbDir) + '"',
      'DatabaseMirror database.clamav.net',
      'ScriptedUpdates yes',
      'LogTime yes',
      'UpdateLogFile "' + this.toClamPath(path.join(this.dbDir, 'freshclam.log')) + '"',
      'ConnectTimeout 30',
      'ReceiveTimeout 60'
    ];

    if (fs.existsSync(this.certsDir)) {
      lines.push('CVDCertsDirectory "' + this.toClamPath(this.certsDir) + '"');
    }

    fs.writeFileSync(configPath, lines.join('\n') + '\n', 'utf8');
    return configPath;
  }

  toClamPath(value) {
    return path.resolve(value).replace(/\\/g, '/');
  }

  async scanFile(filePath, onProgress, options = {}) {
    if (!this.isReady) {
      return { success: false, error: 'ClamAV not ready', threatsFound: 0, filesScanned: 0, output: '' };
    }

    if (!this.hasVirusDatabase()) {
      const updateResult = await this.updateDefinitions(onProgress);
      if (!updateResult.success || !this.hasVirusDatabase()) {
        return {
          success: false,
          error: 'ClamAV virus definitions are not available. ' + (updateResult.error || this.lastUpdateError || ''),
          threatsFound: 0,
          filesScanned: 0,
          output: updateResult.output || ''
        };
      }
    }

    const inactivityTimeoutMs = options.inactivityTimeoutMs || DEFAULT_SCAN_INACTIVITY_TIMEOUT_MS;

    let isDir;
    try {
      isDir = fs.statSync(filePath).isDirectory();
    } catch (err) {
      return { success: false, error: err.message, threatsFound: 0, filesScanned: 0, output: '' };
    }

    return new Promise((resolve) => {
      const args = [
        '--stdout',
        '--database=' + this.toClamPath(this.dbDir),
        '--max-dir-recursion=32'
      ];

      if (isDir) {
        args.push('--recursive');
      }

      args.push(filePath);

      let clam;
      try {
        clam = spawn(this.clamscanPath, args, {
          cwd: this.baseDir,
          windowsHide: true
        });
        this.activeScanProcess = clam;
      } catch (err) {
        resolve({ success: false, error: err.message, threatsFound: 0, filesScanned: 0, output: '' });
        return;
      }
      let output = '';
      let stderr = '';
      let lines = [];

      let timedOut = false;
      let inactivityTimer = null;

      const armInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          timedOut = true;
          if (this.activeScanProcess === clam) {
            try { this.activeScanProcess.kill(); } catch (_) {}
          }
        }, inactivityTimeoutMs);
        if (typeof inactivityTimer.unref === 'function') inactivityTimer.unref();
      };

      const clearInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = null;
      };

      const finish = (result) => {
        clearInactivityTimer();
        if (this.activeScanProcess === clam) this.activeScanProcess = null;
        resolve(result);
      };

      const handleOutput = (data) => {
        armInactivityTimer();
        const chunk = data.toString();
        output += chunk;
        lines = lines.concat(chunk.split(/\r?\n/).filter(line => line.trim()));

        if (onProgress) {
          const fileLines = lines.filter(line => /: (OK|.+ FOUND|ERROR)$/i.test(line.trim()));
          onProgress({ text: chunk, fileCount: fileLines.length });
        }
      };

      armInactivityTimer();

      clam.stdout.on('data', handleOutput);
      clam.stderr.on('data', (data) => {
        stderr += data.toString();
        handleOutput(data);
      });

      clam.on('close', (code) => {
        clearInactivityTimer();
        const wasCanceled = this.cancelScanRequested;
        if (this.activeScanProcess === clam) {
          this.activeScanProcess = null;
          this.cancelScanRequested = false;
        }

        if (timedOut) {
          finish({
            success: false,
            error: 'Scan timed out',
            threats: [],
            threatsFound: 0,
            output,
            filesScanned: 0
          });
          return;
        }

        if (wasCanceled) {
          finish({
            success: false,
            canceled: true,
            error: 'Scan canceled',
            threats: [],
            threatsFound: 0,
            output,
            filesScanned: 0
          });
          return;
        }

        const fileLines = lines.filter(line => /: (OK|.+ FOUND|ERROR)$/i.test(line.trim()));
        const foundLines = lines.filter(line => /: .+ FOUND$/i.test(line.trim()));
        const accessDeniedLines = lines.filter(line =>
          /: (can't open file|lstat\(\) failed|permission denied|access is denied)/i.test(line)
        );
        const realErrorLines = lines.filter(line =>
          /: ERROR$/i.test(line.trim()) && !/can't open file|lstat\(\) failed|permission denied|access is denied/i.test(line)
        );
        const threats = foundLines.map(line => {
          const match = line.match(/^(.*):\s+(.+)\s+FOUND$/i);
          return match ? { path: match[1], name: match[2] } : { path: line, name: 'Unknown' };
        });

        const onlyOpenErrors = code === 2 && accessDeniedLines.length > 0 && foundLines.length === 0 && realErrorLines.length === 0;
        const error = code === 2 && !onlyOpenErrors ? (stderr || output).trim() || 'clamscan exited with code 2' : null;

        finish({
          success: code !== 2 || onlyOpenErrors,
          error,
          warnings: accessDeniedLines,
          note: onlyOpenErrors ? `${accessDeniedLines.length} protected file(s) could not be opened and were skipped.` : null,
          threats,
          threatsFound: threats.length,
          output,
          filesScanned: fileLines.length
        });
      });

      clam.on('error', (err) => {
        finish({ success: false, error: err.message, threatsFound: 0, filesScanned: 0, output: '' });
      });
    });
  }

  abortCurrentScan() {
    let killed = false;

    if (this.activeScanProcess) {
      this.cancelScanRequested = true;
      try {
        this.activeScanProcess.kill();
        killed = true;
      } catch (_) {}
    }

    if (this.activeUpdateProcess) {
      this.cancelUpdateRequested = true;
      try {
        this.activeUpdateProcess.kill();
        killed = true;
      } catch (_) {}
    }

    return killed;
  }
}

module.exports = ClamAVEngine;
