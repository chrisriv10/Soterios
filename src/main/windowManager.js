'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');
const { TOAST_THEMES, resolveThemeName, themeBackground } = require('../utils/themes');
const i18n = require('../i18n');
const { renderTemplate } = require('../utils/templates');

// Module-level state (shared across exported functions).
let dbRef = null;
let featureFlags = null;
let currentUiTheme = 'dark';
let startupLocale = 'en';
let logLine = (level, message, meta) => { const fn = logger[level] || logger.info; fn(message, meta || undefined); };
let t = (key, vars) => i18n.t(key, i18n.normalizeLocale(startupLocale), vars);

let mainWindow = null;
let splashWindow = null;
let splashTimeoutId = null;

function init({ dbRef: db, featureFlags: ff, currentUiTheme: theme, startupLocale: locale, logLine: ll, t: translator }) {
  dbRef = db;
  featureFlags = ff;
  currentUiTheme = theme;
  startupLocale = locale;
  logLine = ll || logLine;
  t = translator || t;
}

// Active toast windows stacked bottom-right.
const activeToasts = [];
const TOAST_WIDTH = 380;
const TOAST_HEIGHT = 180;
const TOAST_MARGIN = 16;
const TOAST_GAP = 10;
const TOAST_LIFETIME_MS = 6000;

const TOAST_ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v5"/><path d="M12 7.5h.01"/>',
  success: '<path d="M5 13l4 4L19 7"/>',
  warn: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.7 18a1 1 0 0 0 .9 1.5h16.8a1 1 0 0 0 .9-1.5L13.7 3.9a1.6 1.6 0 0 0-2.8 0z"/>',
  danger: '<path d="M15 9l-6 6"/><path d="M9 9l6 6"/><circle cx="12" cy="12" r="9"/>',
  threat: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.3 18.3l-2.1-2.1"/><path d="M18.3 5.6l-2.1 2.1"/><path d="M5.6 18.3l2.1-2.1"/><circle cx="10" cy="10" r=".5"/><circle cx="14.5" cy="10.5" r=".5"/><circle cx="13" cy="14.5" r=".5"/><circle cx="9.5" cy="14" r=".5"/>'
};

function escToastHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[ch]));
}

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

function toastHtml(title, body, level, themeName, iconOverride = null) {
  const theme = TOAST_THEMES[themeName] || TOAST_THEMES.dark;
  const accent = theme.accents[level] || theme.accents.info;
  const iconPaths = iconOverride || TOAST_ICONS[level] || TOAST_ICONS.info;
  const markDataUri = getToastMarkDataUri();
  const wordmarkDataUri = getToastWordmarkDataUri();
  return renderTemplate(path.join(__dirname, '..', 'ui', 'templates', 'toast.html'), {
    TOAST_WIDTH: TOAST_WIDTH,
    THEME_BG: theme.bg,
    THEME_BORDER: theme.border,
    ACCENT: accent,
    THEME_TEXT_MAIN: theme.textMain,
    THEME_CLOSE_BTN: theme.closeBtn,
    THEME_CLOSE_HOVER: theme.closeHover,
    THEME_TEXT_MUTED: theme.textMuted,
    MARK_DATA_URI: markDataUri ? `<img class="mark" src="${markDataUri}" alt="" />` : '',
    WORDMARK_DATA_URI: wordmarkDataUri ? `<img class="wordmark" src="${wordmarkDataUri}" alt="" />` : '<span class="wordmark-fallback">Soterios</span>',
    ICON_PATHS: iconPaths,
    TITLE: escToastHtml(title),
    BODY: escToastHtml(body),
    LIFETIME_MS: TOAST_LIFETIME_MS,
  });
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
  if (dbRef && featureFlags && !featureFlags.getFlag(dbRef, 'notificationsEnabled', true)) return;
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
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, '../preload/toastPreload.js')
      }
    });
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
    activeToasts.push(toastWindow);
    repositionToasts();
  } catch (err) {
    logLine('debug', 'Toast creation failed', { error: err.message });
  }
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
  splashWindow.loadFile(path.join(__dirname, '../ui/pages/splash.html'), { query: { theme } });
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  return splashWindow;
}

function sendSplashProgress(splashWindow, pct, label) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:progress', { pct, label });
  }
}

function dismissSplash(mainWindowArg, splashWindowArg, splashTimeoutIdArg) {
  const timeout = splashTimeoutIdArg ?? splashTimeoutId;
  if (timeout) {
    clearTimeout(timeout);
  }
  const main = mainWindowArg ?? mainWindow;
  const splash = splashWindowArg ?? splashWindow;
  if (main && !main.isDestroyed()) {
    main.show();
  }
  if (splash && !splash.isDestroyed()) {
    splash.close();
  }
}

function createIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.ico');
  return nativeImage.createFromPath(iconPath);
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
    return { mainWindow, splashTimeoutId: null };
  }
  if (screenshotConfig) {
    mainWindow.loadFile(shellHtmlPath, { hash: screenshotConfig.page });
    scheduleScreenshotCapture(mainWindow, screenshotConfig);
  } else {
    mainWindow.loadFile(shellHtmlPath);
  }

  splashTimeoutId = setTimeout(() => dismissSplash(mainWindow, splashWindow, splashTimeoutId), 8000);

  if ((process.argv.includes('--dev') || process.env.NODE_ENV === 'development') && !isScreenshotCaptureMode()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }

  return { mainWindow, splashTimeoutId };
}

function buildAppMenu(mainWindow) {
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
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
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
  return { page, outPath, runUninstaller: process.argv.includes('--screenshot-run-uninstaller') };
}

function failScreenshotCapture(message) {
    logLine('error', message);
  app.exit(1);
}

function scheduleScreenshotCapture(win, config) {
  win.webContents.once('did-finish-load', () => {
    dismissSplash(win, null, null);
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

module.exports = {
  init,
  createSplashWindow,
  sendSplashProgress,
  dismissSplash,
  createWindow,
  buildAppMenu,
  showNotification,
  repositionToasts,
  toastHtml,
  escToastHtml,
  getToastMarkDataUri,
  getToastWordmarkDataUri,
  readPngAsDataUri,
  scheduleScreenshotCapture,
  failScreenshotCapture,
  getScreenshotConfig,
  isScreenshotCaptureMode,
  createIcon,
  activeToasts,
  TOAST_WIDTH,
  TOAST_HEIGHT,
  TOAST_MARGIN,
  TOAST_GAP,
  TOAST_LIFETIME_MS,
  TOAST_ICONS,
};
