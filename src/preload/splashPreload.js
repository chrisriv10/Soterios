const { contextBridge, ipcRenderer } = require('electron');

/**
 * Splash window preload script.
 *
 * Exposes a minimal IPC surface for splash progress events.
 */

contextBridge.exposeInMainWorld('api', {
  on: (channel, callback) => {
    /**
     * IPC event listener wrapper that strips the Electron event argument.
     */
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
