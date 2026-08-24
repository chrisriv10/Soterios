'use strict';

const { Tray, BrowserWindow, nativeImage, screen, Menu } = require('electron');
const path = require('path');

const TRAY_WIDTH = 320;
const TRAY_HEIGHT = 220;
const TRAY_MARGIN = 8;

function createTrayIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.ico');
  return nativeImage.createFromPath(iconPath);
}

function positionTrayWindow(tray, trayWindow) {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { workArea } = display;
  const effectiveWidth = Math.min(TRAY_WIDTH, Math.max(1, workArea.width - TRAY_MARGIN * 2));
  const effectiveHeight = Math.min(TRAY_HEIGHT, Math.max(1, workArea.height - TRAY_MARGIN * 2));
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - effectiveWidth / 2);
  let y = Math.round(trayBounds.y - effectiveHeight - TRAY_MARGIN);
  x = Math.max(workArea.x + TRAY_MARGIN, Math.min(x, workArea.x + workArea.width - effectiveWidth - TRAY_MARGIN));
  y = Math.max(workArea.y + TRAY_MARGIN, Math.min(y, workArea.y + workArea.height - effectiveHeight - TRAY_MARGIN));
  trayWindow.setBounds({ x, y, width: effectiveWidth, height: effectiveHeight }, false);
}

function initTrayDashboard({ app, mainWindow, getSummary, vpnManager, db, i18n }) {
  let tray = null;
  let trayWindow = null;
  let vpnUpdateInterval = null;

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

  const updateVpnMenu = async () => {
    if (!vpnManager || !tray) return;
    try {
      const lastProfile = db.getSetting('vpn.lastProfile');
      if (!lastProfile) {
        // No last profile - show "No VPN configured"
        const contextMenu = Menu.buildFromTemplate([
          { label: 'Open Soterios', click: showMain },
          { type: 'separator' },
          {
            label: 'Network',
            submenu: [
              { label: i18n.t('tray.vpnNoProfile'), enabled: false },
              { type: 'separator' },
              { label: i18n.t('tray.openVPNSettings'), click: () => { showMain(); mainWindow.webContents.send('navigate-to-network'); } },
            ]
          },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() }
        ]);
        tray.setContextMenu(contextMenu);
        return;
      }

      // Get status of last profile
      const status = await vpnManager.getStatus(lastProfile);
      const isConnected = status.ok && status.connected;
      const statusIcon = isConnected ? '●' : '○';
      const profileLabel = `${i18n.t('tray.vpnLabel')}: ${statusIcon} ${lastProfile}`;

      const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Soterios', click: showMain },
        { type: 'separator' },
        {
          label: 'Network',
          submenu: [
            {
              label: profileLabel,
              click: async () => {
                try {
                  await vpnManager.toggleLast();
                  await refreshTrayWindow();
                  // Update menu after toggle
                  setTimeout(updateVpnMenu, 500);
                } catch (_) {}
              }
            },
            { type: 'separator' },
            { label: i18n.t('tray.openVPNSettings'), click: () => { showMain(); mainWindow.webContents.send('navigate-to-network'); } },
          ]
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ]);
      tray.setContextMenu(contextMenu);
    } catch (_) {
      // Ignore errors in menu update
    }
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
    trayWindow.show();
    await refreshTrayWindow();
    await updateVpnMenu();
    if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) {
      trayWindow.focus();
    }
  });

  tray.on('double-click', showMain);

  // Initial context menu
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Soterios', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  // Update VPN menu periodically when tray is open
  tray.on('click', async () => {
    if (trayWindow.isVisible()) {
      await updateVpnMenu();
    }
  });

  return {
    tray,
    trayWindow,
    refreshTrayWindow,
    updateVpnMenu,
    dispose: () => {
      hideTrayWindow();
      if (vpnUpdateInterval) clearInterval(vpnUpdateInterval);
      if (tray) tray.destroy();
      if (trayWindow && !trayWindow.isDestroyed()) trayWindow.destroy();
    }
  };
}

module.exports = { initTrayDashboard };