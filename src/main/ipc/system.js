const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
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
const logger = require('../../utils/logger');
const { requestText } = require('./_shared');
const featureFlags = require('../../core/featureFlags');
const { AppError, PermissionError } = require('../../utils/errors');

function deleteFileIfSafe(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    logger.debug?.('deleteFileIfSafe failed', { filePath, error: e?.message || String(e) });
  }
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
  folderWatcher,
  startNetworkStatsTimer,
  stopNetworkStatsTimer,
  emergencyLockdown,
  isActuallyAdmin = false,
}) {
  // -- System --
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    isAdmin: !!isActuallyAdmin,
  }));

  // -- Launch at Startup --
  ipcMain.handle('app:getLaunchAtStartup', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('app:setLaunchAtStartup', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  // -- Real-Time Protection --
  ipcMain.handle('rtp:status', async () => {
    const result = await realtimeWatcher.getStatus();
    return result.ok ? result.enabled : false;
  });

  ipcMain.handle('rtp:toggle', async (_event, enable) => {
    const result = enable ? await realtimeWatcher.start() : await realtimeWatcher.stop();
    if (!result.ok) throw new AppError(result.error || 'Unable to update real-time protection.');
    return result.enabled;
  });

  // -- Folder Watch --
  ipcMain.handle('folderwatch:status', async () => {
    return (folderWatcher && folderWatcher.getStatus()) || { running: false };
  });

  ipcMain.handle('folderwatch:toggle', async (_event, enable) => {
    if (!folderWatcher) return false;
    if (enable) folderWatcher.start();
    else folderWatcher.stop();
    return folderWatcher.getStatus().running;
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
        // Unknown feature flag; fall through to raw DB write
        return db.setSetting(key, value);
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

  ipcMain.handle('audit:log', async (_event, entry) => {
    validateArgs([
      { name: 'action', type: 'string', required: true },
      { name: 'detail', type: 'string', required: false },
      { name: 'result', type: 'string', required: false },
      { name: 'userInitiated', type: 'boolean', required: false },
    ], [entry]);
    return db.addAuditEntry({
      action: entry.action,
      detail: entry.detail || null,
      result: entry.result || null,
      userInitiated: !!entry.userInitiated,
    });
  });

  ipcMain.handle('alerts:list', async (_event, options = {}) => {
    validateArgs([
      { name: 'limit', type: 'number', required: false, min: 1, max: 500 },
      { name: 'unreadOnly', type: 'boolean', required: false },
    ], [options]);
    return db.getAlerts(options);
  });

  ipcMain.handle('alerts:counts', async () => {
    return db.getAlertCounts();
  });

  ipcMain.handle('app:exportSettings', async () => {
    return {
      settings: db.exportAllSettings(),
      quarantine: db.exportQuarantineState(),
      exportedAt: new Date().toISOString(),
    };
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
    if (!featureFlags.getFlag(db, 'externalLookups', true)) throw new PermissionError('External lookups are disabled in Settings.');
    const sha = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha.slice(0, 5);
    const suffix = sha.slice(5);
    const res = await requestText(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (res.statusCode !== 200) throw new AppError(`HIBP password check failed (${res.statusCode}).`);
    const line = res.body.split(/\r?\n/).find((row) => row.split(':')[0] === suffix);
    const count = line ? Number(line.split(':')[1] || 0) : 0;
    return { found: count > 0, count };
  });

  ipcMain.handle('xon:email', async (_event, email) => {
    if (!email) return { found: false, breaches: [] };
    if (!featureFlags.getFlag(db, 'externalLookups', true)) throw new PermissionError('External lookups are disabled in Settings.');
    const encoded = encodeURIComponent(email);
    const res = await requestText(`https://api.xposedornot.com/v1/check-email/${encoded}?details=true`);
    if (res.statusCode === 404) return { found: false, breaches: [] };
    if (res.statusCode === 429) throw new AppError('XposedOrNot rate limit reached. Try again in a moment.');
    if (res.statusCode !== 200) throw new AppError(`XposedOrNot email check failed (${res.statusCode}).`);
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
    if (!result.ok) throw new AppError(result.error || 'Unable to calculate health score');
    return result.data;
  });

  // -- Browser Extension Credential Leak Notification --
  ipcMain.handle('credential-leak:notify', async (_event, payload) => {
    if (!payload?.password) return { ok: false, error: 'Missing password' };
    const sha = crypto.createHash('sha1').update(payload.password).digest('hex').toUpperCase();
    const alert = {
      level: 'danger',
      source: 'Browser Extension',
      title: 'Credential Leak Detected',
      message: `Password found in ${payload.count} breach${payload.count > 1 ? 'es' : ''} via browser extension`,
      detail: `SHA-1 prefix: ${sha.slice(0, 5)}... | Breaches: ${payload.count}`,
      timestamp: new Date().toISOString(),
      metadata: { source: 'browser-extension', hashPrefix: sha.slice(0, 5), count: payload.count }
    };
    db.addAlert(alert);
    if (eventBus) eventBus.emit('alert:new', alert);
    return { ok: true };
  });

  // -- Browser Extension Native Host Installation --
  ipcMain.handle('browserExtension:installNativeHost', async () => {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Native host install only supported on Windows' };
    }
    const { execSync } = require('child_process');
    const extDir = path.join(__dirname, '..', '..', 'browser-extension');
    const manifestPath = path.join(extDir, 'native-host-manifest.json');
    const batPath = path.join(extDir, 'src', 'native-host.bat');
    const jsPath = path.join(extDir, 'src', 'native-host.js');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(batPath) || !fs.existsSync(jsPath)) {
      return { ok: false, error: 'Extension files not found. Reinstall Soterios.' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extId = process.env.SOTERIOS_EXT_ID || 'YOUR_EXTENSION_ID_HERE';
    manifest.allowed_origins = [manifest.allowed_origins[0].replace('<EXTENSION_ID>', extId)];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const regPath = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${manifest.name}`;
    const regCmd = `reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`;
    try {
      execSync(regCmd, { stdio: 'ignore' });
      const regPathEdge = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${manifest.name}`;
      const regCmdEdge = `reg add "${regPathEdge}" /ve /t REG_SZ /d "${manifestPath.replace(/\\/g, '\\\\')}" /f`;
      try { execSync(regCmdEdge, { stdio: 'ignore' }); } catch (e) { logger.debug?.('Native host Edge reg write failed', { error: e?.message || String(e) }); }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
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

  // -- Emergency Lockdown --
  ipcMain.handle('lockdown:getStatus', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const status = emergencyLockdown.getStatus();
      return { ok: true, data: status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:activate', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const result = await emergencyLockdown.lockdown();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:restore', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const result = await emergencyLockdown.restore();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // -- Emergency Lockdown Allowlist --
  ipcMain.handle('lockdown:getAllowlist', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const allowlist = emergencyLockdown.getAllowlist();
      return { ok: true, data: allowlist };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:setAllowlist', async (event, allowlist) => {
    validateArgs([
      { name: 'allowlist', type: 'array', required: true, minItems: 0, maxItems: 1000 }
    ], [allowlist]);
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const result = emergencyLockdown.setAllowlist(allowlist);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:addToAllowlist', async (event, type, value) => {
    validateArgs([
      { name: 'type', type: 'string', required: true, allowed: ['ip', 'port', 'program', 'interface'] },
      { name: 'value', type: 'string', required: true },
    ], [type, value]);
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const result = emergencyLockdown.addToAllowlist(type, value);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:removeFromAllowlist', async (event, type, value) => {
    validateArgs([
      { name: 'type', type: 'string', required: true, allowed: ['ip', 'port', 'program', 'interface'] },
      { name: 'value', type: 'string', required: true },
    ], [type, value]);
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const result = emergencyLockdown.removeFromAllowlist(type, value);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // -- Tools --
  ipcMain.handle('tools:list', async () => {
    try {
      const list = toolRegistry.list();
      return { ok: true, data: list };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('tools:run', async (_event, toolId, args = {}) => {
    try {
      const result = await toolRegistry.run(toolId, args, { db, eventBus, mainWindow });
      return result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { register };
