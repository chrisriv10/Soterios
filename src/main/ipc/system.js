const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const {
  isPathInScanReportsDir,
  isPathInAllowedReportDir,
  isPathInsideDir,
  securityReportsDir,
  threatsToCsv,
  securityReportToCsv,
  csvPathForJson,
  safeWriteFileSync,
  generatePdfFromHtml,
} = require('../../security/reportExport');
const updater = require('../updater');
const { getTrayHealthSummary } = require('../healthSummary');
const { MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS, ALLOWED_SCRIPT_IDS, SCHEDULE_PRESETS } = require('../maintenanceScheduler');
const { loadRegistry } = require('../../scripts/scriptRunner');
const i18n = require('../../i18n');
const { requestText } = require('./_shared');
const featureFlags = require('../../core/featureFlags');

function deleteFileIfSafe(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) { }
}

function register(mainWindow, {
  db,
  eventBus,
  toolRegistry,
  maintenanceScheduler,
  firewallManager,
  networkMonitor,
  geoLocationService,
  systemAudit,
  realtimeWatcher,
  startNetworkStatsTimer,
  stopNetworkStatsTimer,
}) {
  // -- System --
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    isAdmin: true, // We requested admin rights
  }));

  // -- Launch at Startup --
  ipcMain.handle('app:getLaunchAtStartup', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('app:setLaunchAtStartup', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  // -- Database / Settings --
  ipcMain.handle('db:getScanHistory', (_event, limit) => db.getScanHistory(limit));
  ipcMain.handle('db:getQuarantineList', () => db.getQuarantineList());
  ipcMain.handle('db:getUnreadAlerts', () => db.getUnreadAlerts());
  ipcMain.handle('db:markAlertRead', (_event, id) => db.markAlertRead(id));
  ipcMain.handle('db:getSetting', (_event, key, def) => {
    if (typeof key === 'string' && key.startsWith('feature.')) {
      try {
        return featureFlags.getFlag(db, key, def);
      } catch (_) {
        // Unknown feature flag; fall through to raw DB read so we don't
        // break unknown keys used during feature-flag migration.
        return db.getSetting(key, def);
      }
    }
    return db.getSetting(key, def);
  });

  ipcMain.handle('db:setSetting', (_event, key, value) => {
    if (typeof key === 'string' && key.startsWith('feature.')) {
      try {
        return featureFlags.setFlag(db, key, value);
      } catch (_) {
        throw new Error(`Unknown feature flag: ${key}`);
      }
    }
    return db.setSetting(key, value);
  });
  // -- Internationalization --
  ipcMain.handle('i18n:getCatalog', (_event, locale) => i18n.loadCatalog(locale));
  ipcMain.handle('i18n:normalizeLocale', (_event, locale) => i18n.normalizeLocale(locale));
  ipcMain.handle('i18n:listLocales', () => i18n.listLocales());
  ipcMain.handle('i18n:isRtlLocale', (_event, locale) => i18n.isRtlLocale(locale));
  ipcMain.handle('i18n:getSystemLocale', () => app.getLocale());

  // -- Warnings --
  ipcMain.handle('warnings:ignore', (_event, warning) => db.ignoreWarning(warning));
  ipcMain.handle('warnings:unignore', (_event, id) => db.unignoreWarning(id));
  ipcMain.handle('warnings:listIgnored', () => db.getIgnoredWarnings());

  // -- Audit --
  ipcMain.handle('audit:run', async (event) => {
    return systemAudit.runAudit((label) => {
      event.sender.send('audit:progress', label);
    });
  });

  // -- Scheduled maintenance (#71) --
  ipcMain.handle('maintenance:get', () => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    return { ok: true, data: maintenanceScheduler.loadConfig() };
  });

  ipcMain.handle('maintenance:set', (_event, partial) => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const next = { ...(partial || {}) };
    if (Object.prototype.hasOwnProperty.call(next, 'intervalHours')) {
      const hours = Number(next.intervalHours);
      if (!Number.isFinite(hours) || hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) {
        return {
          ok: false,
          error: `Interval must be between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS} hours.`,
        };
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'schedulePreset')) {
      if (!SCHEDULE_PRESETS[next.schedulePreset]) {
        return { ok: false, error: 'Invalid schedule preset.' };
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'scriptIds')) {
      if (!Array.isArray(next.scriptIds)) {
        return { ok: false, error: 'scriptIds must be an array.' };
      }
      next.scriptIds = next.scriptIds.filter((id) => ALLOWED_SCRIPT_IDS.has(id));
      if (!next.scriptIds.length) {
        return { ok: false, error: 'Select at least one maintenance script.' };
      }
    }
    return { ok: true, data: maintenanceScheduler.saveConfig(next) };
  });

  ipcMain.handle('maintenance:getScripts', () => {
    const scripts = loadRegistry()
      .filter((entry) => ALLOWED_SCRIPT_IDS.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, description: entry.description }));
    return { ok: true, data: scripts };
  });

  ipcMain.handle('maintenance:getHistory', () => ({ ok: true, data: db.getMaintenanceHistory(25) }));

  ipcMain.handle('maintenance:runNow', async () => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const result = await maintenanceScheduler.runNow({ dryRunCleanup: false, manual: true });
    if (result.skipped) {
      return {
        ok: false,
        error: result.reason === 'already-running'
          ? 'Maintenance is already running.'
          : `Maintenance skipped: ${result.reason || 'unknown'}.`,
        data: result,
      };
    }
    return { ok: true, data: result };
  });

  // -- Auto-updater (#69) --
  ipcMain.handle('update:check', () => updater.checkForUpdates());
  ipcMain.handle('update:status', () => updater.getUpdateStatus());
  ipcMain.handle('update:install', () => updater.quitAndInstall());

  // -- System tray mini dashboard (#67) --
  ipcMain.handle('tray:getSummary', async () => getTrayHealthSummary(db, toolRegistry));

  ipcMain.handle('tray:openMain', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.handle('tray:quit', () => app.quit());

  // -- Reports --
  ipcMain.handle('reports:list', async () => {
    const dir = path.join(os.homedir(), '.soterios', 'reports');
    try {
      const all = fs.readdirSync(dir).filter((f) => f.endsWith('.html') || f.endsWith('.json'));
      const jsonBases = new Set(all.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/i, '')));
      const files = all.filter((f) => f.endsWith('.json') || !jsonBases.has(f.replace(/\.html$/i, '')));
      return files.sort().reverse().slice(0, 50).map((f) => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.toISOString(),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('scanReports:list', async (_event, limit) => {
    return db.getScanReports(limit || 25);
  });

  ipcMain.handle('scanReports:latest', async () => {
    return db.getLatestScanReport();
  });

  ipcMain.handle('scanReports:delete', async (_event, id) => {
    const row = db.deleteScanReport(id);
    if (!row) return { success: false, error: 'Report not found.' };
    deleteFileIfSafe(row.html_path);
    deleteFileIfSafe(row.json_path);
    deleteFileIfSafe(row.html_path && row.html_path.replace(/\.html$/i, '.pdf'));
    deleteFileIfSafe(row.json_path && row.json_path.replace(/\.json$/i, '.csv'));
    return { success: true };
  });

  ipcMain.handle('report:exportPDF', async (_event, reportId, reportType = 'scan') => {
    try {
      if (reportType === 'security') {
        const jsonPath = path.resolve(reportId || '');
        if (!isPathInsideDir(jsonPath, securityReportsDir()) ||
          path.extname(jsonPath).toLowerCase() !== '.json') {
          return { success: false, error: 'Invalid report path.' };
        }
        const htmlPath = jsonPath.replace(/\.json$/i, '.html');
        if (!fs.existsSync(htmlPath)) return { success: false, error: 'Report HTML file not found.' };
        const pdfPath = await generatePdfFromHtml(htmlPath);
        return { success: true, path: pdfPath };
      }
      const row = db.getScanReport(Number(reportId));
      if (!row) return { success: false, error: 'Report not found.' };
      if (!row.html_path || !fs.existsSync(row.html_path)) {
        return { success: false, error: 'Report HTML file not found.' };
      }
      if (!isPathInScanReportsDir(row.html_path)) {
        return { success: false, error: 'Invalid report path.' };
      }
      const pdfPath = await generatePdfFromHtml(row.html_path);
      return { success: true, path: pdfPath };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('report:exportCSV', async (_event, reportId, reportType = 'scan') => {
    try {
      if (reportType === 'security') {
        const resolved = path.resolve(reportId || '');
        if (!isPathInsideDir(resolved, securityReportsDir()) ||
          path.extname(resolved).toLowerCase() !== '.json') {
          return { success: false, error: 'Invalid report path.' };
        }
        if (!fs.existsSync(resolved)) return { success: false, error: 'Report file not found.' };
        const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        const csvPath = resolved.replace(/\.json$/i, '.csv');
        safeWriteFileSync(csvPath, securityReportToCsv(report), 'utf8');
        return { success: true, path: csvPath };
      }
      const row = db.getScanReport(Number(reportId));
      if (!row) return { success: false, error: 'Report not found.' };
      if (!row.json_path || !fs.existsSync(row.json_path)) {
        return { success: false, error: 'Report JSON file not found.' };
      }
      if (!isPathInScanReportsDir(row.json_path)) {
        return { success: false, error: 'Invalid report path.' };
      }
      const report = JSON.parse(fs.readFileSync(row.json_path, 'utf8'));
      const csvPath = csvPathForJson(row.json_path);
      safeWriteFileSync(csvPath, threatsToCsv(report), 'utf8');
      return { success: true, path: csvPath };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('reports:delete', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInsideDir(resolved, securityReportsDir())) return { success: false, error: 'Invalid report path.' };
    deleteFileIfSafe(resolved);
    const sidecar = resolved.toLowerCase().endsWith('.json')
      ? resolved.replace(/\.json$/i, '.html')
      : resolved.replace(/\.html$/i, '.json');
    if (sidecar !== resolved) deleteFileIfSafe(sidecar);
    return { success: true };
  });

  ipcMain.handle('reports:read', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInsideDir(resolved, securityReportsDir())) return { success: false, error: 'Invalid report path.' };
    if (!fs.existsSync(resolved)) return { success: false, error: 'Report not found.' };
    if (resolved.toLowerCase().endsWith('.json')) {
      return { success: true, type: 'json', data: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
    }
    if (resolved.toLowerCase().endsWith('.html')) {
      const html = fs.readFileSync(resolved, 'utf8');
      const text = html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { success: true, type: 'html', text };
    }
    return { success: false, error: 'Unsupported report type.' };
  });

  // -- External lookups --
  ipcMain.handle('hibp:password', async (_event, password) => {
    if (!password) return { found: false, count: 0 };
    if (!featureFlags.getFlag(db, 'externalLookups', true)) throw new Error('External lookups are disabled in Settings.');
    const sha = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha.slice(0, 5);
    const suffix = sha.slice(5);
    const res = await requestText(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (res.statusCode !== 200) throw new Error(`HIBP password check failed (${res.statusCode}).`);
    const line = res.body.split(/\r?\n/).find((row) => row.split(':')[0] === suffix);
    const count = line ? Number(line.split(':')[1] || 0) : 0;
    return { found: count > 0, count };
  });

  ipcMain.handle('xon:email', async (_event, email) => {
    if (!email) return { found: false, breaches: [] };
    if (!featureFlags.getFlag(db, 'externalLookups', true)) throw new Error('External lookups are disabled in Settings.');
    const encoded = encodeURIComponent(email);
    const res = await requestText(`https://api.xposedornot.com/v1/check-email/${encoded}?details=true`);
    if (res.statusCode === 404) return { found: false, breaches: [] };
    if (res.statusCode === 429) throw new Error('XposedOrNot rate limit reached. Try again in a moment.');
    if (res.statusCode !== 200) throw new Error(`XposedOrNot email check failed (${res.statusCode}).`);
    const body = JSON.parse(res.body || '{}');
    if (body.Error || body.error) return { found: false, breaches: [] };
    const raw = body.breaches || body.Breaches || body.breach_details || body.BreachMetrics?.breaches_details || [];
    const breaches = Array.isArray(raw) ? raw.flat(Infinity).filter(Boolean) : Object.values(raw || {});
    return { found: breaches.length > 0, breaches };
  });

  ipcMain.handle('health:score', async () => {
    const latest = db.getLatestScanReport();
    const passwordScore = db.getSetting('feature.lastPasswordScore', null);
    const result = await toolRegistry.run('health-score', {
      lastScanMatches: latest ? latest.threats_found : null,
      passwordScore: passwordScore === null ? null : Number(passwordScore),
    }, { db });
    if (!result.ok) throw new Error(result.error || 'Unable to calculate health score');
    return result.data;
  });

  // -- Dialogs & Shell --
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('shell:showItemInFolder', (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('shell:openPath', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInAllowedReportDir(resolved)) {
      return { success: false, error: 'Invalid file path.' };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'File not found.' };
    }
    const errorMessage = await shell.openPath(resolved);
    return errorMessage ? { success: false, error: errorMessage } : { success: true };
  });
}

module.exports = { register };
