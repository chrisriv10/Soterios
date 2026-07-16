const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Soterios Scan Report</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#15202b;background:#fff}.muted{color:#667085}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card{border:1px solid #d7dde5;border-radius:6px;padding:14px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;border-bottom:1px solid #e6eaf0;padding:8px;font-size:13px}.danger{color:#b42318}.ok{color:#027a48}.warn{color:#b54708}pre{white-space:pre-wrap;word-break:break-word}</style>
</head><body>
<h1>Soterios Scan Report</h1>
<div class="muted">Generated ${esc(new Date(report.completedAt).toLocaleString())}</div>
<div class="grid">
  <div class="card"><div class="muted">Type</div><h2>${esc(report.scanType)}</h2></div>
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

class ScanEngine {
  constructor(db, eventBus, clamEngine, heuristicEngine, reputationEngine, quarantineManager) {
    this.db = db;
    this.eventBus = eventBus;
    this.clamEngine = clamEngine;
    this.heuristicEngine = heuristicEngine;
    this.reputationEngine = reputationEngine;
    this.quarantineManager = quarantineManager;
    this.abortController = null;
    this.isScanning = false;
    this.currentScan = null;
  }

  async runQuickScan() {
    if (this.isScanning) return { error: 'Scan already in progress' };

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

  async runFullScan() {
    if (this.isScanning) return { error: 'Scan already in progress' };

    return this.runScan('full', ['C:\\'], 'Full scan starting (this may take a while)...');
  }

  async runCustomScan(paths) {
    if (this.isScanning) return { error: 'Scan already in progress' };
    return this.runScan('custom', paths, 'Custom scan starting...');
  }

  async runScan(scanType, paths, startMessage) {
    this.isScanning = true;
    this.abortController = new AbortController();
    this.currentScan = { scanType, paths, startedAt: new Date().toISOString() };

    const startTime = Date.now();
    let totalFilesScanned = 0;
    let totalThreatsFound = 0;
    const threats = [];
    const errors = [];
    let wasCanceled = false;

    // Progress must never move backward within a single scan. Previously,
    // each target path computed its own fresh, lower "basePct" and emitted
    // it immediately on starting the next path, causing the reported
    // percentage to visibly climb toward ~80-95% then drop back down --
    // once per target path being scanned. This tracks the highest
    // percentage reported so far and clamps every emission to it.
    let maxEmittedPct = 0;
    let cumulativeFiles = 0;
    const emitProgress = (pctCandidate, message, extra) => {
      const pct = Math.max(maxEmittedPct, Math.min(100, pctCandidate));
      maxEmittedPct = pct;
      this.eventBus.emit('scan:progress', { scanType, pct, message, ...extra });
    };

    try {
      emitProgress(5, startMessage);

      for (let i = 0; i < paths.length; i++) {
        if (this.abortController.signal.aborted) {
          wasCanceled = true;
          break;
        }

        const targetPath = paths[i];
        const basePct = Math.round((i / paths.length) * 80 + 10);
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

        if (this.abortController.signal.aborted) {
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
            this._notes = this._notes || [];
            this._notes.push(result.note);
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
      if (this.abortController && this.abortController.signal.aborted) {
        wasCanceled = true;
      } else {
        logger.error('Scan error:', err);
        errors.push(err.message || String(err));
      }
    } finally {
      this.isScanning = false;
      const durationMs = Date.now() - startTime;
      const status = wasCanceled ? 'canceled' : (errors.length === 0 ? 'completed' : 'failed');
      const reportPayload = {
        scanType,
        status,
        startedAt: this.currentScan ? this.currentScan.startedAt : new Date(startTime).toISOString(),
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
      } catch (_) {}
      this.currentScan = null;
      this.abortController = null;
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

    const notes = this._notes || [];
    this._notes = undefined;
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

  abortScan() {
    if (!this.isScanning) {
      return { success: false, canceled: false, error: 'No scan in progress' };
    }
    if (this.currentScan?.scanType === 'folderwatch') {
      return { success: false, canceled: false, error: 'No user scan in progress' };
    }
    if (this.abortController) this.abortController.abort();
    if (this.clamEngine && typeof this.clamEngine.abortCurrentScan === 'function') {
      this.clamEngine.abortCurrentScan();
    }
    this.eventBus.emit('scan:progress', { pct: null, message: 'Canceling scan...' });
    return { success: true, canceled: true };
  }

  getStatus() {
    return {
      isScanning: this.isScanning,
      currentScan: this.currentScan
    };
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