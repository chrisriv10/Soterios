const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Ensure Chromium/Electron uses a writable data/cache location instead of
// falling back to a restricted or temp-based path on Windows.
try {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const defaultUserDataPath = path.join(appDataRoot, 'Soterios');
  const userDataPath = process.env.SOTERIOS_USERDATA || defaultUserDataPath;
  const cacheDir = path.join(userDataPath, 'cache');
  const tempDir = path.join(userDataPath, 'temp');

  for (const dirPath of [userDataPath, cacheDir, tempDir]) {
    try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) { }
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

const ClamAVEngine = require('../security/ClamAVEngine');
const HeuristicEngine = require('../security/HeuristicEngine');
const ReputationEngine = require('../security/ReputationEngine');
const QuarantineManager = require('../security/QuarantineManager');
const ScanEngine = require('../security/ScanEngine');
const RealTimeWatcher = require('../security/RealTimeWatcher');
const ProcessInspector = require('../security/ProcessInspector');
const SystemAudit = require('../security/SystemAudit');
const FirewallManager = require('../security/FirewallManager');
const NetworkMonitor = require('../security/NetworkMonitor');
const { ProcessResolver } = require('../security/ProcessResolver');
const { BlocklistService } = require('../security/BlocklistService');
const { NetworkEnricher } = require('../security/NetworkEnricher');

// Legacy utilities
const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../core/toolRegistry');

let mainWindow;
let splashWindow;
let splashTimeoutId;
let dbRef; // set once the database is created in app.whenReady() below, so
           // showNotification (defined before that point) can check settings

function logLine(level, message, meta) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, meta: meta || null }) + '\n';
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'soterios.log'), line);
  } catch (_) { }
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
const TOAST_WIDTH = 360;
const TOAST_HEIGHT = 96;
const TOAST_MARGIN = 16;
const TOAST_GAP = 10;
const TOAST_LIFETIME_MS = 6000;

// Toast HTML is loaded via a data: URL, which has no filesystem base to
// resolve a relative image path against -- so the logo is embedded directly
// as a base64 PNG instead of referenced by path. Computed once and cached
// since it never changes.
let cachedToastLogoDataUri = null;
function getToastLogoDataUri() {
  if (cachedToastLogoDataUri !== null) return cachedToastLogoDataUri;
  try {
    const png = createIcon().resize({ width: 20, height: 20 }).toPNG();
    cachedToastLogoDataUri = `data:image/png;base64,${png.toString('base64')}`;
  } catch (_) {
    cachedToastLogoDataUri = '';
  }
  return cachedToastLogoDataUri;
}

const TOAST_ACCENTS = {
  info: '#4fc3d9',
  success: '#3ddc97',
  warn: '#e8b339',
  danger: '#e85f5c'
};

function escToastHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function toastHtml(title, body, level) {
  const accent = TOAST_ACCENTS[level] || TOAST_ACCENTS.info;
  const logoDataUri = getToastLogoDataUri();
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; user-select:none; }
  .toast {
    box-sizing: border-box;
    position: relative;
    width: ${TOAST_WIDTH}px;
    min-height: ${TOAST_HEIGHT}px;
    display:flex; align-items:flex-start; gap:12px;
    padding:14px 40px 14px 16px;
    background: rgba(20, 26, 33, 0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-left: 3px solid ${accent};
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.45);
    font-family: 'Segoe UI', -apple-system, sans-serif;
    color: #e6edf3;
    cursor: pointer;
    animation: toastIn 220ms ease-out;
  }
  .toast.closing { animation: toastOut 200ms ease-in forwards; }
  @keyframes toastIn { from { transform: translateX(24px); opacity:0; } to { transform: translateX(0); opacity:1; } }
  @keyframes toastOut { from { transform: translateX(0); opacity:1; } to { transform: translateX(24px); opacity:0; } }
  .icon { flex-shrink:0; width:20px; height:20px; margin-top:2px; color: ${accent}; }
  .content { flex:1; min-width:0; }
  .brand { font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:#7d8a99; margin-bottom:3px; font-weight:600; }
  .title { font-size:13.5px; font-weight:600; color:#f2f5f8; margin-bottom:3px; }
  .body { font-size:12.5px; color:#aab4bf; line-height:1.4; word-wrap:break-word; }
  .top-right { position:absolute; top:10px; right:10px; display:flex; align-items:center; gap:8px; }
  .logo { width:16px; height:16px; border-radius:4px; display:block; }
  .close { flex-shrink:0; color:#5b6672; font-size:16px; line-height:1; padding:2px; }
  .close:hover { color:#aab4bf; }
</style></head>
<body>
  <div class="toast" id="toast">
    <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
    <div class="content">
      <div class="brand">Soterios</div>
      <div class="title">${escToastHtml(title)}</div>
      <div class="body">${escToastHtml(body)}</div>
    </div>
    <div class="top-right">
      ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="" />` : ''}
      <div class="close" id="closeBtn">&times;</div>
    </div>
  </div>
  <script>
    const toast = document.getElementById('toast');
    function dismiss() {
      toast.classList.add('closing');
      setTimeout(() => { window.close(); }, 200);
    }
    document.getElementById('closeBtn').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    toast.addEventListener('click', dismiss);
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

function showNotification(title, body, level = 'info') {
  // Previously fired unconditionally regardless of the Settings toggle --
  // this was the same "flag saved but never read" bug found earlier with
  // System Monitoring.
  if (dbRef && !dbRef.getSetting('feature.notificationsEnabled', true)) return;
  try {
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
        sandbox: true
      }
    });
    toastWindow.setAlwaysOnTop(true, 'screen-saver');
    toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toastHtml(title, body, level)));
    toastWindow.once('ready-to-show', () => toastWindow.show());
    toastWindow.on('closed', () => {
      const idx = activeToasts.indexOf(toastWindow);
      if (idx !== -1) activeToasts.splice(idx, 1);
      repositionToasts();
    });
    activeToasts.push(toastWindow);
    repositionToasts();
  } catch (_) {}
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#0e1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, '../ui/pages/splash.html'));
  splashWindow.once('ready-to-show', () => {
    if (splashWindow) splashWindow.show();
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
    backgroundColor: '#0e1117',
    title: 'Soterios',
    icon: createIcon(),   
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/pages/shell.html'));

  // Intentionally no auto-show on 'ready-to-show' here -- the window stays
  // hidden until the renderer signals it has actually finished loading data
  // (see the 'app:ready' handler below), so the splash screen covers the
  // whole load instead of just the initial blank-page flash. A fallback
  // timeout guarantees the window still appears even if that signal is
  // delayed or never arrives (e.g. an unexpected renderer error).
  splashTimeoutId = setTimeout(dismissSplash, 8000);

  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
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

app.whenReady().then(async () => {
  // Show the splash screen immediately, before any backend setup, so the
  // user sees something the instant the app launches rather than a blank
  // taskbar entry with no window at all.
  createSplashWindow();

  logLine('info', 'App starting');

  // 1. Database
  const dbPath = path.join(app.getPath('userData'), 'soterios.db');
  const db = new DatabaseService(dbPath);
  dbRef = db;

  // Migrate old feature.systemMonitoring key to feature.externalLookups
  const oldVal = db.getSetting('feature.systemMonitoring', null);
  if (oldVal !== null) {
    const newVal = db.getSetting('feature.externalLookups', null);
    if (newVal === null) db.setSetting('feature.externalLookups', oldVal);
    db.setSetting('feature.systemMonitoring', null);
  }

  // 2. Security Engines (Dependency Injection)
  const clamEngine = new ClamAVEngine({
    dbDir: path.join(app.getPath('userData'), 'clamav-db')
  });
  const heuristicEngine = new HeuristicEngine();
  const reputationEngine = new ReputationEngine(db);
  const quarantineManager = new QuarantineManager(db);

  const scanEngine = new ScanEngine(
    db,
    eventBus,
    clamEngine,
    heuristicEngine,
    reputationEngine,
    quarantineManager
  );

  const realtimeWatcher = new RealTimeWatcher(db, eventBus, scanEngine);
  const processInspector = new ProcessInspector();
  const systemAudit = new SystemAudit();
  const firewallManager = new FirewallManager();
  const networkMonitor = new NetworkMonitor();

  const processResolver = new ProcessResolver(processInspector);
  const blocklistService = new BlocklistService(db);
  const networkEnricher = new NetworkEnricher(processResolver, blocklistService);

  // loadPlugins() is a synchronous filesystem scan, not a network call, so
  // it's cheap enough to keep here rather than deferring it.
  loadPlugins();

  const services = {
    db,
    eventBus,
    clamEngine,
    heuristicEngine,
    reputationEngine,
    quarantineManager,
    scanEngine,
    realtimeWatcher,
    processInspector,
    systemAudit,
    firewallManager,
    networkMonitor,
    processResolver,
    blocklistService,
    networkEnricher,
    toolRegistry
  };

  // Show the window as soon as possible instead of waiting on ClamAV/RTP
  // initialization below -- those can take a while (definitions download,
  // spawning PowerShell) and previously blocked the window from appearing
  // at all until they finished.
  buildAppMenu();
  createWindow();

  // Register IPC handlers only once mainWindow actually exists. Previously
  // this ran before createWindow(), so the mainWindow parameter passed in
  // was always undefined (a plain variable copied by value at call time) --
  // handlers like dialog:pickFolder/pickFiles silently fell back to
  // BrowserWindow.getFocusedWindow() instead of targeting the real window.
  registerIpcHandlers(mainWindow, services);

  // Forward scan progress events from EventBus to renderer
  const announcedProgress = new Set();
  eventBus.on('scan:progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', data);
    }
    if (!data || typeof data.pct !== 'number') return;
    const milestone = [0, 25, 50, 75].find((value) => data.pct >= value && !announcedProgress.has(value));
    if (milestone !== undefined) {
      announcedProgress.add(milestone);
      showNotification('Soterios scan progress', data.message || `Scan is ${milestone}% complete.`, 'info');
    }
  });

  // Forward scan complete events to renderer
  eventBus.on('scan:complete', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:complete', data);
    }
    announcedProgress.clear();
    let label;
    let body;
    let level;
    if (data && data.scanType === 'definitions') {
      label = data.status === 'completed' ? 'Signatures updated' : data.status === 'canceled' ? 'Definitions update canceled' : 'Definitions update failed';
      body = data.status === 'completed'
        ? 'ClamAV signatures are up to date.'
        : data.error || 'ClamAV signature update failed.';
      level = data.status === 'completed' ? 'success' : data.status === 'canceled' ? 'warn' : 'danger';
    } else {
      label = data.status === 'completed' ? 'Scan completed' : data.status === 'canceled' ? 'Scan canceled' : 'Scan finished with issues';
      body = `${data.filesScanned || 0} file(s) scanned, ${data.threatsFound || 0} threat(s) found.`;
      level = data.status !== 'completed' ? 'warn' : (data.threatsFound ? 'warn' : 'success');
    }
    showNotification(label, body, level);
    // Auto-generate a scan report
    (async () => {
      try {
        if (!db.getSetting('feature.autoReports', true)) return;
        logLine('info', 'Generating scan report...');
        const result = await toolRegistry.run('generate-security-report', { version: app.getVersion() }, { toolRegistry, db, log: logLine });
        logLine('info', 'Scan report ' + (result.ok ? 'generated' : 'failed: ' + (result.error || 'unknown')));
      } catch (err) {
        logLine('error', 'Auto-report generation threw: ' + (err.message || err));
      }
    })();
  });

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
      await blocklistService.refreshAll();
    } catch (err) {
      logLine('error', 'Blocklist refresh failed', { message: err.message });
    }
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});