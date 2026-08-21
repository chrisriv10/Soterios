const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { clampProgress } = require('../core/scanProgress');

// How long a user scan waits for a preempted folder-watch scan to release the
// ClamAV process before proceeding anyway.
const FOLDER_WATCH_TAKEOVER_TIMEOUT_MS = 10000;

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function scanReportsDir() {
  const dir = path.join(os.homedir(), '.soterios', 'scan-reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function renderScanReportHtml(report) {
  const threatRows = report.threats.length
    ? report.threats.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.path)}</td></tr>`).join('')
    : '<tr><td colspan="2">No threats found.</td></tr>';
  const errors = report.errors.length
    ? report.errors.map((e) => `<li>${esc(e)}</li>`).join('')
    : '<li>No scan errors recorded.</li>';
  const scanType = report.scanType ? report.scanType.charAt(0).toUpperCase() + report.scanType.slice(1) : 'Scan';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Soterios Scan Report</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#15202b;background:#fff}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #d7dde5;border-radius:6px;padding:14px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;border-bottom:1px solid #e6eaf0;padding:8px;font-size:13px}.danger{color:#b42318}.ok{color:#027a48}.warn{color:#b54708}pre{white-space:pre-wrap;word-break:break-word}</style>
</head><body>
<h1>Soterios Scan Report</h1>
<div class="muted">Generated ${esc(new Date(report.completedAt).toLocaleString())}</div>
<div class="grid">
  <div class="card"><div class="muted">Type</div><h2>${esc(scanType)}</h2></div>
  <div class="card"><div class="muted">Status</div><h2 class="${report.status === 'completed' ? 'ok' : 'warn'}">${esc(report.status)}</h2></div>
  <div class="card"><div class="muted">Files Scanned</div><h2>${esc(report.filesScanned)}</h2></div>
  <div class="card"><div class="muted">Threats</div><h2 class="${report.threatsFound ? 'danger' : 'ok'}">${esc(report.threatsFound)}</h2></div>
</div>
<h2>Targets</h2><pre>${esc(report.targetPaths.join('\n'))}</pre>
<h2>Threat Details</h2>
<table><thead><tr><th>Name</th><th>Path</th></tr></thead><tbody>${threatRows}</tbody></table>
<h2>Errors and Notes</h2><ul>${errors}</ul>
</body></html>`;
}

function countFilesInPaths(paths) {
  let totalFiles = 0;
  for (const targetPath of paths) {
    try {
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          totalFiles += 1;
        } else if (stat.isDirectory()) {
          // Recursively count files in directory
          function countFiles(dir) {
            const items = fs.readdirSync(dir);
            for (const item of items) {
              const fullPath = path.join(dir, item);
              try {
                const itemStat = fs.statSync(fullPath);
                if (itemStat.isFile()) {
                  totalFiles += 1;
                } else if (itemStat.isDirectory()) {
                  countFiles(fullPath);
                }
              } catch (_) {
                // Skip files we can't access
              }
            }
          }
          countFiles(targetPath);
        }
      }
    } catch (_) {
      // Skip paths we can't access
    }
  }
  return totalFiles;
}

