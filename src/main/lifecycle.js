'use strict';

/**
 * Application lifecycle and startup orchestration.
 *
 * Handles:
 * - Startup locale/theme detection
 * - IPC handler registration
 * - Service wiring
 * - Tray initialization
 * - Updater initialization
 * - Background engines (maintenance scheduler, folder watcher, etc.)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFileSync } = require('child_process');
const logger = require('../utils/logger');
const i18n = require('../i18n');
const featureFlags = require('../core/featureFlags');
const { loadPlugins } = require('../core/pluginLoader');
const serviceRegistry = require('./serviceRegistry');
const updater = require('./updater');
const { getTrayHealthSummary } = require('./healthSummary');
const { initTrayDashboard } = require('./trayDashboard');
const { registerIpcHandlers } = require('./ipcHandlers');
const { MaintenanceScheduler } = require('./maintenanceScheduler');
const windowManager = require('./windowManager');
const { InvalidInputError } = require('../utils/errors');

/**
 * Log a line through the centralized logger.
 * @param {string} level
 * @param {string} message
 * @param {Object} [meta]
 */
function logLine(level, message, meta) {
  const fn = logger[level] || logger.info;
  fn(message, meta || undefined);
}

/**
 * Peek the saved UI language from the database without opening a full service.
 * @param {string} dbPath
 * @returns {string}
 */
function peekUiLanguage(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return 'en';
    const Database = require('better-sqlite3');
    const peek = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = peek.prepare('SELECT value FROM settings WHERE key = ?').get('ui.language');
      if (!row || row.value == null) return 'en';
      return JSON.parse(row.value);
    } finally {
      peek.close();
    }
  } catch (_) {
    return 'en';
  }
}

/**
 * Peek the saved UI theme from the database without opening a full service.
 * @param {string} dbPath
 * @returns {string}
 */
function peekUiTheme(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return 'dark';
    const Database = require('better-sqlite3');
    const peek = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = peek.prepare('SELECT value FROM settings WHERE key = ?').get('ui.theme');
      if (!row || row.value == null) return 'dark';
      return JSON.parse(row.value);
    } finally {
      peek.close();
    }
  } catch (_) {
    return 'dark';
  }
}

/**
 * Resolve the effective locale from DB or fallback.
 * @param {object} dbRef
 * @param {string} startupLocale
 * @returns {string}
 */
function getLocale(dbRef, startupLocale) {
  if (dbRef) {
    try {
      const lang = dbRef.getSetting('ui.language', 'en');
      return i18n.normalizeLocale(lang);
    } catch (_) {
      return startupLocale;
    }
  }
  return startupLocale;
}

/**
 * Translate a key using the current startup locale.
 * @param {string} key
 * @param {Object} [vars]
 * @returns {string}
 */
function t(key, vars) {
  return i18n.t(key, getLocale(windowManager.dbRef, windowManager.startupLocale), vars);
}

/**
 * Validate a startup persistence item.
 * Rejects path separators, control characters, and traversal attempts.
 * @param {Object} item
 * @param {string} item.source
 * @param {string} item.value
 * @throws {InvalidInputError}
 */
