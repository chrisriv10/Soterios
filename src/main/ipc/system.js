const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const { spawn, execFile } = require('child_process');
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
const {
  MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS, ALLOWED_SCRIPT_IDS,
  AUTO_CLEAN_SCRIPT_IDS, POLICY_MODES, SCHEDULE_PRESETS, normalizeScriptArgs
} = require('../maintenanceScheduler');
const performanceModes = require('../performanceModes');
const { loadRegistry } = require('../../scripts/scriptRunner');
const i18n = require('../../i18n');
const { requestText } = require('./_shared');
const {
  openExternal,
  openPowerShell,
  openControlPanel,
  openWindowsUtility
} = require('../shellLaunchers');
const featureFlags = require('../../core/featureFlags');
const privacyMode = require('../../core/privacyMode');

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
  toolRunManager,
  maintenanceSafetyVault,
  persistenceMonitor,
  extensionBridge,
  processService,
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
  vpnManager,
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

  // -- Real-Time Protection --
  ipcMain.handle('rtp:status', async () => {
    const result = await realtimeWatcher.getStatus();
    // If Defender is not available or check failed, return null to indicate unknown state
    // The dashboard should handle this as "unknown" rather than assuming disabled
    if (!result.ok) return null;
    return result.enabled;
  });

  ipcMain.handle('rtp:toggle', async (_event, enable) => {
    const result = enable ? await realtimeWatcher.start() : await realtimeWatcher.stop();
    if (!result.ok) throw new Error(result.error || 'Unable to update real-time protection.');
    return result.enabled;
  });

  // -- Folder Watch --
  ipcMain.handle('folderwatch:status', async () => {
    return (folderWatcher && folderWatcher.getStatus()) || { running: false };
  });

  ipcMain.handle('folderwatch:toggle', async (_event, enable) => {
    if (!folderWatcher) return { running: false };
    if (enable) folderWatcher.start();
    else folderWatcher.stop();
    return folderWatcher.getStatus();
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
    const result = db.setSetting(key, value);
    if (key === 'ui.theme') {
      try {
        const themePath = path.join(app.getPath('userData'), 'theme.json');
        fs.writeFileSync(themePath, JSON.stringify({ theme: value }, null, 2), 'utf8');
      } catch (_) { }
    }
    return result;
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
  ipcMain.handle('warnings:listAudit', () => db.getAuditWarnings());

  // -- Audit --
  ipcMain.handle('audit:run', async (event) => {
    const results = await systemAudit.runAudit((progress) => {
      event.sender.send('audit:progress', progress);
    });
    const auditWarnings = (results || []).filter((r) => r.status === 'warn' || r.status === 'fail').map((r) => {
      const id = 'audit:' + String(r.name || r.message || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return {
        id,
        title: r.name || '',
        detail: r.message || r.detail || '',
        level: r.status === 'fail' ? 'danger' : 'warn',
        scannedAt: new Date().toISOString()
      };
    });
    db.replaceAuditWarnings(auditWarnings);
    return results;
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
    if (Object.prototype.hasOwnProperty.call(next, 'policies')) {
      if (!next.policies || typeof next.policies !== 'object' || Array.isArray(next.policies)) {
        return { ok: false, error: 'policies must be an object.' };
      }
      const policies = {};
      for (const [id, mode] of Object.entries(next.policies)) {
        if (!ALLOWED_SCRIPT_IDS.has(id) || !POLICY_MODES.has(mode) || mode === 'off') continue;
        policies[id] = mode === 'auto-clean' && !AUTO_CLEAN_SCRIPT_IDS.has(id) ? 'analyze' : mode;
      }
      if (!Object.keys(policies).length) return { ok: false, error: 'Select at least one maintenance policy.' };
      next.policies = policies;
      delete next.scriptIds;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'scriptArgs')) {
      if (!next.scriptArgs || typeof next.scriptArgs !== 'object' || Array.isArray(next.scriptArgs)) {
        return { ok: false, error: 'scriptArgs must be an object.' };
      }
      const { browserIds } = require('../../scripts/safeScripts/browserCacheReport');
      const knownBrowserIds = new Set(browserIds);
      for (const [id, rawArgs] of Object.entries(next.scriptArgs)) {
        if (!ALLOWED_SCRIPT_IDS.has(id)) continue;
        if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) continue;
        if (rawArgs.minimumAgeDays !== undefined) {
          const age = Math.floor(Number(rawArgs.minimumAgeDays));
          if (!Number.isFinite(age) || age < 1 || age > 365) {
            return { ok: false, error: 'minimumAgeDays must be between 1 and 365.' };
          }
        }
        if (rawArgs.thresholdMB !== undefined) {
          const mb = Math.floor(Number(rawArgs.thresholdMB));
          if (!Number.isFinite(mb) || mb < 1 || mb > 100000) {
            return { ok: false, error: 'thresholdMB must be between 1 and 100000.' };
          }
        }
        if (rawArgs.browsers !== undefined) {
          if (!Array.isArray(rawArgs.browsers)) {
            return { ok: false, error: 'browsers must be an array.' };
          }
          const selected = rawArgs.browsers.map((value) => String(value).toLowerCase());
          if (selected.some((value) => !knownBrowserIds.has(value))) {
            return { ok: false, error: 'Unknown browser id in browsers.' };
          }
        }
      }
      next.scriptArgs = normalizeScriptArgs(next.scriptArgs);
    }
    return { ok: true, data: maintenanceScheduler.saveConfig(next) };
  });

  ipcMain.handle('maintenance:getScripts', () => {
    const scripts = loadRegistry()
      .filter((entry) => ALLOWED_SCRIPT_IDS.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        scheduling: entry.scheduling || ['analyze'],
        autoCleanAllowed: AUTO_CLEAN_SCRIPT_IDS.has(entry.id)
      }));
    return { ok: true, data: scripts };
  });

  ipcMain.handle('maintenance:getBrowserOptions', async () => {
    try {
      const { listInstalledBrowsers } = require('../../scripts/safeScripts/browserCacheReport');
      const browsers = await listInstalledBrowsers();
      return { ok: true, data: browsers };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('maintenance:runManual', async (_event, payload) => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const policies = payload?.policies;
    if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
      return { ok: false, error: 'policies must be an object.' };
    }
    const { browserIds } = require('../../scripts/safeScripts/browserCacheReport');
    const knownBrowserIds = new Set(browserIds);
    const entries = {};
    for (const [id, entry] of Object.entries(policies)) {
      if (!ALLOWED_SCRIPT_IDS.has(id)) continue;
      const mode = entry && typeof entry === 'object' ? entry.mode : entry;
      if (!POLICY_MODES.has(mode) || mode === 'off') continue;
      const args = entry && typeof entry === 'object' && entry.args && typeof entry.args === 'object' ? entry.args : {};
      if (id === 'clear-temp-files' && args.minimumAgeDays !== undefined) {
        const age = Math.floor(Number(args.minimumAgeDays));
        if (!Number.isFinite(age) || age < 1 || age > 365) {
          return { ok: false, error: 'minimumAgeDays must be between 1 and 365.' };
        }
      }
      if (id === 'browser-cache-report') {
        if (!Array.isArray(args.browsers) || !args.browsers.length) {
          return { ok: false, error: 'Select at least one browser to clear.' };
        }
        const selected = args.browsers.map((value) => String(value).toLowerCase());
        if (selected.some((value) => !knownBrowserIds.has(value))) {
          return { ok: false, error: 'Unknown browser id in browsers.' };
        }
      }
      entries[id] = { mode, args };
    }
    if (!Object.keys(entries).length) return { ok: false, error: 'Select at least one cleanup policy.' };
    const result = await maintenanceScheduler.runNow({ dryRunCleanup: false, manual: true, policyOverrides: entries });
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

  ipcMain.handle('maintenance:getHistory', () => ({ ok: true, data: db.getMaintenanceHistory(25) }));

  ipcMain.handle('maintenance:getScheduledHistory', () => ({ ok: true, data: db.getScheduledMaintenanceHistory(25) }));

  const MAINTENANCE_TOOL_IDS = new Set(['clear-temp-files', 'disk-space-report', 'large-files-report', 'browser-cache-report']);
  ipcMain.handle('maintenance:getManualHistory', () => {
    const all = db.getToolHistory(100);
    const manual = all.filter((run) => MAINTENANCE_TOOL_IDS.has(run.toolId) && run.source === 'manual');
    return { ok: true, data: manual.slice(0, 25) };
  });

  ipcMain.handle('maintenance:deleteRun', (_event, id) => {
    const runId = Number(id);
    if (!Number.isInteger(runId) || runId <= 0) return { ok: false, error: 'Invalid maintenance run id.' };
    const result = db.deleteMaintenanceRun(runId);
    return { ok: true, changes: result.changes };
  });

  ipcMain.handle('maintenance:deleteToolRun', (_event, runId) => {
    if (!runId || typeof runId !== 'string') return { ok: false, error: 'Invalid tool run id.' };
    const result = db.deleteToolRun(runId);
    if (!result.changes) return { ok: false, error: 'Maintenance run was not found.' };
    return { ok: true, changes: result.changes };
  });

  ipcMain.handle('maintenance:clearToolHistory', (_event, toolId) => {
    if (!toolId || typeof toolId !== 'string') return { ok: false, error: 'Invalid tool id.' };
    const result = db.deleteToolHistory(toolId);
    return { ok: true, changes: result.changes };
  });

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

  ipcMain.handle('maintenance:cancel', () => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const canceled = maintenanceScheduler.cancel();
    return canceled ? { ok: true } : { ok: false, error: 'No maintenance run is active.' };
  });

  // -- Device Optimization Modes (power plan switching) --
  ipcMain.handle('performance:getMode', async () => {
    return performanceModes.getActiveMode();
  });

  ipcMain.handle('performance:setMode', async (_event, modeId) => {
    if (typeof modeId !== 'string' || !performanceModes.MODES[modeId]) {
      return { ok: false, error: 'Unknown optimization mode.' };
    }
    return performanceModes.setMode(modeId);
  });

  // -- Auto-updater (#69) --
  ipcMain.handle('update:check', () => updater.checkForUpdates());
  ipcMain.handle('update:status', () => updater.getUpdateStatus());
  ipcMain.handle('update:install', () => updater.quitAndInstall());

  // -- System tray mini dashboard (#67) --
  ipcMain.handle('tray:getSummary', async () => getTrayHealthSummary(db, toolRegistry, vpnManager));

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

  // -- Browser Extension (manual "Load unpacked" install) --
  const extInstaller = require('../../extension/installer');

  function resolveExtensionSourceDir() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'browser-extension')
      : path.join(app.getAppPath(), 'browser-extension', 'dist', 'chromium');
  }

  function resolveNativeHostBinary() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'native-host', 'SoteriosNativeHost.exe')
      : path.join(app.getAppPath(), 'build', 'native-host', 'SoteriosNativeHost.exe');
  }

  function resolveAppPath() {
    return app.isPackaged
      ? path.join(path.dirname(process.execPath), 'Soterios.exe')
      : process.execPath;
  }

  ipcMain.handle('browserExtension:getState', () => {
    try {
      const state = extInstaller.getState({ bundledDir: resolveExtensionSourceDir() });
      return { ok: true, ...state, bridge: extensionBridge?.getStatus() || { listening: false, connected: false } };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('browserExtension:install', (_event, browserId) => {
    try {
      const result = extInstaller.install(browserId, {
        srcDir: resolveExtensionSourceDir(),
        appPath: resolveAppPath(),
        nativeHostBinary: resolveNativeHostBinary(),
      });
      return result;
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('browserExtension:openPage', (_event, browserId) => {
    try {
      return extInstaller.openExtensionsPage(browserId);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle('browserExtension:openFolder', () => {
    try {
      return extInstaller.openExtensionFolder(extInstaller.getNativeHostDir());
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
    const resolved = path.resolve(String(filePath || ''));
    if (fs.existsSync(resolved)) {
      shell.showItemInFolder(resolved);
    } else {
      // Staged vault items no longer exist at their original path; open the
      // containing folder so the action remains useful after staging.
      shell.openPath(path.dirname(resolved));
    }
    return { success: true };
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

  // Open an arbitrary existing folder in Explorer. Unlike shell:openPath,
  // this is not restricted to the reports directory: it backs the settings
  // "open extension folder" button, where the folder lives under the user's
  // profile. Mirrors shell:showItemInFolder, which is likewise unvalidated.
  ipcMain.handle('shell:openFolder', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'Folder not found.' };
    }
    shell.showItemInFolder(resolved);
    return { success: true };
  });

  ipcMain.handle('shell:openExternal', (_event, url) => openExternal(shell, url));

  ipcMain.handle('shell:openPowerShell', (_event, context) => openPowerShell(spawn, context));

  // Control Panel applets (e.g. "control userpasswords2" or
  // "control /name Microsoft.BitLockerDriveEncryption") are not URLs, so
  // they cannot go through shell.openExternal. Spawn control.exe directly.
  ipcMain.handle('shell:openControlPanel', (_event, command) => openControlPanel(spawn, command));

  ipcMain.handle('shell:openWindowsUtility', (_event, utility) => openWindowsUtility(spawn, utility));

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

  // -- Emergency Lockdown Suggestions (quick-add) --
  ipcMain.handle('lockdown:getInterfaces', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const interfaces = await emergencyLockdown.getNetworkInterfaces();
      return { ok: true, data: interfaces };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:getServices', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const services = await emergencyLockdown.getNonEssentialServices();
      return { ok: true, data: services };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('lockdown:getLocalIPs', async () => {
    if (!emergencyLockdown) {
      return { ok: false, error: 'Emergency lockdown service unavailable' };
    }
    try {
      const ips = emergencyLockdown.getLocalIPs();
      return { ok: true, data: ips };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // -- Privacy Mode --
  ipcMain.handle('privacy:helpers', () => ({
    sensitiveFeatures: [...privacyMode.PRIVACY_SENSITIVE_FEATURES],
    disablePatch: privacyMode.buildDisablePatch(),
  }));

  ipcMain.handle('privacy:restorePatch', (_event, snapshot) => privacyMode.buildRestorePatch(snapshot));

  // -- Tools --
  ipcMain.handle('tools:list', async () => {
    if (!toolRegistry) return { ok: false, error: 'Tool registry unavailable' };
    const registry = loadRegistry();
    return { ok: true, data: registry };
  });

  ipcMain.handle('tools:run', async (event, toolId, args) => {
    if (!toolRegistry) return { ok: false, error: 'Tool registry unavailable' };
    const result = await toolRegistry.run(toolId, args || {}, {
      toolRegistry,
      db,
      processService,
      sendProgress: (payload) => {
        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send(`tools:progress:${toolId}`, payload);
        }
      }
    });
    return result;
  });

  if (toolRunManager) {
    const broadcast = (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    };
    toolRunManager.on('progress', (payload) => {
      broadcast('tools:progress', payload);
      broadcast(`tools:progress:${payload.toolId}`, payload);
    });
    toolRunManager.on('complete', (payload) => {
      broadcast('tools:complete', payload);
      broadcast(`tools:complete:${payload.toolId}`, payload);
    });
  }

  ipcMain.handle('tools:start', (_event, toolId, args, options) => {
    if (!toolRunManager) return { ok: false, error: 'Tool run manager unavailable' };
    try {
      return { ok: true, data: toolRunManager.start(toolId, args || {}, options || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('tools:cancel', (_event, runId) => {
    if (!toolRunManager) return { ok: false, error: 'Tool run manager unavailable' };
    const canceled = toolRunManager.cancel(String(runId || ''));
    return canceled ? { ok: true } : { ok: false, error: 'Run is no longer cancelable.' };
  });

  ipcMain.handle('tools:getActive', () => ({
    ok: true,
    data: toolRunManager ? toolRunManager.getActive() : []
  }));

  ipcMain.handle('tools:getHistory', (_event, limit, toolId) => ({
    ok: true,
    data: toolRunManager ? toolRunManager.getHistory(limit, toolId || null) : []
  }));

  // -- Maintenance File Vault --
  ipcMain.handle('vault:list', () => {
    if (!maintenanceSafetyVault) return { ok: false, error: 'File Vault unavailable' };
    return { ok: true, data: maintenanceSafetyVault.list() };
  });

  ipcMain.handle('vault:stage', async (event, items, options) => {
    if (!maintenanceSafetyVault) return { ok: false, error: 'File Vault unavailable' };
    try {
      const result = await maintenanceSafetyVault.stage(items, {
        ...(options || {}),
        onProgress: (payload) => {
          if (!event.sender.isDestroyed()) event.sender.send('vault:progress', payload);
        }
      });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('vault:restore', async (_event, id) => {
    if (!maintenanceSafetyVault) return { ok: false, error: 'File Vault unavailable' };
    try { return { ok: true, data: await maintenanceSafetyVault.restore(String(id || '')) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('vault:purge', async (_event, id) => {
    if (!maintenanceSafetyVault) return { ok: false, error: 'File Vault unavailable' };
    try { return { ok: true, data: await maintenanceSafetyVault.purge(String(id || '')) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // -- Persistence Change Monitor --
  ipcMain.handle('persistence:getStatus', () => {
    if (!persistenceMonitor) return { ok: false, error: 'Persistence Monitor unavailable' };
    return { ok: true, data: persistenceMonitor.getStatus() };
  });

  ipcMain.handle('persistence:scan', async (event) => {
    if (!persistenceMonitor) return { ok: false, error: 'Persistence Monitor unavailable' };
    try {
      const data = await persistenceMonitor.scan({
        source: 'manual',
        onProgress: (payload) => {
          if (!event.sender.isDestroyed()) event.sender.send('persistence:progress', payload);
        }
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('persistence:approve', (_event, options) => {
    if (!persistenceMonitor) return { ok: false, error: 'Persistence Monitor unavailable' };
    try { return { ok: true, data: persistenceMonitor.approve(options || {}) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // -- Startup Items --
  ipcMain.handle('startup:getIcons', async (_event, exePaths) => {
    if (!Array.isArray(exePaths)) return {};
    const { nativeImage } = require('electron');
    const icons = {};
    for (const exePath of exePaths) {
      try {
        if (fs.existsSync(exePath)) {
          const icon = nativeImage.createFromPath(exePath);
          if (!icon.isEmpty()) {
            icons[exePath] = icon.toDataURL();
          }
        }
      } catch (_) {}
    }
    return icons;
  });

  ipcMain.handle('startup:toggle', async (_event, item, enable) => {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Invalid item' };
    const backupKey = 'tools.disabledStartupItems.v1';
    const backups = db.getSetting(backupKey, {});
    const runFile = (file, args) => new Promise((resolve, reject) => {
      execFile(file, args, { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(String(stderr || error.message).trim()));
        resolve(stdout);
      });
    });
    try {
      if (item.source === 'registry') {
        const allowed = new Set([
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
          'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
          'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
          'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
        ]);
        const nativeKey = String(item.location || '').replace(/^HKCU:\\/, 'HKCU\\').replace(/^HKLM:\\/, 'HKLM\\');
        const valueName = String(item.valueName || item.name || '');
        if (!allowed.has(nativeKey) || !valueName || /[\r\n]/.test(valueName)) throw new Error('Unsupported startup registry value.');
        if (enable) {
          const backup = backups[item.id];
          if (!backup || backup.source !== 'registry') throw new Error('The original registry value backup was not found.');
          await runFile('reg.exe', ['add', nativeKey, '/v', valueName, '/t', backup.registryType === 'ExpandString' ? 'REG_EXPAND_SZ' : 'REG_SZ', '/d', backup.command, '/f']);
          delete backups[item.id];
        } else {
          const current = await runFile('reg.exe', ['query', nativeKey, '/v', valueName]);
          if (item.command && !String(current).includes(item.command)) throw new Error('The startup value changed after it was inspected. Refresh and try again.');
          backups[item.id] = { ...item, disabledAt: new Date().toISOString(), source: 'registry' };
          await runFile('reg.exe', ['delete', nativeKey, '/v', valueName, '/f']);
        }
      } else if (item.source === 'startup-folder') {
        const { isInside } = require('../../core/pathSafety');
        const officialRoots = [
          path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
          path.join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
        ].filter(Boolean).map((entry) => path.resolve(entry));
        if (enable) {
          const backup = backups[item.id];
          if (!backup || backup.source !== 'startup-folder' || !fs.existsSync(backup.disabledPath)) throw new Error('The original Startup-folder backup was not found.');
          if (fs.existsSync(backup.startupPath)) throw new Error('A file already exists at the original Startup-folder location.');
          fs.renameSync(backup.disabledPath, backup.startupPath);
          delete backups[item.id];
        } else {
          const sourcePath = path.resolve(item.startupPath || '');
          if (!officialRoots.some((root) => isInside(sourcePath, root))) throw new Error('Unsupported Startup-folder entry.');
          const disabledRoot = path.join(app.getPath('userData'), 'DisabledStartupItems');
          fs.mkdirSync(disabledRoot, { recursive: true });
          const disabledPath = path.join(disabledRoot, `${item.id}-${path.basename(sourcePath)}`);
          if (fs.existsSync(disabledPath)) throw new Error('A backup for this startup item already exists.');
          fs.renameSync(sourcePath, disabledPath);
          backups[item.id] = { ...item, disabledPath, disabledAt: new Date().toISOString(), source: 'startup-folder' };
        }
      } else {
        throw new Error('Unsupported startup item source.');
      }
      db.setSetting(backupKey, backups);
      return { ok: true, enabled: !!enable };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('startup:listDisabled', () => {
    const backups = db.getSetting('tools.disabledStartupItems.v1', {});
    return Object.values(backups).map((item) => ({ ...item, enabled: false }));
  });
}

module.exports = { register };
