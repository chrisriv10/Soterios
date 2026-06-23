const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soterios', {
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    run: (toolId, args) => ipcRenderer.invoke('tools:run', toolId, args),
    onProgress: (toolId, callback) => {
      const channel = `tools:progress:${toolId}`;
      const listener = (event, payload) => callback(payload);
      ipcRenderer.on(channel, listener);
      // return an unsubscribe fn
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
    pickFiles: () => ipcRenderer.invoke('dialog:pickFiles')
  },
  shell: {
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
  },
  store: {
    snapshot: () => ipcRenderer.invoke('store:snapshot'),
    settings: () => ipcRenderer.invoke('store:settings'),
    updateSettings: (patch) => ipcRenderer.invoke('store:updateSettings', patch),
    history: (kind, limit) => ipcRenderer.invoke('store:history', kind, limit),
    quarantine: () => ipcRenderer.invoke('store:quarantine')
  }
});