class ScanEngine {
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
      filesScanned: 0,
      threatsFound: 0,
      phase: 'idle',
      lastMessage: '',
      currentTarget: null,
      targetIndex: 0,
      targetCount: 0,
      completedTargets: [],
      progressEstimated: false,
      lastResult: null
    };

    this.folderWatchScan = {
      abortController: null,
      isScanning: false,
      currentScan: null,
      notes: [],
      progress: 0,
      filesScanned: 0,
      threatsFound: 0,
      phase: 'idle',
      lastMessage: '',
      currentTarget: null,
      targetIndex: 0,
      targetCount: 0,
      completedTargets: [],
      progressEstimated: false,
      lastResult: null
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
      return this.runScan('quick', [], 'No scan targets found.');
    }

    return this.runScan('quick', targets, 'Quick scan starting...');
  }

  async runFullScan() {
    if (this.userScan.isScanning) return { error: 'Scan already in progress' };

    return this.runScan('full', ['C:\\'], 'Full scan starting (this may take a while)...');
  }

  async runCustomScan(paths) {
    if (this.userScan.isScanning) return { error: 'Scan already in progress' };
    return this.runScan('custom', paths, 'Custom scan starting...');
  }

  async runScan(scanType, paths, startMessage) {
    const isFolderWatch = scanType === 'folderwatch';
    const scanState = isFolderWatch ? this.folderWatchScan : this.userScan;
    
    if (isFolderWatch) {
      if (scanState.isScanning) return { error: 'Folder watch scan already in progress' };
      // A user scan takes priority over the ClamAV process; folder-watch defers.
      if (this.userScan.isScanning) return { error: 'Scan already in progress' };
    } else {
      if (scanState.isScanning) return { error: 'Scan already in progress' };
      // A user scan always takes priority: cancel any running folder-watch
      // scan so it never blocks the user, then wait for it to release the
      // ClamAV process before spawning our own clamscan.
      if (this.folderWatchScan.isScanning) {
        this._cancelFolderWatchScan();
        const deadline = Date.now() + FOLDER_WATCH_TAKEOVER_TIMEOUT_MS;
        while (this.folderWatchScan.isScanning && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
    }
    
    scanState.isScanning = true;
    scanState.abortController = new AbortController();
    scanState.currentScan = {
      scanType,
      paths,
      targetPaths: paths,
      startedAt: new Date().toISOString()
    };
    scanState.notes = [];
    scanState.progress = 0;
    scanState.filesScanned = 0;
    scanState.threatsFound = 0;
    scanState.phase = 'preparing';
    scanState.lastMessage = startMessage;
    scanState.currentTarget = null;
    scanState.targetIndex = 0;
    scanState.targetCount = paths.length;
    scanState.completedTargets = [];
    scanState.progressEstimated = scanType === 'full';
    if (!isFolderWatch) scanState.lastResult = null;

    const startTime = Date.now();
    let totalFilesScanned = 0;
    let totalThreatsFound = 0;
    const threats = [];
    const errors = [];
    const completedTargets = [];
    let wasCanceled = false;

    // Progress must never move backward within a single scan. Previously,
    // each target path computed its own fresh, lower "basePct" and emitted
    // it immediately on starting the next path, causing the reported
    // percentage to visibly climb toward ~80-95% then drop back down --
    // once per target path being scanned. This tracks the highest
    // percentage reported so far and clamps every emission to it.
    let maxEmittedPct = 0;
    let cumulativeFiles = 0;
    const emitProgress = (pctCandidate, message, extra = {}) => {
      const pct = Math.max(maxEmittedPct, clampProgress(pctCandidate));
      maxEmittedPct = pct;
      scanState.progress = pct;
      if (Number.isFinite(extra.filesScanned)) {
        scanState.filesScanned = extra.filesScanned;
      }
      if (Number.isFinite(extra.threatsFound)) {
        scanState.threatsFound = extra.threatsFound;
      }
      if (extra.phase) scanState.phase = extra.phase;
      if (Object.prototype.hasOwnProperty.call(extra, 'currentTarget')) {
        scanState.currentTarget = extra.currentTarget;
      }
      if (Number.isFinite(extra.targetIndex)) scanState.targetIndex = extra.targetIndex;
      if (Number.isFinite(extra.targetCount)) scanState.targetCount = extra.targetCount;
      if (Array.isArray(extra.completedTargets)) scanState.completedTargets = extra.completedTargets.slice();
      scanState.lastMessage = message || scanState.lastMessage;
      this.eventBus.emit('scan:progress', {
        scanType,
        pct,
        message,
        phase: scanState.phase,
        startedAt: scanState.currentScan.startedAt,
        currentTarget: scanState.currentTarget,
        targetPaths: scanState.currentScan.targetPaths,
        targetIndex: scanState.targetIndex,
        targetCount: scanState.targetCount,
        completedTargets: scanState.completedTargets.slice(),
        filesScanned: scanState.filesScanned,
        threatsFound: scanState.threatsFound,
        progressEstimated: scanState.progressEstimated,
        ...extra
      });
    };

    try {
      emitProgress(5, startMessage, { phase: 'preparing' });

      // Pre-count total files for accurate progress calculation (skip for full scans to avoid long delays)
      let totalFilesToScan = 0;
      if (scanType !== 'full' && paths.length < 10) {
        emitProgress(5, 'Preparing scan', { phase: 'preparing' });
        totalFilesToScan = countFilesInPaths(paths);
        console.log(`[ScanEngine] Pre-counted ${totalFilesToScan} files in ${paths.length} paths`);
      }

      for (let i = 0; i < paths.length; i++) {
        if (scanState.abortController.signal.aborted) {
          wasCanceled = true;
          break;
        }

        const targetPath = paths[i];
        emitProgress(maxEmittedPct, 'Scanning ' + targetPath + '...', {
          phase: 'scanning',
          currentTarget: targetPath,
          targetIndex: i + 1,
          targetCount: paths.length
        });
        
        let pathLastChecked = 0;
        let hasReportedProgress = false;
        const result = await this.clamEngine.scanFile(targetPath, (progress) => {
          if (!progress) return;
          if (progress.phase === 'update') {
            emitProgress(Math.max(8, Math.min(20, cumulativeFiles / 5)), 'Updating ClamAV definitions...', {
              phase: 'updating-definitions'
            });
            return;
          }

          const checked = progress.fileCount || 0;
          cumulativeFiles += checked - pathLastChecked;
          pathLastChecked = checked;
          
          // Only emit progress if files are actually being scanned
          if (checked > 0) {
            // Calculate progress based on actual files scanned
            let pct;
            if (totalFilesToScan > 0) {
              // Use accurate percentage if we pre-counted files
              pct = Math.min(95, Math.round((cumulativeFiles / totalFilesToScan) * 90));
            } else {
              // Fall back to logarithmic scaling for full scans or when pre-counting was skipped
              pct = Math.min(95, Math.round(Math.log10(cumulativeFiles + 1) * 15));
            }
            emitProgress(pct, 'Scanning ' + targetPath + ' (' + checked + ' files checked)...', {
              phase: 'scanning',
              currentTarget: targetPath,
              targetIndex: i + 1,
              targetCount: paths.length,
              filesScanned: cumulativeFiles,
              threatsFound: totalThreatsFound
            });
            hasReportedProgress = true;
          }
        }, {
          inactivityTimeoutMs: scanType === 'folderwatch' ? 600000 : 1800000
        });
        
        // If no progress was reported during this path scan, emit a minimal progress update
        if (!hasReportedProgress && !wasCanceled) {
          emitProgress(Math.max(5, Math.min(20, cumulativeFiles / 5)), 'Scanning ' + targetPath + ' (no files found)...', {
            phase: 'scanning',
            currentTarget: targetPath,
            targetIndex: i + 1,
            targetCount: paths.length,
            filesScanned: cumulativeFiles,
            threatsFound: totalThreatsFound
          });
        }

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
          scanState.threatsFound = totalThreatsFound;
          scanState.filesScanned = Math.max(totalFilesScanned, cumulativeFiles);
          if (Array.isArray(result.threats)) threats.push(...result.threats);
          if (result.note) {
            scanState.notes.push(result.note);
          }

          // Quarantine each newly-found threat from this iteration
          if (Array.isArray(result.threats)) {
            for (const threat of result.threats) {
              try {
                // Hold at the current highest percentage rather than
                // recalculating - the path's scan has already completed by this
                // point, so progress shouldn't dip back just because a threat was found.
                emitProgress(maxEmittedPct, 'Quarantining ' + threat.name + '...', {
                  phase: 'quarantining',
                  threatsFound: totalThreatsFound
                });
                
                const fileBuffer = fs.readFileSync(threat.path);
                const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

                // Skip files the user explicitly trusted (false-positive whitelist)
                // so they are not re-quarantined on every pass.
                let hashTrusted = false;
                try {
                  hashTrusted = !!(this.db && typeof this.db.isHashTrusted === 'function' && this.db.isHashTrusted(hash));
                } catch (_) {
                  hashTrusted = false;
                }
                if (hashTrusted) {
                  threat.trusted = true;
                  scanState.notes.push(`Skipped trusted file: ${threat.path}`);
                  continue;
                }

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
          completedTargets.push(targetPath);
          emitProgress(maxEmittedPct, 'Finished scanning ' + targetPath, {
            phase: 'scanning',
            currentTarget: targetPath,
            targetIndex: i + 1,
            targetCount: paths.length,
            completedTargets,
            filesScanned: scanState.filesScanned,
            threatsFound: totalThreatsFound
          });
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
      const finalFilesScanned = Math.max(totalFilesScanned, cumulativeFiles);
      const reportPayload = {
        scanType,
        status,
        startedAt: scanState.currentScan ? scanState.currentScan.startedAt : new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        targetPaths: paths,
        completedTargets: completedTargets.slice(),
        filesScanned: finalFilesScanned,
        threatsFound: totalThreatsFound,
        durationMs,
        threats,
        errors,
        details: { threats, errors }
      };
      const shouldPersistReport = scanType !== 'folderwatch';
      const report = shouldPersistReport
        ? this.saveScanReport(reportPayload)
        : reportPayload;
      try {
        if (shouldPersistReport && this.db.getSetting('feature.scanHistory', true)) {
          this.db.logScan(scanType, totalFilesScanned, totalThreatsFound, durationMs);
        }
      } catch (_) {}
      scanState.currentScan = null;
      scanState.abortController = null;
      scanState.filesScanned = finalFilesScanned;
      scanState.threatsFound = totalThreatsFound;
      scanState.phase = status;
      scanState.lastMessage = status === 'completed' ? 'Scan complete' : status === 'canceled' ? 'Scan canceled' : 'Scan failed';
      const lastResult = {
        scanType,
        status,
        startedAt: reportPayload.startedAt,
        completedAt: reportPayload.completedAt,
        targetPaths: paths,
        completedTargets: completedTargets.slice(),
        filesScanned: finalFilesScanned,
        threatsFound: totalThreatsFound,
        threats: threats.slice(),
        progress: status === 'completed' ? 100 : maxEmittedPct,
        durationMs,
        errors: errors.slice(),
        note: scanState.notes.length ? scanState.notes.join(' ') : undefined,
        report
      };
      if (!isFolderWatch) scanState.lastResult = lastResult;
      if (wasCanceled) {
        this.eventBus.emit('scan:canceled', {
          scanType,
          filesScanned: finalFilesScanned,
          threatsFound: totalThreatsFound,
          durationMs,
          status: 'canceled'
        });
      }
      this.eventBus.emit('scan:complete', {
        scanType,
        startedAt: reportPayload.startedAt,
        completedAt: reportPayload.completedAt,
        targetPaths: paths,
        completedTargets: completedTargets.slice(),
        filesScanned: finalFilesScanned,
        threatsFound: totalThreatsFound,
        pct: status === 'completed' ? 100 : maxEmittedPct,
        durationMs,
        threats,
        errors,
        note: lastResult.note,
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
      filesScanned: Math.max(totalFilesScanned, cumulativeFiles),
      threatsFound: totalThreatsFound,
      completedTargets: completedTargets.slice(),
      threats,
      errors,
      error: errors[0],
      note
    };
  }

  abortScan() {
    // Prefer aborting the user's scan; only fall through to the background
    // folder-watch scan if no user scan is active, so a stuck background
    // scan can never lock the user out of scans indefinitely.
    const target = this.userScan.isScanning ? this.userScan
      : this.folderWatchScan.isScanning ? this.folderWatchScan
      : null;

    if (!target) {
      return { success: false, canceled: false, error: 'No scan in progress' };
    }
    if (target.abortController) target.abortController.abort();
    if (this.clamEngine && typeof this.clamEngine.abortCurrentScan === 'function') {
      this.clamEngine.abortCurrentScan();
    }
    target.phase = 'canceling';
    target.lastMessage = 'Canceling scan...';
    this.eventBus.emit('scan:progress', {
      scanType: target.currentScan && target.currentScan.scanType,
      pct: null,
      message: target.lastMessage,
      phase: target.phase,
      startedAt: target.currentScan && target.currentScan.startedAt,
      currentTarget: target.currentTarget,
      targetPaths: target.currentScan && target.currentScan.targetPaths,
      targetIndex: target.targetIndex,
      targetCount: target.targetCount,
      completedTargets: target.completedTargets.slice(),
      filesScanned: target.filesScanned,
      threatsFound: target.threatsFound,
      progressEstimated: target.progressEstimated
    });
    return { success: true, canceled: true };
  }

  _cancelFolderWatchScan() {
    if (this.folderWatchScan.abortController) this.folderWatchScan.abortController.abort();
    if (this.clamEngine && typeof this.clamEngine.abortCurrentScan === 'function') {
      this.clamEngine.abortCurrentScan();
    }
  }

  getStatus() {
    const activeScan = this.userScan.isScanning ? this.userScan
      : this.folderWatchScan.isScanning ? this.folderWatchScan
      : null;
    return {
      isScanning: this.userScan.isScanning,
      isFolderWatchScanning: this.folderWatchScan.isScanning,
      currentScan: this.userScan.currentScan || this.folderWatchScan.currentScan,
      progress: activeScan ? activeScan.progress : 0,
      filesScanned: activeScan ? activeScan.filesScanned : 0,
      threatsFound: activeScan ? activeScan.threatsFound : 0,
      phase: activeScan ? activeScan.phase : 'idle',
      message: activeScan ? activeScan.lastMessage : '',
      currentTarget: activeScan ? activeScan.currentTarget : null,
      targetIndex: activeScan ? activeScan.targetIndex : 0,
      targetCount: activeScan ? activeScan.targetCount : 0,
      completedTargets: activeScan ? activeScan.completedTargets.slice() : [],
      progressEstimated: activeScan ? activeScan.progressEstimated : false,
      startedAt: activeScan && activeScan.currentScan ? activeScan.currentScan.startedAt : null,
      lastResult: this.userScan.lastResult
    };
  }

  clearLastResult() {
    this.userScan.lastResult = null;
  }

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
