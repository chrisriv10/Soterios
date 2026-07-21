let savedTheme = 'dark';
let unsubscribeUpdateStatus = null;

window.Pages = window.Pages || {};
window.Pages.settings = {
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const settings = await Api.getSettings();
    const appInfo = await Api.getAppInfo();
    let launchAtStartup = false;
    try {
      launchAtStartup = await window.api.invoke('app:getLaunchAtStartup');
    } catch (_) {
      launchAtStartup = !!(settings.features && settings.features.launchAtStartup);
    }
    savedTheme = settings.ui?.theme || 'dark';
    const activeTheme = (window.AppState && window.AppState.currentTheme) || savedTheme;
    Api.applyTheme(activeTheme);
    let localeOptions = '';
    let languageInDevMap = {};
    try {
      const locales = await window.api.invoke('i18n:listLocales');
      const currentLanguage = (window.I18n && window.I18n.locale)
        || settings.ui?.language
        || 'en';
      // Pre-fetch "language in development" translation for each locale
      await Promise.all(locales.map(async ({ code, label }) => {
        if (code !== 'en') {
          try {
            const catalog = await window.api.invoke('i18n:getCatalog', code);
            if (catalog && catalog['settings.languageInDevelopment']) {
              languageInDevMap[code] = catalog['settings.languageInDevelopment'];
            }
          } catch (_) {}
        }
      }));
      localeOptions = locales.map(({ code, label }) => {
        const warning = languageInDevMap[code] ? ` data-warning="${escapeHtml(languageInDevMap[code])}"` : '';
        return `<option value="${escapeHtml(code)}"${warning} ${currentLanguage === code ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
    } catch (_) {
      localeOptions = '<option value="en" selected>English</option>';
    }
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">${escapeHtml(t('nav.settings'))}</h1>
        <div class="page-subtitle">${escapeHtml(t('settings.pageSubtitle'))}</div></div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.featureToggles'))}</div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.rtp.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.rtp.desc'))}</div>
            </div>
            <label class="toggle" id="rtpToggleWrap"><input type="checkbox" id="rtpToggle" ${settings.features.realtimeProtection ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.folderWatch.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.folderWatch.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="folderWatchToggle" ${settings.features.folderWatch !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.networkAlerts.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.networkAlerts.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="networkAlertsToggle" ${settings.features.networkAlerts !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.networkTrafficHistory.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.networkTrafficHistory.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="networkTrafficHistoryToggle" ${settings.features.networkTrafficHistory !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.autoReports.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.autoReports.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="autoReportToggle" ${settings.features.autoReports ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.scanHistory.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.scanHistory.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="scanHistoryToggle" ${settings.features.scanHistory ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.externalLookups.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.externalLookups.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="externalLookupsToggle" ${settings.features.externalLookups ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.geoLookup.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.geoLookup.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="geoLookupToggle" ${settings.features.geoLookup ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.networkPerimeterMap.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.networkPerimeterMap.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="networkPerimeterMapToggle" ${settings.features.networkPerimeterMap !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="featureToggleStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.appearance'))}</div>
          <div class="field">
            <label class="field-label">${escapeHtml(t('settings.colorScheme'))}</label>
            <select id="themeSelect" style="width:100%;">
              <option value="dark" ${settings.ui?.theme === 'dark' ? 'selected' : ''}>${escapeHtml(t('settings.theme.dark'))}</option>
              <option value="light" ${settings.ui?.theme === 'light' ? 'selected' : ''}>${escapeHtml(t('settings.theme.light'))}</option>
              <option value="ocean" ${settings.ui?.theme === 'ocean' ? 'selected' : ''}>${escapeHtml(t('settings.theme.ocean'))}</option>
              <option value="emerald" ${settings.ui?.theme === 'emerald' ? 'selected' : ''}>${escapeHtml(t('settings.theme.emerald'))}</option>
              <option value="sunset" ${settings.ui?.theme === 'sunset' ? 'selected' : ''}>${escapeHtml(t('settings.theme.sunset'))}</option>
              <option value="violet" ${settings.ui?.theme === 'violet' ? 'selected' : ''}>${escapeHtml(t('settings.theme.violet'))}</option>
              <option value="crimson" ${settings.ui?.theme === 'crimson' ? 'selected' : ''}>${escapeHtml(t('settings.theme.crimson'))}</option>
              <option value="terminal" ${settings.ui?.theme === 'terminal' ? 'selected' : ''}>${escapeHtml(t('settings.theme.terminal'))}</option
              <option value="midnight" ${settings.ui?.theme === 'midnight' ? 'selected' : ''}>${escapeHtml(t('settings.theme.midnight'))}</option>
              <option value="bumblebee" ${settings.ui?.theme === 'bumblebee' ? 'selected' : ''}>${escapeHtml(t('settings.theme.bumblebee'))}</option>
              <option value="monochrome" ${settings.ui?.theme === 'monochrome' ? 'selected' : ''}>${escapeHtml(t('settings.theme.monochrome'))}</option>
              <option value="rose" ${settings.ui?.theme === 'rose' ? 'selected' : ''}>${escapeHtml(t('settings.theme.rose'))}</option>
              <option value='aurora' ${settings.ui?.theme === 'aurora' ? 'selected' : ''}>${escapeHtml(t('settings.theme.aurora'))}</option>
            </select>
          </div>
          <div class="toggle-desc" style="margin-bottom:12px;">${escapeHtml(t('settings.themeDesc'))}</div>
          <button class="btn btn-primary" id="saveTheme" style="margin-top:4px;">${escapeHtml(t('settings.applyTheme'))}</button>
          <div id="themeStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
          <div class="field" style="margin-top:16px;">
            <label class="field-label">${escapeHtml(t('settings.language'))}</label>
            <select id="languageSelect" style="width:100%;">
              ${localeOptions}
            </select>
          </div>
          <div class="toggle-desc" style="margin-bottom:12px;" id="languageHint">${escapeHtml(t('settings.languageHint'))}</div>
          <div id="languageWarning" style="display:none; margin-bottom:12px; padding:12px; background:var(--warning-bg, #fff3cd); border:1px solid var(--warning-border, #ffc107); border-radius:4px; color:var(--warning-text, #856404); font-size:0.85rem;"></div>
          <button class="btn btn-primary" id="saveLanguage" style="margin-top:4px;">${escapeHtml(t('settings.applyLanguage'))}</button>
          <div id="languageStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.scannerDefaults'))}</div>

          <div class="field"><label class="field-label">${escapeHtml(t('settings.defaultScanPath'))}</label><input type="text" id="defaultPath" value="${escapeHtml(settings.scanner.defaultPath || '')}" placeholder="e.g. C:\\Users\\..." /></div>
          <div class="grid grid-2">
            <div class="field"><label class="field-label">${escapeHtml(t('settings.maxDepth'))}</label><input type="number" id="maxDepthSetting" min="1" max="32" value="${escapeHtml(settings.scanner.maxDepth)}" /></div>
            <div class="field"><label class="field-label">${escapeHtml(t('settings.maxFileSize'))}</label><input type="number" id="maxFileSizeSetting" min="1" max="4096" value="${escapeHtml(settings.scanner.maxFileSizeMB)}" /></div>
          </div>
          <label class="checkbox-row"><input type="checkbox" id="includeCleanSetting" ${settings.scanner.includeCleanResults ? 'checked' : ''} />${escapeHtml(t('settings.includeClean'))}</label>
          <div class="field"><label class="field-label">${escapeHtml(t('settings.excludedDirs'))}</label><input type="text" id="excludedDirs" value="${escapeHtml((settings.scanner.excludedDirNames || []).join(', '))}" /></div>
          <button class="btn btn-primary" id="saveSettings" style="margin-top:12px;">${escapeHtml(t('settings.saveScannerSettings'))}</button>
          <div id="settingsStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.notifications'))}</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.enableNotifications.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.enableNotifications.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="notificationsToggle" ${settings.features.notificationsEnabled !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div class="toggle-row" style="margin-top:8px;">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.scanNotifications.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.scanNotifications.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="scanNotificationsToggle" ${settings.features.scanNotifications !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="notificationStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.startup'))}</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.launchAtStartup.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.launchAtStartup.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="launchAtStartupToggle" ${launchAtStartup ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="startupStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.scheduledMaintenance'))}</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.enableMaintenance.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.enableMaintenance.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="maintenanceEnabledToggle" /><span class="toggle-slider"></span></label>
          </div>
          <div class="field" style="margin-top:12px;">
            <label class="field-label">${escapeHtml(t('settings.schedule'))}</label>
            <select id="maintenancePreset" class="field-input">
              <option value="daily">${escapeHtml(t('settings.daily'))}</option>
              <option value="weekly">${escapeHtml(t('settings.weekly'))}</option>
              <option value="idle">${escapeHtml(t('settings.idle'))}</option>
              <option value="custom">${escapeHtml(t('settings.custom'))}</option>
            </select>
          </div>
          <div class="field" id="maintenanceCustomIntervalWrap" style="margin-top:12px; display:none;">
            <label class="field-label">${escapeHtml(t('settings.intervalHours'))}</label>
            <input type="number" id="maintenanceInterval" min="24" max="720" value="168" />
          </div>
          <div class="field" style="margin-top:12px;">
            <label class="field-label">${escapeHtml(t('settings.scriptsToRun'))}</label>
            <div id="maintenanceScriptList" class="page-subtitle" style="font-size:0.85rem;">${escapeHtml(t('settings.loadingScripts'))}</div>
          </div>
          <div class="toggle-row" style="margin-top:8px;">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.notifyOnComplete.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.notifyOnComplete.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="maintenanceNotifyToggle" checked /><span class="toggle-slider"></span></label>
          </div>
          <button class="btn btn-primary" id="saveMaintenance" style="margin-top:12px;">${escapeHtml(t('settings.saveMaintenance'))}</button>
          <button class="btn btn-secondary" id="runMaintenanceNow" style="margin-top:12px; margin-left:8px;">${escapeHtml(t('settings.runNow'))}</button>
          <div id="maintenanceStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.updates'))}</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.autoUpdates.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.autoUpdates.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="autoUpdatesToggle" ${settings.features.autoUpdates !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="updateStatusText" style="margin-top:12px; font-size:0.85rem; color:var(--text-muted);">${escapeHtml(t('settings.checkingUpdateStatus'))}</div>
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-primary" id="checkUpdatesBtn">${escapeHtml(t('settings.checkUpdates'))}</button>
            <button class="btn btn-secondary" id="installUpdateBtn" disabled>${escapeHtml(t('settings.installUpdate'))}</button>
          </div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.about'))}</div>
          <div style="font-size:0.9rem; line-height:1.8;">
            <div><strong>Soterios</strong> v${escapeHtml(appInfo.version || '1.2.1')}</div>
            <div style="color:var(--text-muted); margin-top:8px;">${escapeHtml(t('settings.aboutDesc'))}</div>
            <div style="margin-top:12px; font-size:0.8rem;">
              <div>${escapeHtml(t('settings.clamavPath'))}</div>
              <div>${escapeHtml(t('settings.quarantinePath'))}</div>
            </div>
          </div>
        </div>
      </div>`;

    container.querySelector('#saveTheme').addEventListener('click', async () => {
      const theme = container.querySelector('#themeSelect').value;
      const status = container.querySelector('#themeStatus');
      try {
        Api.applyTheme(theme);
        await Api.updateSettings({ ui: { theme } });
        savedTheme = theme;
        status.textContent = t('settings.themeApplied', { theme: theme.charAt(0).toUpperCase() + theme.slice(1) });
      } catch (err) {
        status.textContent = err.message || String(err);
      }
    });

    container.querySelector('#themeSelect').addEventListener('change', (event) => {
      const theme = event.target.value;
      Api.applyTheme(theme);
      const status = container.querySelector('#themeStatus');
      status.textContent = t('settings.themePreview');
    });

    // Show/hide language in development warning
    const languageSelect = container.querySelector('#languageSelect');
    const languageWarning = container.querySelector('#languageWarning');
    const languageHint = container.querySelector('#languageHint');
    function updateLanguageWarning(lang) {
      const selectedLang = lang || languageSelect.value;
      if (selectedLang && selectedLang !== 'en') {
        // Read warning from the option's data-warning attribute
        const selectedOpt = languageSelect.querySelector(`option[value="${selectedLang}"]`);
        const msg = (selectedOpt && selectedOpt.dataset.warning) || languageInDevMap[selectedLang] || t('settings.languageInDevelopment');
        languageWarning.textContent = msg;
        languageWarning.style.display = 'block';
        languageHint.style.display = 'none';
      } else {
        languageWarning.style.display = 'none';
        languageHint.style.display = 'block';
      }
    }
    // Show warning for hovered option in dropdown (using mousemove on select)
    let lastHoveredValue = null;
    languageSelect.addEventListener('mousemove', (e) => {
      const opt = e.target.closest('option');
      if (opt && opt.value && opt.value !== 'en' && opt.value !== lastHoveredValue) {
        lastHoveredValue = opt.value;
        updateLanguageWarning(opt.value);
      }
    });
    // Show warning on interaction (click/focus) before change is committed
    languageSelect.addEventListener('mousedown', () => updateLanguageWarning(languageSelect.value));
    languageSelect.addEventListener('focus', () => updateLanguageWarning(languageSelect.value));
    languageSelect.addEventListener('change', () => { lastHoveredValue = null; updateLanguageWarning(languageSelect.value); });
    // Reset to current selection when mouse leaves dropdown
    languageSelect.addEventListener('mouseleave', () => { lastHoveredValue = null; updateLanguageWarning(languageSelect.value); });
    languageSelect.addEventListener('blur', () => { lastHoveredValue = null; updateLanguageWarning(languageSelect.value); });
    // Initial check
    updateLanguageWarning();

    container.querySelector('#saveLanguage').addEventListener('click', async () => {
      const language = container.querySelector('#languageSelect').value;
      const status = container.querySelector('#languageStatus');
      try {
        await window.I18n.setLocale(language);
        await Api.updateSettings({ ui: { language } });
        // Re-render the current page so template-literal text updates to the new locale
        if (window.AppRouter && typeof window.AppRouter.navigate === 'function') {
          window.AppRouter.navigate(window.AppRouter.current() || 'settings');
        }
      } catch (err) {
        status.textContent = err.message || String(err);
      }
    });

    container.querySelector('#saveSettings').addEventListener('click', async () => {
      const btn = container.querySelector('#saveSettings');
      const status = container.querySelector('#settingsStatus');
      setButtonLoading(btn, true, t('common.saving'));
      try {
        await Api.updateSettings({
          scanner: {
            defaultPath: container.querySelector('#defaultPath').value.trim(),
            maxDepth: Number(container.querySelector('#maxDepthSetting').value || 12),
            maxFileSizeMB: Number(container.querySelector('#maxFileSizeSetting').value || 512),
            includeCleanResults: container.querySelector('#includeCleanSetting').checked,
            excludedDirNames: container.querySelector('#excludedDirs').value.split(',').map(i => i.trim()).filter(Boolean)
          }
        });
        status.textContent = t('settings.settingsSaved');
      } catch (err) { status.textContent = err.message || String(err); }
      finally { setButtonLoading(btn, false); }
    });

    async function saveFeature(key, value, input, statusEl) {
      if (!statusEl) statusEl = container.querySelector('#featureToggleStatus');
      statusEl.textContent = '';
      input.disabled = true;
      try {
        await Api.updateSettings({ features: { [key]: value } });
        statusEl.textContent = t('settings.featureSaved');
      } catch (err) {
        input.checked = !value;
        statusEl.textContent = err.message || String(err);
      } finally {
        input.disabled = false;
      }
    }

    container.querySelector('#rtpToggle').addEventListener('change', (event) => saveFeature('realtimeProtection', event.target.checked, event.target));
    container.querySelector('#folderWatchToggle').addEventListener('change', (event) => saveFeature('folderWatch', event.target.checked, event.target));
    container.querySelector('#networkAlertsToggle').addEventListener('change', (event) => saveFeature('networkAlerts', event.target.checked, event.target));
    container.querySelector('#networkTrafficHistoryToggle').addEventListener('change', (event) => saveFeature('networkTrafficHistory', event.target.checked, event.target));
    container.querySelector('#autoReportToggle').addEventListener('change', (event) => saveFeature('autoReports', event.target.checked, event.target));
    container.querySelector('#scanHistoryToggle').addEventListener('change', (event) => saveFeature('scanHistory', event.target.checked, event.target));
    container.querySelector('#externalLookupsToggle').addEventListener('change', (event) => saveFeature('externalLookups', event.target.checked, event.target));
    container.querySelector('#geoLookupToggle').addEventListener('change', (event) => saveFeature('geoLookup', event.target.checked, event.target));
    container.querySelector('#networkPerimeterMapToggle').addEventListener('change', (event) => saveFeature('networkPerimeterMap', event.target.checked, event.target));
    container.querySelector('#notificationsToggle').addEventListener('change', async (event) => {
      const checked = event.target.checked;
      const statusEl = container.querySelector('#notificationStatus');
      statusEl.textContent = '';
      event.target.disabled = true;
      try {
        await Api.updateSettings({ features: { notificationsEnabled: checked } });
        if (!checked) {
          const scanToggle = container.querySelector('#scanNotificationsToggle');
          if (scanToggle.checked) {
            scanToggle.checked = false;
            await Api.updateSettings({ features: { scanNotifications: false } });
          }
        }
        statusEl.textContent = t('settings.featureSaved');
      } catch (err) {
        event.target.checked = !checked;
        statusEl.textContent = err.message || String(err);
      } finally {
        event.target.disabled = false;
      }
    });
    container.querySelector('#scanNotificationsToggle').addEventListener('change', (event) => saveFeature('scanNotifications', event.target.checked, event.target, container.querySelector('#notificationStatus')));

    container.querySelector('#launchAtStartupToggle').addEventListener('change', async (event) => {
      const checked = event.target.checked;
      const input = event.target;
      const status = container.querySelector('#startupStatus');
      input.disabled = true;
      status.textContent = '';
      try {
        const result = await window.api.invoke('app:setLaunchAtStartup', checked);
        await Api.updateSettings({ features: { launchAtStartup: !!result } });
        input.checked = !!result;
        status.textContent = result ? t('settings.startupEnabled') : t('settings.startupDisabled');
      } catch (err) {
        input.checked = !checked;
        status.textContent = err.message || t('settings.startupError');
      } finally {
        input.disabled = false;
      }
    });

    let maintenanceConfig = null;
    let maintenanceScripts = [];
    try {
      const [configResponse, scriptsResponse] = await Promise.all([
        window.api.invoke('maintenance:get'),
        window.api.invoke('maintenance:getScripts')
      ]);
      maintenanceConfig = configResponse && configResponse.ok ? configResponse.data : null;
      maintenanceScripts = scriptsResponse && scriptsResponse.ok ? scriptsResponse.data : [];
    } catch (_) {
      maintenanceConfig = null;
      maintenanceScripts = [];
    }

    const scriptListEl = container.querySelector('#maintenanceScriptList');
    const selectedScriptIds = new Set((maintenanceConfig && maintenanceConfig.scriptIds) || ['clear-temp-files', 'disk-space-report']);
    if (maintenanceScripts.length) {
      scriptListEl.innerHTML = maintenanceScripts.map((script) => `
        <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; cursor:pointer;">
          <input type="checkbox" class="maintenance-script-checkbox" value="${escapeHtml(script.id)}" ${selectedScriptIds.has(script.id) ? 'checked' : ''} />
          <span><strong>${escapeHtml(script.name)}</strong><br /><span style="color:var(--text-muted);">${escapeHtml(script.description || '')}</span></span>
        </label>
      `).join('');
    } else {
      scriptListEl.textContent = t('settings.maintenanceUnavailable');
    }

    const presetEl = container.querySelector('#maintenancePreset');
    const customIntervalWrap = container.querySelector('#maintenanceCustomIntervalWrap');

    const syncPresetUi = (preset) => {
      customIntervalWrap.style.display = preset === 'custom' ? 'block' : 'none';
    };

    if (maintenanceConfig) {
      container.querySelector('#maintenanceEnabledToggle').checked = !!maintenanceConfig.enabled;
      presetEl.value = maintenanceConfig.schedulePreset || 'weekly';
      container.querySelector('#maintenanceInterval').value = String(maintenanceConfig.intervalHours || 168);
      container.querySelector('#maintenanceNotifyToggle').checked = maintenanceConfig.notifyOnComplete !== false;
      syncPresetUi(presetEl.value);
      if (maintenanceConfig.lastRun) {
        container.querySelector('#maintenanceStatus').textContent = t('settings.lastRun', { when: new Date(maintenanceConfig.lastRun).toLocaleString() });
      }
    } else {
      syncPresetUi(presetEl.value);
    }

    presetEl.addEventListener('change', () => syncPresetUi(presetEl.value));

    container.querySelector('#saveMaintenance').addEventListener('click', async () => {
      const status = container.querySelector('#maintenanceStatus');
      const btn = container.querySelector('#saveMaintenance');
      setButtonLoading(btn, true, t('common.saving'));
      try {
        const scriptIds = Array.from(container.querySelectorAll('.maintenance-script-checkbox:checked')).map((el) => el.value);
        const response = await window.api.invoke('maintenance:set', {
          enabled: container.querySelector('#maintenanceEnabledToggle').checked,
          schedulePreset: presetEl.value,
          intervalHours: Number(container.querySelector('#maintenanceInterval').value || 168),
          scriptIds,
          notifyOnComplete: container.querySelector('#maintenanceNotifyToggle').checked
        });
        if (!response || !response.ok) throw new Error(response?.error || t('settings.saveMaintenanceError'));
        const saved = response.data;
        const presetLabel = {
          daily: t('settings.daily'),
          weekly: t('settings.weekly'),
          idle: t('settings.idle'),
          custom: t('settings.customInterval', { hours: saved.intervalHours })
        }[saved.schedulePreset] || t('settings.customInterval', { hours: saved.intervalHours });
        status.textContent = saved.enabled
          ? t('settings.maintenanceEnabled', { preset: presetLabel, count: saved.scriptIds.length })
          : t('settings.maintenanceDisabled');
      } catch (err) {
        status.textContent = err.message || String(err);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    container.querySelector('#runMaintenanceNow').addEventListener('click', async () => {
      const status = container.querySelector('#maintenanceStatus');
      const btn = container.querySelector('#runMaintenanceNow');
      setButtonLoading(btn, true, t('common.running'));
      try {
        const response = await window.api.invoke('maintenance:runNow');
        if (!response || !response.ok) throw new Error(response?.error || t('settings.runFailed'));
        const result = response.data;
        if (result.skipped) {
          status.textContent = t('settings.maintenanceSkipped', { reason: result.reason || 'unknown' });
        } else {
          const okCount = (result.results || []).filter((row) => row.ok).length;
          const total = (result.results || []).length;
          status.textContent = t('settings.maintenanceCompleted', { ok: okCount, total });
        }
      } catch (err) {
        status.textContent = err.message || String(err);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    const updateStatusEl = container.querySelector('#updateStatusText');
    const installUpdateBtn = container.querySelector('#installUpdateBtn');

    async function refreshUpdateStatus() {
      try {
        const status = await window.api.invoke('update:status');
        updateStatusEl.textContent = status.message || status.status || t('settings.updateUnavailable');
        installUpdateBtn.disabled = status.status !== 'ready';
      } catch (err) {
        updateStatusEl.textContent = err.message || t('settings.updateReadError');
        installUpdateBtn.disabled = true;
      }
    }

    if (window.api.on) {
      if (unsubscribeUpdateStatus) unsubscribeUpdateStatus();
      unsubscribeUpdateStatus = window.api.on('update:status', refreshUpdateStatus);
    }

    container.querySelector('#autoUpdatesToggle').addEventListener('change', (event) => {
      saveFeature('autoUpdates', event.target.checked, event.target, updateStatusEl);
    });

    container.querySelector('#checkUpdatesBtn').addEventListener('click', async () => {
      const btn = container.querySelector('#checkUpdatesBtn');
      setButtonLoading(btn, true, t('settings.checking'));
      try {
        await window.api.invoke('update:check');
        await refreshUpdateStatus();
      } catch (err) {
        updateStatusEl.textContent = err.message || String(err);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    installUpdateBtn.addEventListener('click', async () => {
      try {
        await window.api.invoke('update:install');
      } catch (err) {
        updateStatusEl.textContent = err.message || String(err);
      }
    });

    refreshUpdateStatus();
  },

  destroy() {
    if (unsubscribeUpdateStatus) {
      unsubscribeUpdateStatus();
      unsubscribeUpdateStatus = null;
    }
    if (typeof savedTheme !== 'undefined') {
      Api.applyTheme(savedTheme);
    }
  }
};