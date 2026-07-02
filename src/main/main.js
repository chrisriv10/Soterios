const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, Notification } = require('electron');
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

// Legacy utilities
const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../core/toolRegistry');

let mainWindow;

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

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, icon: createIcon() }).show();
  } catch (_) {}
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
  logLine('info', 'App starting');

  // 1. Database
  const dbPath = path.join(app.getPath('userData'), 'soterios.db');
  const db = new DatabaseService(dbPath);

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
      showNotification('Soterios scan progress', data.message || `Scan is ${milestone}% complete.`);
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
    if (data && data.scanType === 'definitions') {
      label = data.status === 'completed' ? 'Signatures updated' : data.status === 'canceled' ? 'Definitions update canceled' : 'Definitions update failed';
      body = data.status === 'completed'
        ? 'ClamAV signatures are up to date.'
        : data.error || 'ClamAV signature update failed.';
    } else {
      label = data.status === 'completed' ? 'Scan completed' : data.status === 'canceled' ? 'Scan canceled' : 'Scan finished with issues';
      body = `${data.filesScanned || 0} file(s) scanned, ${data.threatsFound || 0} threat(s) found.`;
    }
    showNotification(label, body);
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