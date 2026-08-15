const { ipcMain } = require('electron');
const i18n = require('../../i18n');
const logger = require('../../utils/logger');

const DEFAULT_SCHEDULE = {
  enabled: false,
  scanType: 'quick',
  customPath: null,
  intervalHours: 24,
  lastRun: null,
};

function register(mainWindow, { db, eventBus, clamEngine, scanEngine, reputationEngine }) {
  const definitionState = {
    isScanning: false,
    currentScan: null,
    progress: 0,
    phase: 'idle',
    message: '',
    lastResult: null,
  };

  function newestResult(first, second) {
    if (!first) return second || null;
    if (!second) return first;
    return new Date(first.completedAt || 0).getTime() >= new Date(second.completedAt || 0).getTime()
      ? first
      : second;
  }

  function definitionSnapshot() {
    const current = definitionState.currentScan;
    return {
      isScanning: definitionState.isScanning,
      isFolderWatchScanning: false,
      currentScan: current,
      progress: definitionState.progress,
      filesScanned: 0,
      threatsFound: 0,
      phase: definitionState.phase,
      message: definitionState.message,
      currentTarget: null,
      targetIndex: 0,
      targetCount: 0,
      progressEstimated: false,
      startedAt: current ? current.startedAt : null,
      lastResult: definitionState.lastResult,
    };
  }

  // -- Scanning Engine --
  ipcMain.handle('scan:status', () => {
    const scanStatus = scanEngine.getStatus();
    const scan = definitionState.isScanning
      ? definitionSnapshot()
      : {
          ...scanStatus,
          lastResult: newestResult(scanStatus.lastResult, definitionState.lastResult),
        };
    return {
      engine: clamEngine.getStatus(),
      scan,
    };
  });

  ipcMain.handle('scan:updateDefinitions', async () => {
    const engineScanStatus = scanEngine.getStatus();
    if (engineScanStatus && (engineScanStatus.isScanning || engineScanStatus.isFolderWatchScanning)) {
      const locale = db.getSetting('ui.language', 'en');
      return { success: false, error: i18n.t('scanner.defsBlockedDuringScan', locale) };
    }
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    definitionState.isScanning = true;
    definitionState.currentScan = { scanType: 'definitions', startedAt, paths: [], targetPaths: [] };
    definitionState.progress = 10;
    definitionState.phase = 'updating-definitions';
    definitionState.message = 'Updating ClamAV definitions...';
    definitionState.lastResult = null;
    if (typeof scanEngine.clearLastResult === 'function') scanEngine.clearLastResult();

    const emitProgress = (pct) => {
      definitionState.progress = Math.max(definitionState.progress, Math.min(95, Number(pct) || 0));
      eventBus.emit('scan:progress', {
        scanType: 'definitions',
        pct: definitionState.progress,
        message: definitionState.message,
        phase: definitionState.phase,
        startedAt,
        currentTarget: null,
        targetIndex: 0,
        targetCount: 0,
        filesScanned: 0,
        threatsFound: 0,
        progressEstimated: false,
      });
    };

    emitProgress(10);
    let result;
    try {
      result = await clamEngine.updateDefinitions((progress) => {
        if (progress && progress.text) {
          const match = progress.text.match(/(\d+)%/);
          if (match) {
            emitProgress(Number(match[1]));
          }
        }
      });
    } catch (error) {
      result = { success: false, error: error && error.message ? error.message : String(error) };
    }
    const status = result.success ? 'completed' : 'failed';
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    definitionState.isScanning = false;
    definitionState.currentScan = null;
    definitionState.progress = 100;
    definitionState.phase = status;
    definitionState.message = result.success ? 'Signatures updated' : 'Signature update failed';
    definitionState.lastResult = {
      scanType: 'definitions',
      status,
      startedAt,
      completedAt,
      targetPaths: [],
      filesScanned: 0,
      threatsFound: 0,
      progress: 100,
      durationMs,
      errors: result.success ? [] : [result.error || 'Definition update failed'],
      note: result.error,
    };
    eventBus.emit('scan:complete', {
      scanType: 'definitions',
      status,
      filesScanned: 0,
      threatsFound: 0,
      pct: 100,
      startedAt,
      completedAt,
      durationMs,
      phase: status,
      progressEstimated: false,
      errors: result.success ? [] : [result.error || 'Definition update failed'],
      error: result.error,
    });
    return result;
  });

  ipcMain.handle('scan:quick', async () => {
    definitionState.lastResult = null;
    return scanEngine.runQuickScan();
  });

  ipcMain.handle('scan:full', async () => {
    definitionState.lastResult = null;
    return scanEngine.runFullScan();
  });

  ipcMain.handle('scan:custom', async (_event, targetPaths) => {
    definitionState.lastResult = null;
    return scanEngine.runCustomScan(targetPaths);
  });

  ipcMain.handle('scan:abort', () => {
    return scanEngine.abortScan();
  });

  // -- Reputation --
  ipcMain.handle('reputation:addHash', async (_event, hash, verdict, note) => {
    return reputationEngine.addHash(hash, verdict, note);
  });

  ipcMain.handle('reputation:removeHash', async (_event, hash) => {
    return reputationEngine.removeHash(hash);
  });

  ipcMain.handle('reputation:listHashes', async (_event, limit) => {
    return reputationEngine.listHashes(limit);
  });

  ipcMain.handle('reputation:checkHash', async (_event, hash) => {
    return reputationEngine.checkHash(hash);
  });

  // -- Scheduled Scans --
  const SCHEDULE_SETTING_KEY = 'schedule.config';

  function loadScheduleConfig() {
    const stored = db.getSetting(SCHEDULE_SETTING_KEY, null);
    return { ...DEFAULT_SCHEDULE, ...(stored || {}) };
  }

  function saveScheduleConfig(partial) {
    const merged = { ...loadScheduleConfig(), ...partial };
    db.setSetting(SCHEDULE_SETTING_KEY, merged);
    return merged;
  }

  ipcMain.handle('schedule:get', () => loadScheduleConfig());

  ipcMain.handle('schedule:set', (_event, config) => {
    return saveScheduleConfig(config || {});
  });

  // Runs in the main process, independent of any open renderer page, so the
  // schedule keeps working even if the user isn't looking at the Scanner tab.
  let scheduledScanRunning = false;
  async function runScheduledScanIfDue() {
    if (scheduledScanRunning) return;
    const config = loadScheduleConfig();
    if (!config.enabled) return;
    if (config.scanType === 'custom' && !config.customPath) return;

    const engineStatus = scanEngine.getStatus();
    if (engineStatus && (engineStatus.isScanning || engineStatus.isFolderWatchScanning)) return; // don't collide with any scan

    const intervalMs = Math.max(1, Number(config.intervalHours) || 24) * 60 * 60 * 1000;
    const lastRunMs = config.lastRun ? new Date(config.lastRun).getTime() : 0;
    if (Date.now() - lastRunMs < intervalMs) return;

    scheduledScanRunning = true;
    definitionState.lastResult = null;
    saveScheduleConfig({ lastRun: new Date().toISOString() });
    try {
      if (config.scanType === 'full') {
        await scanEngine.runFullScan();
      } else if (config.scanType === 'custom') {
        await scanEngine.runCustomScan([config.customPath]);
      } else {
        await scanEngine.runQuickScan();
      }
    } catch (e) {
      logger.error('Scheduled scan failed', e);
    } finally {
      scheduledScanRunning = false;
    }
  }

  // Check once a minute whether a scan is due, plus a check shortly after
  // startup in case one was missed while the app was closed.
  setInterval(() => { runScheduledScanIfDue(); }, 60 * 1000);
  setTimeout(() => { runScheduledScanIfDue(); }, 15 * 1000);
}

module.exports = { register };
