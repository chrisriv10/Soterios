const { ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

function register(mainWindow, { processInspector }) {
  ipcMain.handle('process:list', async () => {
    return processInspector.getProcesses();
  });

  ipcMain.handle('process:kill', async (_event, pid) => {
    return processInspector.killProcess(pid);
  });

  ipcMain.handle('process:runTask', async (_event, command) => {
    return new Promise((resolve, reject) => {
      if (!command || typeof command !== 'string' || !command.trim()) {
        return reject(new Error('Invalid command'));
      }

      try {
        const args = command.trim().split(/\s+/);
        const cmd = args[0];
        const cmdArgs = args.slice(1);

        const child = spawn(cmd, cmdArgs, {
          detached: true,
          stdio: 'ignore',
          shell: true
        });

        child.unref();
        resolve({ success: true });
      } catch (err) {
        reject(err);
      }
    });
  });

  ipcMain.handle('process:showProperties', async (_event, filePath) => {
    return new Promise((resolve, reject) => {
      if (!filePath || typeof filePath !== 'string') {
        return reject(new Error('Invalid file path'));
      }

      try {
        spawn('powershell.exe', [
          '-NoProfile',
          '-Command',
          `Invoke-Item -LiteralPath "${filePath.replace(/"/g, '\\"')}" -ErrorAction Stop`
        ], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        resolve({ success: true });
      } catch (err) {
        reject(err);
      }
    });
  });

  ipcMain.handle('process:searchOnline', async (_event, query) => {
    return new Promise((resolve, reject) => {
      if (!query || typeof query !== 'string') {
        return reject(new Error('Invalid search query'));
      }

      try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        shell.openExternal(searchUrl);
        resolve({ success: true });
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { register };
