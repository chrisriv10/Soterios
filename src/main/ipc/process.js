const { ipcMain } = require('electron');
const { validateArgs } = require('./validate');

function register(mainWindow, { processInspector }) {
  ipcMain.handle('process:list', async () => {
    return processInspector.getProcesses();
  });

  ipcMain.handle('process:kill', async (_event, pid) => {
    validateArgs([
      { name: 'pid', type: 'number', required: true, min: 1 },
    ], [pid]);
    return processInspector.killProcess(pid);
  });
}

module.exports = { register };
