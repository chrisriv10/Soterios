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
  // -- Scanning Engine --
  ipcMain.handle('scan:status', () => {
    return {
      engine: clamEngine.getStatus(),
      scan: scanEngine.getStatus(),
    };
  });

  ipcMain.handle('scan:updateDefinitions', async () => {
    const status = scanEngine.getStatus();
    if (status && (status.isScanning || status.isFolderWatchScanning)) {
      const locale = db.getSetting('ui.language', 'en');
      return { success: false, error: i18n.t('scanner.defsBlockedDuringScan', locale) };
    }
    const result = await clamEngine.updateDefinitions((progress) => {
      eventBus.emit('scan:progress', { scanType: 'definitions', pct: 10, message: 'Updating ClamAV definitions...' });
      if (progress && progress.text) {
        const match = progress.text.match(/(\d+)%/);
        if (match) {
          eventBus.emit('scan:progress', { scanType: 'definitions', pct: Math.min(95, Number(match[1])), message: 'Updating ClamAV definitions...' });
        }
      }
    });
    eventBus.emit('scan:complete', {
      scanType: 'definitions',
      status: result.success ? 'completed' : 'failed',
      filesScanned: 0,
      threatsFound: 0,
      errors: result.success ? [] : [result.error || 'Definition update failed'],
      error: result.error,
    });
    return result;
  });

  ipcMain.handle('scan:quick', async () => {
    return scanEngine.runQuickScan();
  });

  ipcMain.handle('scan:full', async () => {
    return scanEngine.runFullScan();
  });

  ipcMain.handle('scan:custom', async (_event, targetPaths) => {
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
