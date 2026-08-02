const { ipcMain } = require('electron');
const i18n = require('../../i18n');
const logger = require('../../utils/logger');
const { validateArgs } = require('./validate');
const fs = require('fs');

const DEFAULT_SCHEDULE = {
  enabled: false,
  scanType: 'quick',
  customPaths: [],
  intervalHours: 24,
  lastRun: null,
};

/**
 * Register scan-related IPC handlers.
 * @param {BrowserWindow} mainWindow
 * @param {Object} services
 * @param {object} services.db
 * @param {object} services.eventBus
 * @param {object} services.clamEngine
 * @param {object} services.scanEngine
 * @param {object} services.reputationEngine
 */
function register(mainWindow, { db, eventBus, clamEngine, scanEngine, reputationEngine }) {
  // -- Scanning Engine --
  ipcMain.handle('scan:status', () => {
    const scanStatus = scanEngine.getStatus();
    if (scanStatus.currentScan && scanStatus.currentScan.scanType === 'folderwatch') {
      return {
        engine: clamEngine.getStatus(),
        scan: { isScanning: false, currentScan: null },
      };
    }
    return {
      engine: clamEngine.getStatus(),
      scan: scanStatus,
    };
  });

  ipcMain.handle('scan:updateDefinitions', async () => {
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
    validateArgs([
      { name: 'targetPaths', type: 'array', required: true, minItems: 1, maxItems: 50 }
    ], [targetPaths]);
    return scanEngine.runCustomScan(targetPaths);
  });

  ipcMain.handle('scan:abort', () => {
    const status = scanEngine.getStatus();
    if (status.currentScan && status.currentScan.scanType === 'folderwatch') {
      return { success: false, canceled: false, error: 'No user scan in progress' };
    }
    return scanEngine.abortScan();
  });

  // -- Reputation --
  ipcMain.handle('reputation:addHash', async (_event, hash, verdict, note) => {
    validateArgs([
      { name: 'hash', type: 'string', required: true, pattern: /^[a-f0-9]{64}$/i },
      { name: 'verdict', type: 'string', required: true, allowed: ['safe', 'malicious'] },
      { name: 'note', type: 'string', required: false },
    ], [hash, verdict, note]);
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
    validateArgs([
      { name: 'config', type: 'object', required: false },
      { name: 'config.enabled', type: 'boolean', required: false },
      { name: 'config.scanType', type: 'string', required: false, allowed: ['quick', 'full', 'custom'] },
      { name: 'config.intervalHours', type: 'number', required: false, min: 1, max: 720 },
      { name: 'config.customPaths', type: 'array', required: false },
    ], [config]);
    return saveScheduleConfig(config || {});
  });

  ipcMain.handle('schedule:getCustomPaths', () => {
    const config = loadScheduleConfig();
    return config.customPaths || [];
  });

  // Runs in the main process, independent of any open renderer page, so the
  // schedule keeps working even if the user isn't looking at the Scanner tab.
  let scheduledScanRunning = false;
  async function runScheduledScanIfDue() {
    if (scheduledScanRunning) return;
    const config = loadScheduleConfig();
    if (!config.enabled) return;
    if (config.scanType === 'custom' && (!config.customPaths || !config.customPaths.length)) return;

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
        for (const customPath of config.customPaths) {
          if (fs.existsSync(customPath)) {
            await scanEngine.runCustomScan([customPath]);
          }
        }
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
