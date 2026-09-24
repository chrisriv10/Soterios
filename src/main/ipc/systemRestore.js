const { ipcMain } = require('electron');

const ALLOWED_CHANNELS = ['systemRestore:list', 'systemRestore:create'];

function register(mainWindow, { systemRestoreManager }) {
  if (!systemRestoreManager) {
    throw new Error('systemRestore IPC requires a systemRestoreManager.');
  }

  ipcMain.handle('systemRestore:list', async () => {
    return systemRestoreManager.listRestorePoints();
  });

  ipcMain.handle('systemRestore:create', async (_event, payload) => {
    const description = payload && typeof payload.description === 'string'
      ? payload.description
      : payload;
    return systemRestoreManager.createRestorePoint(description);
  });
}

module.exports = { register, ALLOWED_CHANNELS };