function validateStartupItem(item) {
  if (!item || typeof item !== 'object') {
    throw new InvalidInputError('Invalid startup item');
  }
  if (!item.source || !['registry', 'startup-folder'].includes(item.source)) {
    throw new InvalidInputError('Invalid startup item source');
  }
  if (!item.name || typeof item.name !== 'string' || item.name.length === 0 || item.name.length > 256) {
    throw new InvalidInputError('Invalid startup item name');
  }
  // Reject path separators and control characters in registry value names / filenames.
  if (/[\\/:*?"<>|\x00-\x1f]/.test(item.name)) {
    throw new InvalidInputError('Startup item name contains invalid characters');
  }
  if (item.source === 'registry') {
    if (!item.command || typeof item.command !== 'string') {
      throw new InvalidInputError('Invalid registry command');
    }
  } else if (item.source === 'startup-folder') {
    if (!item.path || typeof item.path !== 'string') {
      throw new InvalidInputError('Invalid startup item path');
    }
    const appData = process.env.APPDATA || '';
    const programData = process.env.ProgramData || '';
    const userStartup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const allStartup = path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const expectedDir = item.scope === 'user' ? userStartup : allStartup;
    const resolved = path.resolve(item.path);
    if (resolved !== expectedDir && !resolved.startsWith(expectedDir + path.sep)) {
      throw new InvalidInputError('Startup item path is outside the allowed directory');
    }
  }
}

/**
 * Wire core services from the service registry.
 * @param {object} db
 * @param {object} eventBus
 * @param {Object} [options]
 * @param {string} [options.userDataPath]
 * @param {string} [options.locale]
 * @param {Function} [options.notify]
 * @returns {Object}
 */
function wireServices(db, eventBus, options = {}) {
  const notify = options.notify || (() => {});
  const locale = options.locale || 'en';
  const services = serviceRegistry.create(db, eventBus, {
    userDataPath: options.userDataPath,
    locale,
    notify,
  });
  return services;
}

/**
 * Initialize auto-updater and broadcast status to windows.
 * @param {Object} services
 * @param {Object} [options]
 * @param {Function} [options.notify]
 */
function initUpdater(services, options = {}) {
  const notify = options.notify || (() => {});
  updater.initAutoUpdater({ onNotify: (title, body, level) => notify(title, body, level) });
  updater.subscribe((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:status', status);
    }
  });
}

/**
 * Initialize the system tray dashboard.
 * @param {Object} services
 * @param {Object} [options]
 * @param {BrowserWindow} [options.mainWindow]
 * @param {Electron.App} [options.app]
 * @param {object} [options.db]
 * @param {Function} [options.notify]
 */
function initTray(services, options = {}) {
  const { mainWindow, app } = options;
  const db = options.db;
  const toolRegistry = services.toolRegistry;
  try {
    const trayController = initTrayDashboard({
      app,
      mainWindow,
      getSummary: () => getTrayHealthSummary(db, toolRegistry)
    });
    services.trayController = trayController;
    return trayController;
  } catch (err) {
    logLine('warn', 'Tray dashboard unavailable', { error: err.message });
    return null;
  }
}

/**
 * Register event-bus listeners for scan progress and completion.
 * @param {Object} services
 * @param {object} db
 */
function registerProgressListeners(services, db) {
  const { mainWindow, eventBus } = services;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (services._progressListenersRegistered) return;
  services._progressListenersRegistered = true;

  const resolveScanType = (data) => data?.scanType || data?.report?.scanType || null;
  const isBackgroundScan = (scanType) => scanType === 'folderwatch';
  let announcedProgress = new Set();

  eventBus.on('scan:progress', (data) => {
    const scanType = resolveScanType(data);
    if (!isBackgroundScan(scanType) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', data);
    }
    if (!data || typeof data.pct !== 'number') return;
    if (db && !featureFlags.getFlag(db, 'scanNotifications', true)) return;
    if (scanType === 'definitions' || isBackgroundScan(scanType) || scanType === 'custom') return;
    const milestone = [0, 25, 50, 75].find((value) => data.pct >= value && !announcedProgress.has(value));
    if (milestone !== undefined) {
      announcedProgress.add(milestone);
      const files = data.filesScanned || 0;
      services.notify && services.notify('toast.scanProgressTitle', 'scan.progress', 'info', { files, pct: data.pct });
    }
  });

  eventBus.on('scan:complete', (data) => {
    const scanType = resolveScanType(data);
    announcedProgress.clear();
    if (!isBackgroundScan(scanType) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:complete', data);
    }
    if (isBackgroundScan(scanType) || scanType === 'custom') return;

    let label, body, level;
    if (data.scanType === 'definitions') {
      if (data.status === 'completed') {
        label = 'toast.signaturesUpdated';
        body = 'toast.definitionsUpdatedDetail';
        level = 'success';
      } else if (data.status === 'canceled') {
        label = 'toast.definitionsUpdateCanceled';
        body = 'toast.definitionsUpdateCanceledDetail';
        level = 'warn';
      } else {
        label = 'toast.definitionsUpdateFailed';
        body = data.error || 'toast.definitionsUpdateFailedDetail';
        level = 'danger';
      }
    } else {
      if (data.status === 'canceled') {
        label = 'toast.scanCanceled';
        body = 'toast.scanCanceledDetail';
        level = 'warn';
      } else {
        label = data.status === 'completed' ? 'toast.scanCompleted' : 'toast.scanFinishedWithIssues';
        body = 'toast.scanSummary';
        level = data.status !== 'completed' ? 'warn' : (data.threatsFound ? 'danger' : 'success');
      }
    }
    const iconOverride = (data.threatsFound && data.threatsFound > 0) ? windowManager.TOAST_ICONS.threat : null;
    services.notify && services.notify(label, body, level, iconOverride);

    (async () => {
      try {
        if (!featureFlags.getFlag(db, 'autoReports', true)) return;
        const isCanceled = data.status === 'canceled' || data.report?.status === 'canceled';
        if (isCanceled || (scanType !== 'quick' && scanType !== 'full')) return;
        logLine('info', 'Generating scan report...');
        const result = await services.toolRegistry.run('generate-security-report', { version: app.getVersion() }, {
          toolRegistry: services.toolRegistry,
          db,
          log: logLine
        });
        logLine('info', 'Scan report ' + (result.ok ? 'generated' : 'failed: ' + (result.error || 'unknown')));
      } catch (err) {
        logLine('error', 'Auto-report generation threw: ' + (err.message || err));
      }
    })();
  });
}

