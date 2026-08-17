const { contextBridge, ipcRenderer } = require('electron');

/**
 * Renderer preload script.
 *
 * Exposes a restricted `window.api` surface for the renderer process.
 * Only explicitly allowlisted IPC channels may be invoked or listened to.
 */

// Explicit allowlists so the renderer cannot invoke arbitrary main-process
// handlers or register listeners on unapproved channels. Any channel not
// listed here is rejected at the preload boundary.

const ALLOWED_INVOKE = new Set([
  // Scanner
  'scan:status', 'scan:quick', 'scan:full', 'scan:abort',
  'scan:updateDefinitions',
  // Reputation
  'reputation:addHash', 'reputation:removeHash',
  'reputation:listHashes', 'reputation:checkHash',
  // Schedule
  'schedule:get', 'schedule:set', 'schedule:getCustomPaths',
  // Tools
  'tools:list', 'tools:run',
  // Dialogs
  'dialog:pickFolder', 'dialog:pickFiles',
  // Shell
  'shell:showItemInFolder', 'shell:openPath',
  // App
  'app:info', 'app:getLaunchAtStartup', 'app:setLaunchAtStartup',
  'app:ready', 'app:exportSettings',
  // Startup
  'startup:getIcons', 'startup:toggle',
  // Process
  'process:list', 'process:kill', 'process:getIcons',
  // Firewall
  'firewall:status', 'firewall:rules', 'firewall:listRules',
  'firewall:createRule', 'firewall:deleteRule',
  'firewall:setRuleEnabled', 'firewall:setProfileEnabled',
  'firewall:exportRules', 'firewall:importRules', 'firewall:getTrusted',
  // Network
  'network:connections', 'network:stats', 'network:history',
  'network:geo', 'network:measureBandwidth',
  'network-alerts:status', 'network-alerts:toggle',
  'network-alerts:ignore', 'network-alerts:kill',
  'network-traffic-history:toggle',
  'network:userBlocklist:list', 'network:userBlocklist:add',
  'network:userBlocklist:remove', 'network:userBlocklist:clear',
  'network:domainBlocklist:list', 'network:domainBlocklist:add',
  'network:domainBlocklist:remove', 'network:domainBlocklist:clear',
  // Database / Settings
  'db:getScanHistory', 'db:getQuarantineList',
  'db:getUnreadAlerts', 'db:markAlertRead',
  'db:getSetting', 'db:setSetting',
  // Warnings
  'warnings:ignore', 'warnings:unignore', 'warnings:listIgnored',
  // Alerts
  'alerts:list', 'alerts:counts',
  // Audit
  'audit:run', 'audit:log',
  // Maintenance
  'maintenance:get', 'maintenance:set', 'maintenance:getScripts',
  'maintenance:getHistory', 'maintenance:runNow',
  // Updates
  'update:check', 'update:status', 'update:install',
  // Tray
  'tray:getSummary', 'tray:openMain', 'tray:quit',
  // Reports
  'reports:list', 'scanReports:list', 'scanReports:latest',
  'scanReports:delete', 'report:exportPDF', 'report:exportCSV',
  'reports:delete', 'reports:read',
  // Quarantine
  'quarantine:restore', 'quarantine:delete',
  // Lockdown
  'lockdown:getStatus', 'lockdown:activate', 'lockdown:restore',
  'lockdown:getAllowlist', 'lockdown:setAllowlist',
  'lockdown:addToAllowlist', 'lockdown:removeFromAllowlist',
  // External lookups
  'hibp:password', 'xon:email',
  // Health
  'health:score',
  // i18n
  'i18n:getCatalog', 'i18n:normalizeLocale', 'i18n:listLocales',
  'i18n:isRtlLocale', 'i18n:getSystemLocale',
  // Browser extension
  'browserExtension:installNativeHost',
  'credential-leak:notify',
]);

const ALLOWED_ON = new Set([
  // Scan progress
  'scan:progress', 'scan:complete', 'scan:canceled',
  // Updates
  'update:status',
  // Network
  'network:connections:progress',
  // Audit
  'audit:progress',
  // Splash
  'splash:progress',
  // Folder watch
  'folderwatch:threat',
  // Lockdown
  'lockdown:changed',
  // Navigation
  'navigate-to-scanner',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, callback) => {
    if (!ALLOWED_ON.has(channel)) {
      throw new Error(`IPC listener channel not allowed: ${channel}`);
    }
    /**
     * IPC event listener wrapper that strips the Electron event argument.
     */
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
      /**
       * IPC progress listener that forwards payload to the callback.
       */
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
  },
  lockdown: {
    getStatus: () => ipcRenderer.invoke('lockdown:getStatus'),
    activate: () => ipcRenderer.invoke('lockdown:activate'),
    restore: () => ipcRenderer.invoke('lockdown:restore'),
    getAllowlist: () => ipcRenderer.invoke('lockdown:getAllowlist'),
    setAllowlist: (allowlist) => ipcRenderer.invoke('lockdown:setAllowlist', allowlist),
    addToAllowlist: (type, value) => ipcRenderer.invoke('lockdown:addToAllowlist', type, value),
    removeFromAllowlist: (type, value) => ipcRenderer.invoke('lockdown:removeFromAllowlist', type, value)
  },
  browserExtension: {
    installNativeHost: () => ipcRenderer.invoke('browserExtension:installNativeHost')
  }
});
