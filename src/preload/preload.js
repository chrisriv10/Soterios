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
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  startup: {
    getIcons: (exePaths) => ipcRenderer.invoke('startup:getIcons', exePaths),
    toggle: (item, enable) => ipcRenderer.invoke('startup:toggle', item, enable)
  },
  process: {
    getIcons: (exePaths) => ipcRenderer.invoke('process:getIcons', exePaths),
    runTask: (command) => ipcRenderer.invoke('process:runTask', command),
    showProperties: (filePath) => ipcRenderer.invoke('process:showProperties', filePath),
    searchOnline: (query) => ipcRenderer.invoke('process:searchOnline', query)
  },
  lockdown: {
    getStatus: () => ipcRenderer.invoke('lockdown:getStatus'),
    activate: () => ipcRenderer.invoke('lockdown:activate'),
    restore: () => ipcRenderer.invoke('lockdown:restore'),
    getAllowlist: () => ipcRenderer.invoke('lockdown:getAllowlist'),
    setAllowlist: (allowlist) => ipcRenderer.invoke('lockdown:setAllowlist', allowlist),
    addToAllowlist: (type, value) => ipcRenderer.invoke('lockdown:addToAllowlist', type, value),
    removeFromAllowlist: (type, value) => ipcRenderer.invoke('lockdown:removeFromAllowlist', type, value),
    getInterfaces: () => ipcRenderer.invoke('lockdown:getInterfaces'),
    getServices: () => ipcRenderer.invoke('lockdown:getServices'),
    getLocalIPs: () => ipcRenderer.invoke('lockdown:getLocalIPs')
  },
  browserExtension: {
    installNativeHost: () => ipcRenderer.invoke('browserExtension:installNativeHost'),
    setExtensionId: (extId) => ipcRenderer.invoke('browserExtension:setExtensionId', extId)
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    chat: (messages, model) => ipcRenderer.invoke('ai:chat', { messages, model }),
    cancel: (requestId) => ipcRenderer.invoke('ai:chat:cancel', requestId),
    getConfig: () => ipcRenderer.invoke('ai:config:get'),
    setConfig: (config) => ipcRenderer.invoke('ai:config:set', config),
    onChunk: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('ai:chat:chunk', listener);
      return () => ipcRenderer.removeListener('ai:chat:chunk', listener);
    }
  }
});
