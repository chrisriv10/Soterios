const { contextBridge, ipcRenderer } = require('electron');

/**
 * Toast window preload script.
 *
 * Exposes a minimal IPC surface for toast navigation events.
 */

contextBridge.exposeInMainWorld('toastApi', {
  navigateToScanner: () => ipcRenderer.send('toast:navigate-scanner')
});
