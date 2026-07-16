'use strict';

const { Tray, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('path');

const TRAY_WIDTH = 320;
const TRAY_HEIGHT = 220;

function createTrayIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.ico');
  return nativeImage.createFromPath(iconPath);
}

function positionTrayWindow(tray, trayWindow) {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { workArea } = display;
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - TRAY_WIDTH / 2);
  const y = Math.round(Math.max(workArea.y + 8, trayBounds.y - TRAY_HEIGHT - 8));
  trayWindow.setBounds({ x, y, width: TRAY_WIDTH, height: TRAY_HEIGHT }, false);
}

function initTrayDashboard({ app, mainWindow, getSummary }) {
  let tray = null;
  let trayWindow = null;

  const showMain = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const hideTrayWindow = () => {
    if (trayWindow && !trayWindow.isDestroyed()) trayWindow.hide();
  };

  const refreshTrayWindow = async () => {
    if (!trayWindow || trayWindow.isDestroyed() || !trayWindow.isVisible()) return;
    try {
      const summary = await getSummary();
      trayWindow.webContents.send('tray:summary', summary);
    } catch (_) {}
  };

  tray = new Tray(createTrayIcon());
  tray.setToolTip('Soterios');

  trayWindow = new BrowserWindow({
    width: TRAY_WIDTH,
    height: TRAY_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  trayWindow.loadFile(path.join(__dirname, '../ui/pages/trayDashboard.html'));
  trayWindow.on('blur', hideTrayWindow);

  tray.on('click', async () => {
    if (trayWindow.isVisible()) {
      hideTrayWindow();
      return;
    }
    positionTrayWindow(tray, trayWindow);
    await refreshTrayWindow();
    trayWindow.show();
    trayWindow.focus();
  });

  tray.on('double-click', showMain);

  const contextMenu = require('electron').Menu.buildFromTemplate([
    { label: 'Open Soterios', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  return {
    tray,
    trayWindow,
    refreshTrayWindow,
    dispose: () => {
      hideTrayWindow();
      if (tray) tray.destroy();
      if (trayWindow && !trayWindow.isDestroyed()) trayWindow.destroy();
    }
  };
}

module.exports = { initTrayDashboard };
