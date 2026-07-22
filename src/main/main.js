const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, screen, powerMonitor } = require('electron');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');
const { TOAST_THEMES, resolveThemeName, themeBackground } = require('../utils/themes');
const i18n = require('../i18n');

// Ensure Chromium/Electron uses a writable data/cache location instead of
// falling back to a restricted or temp-based path on Windows.
try {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const defaultUserDataPath = path.join(appDataRoot, 'Soterios');
  const userDataPath = process.env.SOTERIOS_USERDATA || defaultUserDataPath;
  const cacheDir = path.join(userDataPath, 'cache');
  const tempDir = path.join(userDataPath, 'temp');

  for (const dirPath of [userDataPath, cacheDir, tempDir]) {
    try { fs.mkdirSync(dirPath, { recursive: true }); } catch (err) { logLine('warn', 'Failed to create directory: ' + dirPath, { error: err.message }); }
  }

  app.setPath('userData', userDataPath);
  app.setPath('cache', cacheDir);
  app.setPath('temp', tempDir);

  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('media-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-logging');
  // GPU acceleration is enabled by default -- disabling it forces Chromium
  // into full software rendering, which is the most common cause of choppy
  // scrolling/animations in Electron apps. If a specific machine hits a
  // graphics driver crash or rendering corruption, set
  // SOTERIOS_DISABLE_GPU=1 in the environment to fall back to software
  // rendering without needing a code change.
  if (process.env.SOTERIOS_DISABLE_GPU === '1') {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }
  // Harmless regardless of GPU state -- avoids extra disk writes, not a
  // rendering-smoothness switch.
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-features', 'NetworkService,AutofillServerCommunication,AutofillAcrossForms,Autofill');
} catch (err) {
  // If anything goes wrong here, we intentionally continue — these are best-effort mitigations
}

const DatabaseService = require('../core/database');
const eventBus = require('../core/eventBus');
const { registerIpcHandlers } = require('./ipcHandlers');
const serviceRegistry = require('./serviceRegistry');
const { MaintenanceScheduler } = require('./maintenanceScheduler');
const { initTrayDashboard } = require('./trayDashboard');
const updater = require('./updater');
const { getTrayHealthSummary } = require('./healthSummary');

// Legacy utilities
const { loadPlugins } = require('../core/pluginLoader');

let mainWindow;
let splashWindow;
let splashTimeoutId;
let dbRef; // set once the database is created in app.whenReady() below, so
// showNotification (defined before that point) can check settings
let currentUiTheme = 'dark';
let startupLocale = 'en'; // set from peekUiLanguage() before the DB is ready,
// so the earliest splash messages respect the saved language
let isQuitting = false;
const lifecycleRefs = {
  maintenanceScheduler: null,
  trayController: null,
  networkStatsTimer: null,
  pruneTimer: null
};

function logLine(level, message, meta) {
  const fn = logger[level] || logger.info;
  fn(message, meta || undefined);
}

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

function getLocale() {
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

function t(key, vars) {
  return i18n.t(key, getLocale(), vars);
}

function createIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.ico');
  return nativeImage.createFromPath(iconPath);
}

// -- Custom-designed toast notifications ---------------------------------
// Electron's built-in Notification API renders through the OS's native
// toast template (title/body/icon only) -- there's no way to apply
// Soterios's own dark/cyan design to it. These are small frameless windows
// we fully control instead, stacked bottom-right and styled to match the
// rest of the app.
const activeToasts = [];
const TOAST_WIDTH = 380;
const TOAST_HEIGHT = 180;
const TOAST_MARGIN = 16;
const TOAST_GAP = 10;
const TOAST_LIFETIME_MS = 6000;

