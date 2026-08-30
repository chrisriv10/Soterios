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
    start: (toolId, args, options) => ipcRenderer.invoke('tools:start', toolId, args, options),
    cancel: (runId) => ipcRenderer.invoke('tools:cancel', runId),
    getActive: () => ipcRenderer.invoke('tools:getActive'),
    getHistory: (limit, toolId) => ipcRenderer.invoke('tools:getHistory', limit, toolId),
    onRunProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('tools:progress', listener);
      return () => ipcRenderer.removeListener('tools:progress', listener);
    },
    onRunComplete: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('tools:complete', listener);
      return () => ipcRenderer.removeListener('tools:complete', listener);
    },
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
    openFolder: (filePath) => ipcRenderer.invoke('shell:openFolder', filePath),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPowerShell: (context) => ipcRenderer.invoke('shell:openPowerShell', context),
    openControlPanel: (command) => ipcRenderer.invoke('shell:openControlPanel', command),
    openWindowsUtility: (utility) => ipcRenderer.invoke('shell:openWindowsUtility', utility)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  startup: {
    getIcons: (exePaths) => ipcRenderer.invoke('startup:getIcons', exePaths),
    toggle: (item, enable) => ipcRenderer.invoke('startup:toggle', item, enable),
    listDisabled: () => ipcRenderer.invoke('startup:listDisabled')
  },
  vault: {
    list: () => ipcRenderer.invoke('vault:list'),
    stage: (items, options) => ipcRenderer.invoke('vault:stage', items, options),
    restore: (id) => ipcRenderer.invoke('vault:restore', id),
    purge: (id) => ipcRenderer.invoke('vault:purge', id),
    deleteLog: (id) => ipcRenderer.invoke('vault:deleteLog', id),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('vault:progress', listener);
      return () => ipcRenderer.removeListener('vault:progress', listener);
    }
  },
  persistence: {
    getStatus: () => ipcRenderer.invoke('persistence:getStatus'),
    scan: () => ipcRenderer.invoke('persistence:scan'),
    approve: (options) => ipcRenderer.invoke('persistence:approve', options),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('persistence:progress', listener);
      return () => ipcRenderer.removeListener('persistence:progress', listener);
    }
  },
  process: {
    getIcons: (exePaths) => ipcRenderer.invoke('process:getIcons', exePaths),
    startSubscription: (options) => ipcRenderer.invoke('process:subscription:start', options),
    stopSubscription: () => ipcRenderer.invoke('process:subscription:stop'),
    getSnapshot: () => ipcRenderer.invoke('process:snapshot'),
    getStatus: () => ipcRenderer.invoke('process:status'),
    getDetails: (processKey, sections) => ipcRenderer.invoke('process:details', processKey, sections),
    performAction: (payload) => ipcRenderer.invoke('process:action', payload),
    saveTrace: (options) => ipcRenderer.invoke('process:trace:save', options),
    saveDiagnostics: () => ipcRenderer.invoke('process:diagnostics:save'),
    getReputationStatus: () => ipcRenderer.invoke('process:reputation:status'),
    configureReputation: (apiKey, consent) => ipcRenderer.invoke('process:reputation:configure', apiKey, consent),
    clearReputation: () => ipcRenderer.invoke('process:reputation:clear'),
    checkReputation: (processKey) => ipcRenderer.invoke('process:reputation:check', processKey),
    onFullSnapshot: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('process:fullSnapshot', listener);
      return () => ipcRenderer.removeListener('process:fullSnapshot', listener);
    },
    onDelta: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('process:delta', listener);
      return () => ipcRenderer.removeListener('process:delta', listener);
    },
    onStarted: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('process:started', listener);
      return () => ipcRenderer.removeListener('process:started', listener);
    },
    onExited: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('process:exited', listener);
      return () => ipcRenderer.removeListener('process:exited', listener);
    },
    onCapabilitiesChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('process:capabilitiesChanged', listener);
      return () => ipcRenderer.removeListener('process:capabilitiesChanged', listener);
    },
    runTask: (taskSpec) => ipcRenderer.invoke('process:runTask', taskSpec),
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
    getState: () => ipcRenderer.invoke('browserExtension:getState'),
    install: (browserId) => ipcRenderer.invoke('browserExtension:install', browserId),
    openPage: (browserId) => ipcRenderer.invoke('browserExtension:openPage', browserId)
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
