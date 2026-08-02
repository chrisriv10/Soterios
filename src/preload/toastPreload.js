const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastApi', {
  navigateToScanner: () => ipcRenderer.send('toast:navigate-scanner')
});
