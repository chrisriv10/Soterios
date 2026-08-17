'use strict';

/**
 * Electron main-process entry point for Soterios.
 *
 * Responsibilities:
 * - Configure Electron paths/command-line switches before app ready.
 * - Enforce single-instance lock.
 * - Start the lifecycle services and create the main window.
 * - Register top-level app event handlers (second-instance, ready, window-all-closed, quit).
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, screen } = require('electron');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');
const featureFlags = require('../core/featureFlags');
const { resolveThemeName } = require('../utils/themes');
const windowManager = require('./windowManager');
const lifecycle = require('./lifecycle');

// Ensure Chromium/Electron uses a writable data/cache location instead of
// falling back to a restricted or temp-based path on Windows.
try {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const defaultUserDataPath = path.join(appDataRoot, 'Soterios');
  const userDataPath = process.env.SOTERIOS_USERDATA || defaultUserDataPath;
  const cacheDir = path.join(userDataPath, 'cache');
  const tempDir = path.join(userDataPath, 'temp');

  for (const dirPath of [userDataPath, cacheDir, tempDir]) {
    try { fs.mkdirSync(dirPath, { recursive: true }); } catch (err) { lifecycle.logLine('warn', 'Failed to create directory: ' + dirPath, { error: err.message }); }
  }

  app.setPath('userData', userDataPath);
  app.setPath('cache', cacheDir);
  app.setPath('temp', tempDir);

  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('media-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-logging');
  if (process.env.SOTERIOS_DISABLE_GPU === '1') {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-features', 'NetworkService,AutofillServerCommunication,AutofillAcrossForms,Autofill');
} catch (_) {
  // Best-effort mitigations — continue on failure.
}

app.setAppUserModelId('com.soterios.app');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  if (windowManager.mainWindow) {
    if (windowManager.mainWindow.isMinimized()) windowManager.mainWindow.restore();
    windowManager.mainWindow.focus();
    const url = commandLine.find(arg => arg.startsWith('soterios://'));
    if (url) windowManager.mainWindow.webContents.send('protocol-url', url);
  }
});

app.whenReady().then(async () => {
  /**
   * Electron app-ready bootstrap.
   *
   * Configures paths, logger, theme, database, services, windows,
   * IPC handlers, tray, and background engines.
   */
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('soterios');
  }

  const dbPath = path.join(app.getPath('userData'), 'soterios.db');
  const logConfig = { level: process.env.SOTERIOS_LOG_LEVEL || 'info' };
  if (process.env.SOTERIOS_LOG_FILE) {
    logConfig.filePath = process.env.SOTERIOS_LOG_FILE === '1'
      ? path.join(app.getPath('userData'), 'soterios.log')
      : process.env.SOTERIOS_LOG_FILE;
  }
  logger.configure(logConfig);

  const currentUiTheme = lifecycle.peekUiTheme(dbPath);
  const startupLocale = lifecycle.peekUiLanguage(dbPath);
  windowManager.init({
    dbRef: null,
    featureFlags,
    currentUiTheme,
    startupLocale,
    logLine: lifecycle.logLine,
    t: lifecycle.t.bind(lifecycle),
  });

  if (!windowManager.isScreenshotCaptureMode()) {
    windowManager.createSplashWindow(currentUiTheme);
  }
  lifecycle.logLine('info', 'App starting', { theme: currentUiTheme });
  windowManager.sendSplashProgress(windowManager.splashWindow, 0, lifecycle.t('splash.starting'));

  // 1. Database
  const DatabaseService = require('../core/database');
  const db = new DatabaseService(dbPath);
  windowManager.init({
    dbRef: db,
    featureFlags,
    currentUiTheme: resolveThemeName(db.getSetting('ui.theme', currentUiTheme)),
    startupLocale,
    logLine: lifecycle.logLine,
    t: lifecycle.t.bind(lifecycle),
  });
  lifecycle.logLine('info', 'Database connected', { path: dbPath });
  windowManager.sendSplashProgress(windowManager.splashWindow, 3, lifecycle.t('splash.connectingDb'));

  // Migrate old feature.systemMonitoring key to feature.externalLookups
  const oldVal = db.getSetting('feature.systemMonitoring', null);
  if (oldVal !== null) {
    const newVal = db.getSetting('feature.externalLookups', null);
    if (newVal === null) db.setSetting('feature.externalLookups', oldVal);
    db.setSetting('feature.systemMonitoring', null);
  }

  const eventBus = require('../core/eventBus');

  const services = await lifecycle.start(db, eventBus, {
    userDataPath: app.getPath('userData'),
    startupLocale,
    notify: (title, body, level) => windowManager.showNotification(lifecycle.t(title), lifecycle.t(body), level),
  });

  // Keep a reference for IPC handlers that still reach into main.js state.
  windowManager.mainWindow = services.mainWindow;
  // splashWindow was created earlier via windowManager.createSplashWindow();
  // do NOT overwrite it with services.splashWindow (which is undefined).
  windowManager.splashTimeoutId = services.splashTimeoutId;
  windowManager.lifecycleRefs = services;

  // Renderer signals it has finished loading data; dismiss the splash.
  ipcMain.handle('app:ready', () => {
    windowManager.dismissSplash(
      windowManager.mainWindow,
      windowManager.splashWindow,
      windowManager.splashTimeoutId
    );
  });

  const pruneTimer = setInterval(() => {
    try {
      db.pruneNetworkStats(7);
      db.pruneMaintenanceRuns(100);
    } catch (err) {
      lifecycle.logLine('debug', 'Prune maintenance task failed', { error: err.message });
    }
  }, 60 * 60_000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
  services._pruneTimer = pruneTimer;
});

process.on('uncaughtException', (err) => {
  /**
   * Log uncaught exceptions through the lifecycle logger.
   *
   * @param {Error} err
   */
  lifecycle.logLine('fatal', 'Uncaught exception', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (err) => {
  /**
   * Log unhandled promise rejections through the lifecycle logger.
   *
   * @param {Error} err
   */
  lifecycle.logLine('fatal', 'Unhandled rejection', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
});

app.on('before-quit', () => {
  /**
   * Gracefully stop background services and close the database on quit.
   */
  const lifecycleRefs = windowManager.lifecycleRefs;
  if (lifecycleRefs) {
    lifecycleRefs.maintenanceScheduler?.stop();
    lifecycleRefs.trayController?.dispose();
    if (lifecycleRefs.networkStatsTimer) clearInterval(lifecycleRefs.networkStatsTimer);
    if (lifecycleRefs.pruneTimer) clearInterval(lifecycleRefs.pruneTimer);
  }
  try {
    const dbRef = windowManager.dbRef;
    if (dbRef?.db && typeof dbRef.db.close === 'function') dbRef.db.close();
  } catch (err) {
    lifecycle.logLine('debug', 'Database close failed', { error: err.message });
  }
});

app.on('window-all-closed', () => {
  if (windowManager.lifecycleRefs?.trayController?.tray) return;
  if (process.platform !== 'darwin') app.quit();
});