/**
 * Start background engines: ClamAV, realtime watcher, folder watcher, etc.
 * @param {Object} services
 * @param {object} db
 */
async function startBackgroundEngines(services, db) {
  const { clamEngine, realtimeWatcher, folderWatcher, networkAlertMonitor, blocklistService, networkMonitor } = services;

  try {
    await clamEngine.init();
  } catch (err) {
    logLine('error', 'ClamAV init failed', { message: err.message });
  }
  try {
    if (featureFlags.getFlag(db, 'realtimeProtection', true)) {
      await realtimeWatcher.start();
    }
  } catch (err) {
    logLine('error', 'Real-time protection init failed', { message: err.message });
  }
  try {
    if (featureFlags.getFlag(db, 'folderWatch', true)) {
      folderWatcher.start();
    }
  } catch (err) {
    logLine('error', 'Folder watcher init failed', { message: err.message });
  }
  try {
    if (featureFlags.getFlag(db, 'networkAlerts', true)) {
      networkAlertMonitor.start();
    }
  } catch (err) {
    logLine('error', 'Network alert monitor init failed', { message: err.message });
  }
  try {
    await blocklistService.refreshAll();
  } catch (err) {
    logLine('error', 'Blocklist refresh failed', { message: err.message });
  }
  if (featureFlags.getFlag(db, 'networkTrafficHistory', true)) {
    services.startNetworkStatsTimer && services.startNetworkStatsTimer();
  }
  try {
    await networkMonitor.getStats();
  } catch (err) {
    logLine('error', 'Network stats warm-up failed', { message: err.message });
  }
}

/**
 * Start the application: wire services, initialize engines, create windows.
 * @param {object} db
 * @param {object} eventBus
 * @param {Object} [options]
 * @param {string} [options.userDataPath]
 * @param {string} [options.startupLocale]
 * @param {Function} [options.notify]
 * @returns {Promise<Object>} Started services.
 */
