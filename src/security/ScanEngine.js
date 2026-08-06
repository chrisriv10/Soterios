const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clampProgress } = require('../core/scanProgress');
const { scanReportsDir } = require('./reportExport');
const { renderTemplate } = require('../utils/templates');

/**
 * Escape a string for safe insertion into HTML.
 * @param {*} v - Value to escape.
 * @returns {string} Escaped string.
 */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[ch]));
}

/**
 * Render a scan report as an HTML string.
 * @param {Object} report - Scan report payload.
 * @returns {string} HTML document string.
 */
function renderScanReportHtml(report) {
  const threatRows = report.threats.length
    ? report.threats.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.path)}</td></tr>`).join('')
    : '<tr><td colspan="2">No threats found.</td></tr>';
  const errors = report.errors.length
    ? report.errors.map((e) => `<li>${esc(e)}</li>`).join('')
    : '<li>No scan errors recorded.</li>';
  const statusClass = report.status === 'completed' ? 'ok' : 'warn';
  const threatsClass = report.threatsFound ? 'danger' : 'ok';
  return renderTemplate(path.join(__dirname, '..', 'ui', 'templates', 'scan-report.html'), {
    GENERATED_AT: new Date(report.completedAt).toLocaleString(),
    SCAN_TYPE: esc(report.scanType),
    STATUS_CLASS: statusClass,
    STATUS: esc(report.status),
    FILES_SCANNED: esc(report.filesScanned),
    THREATS_CLASS: threatsClass,
    THREATS_FOUND: esc(report.threatsFound),
    TARGETS: esc(report.targetPaths.join('\n')),
    THREAT_ROWS: threatRows,
    ERRORS: errors,
  });
}

/**
 * Walk paths and collect file metadata for incremental scan comparison.
 * @param {string[]} paths - Root paths to walk.
 * @returns {Array<{ path: string, size: number|null, modifiedAt: string|null }>} File metadata objects.
 */
function collectFileMetadatas(paths) {
  const metadatas = [];
  const visited = new Set();

  function walk(current) {
    if (visited.has(current)) return;
    visited.add(current);
    let stat;
    try {
      stat = fs.statSync(current);
    } catch (_) {
      return;
    }
    if (stat.isFile()) {
      metadatas.push({
        path: current,
        size: stat.size,
        modifiedAt: new Date(stat.mtime).toISOString()
      });
      return;
    }
    if (stat.isDirectory()) {
      try {
        const entries = fs.readdirSync(current);
        for (const entry of entries) {
          const full = path.join(current, entry);
          // Skip junctions/symlinks to avoid cycles and permission issues.
          let entryStat;
          try {
            entryStat = fs.lstatSync(full);
          } catch (_) {
            continue;
          }
          if (entryStat.isSymbolicLink()) continue;
          walk(full);
        }
      } catch (_) {
        // Permission denied or other access error — skip this directory.
      }
    }
  }

  for (const target of paths || []) {
    walk(target);
  }
  return metadatas;
}

/**
 * Coordinates ClamAV scans, progress reporting, threat quarantine,
 * and scan report generation.
 */
class ScanEngine {
  /**
   * @param {DatabaseService} db
   * @param {EventBus} eventBus
   * @param {ClamAVEngine} clamEngine
   * @param {HeuristicEngine} heuristicEngine
   * @param {ReputationEngine} reputationEngine
   * @param {QuarantineManager} quarantineManager
   */
  constructor(db, eventBus, clamEngine, heuristicEngine, reputationEngine, quarantineManager) {
    this.db = db;
    this.eventBus = eventBus;
    this.clamEngine = clamEngine;
    this.heuristicEngine = heuristicEngine;
    this.reputationEngine = reputationEngine;
    this.quarantineManager = quarantineManager;

    // Separate state for user scans and folder-watch scans
    this.userScan = {
      abortController: null,
      isScanning: false,
      currentScan: null,
      notes: [],
      progress: 0,
      filesScanned: 0
    };

    this.folderWatchScan = {
      abortController: null,
      isScanning: false,
      currentScan: null,
      notes: [],
      progress: 0,
      filesScanned: 0
    };
  }

  // Compat getters: FolderWatcher and other callers historically read these
  // directly off the engine instance. Keep them working after the
  // userScan/folderWatchScan state split.
  get isScanning() {
    return this.userScan.isScanning;
  }

  get isFolderWatchScanning() {
    return this.folderWatchScan.isScanning;
  }

  /**
   * Run a quick scan against common system temp/startup locations.
   * @returns {Promise<Object>} Scan result.
   */
  async runQuickScan() {
    if (this.userScan.isScanning) return { error: 'Scan already in progress' };

    const windir = process.env.WINDIR || 'C:\\Windows';
    const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE + '\\AppData\\Local';
    const appData = process.env.APPDATA || process.env.USERPROFILE + '\\AppData\\Roaming';

    const targets = [
      windir + '\\Temp',
      localAppData + '\\Temp',
      windir + '\\Prefetch',
      appData + '\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'
    ].filter(t => {
      try { return require('fs').existsSync(t); } catch (_) { return false; }
    });

    if (targets.length === 0) {
      return { success: true, filesScanned: 0, threatsFound: 0, note: 'No scan targets found.' };
    }

    return this.runScan('quick', targets, 'Quick scan starting...');
  }

  /**
   * Run a full system scan starting from C:\.
   * @returns {Promise<Object>} Scan result.
   */
  async runFullScan() {
    if (this.userScan.isScanning) return { error: 'Scan already in progress' };

    return this.runScan('full', ['C:\\'], 'Full scan starting (this may take a while)...');
  }

  /**
   * Run a custom scan against user-specified paths.
   * @param {string[]} paths - Target paths.
   * @returns {Promise<Object>} Scan result.
   */
  async runCustomScan(paths) {
    if (this.userScan.isScanning) return { error: 'Scan already in progress' };
    return this.runScan('custom', paths, 'Custom scan starting...');
  }

  /**
   * Core scan orchestrator. Runs a single scan of the given type and paths,
   * emitting progress events and quarantining any threats found.
   *
   * @param {'quick'|'full'|'custom'|'folderwatch'} scanType
   * @param {string[]} paths - Target paths.
   * @param {string} startMessage - Initial progress message.
   * @returns {Promise<Object>} Scan result.
   */
  async runScan(scanType, paths, startMessage) {
    const isFolderWatch = scanType === 'folderwatch';
    const scanState = isFolderWatch ? this.folderWatchScan : this.userScan;
    
    if (isFolderWatch) {
      if (scanState.isScanning) return { error: 'Folder watch scan already in progress' };
      // A user scan takes priority over the ClamAV process; folder-watch defers.
      if (this.userScan.isScanning) return { error: 'Scan already in progress' };
    } else {
      if (scanState.isScanning) return { error: 'Scan already in progress' };
      // Only one scan can hold the ClamAV process at a time; wait out a
      // running folder-watch scan rather than clobbering it.
      if (this.folderWatchScan.isScanning) return { error: 'Scan already in progress' };
    }
    
    scanState.isScanning = true;
    scanState.abortController = new AbortController();
    scanState.currentScan = { scanType, paths, startedAt: new Date().toISOString() };
    scanState.notes = [];

    const startTime = Date.now();
    let totalFilesScanned = 0;
    let totalThreatsFound = 0;
    const threats = [];
    const errors = [];

    // Build skip set for incremental scans (full scans only).
    const isFullScan = scanType === 'full';
    const scanMetadatas = isFullScan ? paths.map((p) => {
      let stat;
      try { stat = fs.statSync(p); } catch (_) { stat = null; }
      return { path: p, size: stat ? stat.size : null, modifiedAt: stat ? new Date(stat.mtime).toISOString() : null };
    }) : [];
    const skipPaths = isFullScan ? this.db.getFilesToSkip(scanMetadatas) : new Set();

    // Progress must never move backward within a single scan. Previously,
    // each target path computed its own fresh, lower "basePct" and emitted
    // it immediately on starting the next path, causing the reported
    // percentage to visibly climb toward ~80-95% then drop back down --
    // once per target path being scanned. This tracks the highest
    // percentage reported so far and clamps every emission to it.
    let maxEmittedPct = 0;
    let cumulativeFiles = 0;
    const emitProgress = (pctCandidate, message, extra) => {
      const pct = Math.max(maxEmittedPct, clampProgress(pctCandidate));
      maxEmittedPct = pct;
      scanState.progress = pct;
      if (extra && extra.filesScanned) {
        scanState.filesScanned = extra.filesScanned;
      }
      this.eventBus.emit('scan:progress', { scanType, pct, message, ...extra });
    };

    let wasCanceled = false;
    try {
      emitProgress(5, startMessage);

      for (let i = 0; i < paths.length; i++) {
        if (scanState.abortController.signal.aborted) {
          wasCanceled = true;
          break;
        }

        const targetPath = paths[i];
        const basePct = Math.round((i / paths.length) * 80 + 10);

        // Incremental scan: skip paths that haven't changed since last scan.
        if (skipPaths.has(targetPath)) {
          emitProgress(basePct, 'Skipping unchanged: ' + targetPath + '...', { filesScanned: cumulativeFiles });
          continue;
        }

        emitProgress(basePct, 'Scanning ' + targetPath + '...');

        let pathLastChecked = 0;
        const result = await this.clamEngine.scanFile(targetPath, (progress) => {
          if (!progress) return;

          if (progress.phase === 'update') {
            emitProgress(Math.max(8, basePct - 2), 'Updating ClamAV definitions...');
            return;
          }

          const checked = progress.fileCount || 0;
          cumulativeFiles += checked - pathLastChecked;
          pathLastChecked = checked;
          const pct = Math.min(95, basePct + Math.min(70, Math.round(checked / 10)));
          emitProgress(pct, 'Scanning ' + targetPath + ' (' + checked + ' files checked)...', { filesScanned: cumulativeFiles });
        });

        if (scanState.abortController.signal.aborted) {
          wasCanceled = true;
          break;
        }

        if (result.canceled) {
          wasCanceled = true;
          break;
        }

        if (result.success) {
          totalThreatsFound += result.threatsFound || 0;
          totalFilesScanned += result.filesScanned || 0;
          if (Array.isArray(result.threats)) threats.push(...result.threats);
          if (result.note) {
            scanState.notes.push(result.note);
          }

          // Record scanned path for incremental scans.
          try {
            const meta = isFullScan ? scanMetadatas[i] : null;
            if (meta) {
              this.db.recordScannedFile(meta);
            } else {
              const stat = fs.statSync(targetPath);
              this.db.recordScannedFile({
                path: targetPath,
                size: stat.size,
                modifiedAt: stat.mtime.toISOString()
              });
            }
          } catch (_) {
            // Non-fatal: record best-effort for incremental cache.
          }

          // Quarantine each newly-found threat from this iteration
          if (Array.isArray(result.threats)) {
            for (const threat of result.threats) {
              try {
                // Hold at the current highest percentage rather than
                // basePct -- the path's scan has already completed by this
                // point, so progress shouldn't dip back to where that path
                // started just because a threat was found.
                emitProgress(maxEmittedPct, 'Quarantining ' + threat.name + '...');
                
                const fileBuffer = fs.readFileSync(threat.path);
                const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                
                const qResult = await this.quarantineManager.quarantine(
                  threat.path, hash, 'ClamAV', threat.name, 'Detected during ' + scanType + ' scan'
                );
                
                if (!qResult.success) {
                  errors.push(`Failed to quarantine ${threat.path}: ${qResult.error}`);
                }
              } catch (qErr) {
                errors.push(`Failed to quarantine ${threat.path}: ${qErr.message}`);
              }
            }
          }
        } else {
          if (wasCanceled || result.canceled) {
            wasCanceled = true;
          } else {
            errors.push(result.error || 'Scan failed for ' + targetPath);
          }
        }
      }
    } catch (err) {
      if (scanState.abortController && scanState.abortController.signal.aborted) {
        wasCanceled = true;
      } else {
        logger.error('Scan error:', err);
        errors.push(err.message || String(err));
      }
    } finally {
      scanState.isScanning = false;
      const durationMs = Date.now() - startTime;
      const status = wasCanceled ? 'canceled' : (errors.length === 0 ? 'completed' : 'failed');
      const reportPayload = {
        scanType,
        status,
        startedAt: scanState.currentScan ? scanState.currentScan.startedAt : new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        targetPaths: paths,
        filesScanned: totalFilesScanned,
        threatsFound: totalThreatsFound,
        durationMs,
        threats,
        errors,
        details: { threats, errors }
      };
      const shouldPersistReport = scanType !== 'folderwatch' && !wasCanceled;
      const report = shouldPersistReport
        ? this.saveScanReport(reportPayload)
        : reportPayload;
      try {
        if (shouldPersistReport && this.db.getSetting('feature.scanHistory', true)) {
          this.db.logScan(scanType, totalFilesScanned, totalThreatsFound, durationMs);
        }
      } catch (err) {
        logger.debug('Scan history log failed', { error: err.message });
      }
      scanState.currentScan = null;
      scanState.abortController = null;
      if (wasCanceled) {
        this.eventBus.emit('scan:canceled', {
          scanType,
          filesScanned: totalFilesScanned,
          threatsFound: totalThreatsFound,
          durationMs,
          status: 'canceled'
        });
      }
      this.eventBus.emit('scan:complete', {
        scanType,
        filesScanned: totalFilesScanned,
        threatsFound: totalThreatsFound,
        durationMs,
        threats,
        errors,
        status,
        report
      });
    }

    const notes = scanState.notes || [];
    const note = notes.length ? notes.join(' ') : undefined;
    return {
      success: !wasCanceled && errors.length === 0,
      canceled: wasCanceled,
      status: wasCanceled ? 'canceled' : (errors.length === 0 ? 'completed' : 'failed'),
      filesScanned: totalFilesScanned,
      threatsFound: totalThreatsFound,
      threats,
      errors,
      error: errors[0],
      note
    };
  }

  /**
   * Abort the current user-initiated scan.
   * @returns {Object} Abort result.
   */
  abortScan() {
    // Only abort user scans, not folder-watch scans
    if (!this.userScan.isScanning) {
      return { success: false, canceled: false, error: 'No user scan in progress' };
    }
    if (this.userScan.abortController) this.userScan.abortController.abort();
    if (this.clamEngine && typeof this.clamEngine.abortCurrentScan === 'function') {
      this.clamEngine.abortCurrentScan();
    }
    this.eventBus.emit('scan:progress', { pct: null, message: 'Canceling scan...' });
    return { success: true, canceled: true };
  }

  /**
   * Get the current scan status.
   * @returns {Object} Status object.
   */
  getStatus() {
    const activeScan = this.userScan.isScanning ? this.userScan
      : this.folderWatchScan.isScanning ? this.folderWatchScan
      : null;
    return {
      isScanning: this.userScan.isScanning,
      isFolderWatchScanning: this.folderWatchScan.isScanning,
      currentScan: this.userScan.currentScan || this.folderWatchScan.currentScan,
      progress: activeScan ? activeScan.progress : 0,
      filesScanned: activeScan ? activeScan.filesScanned : 0
    };
  }

  /**
   * Persist a scan report to disk and the database.
   * @param {Object} report - Scan report payload.
   * @returns {Object} Saved report with file paths.
   */
  saveScanReport(report) {
    const shouldSaveHistory = this.db.getSetting('feature.scanHistory', true);
    if (!shouldSaveHistory) {
      return report;
    }

    const dir = scanReportsDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `scan-${report.scanType}-${stamp}`;
    const jsonPath = path.join(dir, `${base}.json`);
    const htmlPath = path.join(dir, `${base}.html`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, renderScanReportHtml(report), 'utf8');
    const saved = { ...report, jsonPath, htmlPath };
    try {
      this.db.addScanReport({
        scanType: report.scanType,
        status: report.status,
        targetPaths: report.targetPaths || [],
        filesScanned: report.filesScanned || 0,
        threatsFound: report.threatsFound || 0,
        durationMs: report.durationMs || 0,
        jsonPath,
        htmlPath,
        details: report.details || {}
      });
    } catch (err) {
      logger.warn('Unable to save scan report record:', err.message || err);
    }
    return saved;
  }
}

module.exports = ScanEngine;