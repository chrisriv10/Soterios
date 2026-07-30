const { ipcMain } = require('electron');

function register(mainWindow, { processInspector }) {
  ipcMain.handle('process:list', async () => {
    return processInspector.getProcesses();
  });

  ipcMain.handle('process:kill', async (_event, pid) => {
    return processInspector.killProcess(pid);
  });
}

module.exports = { register };