async function start(db, eventBus, options = {}) {
  const { userDataPath, notify } = options;
  const locale = getLocale(db, options.startupLocale || 'en');

  // 2. Security Engines (Dependency Injection)
  const services = wireServices(db, eventBus, {
    userDataPath,
    locale,
    notify: (title, body, level) => notify(title, body, level),
  });
  services.notify = notify;

  // Probe actual admin state once at startup rather than assuming elevation
  // from the NSIS requestedExecutionLevel. The running process can lose
  // elevation, and the renderer needs the real value for UI decisions.
  let isActuallyAdmin = false;
  try {
    const adminResult = await services.systemAudit.runPowerShell(
      "([Security.Principal.WindowsPrincipal] " +
      "[Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(" +
      "[Security.Principal.WindowsBuiltInRole]::Administrator)"
    );
    isActuallyAdmin = adminResult.ok && adminResult.stdout.trim() === 'True';
  } catch (_) {
    isActuallyAdmin = false;
  }
  services.isActuallyAdmin = isActuallyAdmin;

  // Network stats timer control (for feature toggle)
  services.startNetworkStatsTimer = () => {
    if (services._networkStatsTimer) return { running: true };
    const sampleNetworkStats = async () => {
      try {
        const stats = await services.networkMonitor.getStats();
        const recordedAt = new Date().toISOString();
        for (const iface of (stats.interfaces || [])) {
          db.addNetworkStatsSample(iface.iface, iface.rxSec || 0, iface.txSec || 0, recordedAt);
        }
      } catch (err) {
        logLine('warn', 'Network stats sample failed', { message: err.message });
      }
    };
    const networkStatsTimer = setInterval(sampleNetworkStats, 30_000);
    if (typeof networkStatsTimer.unref === 'function') networkStatsTimer.unref();
    services._networkStatsTimer = networkStatsTimer;
    sampleNetworkStats().catch(() => {});
    return { running: true };
  };
  services.stopNetworkStatsTimer = () => {
    if (services._networkStatsTimer) {
      clearInterval(services._networkStatsTimer);
      services._networkStatsTimer = null;
    }
    return { running: false };
  };

  const maintenanceScheduler = new MaintenanceScheduler({
    db,
    toolRegistry: services.toolRegistry,
    getIdleTimeSeconds: () => {
      try { return require('electron').powerMonitor.getSystemIdleTime(); } catch (_) { return 0; }
    },
    notify: (title, body, level) => notify(title, body, level),
    log: (level, message, meta) => logLine(level, message, meta)
  });
  maintenanceScheduler.start();
  services.maintenanceScheduler = maintenanceScheduler;

  initUpdater(services, { notify });
  loadPlugins();
  windowManager.sendSplashProgress(services.splashWindow, 6, t('splash.loadingEngines'));

  // Show the window as soon as possible instead of waiting on ClamAV/RTP
  // initialization below -- those can take a while (definitions download,
  // spawning PowerShell) and previously blocked the window from appearing
  // at all until they finished.
  windowManager.buildAppMenu(services.mainWindow);
  const { mainWindow, splashTimeoutId } = windowManager.createWindow();
  services.mainWindow = mainWindow;
  windowManager.sendSplashProgress(services.splashWindow, 9, t('splash.buildingInterface'));

  // Register IPC handlers only once mainWindow actually exists.
  registerIpcHandlers(mainWindow, services);
  windowManager.sendSplashProgress(services.splashWindow, 12, t('splash.registeringServices'));

  const trayController = initTray(services, { mainWindow, app, db, toolRegistry: services.toolRegistry });
  if (trayController) {
    services.trayController = trayController;
  }

  mainWindow.on('close', (event) => {
    if (!services.isQuitting && trayController?.tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  windowManager.sendSplashProgress(services.splashWindow, 15, t('splash.loadingDashboard'));

  // Extract icons from executable paths for the startup items tool
  const _startupIconCache = {};
  ipcMain.handle('startup:getIcons', async (_event, exePaths) => {
    const unique = [...new Set((exePaths || []).filter(Boolean))];
    const result = {};
    for (const exePath of unique) {
      if (exePath in _startupIconCache) {
        result[exePath] = _startupIconCache[exePath];
        continue;
      }
      try {
        const expandedPath = process.env.SystemRoot && exePath.includes('%SystemRoot%')
          ? exePath.replace(/%SystemRoot%/gi, process.env.SystemRoot)
          : exePath;
        if (!fs.existsSync(expandedPath)) {
          _startupIconCache[exePath] = null;
          result[exePath] = null;
          continue;
        }
        const nativeImg = await app.getFileIcon(expandedPath);
        const dataUrl = nativeImg.toDataURL();
        if (dataUrl && dataUrl.length > 100) {
          _startupIconCache[exePath] = dataUrl;
          result[exePath] = dataUrl;
        } else {
          _startupIconCache[exePath] = null;
          result[exePath] = null;
        }
      } catch (_) {
        _startupIconCache[exePath] = null;
        result[exePath] = null;
      }
    }
    return result;
  });

  // Extract icons from executable paths for the processes page
  const _processIconCache = {};
  ipcMain.handle('process:getIcons', async (_event, exePaths) => {
    const unique = [...new Set((exePaths || []).filter(Boolean))];
    const result = {};
    for (const exePath of unique) {
      if (exePath in _processIconCache) {
        result[exePath] = _processIconCache[exePath];
        continue;
      }
      try {
        const expandedPath = process.env.SystemRoot && exePath.includes('%SystemRoot%')
          ? exePath.replace(/%SystemRoot%/gi, process.env.SystemRoot)
          : exePath;
        if (!fs.existsSync(expandedPath)) {
          _processIconCache[exePath] = null;
          result[exePath] = null;
          continue;
        }
        const nativeImg = await app.getFileIcon(expandedPath);
        const dataUrl = nativeImg.toDataURL();
        if (dataUrl && dataUrl.length > 100) {
          _processIconCache[exePath] = dataUrl;
          result[exePath] = dataUrl;
        } else {
          _processIconCache[exePath] = null;
          result[exePath] = null;
        }
      } catch (_) {
        _processIconCache[exePath] = null;
        result[exePath] = null;
      }
    }
    return result;
  });

  // Enable/disable a startup item
  ipcMain.handle('startup:toggle', async (_event, item, enable) => {
    try {
      validateStartupItem(item);
      if (item.source === 'registry') {
        const hive = item.scope === 'HKLM' ? 'HKLM' : 'HKCU';
        const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
        if (enable) {
          execFileSync('reg', ['add', key, '/v', item.name, '/t', 'REG_SZ', '/d', item.command, '/f'], { timeout: 10000 });
        } else {
          execFileSync('reg', ['delete', key, '/v', item.name, '/f'], { timeout: 10000 });
        }
        return { ok: true };
      } else if (item.source === 'startup-folder') {
        const appData = process.env.APPDATA || '';
        const programData = process.env.ProgramData || '';
        const userStartup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const allStartup = path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const startupDir = item.scope === 'user' ? userStartup : allStartup;
        if (enable) {
          const backup = path.join(startupDir, '.disabled', item.name);
          if (fs.existsSync(backup)) {
            fs.renameSync(backup, item.path);
            return { ok: true };
          }
          return { ok: false, error: 'No backup found to restore' };
        } else {
          const disabledDir = path.join(startupDir, '.disabled');
          fs.mkdirSync(disabledDir, { recursive: true });
          const dest = path.join(disabledDir, item.name);
          fs.renameSync(item.path, dest);
          return { ok: true };
        }
      }
      return { ok: false, error: 'Toggle not supported for this item type' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Toast navigation bridge: receives the signal from the isolated toast
  // preload and forwards it to the main window renderer.
  ipcMain.on('toast:navigate-scanner', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send('navigate-to-scanner');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow();
  });

  // Forward progress events from the dashboard (renderer) to the splash
  ipcMain.handle('splash:progress', (_event, data) => {
    if (services.splashWindow && !services.splashWindow.isDestroyed()) {
      services.splashWindow.webContents.send('splash:progress', data);
    }
  });

  // Register the scan progress listeners
  registerProgressListeners(services, db);

  setTimeout(() => {
    if (featureFlags.getFlag(db, 'autoUpdates', true)) {
      updater.checkForUpdates().catch(() => {});
    }
  }, 30_000);

  // Slow engine initialization (ClamAV definitions, real-time protection)
  // runs in the background after the window is already visible, instead of
  // blocking startup.
  (async () => {
    await startBackgroundEngines(services, db);
  })();

  return services;
}

module.exports = {
  wireServices,
  initUpdater,
  initTray,
  loadPlugins,
  start,
  logLine,
  peekUiLanguage,
  peekUiTheme,
  getLocale,
  t,
};
