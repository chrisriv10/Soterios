const Api = {
  applyTheme(themeName) {
    const theme = typeof themeName === 'string' && themeName ? themeName : 'dark';
    const normalized = {
      'black-red': 'crimson',
      'black-green': 'terminal'
    }[theme] || theme;
    const allowed = ['dark', 'light', 'ocean', 'emerald', 'sunset', 'violet', 'crimson', 'terminal', 'midnight', 'bumblebee', 'monochrome', 'rose', 'aurora'];
    const finalTheme = allowed.includes(normalized) ? normalized : 'dark';
    document.documentElement.setAttribute('data-theme', finalTheme);
    document.documentElement.style.setProperty('--theme-name', finalTheme);
    if (window.AppState) window.AppState.currentTheme = finalTheme;
    try {
      if (window.localStorage) window.localStorage.setItem('soterios.theme', finalTheme);
    } catch (_) {}
  },
  async initializeTheme() {
    if (window.AppState && window.AppState.currentTheme) {
      this.applyTheme(window.AppState.currentTheme);
      return;
    }
    try {
      const theme = await window.api.invoke('db:getSetting', 'ui.theme', 'dark');
      if (theme) {
        this.applyTheme(theme);
        return;
      }
    } catch (_) {}
    try {
      const storedTheme = window.localStorage && window.localStorage.getItem('soterios.theme');
      if (storedTheme) {
        this.applyTheme(storedTheme);
        return;
      }
    } catch (_) {}
    this.applyTheme('dark');
  },
  async initializeLanguage() {
    if (!window.I18n) return;
    try {
      const saved = await window.api.invoke('db:getSetting', 'ui.language', '');
      let locale = saved;
      if (!locale) {
        const systemLocale = await window.api.invoke('i18n:getSystemLocale');
        locale = await window.api.invoke('i18n:normalizeLocale', systemLocale);
      }
      // Only persist when we're establishing a fresh default (no saved
      // preference yet) - applying an already-saved preference shouldn't
      // re-write it, and the transient failure fallback below must never
      // clobber it.
      await window.I18n.setLocale(locale || 'en', { persist: !saved });
    } catch (_) {
      try {
        await window.I18n.setLocale('en', { persist: false });
      } catch (_) {}
    }
  },
  async listTools() { return window.soterios.tools.list(); },
  async runTool(toolId, args) {
    const result = await window.soterios.tools.run(toolId, args);
    if (!result.ok) throw new Error(result.error || `Tool "${toolId}" failed`);
    return result.data;
  },
  onToolProgress(toolId, callback) { return window.soterios.tools.onProgress(toolId, callback); },
  async pickFolder() { return window.soterios.dialog.pickFolder(); },
  async pickFiles() { return window.soterios.dialog.pickFiles(); },
  async showItemInFolder(filePath) { return window.soterios.shell.showItemInFolder(filePath); },
  async openPath(filePath) { return window.soterios.shell.openPath(filePath); },
  async getStoreSnapshot() { return {}; },
  async getSettings() {
    const defaultPath = await window.api.invoke('db:getSetting', 'scanner.defaultPath', '');
    const maxDepth = await window.api.invoke('db:getSetting', 'scanner.maxDepth', 12);
    const maxFileSizeMB = await window.api.invoke('db:getSetting', 'scanner.maxFileSizeMB', 512);
    const includeCleanResults = await window.api.invoke('db:getSetting', 'scanner.includeCleanResults', false);
    const excludedDirNames = await window.api.invoke('db:getSetting', 'scanner.excludedDirNames', []);
    const realtimeProtection = await window.api.invoke('db:getSetting', 'feature.realtimeProtection', true);
    const autoReports = await window.api.invoke('db:getSetting', 'feature.autoReports', true);
    const scanHistory = await window.api.invoke('db:getSetting', 'feature.scanHistory', true);
    const externalLookups = await window.api.invoke('db:getSetting', 'feature.externalLookups', true);
    const geoLookup = await window.api.invoke('db:getSetting', 'feature.geoLookup', true);
    const networkPerimeterMap = await window.api.invoke('db:getSetting', 'feature.networkPerimeterMap', true);
    const notificationsEnabled = await window.api.invoke('db:getSetting', 'feature.notificationsEnabled', true);
    const scanNotifications = await window.api.invoke('db:getSetting', 'feature.scanNotifications', true);
    // Cached fallback only -- settings.js queries 'app:getLaunchAtStartup'
    // directly for the real OS-level state and uses this purely as a
    // fallback if that IPC call fails.
    const launchAtStartup = await window.api.invoke('db:getSetting', 'feature.launchAtStartup', false);
    const folderWatch = await window.api.invoke('db:getSetting', 'feature.folderWatch', true);
    const networkAlerts = await window.api.invoke('db:getSetting', 'feature.networkAlerts', true);
    const networkTrafficHistory = await window.api.invoke('db:getSetting', 'feature.networkTrafficHistory', true);
    const dbTheme = await window.api.invoke('db:getSetting', 'ui.theme', 'dark');
    const savedLanguage = await window.api.invoke('db:getSetting', 'ui.language', '');
    let language = savedLanguage;
    if (!language) {
      if (window.AppState && window.AppState.currentLanguage) {
        language = window.AppState.currentLanguage;
      } else if (window.I18n && window.I18n.locale) {
        language = window.I18n.locale;
      } else {
        try {
          const systemLocale = await window.api.invoke('i18n:getSystemLocale');
          language = await window.api.invoke('i18n:normalizeLocale', systemLocale);
        } catch (_) {
          language = 'en';
        }
      }
    }
    let storedTheme = null;
    try {
      storedTheme = window.localStorage && window.localStorage.getItem('soterios.theme');
    } catch (_) {
      storedTheme = null;
    }
    const theme = (window.AppState && window.AppState.currentTheme)
      || dbTheme
      || storedTheme
      || 'dark';
    if (window.AppState) window.AppState.currentTheme = theme;
    return {
      scanner: { defaultPath, maxDepth, maxFileSizeMB, includeCleanResults, excludedDirNames },
      features: {
        realtimeProtection,
        autoReports,
        scanHistory,
        externalLookups,
        geoLookup,
        networkPerimeterMap,
        notificationsEnabled,
        scanNotifications,
        launchAtStartup,
        folderWatch,
        networkAlerts,
        networkTrafficHistory
      },
      ui: { theme, language }
    };
  },
  async updateSettings(patch) {
    if (patch.scanner) {
      const s = patch.scanner;
      await window.api.invoke('db:setSetting', 'scanner.defaultPath', s.defaultPath || '');
      await window.api.invoke('db:setSetting', 'scanner.maxDepth', s.maxDepth || 12);
      await window.api.invoke('db:setSetting', 'scanner.maxFileSizeMB', s.maxFileSizeMB || 512);
      await window.api.invoke('db:setSetting', 'scanner.includeCleanResults', !!s.includeCleanResults);
      await window.api.invoke('db:setSetting', 'scanner.excludedDirNames', s.excludedDirNames || []);
    }
    if (patch.features) {
      const f = patch.features;
      if (Object.prototype.hasOwnProperty.call(f, 'realtimeProtection')) {
        const enable = !!f.realtimeProtection;
        const result = await window.api.invoke('rtp:toggle', enable);
        await window.api.invoke('db:setSetting', 'feature.realtimeProtection', !!result);
      }
      if (Object.prototype.hasOwnProperty.call(f, 'autoReports')) await window.api.invoke('db:setSetting', 'feature.autoReports', !!f.autoReports);
      if (Object.prototype.hasOwnProperty.call(f, 'scanHistory')) await window.api.invoke('db:setSetting', 'feature.scanHistory', !!f.scanHistory);
      if (Object.prototype.hasOwnProperty.call(f, 'externalLookups')) await window.api.invoke('db:setSetting', 'feature.externalLookups', !!f.externalLookups);
      if (Object.prototype.hasOwnProperty.call(f, 'geoLookup')) await window.api.invoke('db:setSetting', 'feature.geoLookup', !!f.geoLookup);
      if (Object.prototype.hasOwnProperty.call(f, 'networkPerimeterMap')) await window.api.invoke('db:setSetting', 'feature.networkPerimeterMap', !!f.networkPerimeterMap);
      if (Object.prototype.hasOwnProperty.call(f, 'notificationsEnabled')) await window.api.invoke('db:setSetting', 'feature.notificationsEnabled', !!f.notificationsEnabled);
      if (Object.prototype.hasOwnProperty.call(f, 'scanNotifications')) await window.api.invoke('db:setSetting', 'feature.scanNotifications', !!f.scanNotifications);
      if (Object.prototype.hasOwnProperty.call(f, 'launchAtStartup')) await window.api.invoke('db:setSetting', 'feature.launchAtStartup', !!f.launchAtStartup);
      if (Object.prototype.hasOwnProperty.call(f, 'folderWatch')) {
        const enable = !!f.folderWatch;
        const result = await window.api.invoke('folderwatch:toggle', enable);
        await window.api.invoke('db:setSetting', 'feature.folderWatch', !!(result && result.running));
      }
      if (Object.prototype.hasOwnProperty.call(f, 'networkAlerts')) {
        const enable = !!f.networkAlerts;
        const result = await window.api.invoke('network-alerts:toggle', enable);
        await window.api.invoke('db:setSetting', 'feature.networkAlerts', !!(result && result.running));
      }
      if (Object.prototype.hasOwnProperty.call(f, 'networkTrafficHistory')) {
        const enable = !!f.networkTrafficHistory;
        const result = await window.api.invoke('network-traffic-history:toggle', enable);
        await window.api.invoke('db:setSetting', 'feature.networkTrafficHistory', !!(result && result.running));
      }
    }
    if (patch.ui) {
      const u = patch.ui;
      if (Object.prototype.hasOwnProperty.call(u, 'theme')) {
        await window.api.invoke('db:setSetting', 'ui.theme', u.theme || 'dark');
        try {
          if (window.localStorage) window.localStorage.setItem('soterios.theme', u.theme || 'dark');
        } catch (_) {}
      }
      if (Object.prototype.hasOwnProperty.call(u, 'language') && window.I18n) {
        await window.I18n.setLocale(u.language || 'en');
      }
    }
  },
  async getHistory(kind, limit) { try { return await window.api.invoke('db:getScanHistory', limit || 10); } catch (e) { return []; } },
  async getQuarantine() { try { return await window.api.invoke('db:getQuarantineList'); } catch (e) { return []; } },
  async getAppInfo() { return window.soterios.app.info(); }
};

window.Api = Api;