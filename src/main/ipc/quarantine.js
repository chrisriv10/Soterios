const { ipcMain } = require('electron');
const { validateArgs } = require('./validate');

function register(mainWindow, { quarantineManager }) {
  ipcMain.handle('quarantine:restore', async (_event, id) => {
    validateArgs([
      { name: 'id', type: 'number', required: true, min: 1 },
    ], [id]);
    return quarantineManager.restore(id);
  });

  ipcMain.handle('quarantine:delete', async (_event, id) => {
    validateArgs([
      { name: 'id', type: 'number', required: true, min: 1 },
    ], [id]);
    return quarantineManager.delete(id);
  });
}

module.exports = { register };
