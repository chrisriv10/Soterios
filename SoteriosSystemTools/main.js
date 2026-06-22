const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');

const pluginLoader = require('./src/core/pluginLoader');
const toolRegistry = require('./src/core/toolRegistry');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0e1117',
    title: 'Soterios System Tools',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/ui/pages/shell.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  // Discover and register all tool plugins before the UI asks for them
  await pluginLoader.loadAll();

  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const aboutHandler = () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'About Soterios System Tools',
      message: 'Soterios System Tools',
      detail:
        `Version ${app.getVersion()}\n\n` +
        'A local-first desktop toolkit for system maintenance, monitoring, ' +
        'and basic security checks.\n\n' +
        'This app does not collect, transmit, or upload any data. All ' +
        'scanning and analysis happens entirely on this device.\n\n' +
        'The file scanner is a local heuristic/signature tool, not a ' +
        'replacement for dedicated antivirus software.',
      buttons: ['OK']
    });
  };

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { label: 'About Soterios System Tools', click: aboutHandler },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }]
      : []),
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
        ...(isMac ? [] : [{ label: 'About Soterios System Tools', click: aboutHandler }]),
        {
          label: 'Quarantine Folder',
          click: () => shell.openPath(path.join(require('os').homedir(), '.soterios-quarantine'))
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------------------------------------------------------------- */
/* IPC: generic tool registry bridge                                      */
/* ---------------------------------------------------------------------- */

ipcMain.handle('tools:list', () => {
  return toolRegistry.list();
});

ipcMain.handle('tools:run', async (event, toolId, args) => {
  return toolRegistry.run(toolId, args, {
    sendProgress: (payload) => {
      event.sender.send(`tools:progress:${toolId}`, payload);
    }
  });
});

/* ---------------------------------------------------------------------- */
/* IPC: native dialogs                                                    */
/* ---------------------------------------------------------------------- */

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:pickFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('shell:showItemInFolder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});