// Toast HTML is loaded via a data: URL, which has no filesystem base to
// resolve a relative image path against -- so the logo is embedded directly
// as a base64 PNG instead of referenced by path. Computed once and cached
// since it never changes.
function readPngAsDataUri(relativePath) {
  try {
    const fullPath = path.join(__dirname, '../../', relativePath);
    const buf = fs.readFileSync(fullPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (_) {
    return '';
  }
}

function getToastMarkDataUri() {
  if (!getToastMarkDataUri._cache) getToastMarkDataUri._cache = readPngAsDataUri('assets/toast-icon.png');
  return getToastMarkDataUri._cache;
}

function getToastWordmarkDataUri() {
  if (!getToastWordmarkDataUri._cache) getToastWordmarkDataUri._cache = readPngAsDataUri('assets/toast-wordmark.png');
  return getToastWordmarkDataUri._cache;
}

const TOAST_ACCENTS = {
  info: '#4fc3d9',
  success: '#3ddc97',
  warn: '#e8b339',
  danger: '#e85f5c'
};

const TOAST_ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v5"/><path d="M12 7.5h.01"/>',
  success: '<path d="M5 13l4 4L19 7"/>',
  warn: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.7 18a1 1 0 0 0 .9 1.5h16.8a1 1 0 0 0 .9-1.5L13.7 3.9a1.6 1.6 0 0 0-2.8 0z"/>',
  danger: '<path d="M15 9l-6 6"/><path d="M9 9l6 6"/><circle cx="12" cy="12" r="9"/>',
  threat: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.3 18.3l-2.1-2.1"/><path d="M18.3 5.6l-2.1 2.1"/><path d="M5.6 18.3l2.1-2.1"/><circle cx="10" cy="10" r=".5"/><circle cx="14.5" cy="10.5" r=".5"/><circle cx="13" cy="14.5" r=".5"/><circle cx="9.5" cy="14" r=".5"/>'
};

function escToastHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function toastHtml(title, body, level, themeName, iconOverride = null) {
  const theme = TOAST_THEMES[themeName] || TOAST_THEMES.dark;
  const accent = theme.accents[level] || theme.accents.info;
  const iconPaths = iconOverride || TOAST_ICONS[level] || TOAST_ICONS.info;
  const markDataUri = getToastMarkDataUri();
  const wordmarkDataUri = getToastWordmarkDataUri();
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; user-select:none; }
  .toast {
    box-sizing: border-box;
    position: relative;
    width: ${TOAST_WIDTH}px;
    display:flex; flex-direction:column;
    background: ${theme.bg};
    border: 1px solid ${theme.border};
    border-left: 3px solid ${accent};
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.45);
    font-family: 'Segoe UI', -apple-system, sans-serif;
    color: ${theme.textMain};
    cursor: pointer;
    animation: toastIn 220ms ease-out;
    overflow: hidden;
  }
  .toast.closing { animation: toastOut 200ms ease-in forwards; }
  @keyframes toastIn { from { transform: translateX(24px); opacity:0; } to { transform: translateX(0); opacity:1; } }
  @keyframes toastOut { from { transform: translateX(0); opacity:1; } to { transform: translateX(24px); opacity:0; } }
  .header { flex-shrink:0; position:relative; display:flex; align-items:center; padding:16px 12px 0 14px; }
  .mark { position:absolute; top:16px; left:12px; height:56px; width:56px; border-radius:8px; }
  .wordmark { height:56px; width:auto; display:block; opacity:0.97; margin-left:49px; }
  .wordmark-fallback { font-size:17px; font-weight:600; color:${theme.textMain}; letter-spacing:-0.02em; margin-left:12px; }
  .header .spacer { flex:1; }
  .close { flex-shrink:0; color:${theme.closeBtn}; font-size:16px; line-height:1; padding:2px 4px; align-self:flex-start; margin-top:4px; }
  .close:hover { color:${theme.closeHover}; }
  .body-row { flex-shrink:0; display:flex; gap:14px; align-items:flex-start; padding:14px 16px 16px 14px; }
  .status-circle {
    flex-shrink:0; width:48px; height:48px; border-radius:50%;
    border:2px solid ${accent};
    display:flex; align-items:center; justify-content:center;
    background: rgba(255,255,255,0.03);
  }
  .status-glyph { width:22px; height:22px; stroke:${accent}; }
  .text { flex:1; min-width:0; padding-top:2px; }
  .title { font-size:14px; font-weight:700; color:${theme.textMain}; margin-bottom:3px; }
  .desc { font-size:12px; color:${theme.textMuted}; line-height:1.42; word-wrap:break-word; }
