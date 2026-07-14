const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});

// Keep legacy namespace for compatibility with some utilities that weren't modified
contextBridge.exposeInMainWorld('soterios', {
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    run: (toolId, args) => ipcRenderer.invoke('tools:run', toolId, args),
    onProgress: (toolId, callback) => {
      const channel = `tools:progress:${toolId}`;
      const listener = (event, payload) => callback(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
    pickFiles: () => ipcRenderer.invoke('dialog:pickFiles')
  },
  shell: {
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  startup: {
    getIcons: (exePaths) => ipcRenderer.invoke('startup:getIcons', exePaths),
    toggle: (item, enable) => ipcRenderer.invoke('startup:toggle', item, enable)
  },
  process: {
    getIcons: (exePaths) => ipcRenderer.invoke('process:getIcons', exePaths)
  }
});
