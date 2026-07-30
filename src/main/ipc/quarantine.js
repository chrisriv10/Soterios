const { ipcMain } = require('electron');

function register(mainWindow, { quarantineManager }) {
  ipcMain.handle('quarantine:restore', async (_event, id) => {
    return quarantineManager.restore(id);
  });

  ipcMain.handle('quarantine:delete', async (_event, id) => {
    return quarantineManager.delete(id);
  });
}

module.exports = { register };