</style></head>
<body>
  <div class="toast" id="toast">
    <div class="header">
      ${markDataUri ? `<img class="mark" src="${markDataUri}" alt="" />` : ''}
      ${wordmarkDataUri ? `<img class="wordmark" src="${wordmarkDataUri}" alt="" />` : '<span class="wordmark-fallback">Soterios</span>'}
      <div class="spacer"></div>
      <div class="close" id="closeBtn">&times;</div>
    </div>
    <div class="body-row">
      <div class="status-circle">
        <svg class="status-glyph" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</svg>
      </div>
      <div class="text">
        <div class="title">${escToastHtml(title)}</div>
        <div class="desc">${escToastHtml(body)}</div>
      </div>
    </div>
  </div>
  <script>
    const toast = document.getElementById('toast');
    function dismiss() {
      toast.classList.add('closing');
      setTimeout(() => { window.close(); }, 200);
    }
    document.getElementById('closeBtn').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    toast.addEventListener('click', () => {
      window.location.href = 'soterios://navigate-scanner';
      dismiss();
    });
    setTimeout(dismiss, ${TOAST_LIFETIME_MS});
  </script>
</body></html>`;
}

// Newest toast lands closest to the bottom margin; older ones already on
// screen get pushed upward above it, same stacking behavior as Windows'
// own Action Center toasts.
function repositionToasts() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  let bottom = y + height - TOAST_MARGIN;
  for (let i = activeToasts.length - 1; i >= 0; i--) {
    const win = activeToasts[i];
    if (!win || win.isDestroyed()) continue;
    const top = bottom - TOAST_HEIGHT;
    win.setBounds({ x: x + width - TOAST_WIDTH - TOAST_MARGIN, y: top, width: TOAST_WIDTH, height: TOAST_HEIGHT });
    bottom = top - TOAST_GAP;
  }
}

function showNotification(title, body, level = 'info', iconOverride = null) {
  // Previously fired unconditionally regardless of the Settings toggle --
  // this was the same "flag saved but never read" bug found earlier with
  // System Monitoring.
  if (dbRef && !dbRef.getSetting('feature.notificationsEnabled', true)) return;
  try {
    const themeName = dbRef ? dbRef.getSetting('ui.theme', 'dark') : 'dark';
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    const toastWindow = new BrowserWindow({
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      x: x + width - TOAST_WIDTH - TOAST_MARGIN,
      y: y + height - TOAST_HEIGHT - TOAST_MARGIN,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        sandbox: false
      }
    });
    // Translate title and body before rendering
    const translatedTitle = t(title);
    const translatedBody = t(body);
    toastWindow.setAlwaysOnTop(true, 'screen-saver');
    toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toastHtml(translatedTitle, translatedBody, level, themeName, iconOverride)));
    toastWindow.once('ready-to-show', () => toastWindow.show());
    toastWindow.on('closed', () => {
      const idx = activeToasts.indexOf(toastWindow);
      if (idx !== -1) activeToasts.splice(idx, 1);
      repositionToasts();
    });

    // Handle toast click to navigate to scanner
    toastWindow.webContents.on('will-navigate', (event, url) => {
      if (url === 'soterios://navigate-scanner') {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
          mainWindow.webContents.send('navigate-to-scanner');
        }
      }
    });

    activeToasts.push(toastWindow);
    repositionToasts();
  } catch (_) { }
}

function createSplashWindow(themeName = 'dark') {
  const theme = resolveThemeName(themeName);
  splashWindow = new BrowserWindow({
    width: 660,
    height: 440,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: themeBackground(theme),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/splashPreload.js')
    }
  });

  splashWindow.loadFile(path.join(__dirname, '../ui/pages/splash.html'), {
    query: { theme }
  });
  splashWindow.once('ready-to-show', () => {
    if (splashWindow) splashWindow.show();
  });
}

function sendSplashProgress(pct, label) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:progress', { pct, label });
  }
}

function isScreenshotCaptureMode() {
  return process.argv.includes('--screenshot-capture');
}

function getScreenshotConfig() {
  if (!isScreenshotCaptureMode()) return null;
  const pageArg = process.argv.find((arg) => arg.startsWith('--screenshot-page='));
  const outArg = process.argv.find((arg) => arg.startsWith('--screenshot-out='));
  if (!pageArg || !outArg) return null;
  const page = pageArg.split('=').slice(1).join('=');
  const outPath = outArg.split('=').slice(1).join('=');
  if (!page || !outPath) return null;
  return {
    page,
    outPath,
    runUninstaller: process.argv.includes('--screenshot-run-uninstaller')
  };
}

function failScreenshotCapture(message) {
  logLine('error', message);
  app.exit(1);
}

function scheduleScreenshotCapture(win, config) {
  win.webContents.once('did-finish-load', () => {
    dismissSplash();
    if (config.page === 'tools') win.setSize(1280, 980);
    const delayMs = config.runUninstaller ? 2000 : 8000;
    setTimeout(async () => {
      try {
        if (config.page === 'tools') {
          await win.webContents.executeJavaScript(`
            (async () => {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              document.querySelector('[data-script-id="uninstaller-report"]')?.scrollIntoView({ block: 'center' });
            })();
          `);
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        if (config.runUninstaller) {
          await win.webContents.executeJavaScript(`
            (async () => {
              let clicked = false;
              for (let attempt = 0; attempt < 24; attempt += 1) {
                const btn = document.querySelector('[data-script-id="uninstaller-report"]');
                if (btn && !btn.disabled) {
                  btn.scrollIntoView({ block: 'center' });
                  btn.click();
                  clicked = true;
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              if (!clicked) throw new Error('Uninstaller report button was not available');

              for (let attempt = 0; attempt < 60; attempt += 1) {
                const output = document.getElementById('toolOutput');
                const running = output && output.querySelector('.spinner');
                const hasContent = output && output.textContent && output.textContent.trim().length > 20;
                if (!running && hasContent) {
                  output.scrollIntoView({ block: 'start' });
                  return true;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              throw new Error('Uninstaller report did not finish in time');
            })();
          `);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const image = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(config.outPath), { recursive: true });
        fs.writeFileSync(config.outPath, image.toPNG());
        logLine('info', 'Screenshot saved', { path: config.outPath });
        app.quit();
      } catch (err) {
        logLine('error', 'Screenshot capture failed', { error: err.message });
        process.exitCode = 1;
        app.quit();
      }
    }, delayMs);
  });
}

// Called once the renderer's Dashboard has actually finished loading its data
// (not just once the HTML has parsed), or after a maximum wait as a fallback
// so a slow/failed load never leaves the user stuck looking at the splash
// screen forever.
function dismissSplash() {
  if (splashTimeoutId) {
    clearTimeout(splashTimeoutId);
    splashTimeoutId = undefined;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: themeBackground(currentUiTheme),
    title: 'Soterios',
    icon: createIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  const shellHtmlPath = path.join(__dirname, '../ui/pages/shell.html');
  const screenshotConfig = getScreenshotConfig();
  if (isScreenshotCaptureMode() && !screenshotConfig) {
    failScreenshotCapture('Screenshot capture requires --screenshot-page= and --screenshot-out=');
    return;
  }
  if (screenshotConfig) {
    mainWindow.loadFile(shellHtmlPath, { hash: screenshotConfig.page });
    scheduleScreenshotCapture(mainWindow, screenshotConfig);
  } else {
    mainWindow.loadFile(shellHtmlPath);
  }

  // Intentionally no auto-show on 'ready-to-show' here -- the window stays
  // hidden until the renderer signals it has actually finished loading data
  // (see the 'app:ready' handler below), so the splash screen covers the
  // whole load instead of just the initial blank-page flash. A fallback
  // timeout guarantees the window still appears even if that signal is
  // delayed or never arrives (e.g. an unexpected renderer error).
  splashTimeoutId = setTimeout(dismissSplash, 8000);

  if ((process.argv.includes('--dev') || process.env.NODE_ENV === 'development') && !isScreenshotCaptureMode()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const aboutHandler = () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'About Soterios',
      message: 'Soterios',
      detail: `Version ${app.getVersion()}\n\nLocal-first Windows security and maintenance platform.`,
      buttons: ['OK']
    });
  };

  const template = [
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Soterios', click: aboutHandler }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setAppUserModelId('com.soterios.app');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const url = commandLine.find(arg => arg.startsWith('soterios://'));
    if (url) mainWindow.webContents.send('protocol-url', url);
  }
});

app.whenReady().then(async () => {
  // Register custom protocol for browser extension communication
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('soterios');
  }

  const dbPath = path.join(app.getPath('userData'), 'soterios.db');
  // File logging is opt-in via SOTERIOS_LOG_FILE (path or "1" for the default log file).
  const logConfig = { level: process.env.SOTERIOS_LOG_LEVEL || 'info' };
  if (process.env.SOTERIOS_LOG_FILE) {
    logConfig.filePath = process.env.SOTERIOS_LOG_FILE === '1'
      ? path.join(app.getPath('userData'), 'soterios.log')
      : process.env.SOTERIOS_LOG_FILE;
  }
  logger.configure(logConfig);

  // Peek the saved theme before creating the splash so the first paint
  // matches the user's preference instead of always flashing dark mode.
  currentUiTheme = peekUiTheme(dbPath);
  // Peek the saved locale too, so the earliest splash progress messages
  // are in the user's language instead of always starting in English.
  startupLocale = i18n.normalizeLocale(peekUiLanguage(dbPath));
  if (!isScreenshotCaptureMode()) {
    createSplashWindow(currentUiTheme);
  }

  logLine('info', 'App starting', { theme: currentUiTheme });
  sendSplashProgress(0, t('splash.starting'));

  // 1. Database
  const db = new DatabaseService(dbPath);
  dbRef = db;
  currentUiTheme = resolveThemeName(db.getSetting('ui.theme', currentUiTheme));
  sendSplashProgress(3, t('splash.connectingDb'));

  // Migrate old feature.systemMonitoring key to feature.externalLookups
  const oldVal = db.getSetting('feature.systemMonitoring', null);
  if (oldVal !== null) {
    const newVal = db.getSetting('feature.externalLookups', null);
    if (newVal === null) db.setSetting('feature.externalLookups', oldVal);
    db.setSetting('feature.systemMonitoring', null);
  }

  // 2. Security Engines (Dependency Injection)
  const services = serviceRegistry.create(db, eventBus, {
    userDataPath: app.getPath('userData'),
    locale: getLocale(),
    notify: (title, body, level) => showNotification(t(title), t(body), level),
  });

  // Network stats timer control (for feature toggle)
  services.startNetworkStatsTimer = () => {
    if (lifecycleRefs.networkStatsTimer) return { running: true };
    const sampleNetworkStats = async () => {
      try {
        const stats = await networkMonitor.getStats();
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
    lifecycleRefs.networkStatsTimer = networkStatsTimer;
    sampleNetworkStats().catch(() => {});
    return { running: true };
  };
  services.stopNetworkStatsTimer = () => {
    if (lifecycleRefs.networkStatsTimer) {
      clearInterval(lifecycleRefs.networkStatsTimer);
      lifecycleRefs.networkStatsTimer = null;
    }
    return { running: false };
  };

  const maintenanceScheduler = new MaintenanceScheduler({
    db: services.db,
    toolRegistry: services.toolRegistry,
    getIdleTimeSeconds: () => {
      try { return powerMonitor.getSystemIdleTime(); } catch (_) { return 0; }
    },
    notify: (title, body, level) => showNotification(t(title), t(body), level),
    log: (level, message, meta) => logLine(level, message, meta)
  });
  maintenanceScheduler.start();
  services.maintenanceScheduler = maintenanceScheduler;
  lifecycleRefs.maintenanceScheduler = maintenanceScheduler;

  const {
    clamEngine,
    realtimeWatcher,
    folderWatcher,
    networkAlertMonitor,
    blocklistService,
    networkMonitor,
    toolRegistry
  } = services;

  updater.initAutoUpdater({ onNotify: (title, body, level) => showNotification(t(title), t(body), level) });
  updater.subscribe((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:status', status);
    }
  });

  // loadPlugins() is a synchronous filesystem scan, not a network call, so
  // it's cheap enough to keep here rather than deferring it.
  loadPlugins();
  sendSplashProgress(6, t('splash.loadingEngines'));

  // Show the window as soon as possible instead of waiting on ClamAV/RTP
  // initialization below -- those can take a while (definitions download,
  // spawning PowerShell) and previously blocked the window from appearing
  // at all until they finished.
  buildAppMenu();
  createWindow();
  sendSplashProgress(9, t('splash.buildingInterface'));

  // Register IPC handlers only once mainWindow actually exists. Previously
  // this ran before createWindow(), so the mainWindow parameter passed in
  // was always undefined (a plain variable copied by value at call time) --
  // handlers like dialog:pickFolder/pickFiles silently fell back to
  // BrowserWindow.getFocusedWindow() instead of targeting the real window.
  registerIpcHandlers(mainWindow, services);
  sendSplashProgress(12, t('splash.registeringServices'));

  try {
    lifecycleRefs.trayController = initTrayDashboard({
      app,
      mainWindow,
      getSummary: () => getTrayHealthSummary(db, toolRegistry)
    });
    services.trayController = lifecycleRefs.trayController;

    mainWindow.on('close', (event) => {
      if (!isQuitting && lifecycleRefs.trayController?.tray) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  } catch (err) {
    logLine('warn', 'Tray dashboard unavailable', { error: err.message });
  }

  setTimeout(() => {
    if (db.getSetting('feature.autoUpdates', true)) {
      updater.checkForUpdates().catch(() => {});
    }
  }, 30_000);

  // Module-level tracking for announced progress milestones to prevent duplicate notifications
  let announcedProgress = new Set();
  let progressListenersRegistered = false;

  function registerScanProgressListeners() {
    if (progressListenersRegistered) return;
    progressListenersRegistered = true;

    const resolveScanType = (data) => data?.scanType || data?.report?.scanType || null;
    const isBackgroundScan = (scanType) => scanType === 'folderwatch';

    eventBus.on('scan:progress', (data) => {
      const scanType = resolveScanType(data);
      // Don't forward folder watch progress to UI to prevent interference
      if (!isBackgroundScan(scanType) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan:progress', data);
      }
      if (!data || typeof data.pct !== 'number') return;
      if (dbRef && !dbRef.getSetting('feature.scanNotifications', true)) return;
      // Explicitly filter out folder watch, definitions, and custom scans from notifications
      if (scanType === 'definitions' || isBackgroundScan(scanType) || scanType === 'custom') return;
      const milestone = [0, 25, 50, 75].find((value) => data.pct >= value && !announcedProgress.has(value));
      if (milestone !== undefined) {
        announcedProgress.add(milestone);
        const files = data.filesScanned || 0;
        showNotification(t('toast.scanProgressTitle'), t('scan.progress', { files, pct: data.pct }), 'info');
      }
    });

    // Forward scan complete events to renderer
    eventBus.on('scan:complete', (data) => {
      const scanType = resolveScanType(data);
      // Clear announced progress milestones when scan completes
      announcedProgress.clear();
      if (!isBackgroundScan(scanType) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan:complete', data);
      }
      if (isBackgroundScan(scanType) || scanType === 'custom') return;

      let label;
      let body;
      let level;
      if (data.scanType === 'definitions') {
        if (data.status === 'completed') {
          label = t('toast.signaturesUpdated');
          body = t('toast.definitionsUpdatedDetail');
          level = 'success';
        } else if (data.status === 'canceled') {
          label = t('toast.definitionsUpdateCanceled');
          body = t('toast.definitionsUpdateCanceledDetail');
          level = 'warn';
        } else {
          label = t('toast.definitionsUpdateFailed');
          body = data.error || t('toast.definitionsUpdateFailedDetail');
          level = 'danger';
        }
      } else {
        // Only show notification if not canceled
        if (data.status === 'canceled') {
          label = t('toast.scanCanceled');
          body = t('toast.scanCanceledDetail', { count: data.filesScanned || 0 });
          level = 'warn';
        } else {
          label = data.status === 'completed' ? t('toast.scanCompleted') : t('toast.scanFinishedWithIssues');
          body = t('toast.scanSummary', { files: data.filesScanned || 0, threats: data.threatsFound || 0 });
          level = data.status !== 'completed' ? 'warn' : (data.threatsFound ? 'danger' : 'success');
        }
      }
      const iconOverride = (data.threatsFound && data.threatsFound > 0) ? TOAST_ICONS.threat : null;
      showNotification(label, body, level, iconOverride);
      // Auto-generate a scan report
      (async () => {
        try {
          if (!db.getSetting('feature.autoReports', true)) return;
          const isCanceled = data.status === 'canceled' || data.report?.status === 'canceled';
          if (isCanceled || (scanType !== 'quick' && scanType !== 'full')) return;
          logLine('info', 'Generating scan report...');

          const result = await toolRegistry.run('generate-security-report', { version: app.getVersion() }, { toolRegistry, db, log: logLine });
          logLine('info', 'Scan report ' + (result.ok ? 'generated' : 'failed: ' + (result.error || 'unknown')));
        } catch (err) {
          logLine('error', 'Auto-report generation threw: ' + (err.message || err));
        }
      })();
    });
  }

  // Register the scan progress listeners
  registerScanProgressListeners();

  // 4. Expose legacy utilities
  // Expose legacy utility running mechanism
  ipcMain.handle('tools:list', () => toolRegistry.list());
  ipcMain.handle('tools:run', async (event, toolId, args) => {
    // Note: appStore is removed, so we mock it for utilities if needed
    // or just let them use basic features.
    return toolRegistry.run(toolId, args, {
      toolRegistry,
      db,
      log: logLine,
      sendProgress: (payload) => {
        event.sender.send(`tools:progress:${toolId}`, payload);
      }
    });
  });

  ipcMain.handle('app:ready', () => {
    dismissSplash();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Forward progress events from the dashboard (renderer) to the splash
  ipcMain.handle('splash:progress', (_event, data) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash:progress', data);
    }
  });

  sendSplashProgress(15, t('splash.loadingDashboard'));

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
        // Expand environment variables like %SystemRoot%
        const expandedPath = process.env.SystemRoot && exePath.includes('%SystemRoot%')
          ? exePath.replace(/%SystemRoot%/gi, process.env.SystemRoot)
          : exePath;
        // Only attempt if file exists
        if (!fs.existsSync(expandedPath)) {
          _startupIconCache[exePath] = null;
          result[exePath] = null;
          continue;
        }
        const nativeImg = await app.getFileIcon(expandedPath);
        const dataUrl = nativeImg.toDataURL();
        // Validate data URL is substantial (not empty image)
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

  // Slow engine initialization (ClamAV definitions, real-time protection)
  // runs in the background after the window is already visible, instead of
  // blocking startup. scanEngine's scan handlers already check
  // clamEngine.isReady and return a graceful error if a scan is attempted
  // before this finishes, and rtp:status/rtp:toggle independently query
  // live Defender state, so nothing depends on this completing first.
  (async () => {
    try {
      await clamEngine.init();
    } catch (err) {
      logLine('error', 'ClamAV init failed', { message: err.message });
    }
    try {
      if (db.getSetting('feature.realtimeProtection', true)) {
        await realtimeWatcher.start();
      }
    } catch (err) {
      logLine('error', 'Real-time protection init failed', { message: err.message });
    }
    try {
      if (db.getSetting('feature.folderWatch', true)) {
        folderWatcher.start();
      }
    } catch (err) {
      logLine('error', 'Folder watcher init failed', { message: err.message });
    }
    try {
      if (db.getSetting('feature.networkAlerts', true)) {
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
    if (db.getSetting('feature.networkTrafficHistory', true)) {
      services.startNetworkStatsTimer();
    }
    const pruneTimer = setInterval(() => {
      try {
        db.pruneNetworkStats(7);
        db.pruneMaintenanceRuns(100);
      } catch (_) {}
    }, 60 * 60_000);
    if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
    lifecycleRefs.pruneTimer = pruneTimer;
    try {
      // systeminformation's networkStats() calculates rx_sec/tx_sec as a
      // rate between two internal samples. The very first call anywhere in
      // the process's lifetime has no prior sample to diff against and can
      // return an empty/zeroed result. This throwaway call exists only to
      // establish that baseline in the background, so the first time the
      // user actually opens the Network Monitor page, the real call already
      // has something to diff against and returns populated data immediately
      // instead of requiring a second visit to "warm up".
      await networkMonitor.getStats();
    } catch (err) {
      logLine('error', 'Network stats warm-up failed', { message: err.message });
    }
  })();
});

process.on('uncaughtException', (err) => {
  logLine('fatal', 'Uncaught exception', { message: err.message, stack: err.stack });
});

process.on('unhandledRejection', (err) => {
  logLine('fatal', 'Unhandled rejection', { message: err && err.message ? err.message : String(err), stack: err && err.stack });
});

app.on('before-quit', () => {
  isQuitting = true;
  lifecycleRefs.maintenanceScheduler?.stop();
  lifecycleRefs.trayController?.dispose();
  if (lifecycleRefs.networkStatsTimer) clearInterval(lifecycleRefs.networkStatsTimer);
  if (lifecycleRefs.pruneTimer) clearInterval(lifecycleRefs.pruneTimer);
  try {
    if (dbRef?.db && typeof dbRef.db.close === 'function') dbRef.db.close();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (lifecycleRefs.trayController?.tray) return;
  if (process.platform !== 'darwin') app.quit();
});