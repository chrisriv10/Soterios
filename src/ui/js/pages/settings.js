let savedTheme = 'dark';
let unsubscribeUpdateStatus = null;

function translateUpdateStatus(status) {
  if (!status || !status.messageKey) return status.message || '';
  const vars = {};
  if (status.version) vars.version = status.version;
  if (status.progress && typeof status.progress.percent === 'number') vars.percent = Math.round(status.progress.percent);
  const translated = window.I18n?.t(status.messageKey, vars) ?? '';
  return translated && translated !== status.messageKey ? translated : (status.message || '');
}

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
      // Pre-fetch "language in development" translation ONLY for current language
      // (not all locales) to speed up initial render. Other catalogs fetch on demand.
      if (currentLanguage !== 'en') {
        try {
          const catalog = await window.api.invoke('i18n:getCatalog', currentLanguage);
          if (catalog && catalog['settings.languageInDevelopment']) {
            languageInDevMap[currentLanguage] = catalog['settings.languageInDevelopment'];
          }
        } catch (_) {}
      }
      // Generate locale options without pre-fetching all catalogs
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
      <div class="dashboard-grid settings-grid">
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

          <div class="privacy-lock-hint" style="display:none; margin-top:8px; font-size:0.8rem; color:var(--text-dim);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Privacy, UI & Connectivity</div>

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

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.emergencyLockdown.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.emergencyLockdown.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="emergencyLockdownToggle" ${settings.features.emergencyLockdown !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.aiAssistant.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.aiAssistant.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="aiAssistantToggle" ${settings.features.aiAssistant !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.vpn.autoConnect.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.vpn.autoConnect.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="vpnAutoConnectToggle" ${settings.features.vpnAutoConnect ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div class="privacy-lock-hint" style="display:none; margin-top:8px; font-size:0.8rem; color:var(--text-dim);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.reportsCard'))}</div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.generateToolRunReports.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.generateToolRunReports.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="generateToolRunReportsToggle" ${settings.features.generateToolRunReports !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.skipDeleteConfirm.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.skipDeleteConfirm.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="skipDeleteConfirmToggle" ${settings.features.skipDeleteConfirm ? 'checked' : ''} /><span class="toggle-slider"></span></label>
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
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.browserExtension.label'))}</div>
          <details class="browser-ext-disclosure">
            <summary><span class="toggle-label">${escapeHtml(t('settings.browserExtension.disclosureTitle'))}</span><span class="browser-ext-disclosure-chevron" aria-hidden="true">▸</span></summary>
            <div class="toggle-desc">${escapeHtml(t('settings.browserExtension.disclosureText'))}</div>
            <label style="display:flex; align-items:flex-start; gap:8px; margin-top:10px; font-size:0.85rem;"><input type="checkbox" id="browserExtDisclosureConfirm" style="margin-top:3px;"> <span>${escapeHtml(t('settings.browserExtension.disclosureConfirm'))}</span></label>
          </details>
          <div class="toggle-desc" style="margin-bottom:12px;">${escapeHtml(t('settings.browserExtension.desc'))}</div>
          <div id="browserExtensionBody">${escapeHtml(t('settings.browserExtension.checking'))}</div>
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
              <option value="sand" ${settings.ui?.theme === 'sand' ? 'selected' : ''}>${escapeHtml(t('settings.theme.sand'))}</option>
              <option value="cyber" ${settings.ui?.theme === 'cyber' ? 'selected' : ''}>${escapeHtml(t('settings.theme.cyber'))}</option>
              <option value="mint" ${settings.ui?.theme === 'mint' ? 'selected' : ''}>${escapeHtml(t('settings.theme.mint'))}</option>
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
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">${escapeHtml(t('settings.privacy'))}</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">${escapeHtml(t('settings.privacyMode.label'))}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.privacyMode.desc'))}</div>
            </div>
            <label class="toggle"><input type="checkbox" id="privacyModeToggle" ${settings.features.privacyMode ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="privacyModeStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);">${escapeHtml(t('settings.privacyMode.checking'))}</div>
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
            <div><strong>Soterios</strong> v${escapeHtml(appInfo.version || '1.3.0')}</div>
            <div style="color:var(--text-muted); margin-top:8px;">${escapeHtml(t('settings.aboutDesc'))}</div>
            <div style="margin-top:8px;">
              <a href="https://github.com/chrisriv10/Soterios" id="githubLink" style="color:var(--accent-primary); text-decoration:none;">${escapeHtml(t('settings.githubRepo'))}</a>
            </div>
            <div style="margin-top:12px; font-size:0.8rem;">
              <div>${escapeHtml(t('settings.clamavPath'))}</div>
              <div>${escapeHtml(t('settings.quarantinePath'))}</div>
            </div>
            <button class="btn btn-secondary" id="replaySetupBtn" style="margin-top:16px;">${escapeHtml(t('settings.replaySetup'))}</button>
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

    const replaySetupBtn = container.querySelector('#replaySetupBtn');
    if (replaySetupBtn) {
      replaySetupBtn.addEventListener('click', () => {
        if (window.AppRouter) window.AppRouter.navigate('setup');
      });
    }

    const githubLink = container.querySelector('#githubLink');
    if (githubLink) {
      githubLink.addEventListener('click', (event) => {
        event.preventDefault();
        window.api.invoke('shell:openExternal', 'https://github.com/chrisriv10/Soterios');
      });
    }

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
    async function updateLanguageWarning(lang) {
      const selectedLang = lang || languageSelect.value;
      if (selectedLang && selectedLang !== 'en') {
        // Read warning from the option's data-warning attribute
        const selectedOpt = languageSelect.querySelector(`option[value="${selectedLang}"]`);
        let msg = (selectedOpt && selectedOpt.dataset.warning) || languageInDevMap[selectedLang];

        // If not cached, fetch the catalog for this language to get the warning
        if (!msg) {
          try {
            const catalog = await window.api.invoke('i18n:getCatalog', selectedLang);
            if (catalog && catalog['settings.languageInDevelopment']) {
              msg = catalog['settings.languageInDevelopment'];
              languageInDevMap[selectedLang] = msg; // Cache for future use
            }
          } catch (_) {}
        }

        // Fallback to current language's translation if still not found
        if (!msg) {
          msg = t('settings.languageInDevelopment');
        }

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
    let hoverDebounce = null;
    languageSelect.addEventListener('mousemove', (e) => {
      const opt = e.target.closest('option');
      if (opt && opt.value && opt.value !== 'en' && opt.value !== lastHoveredValue) {
        lastHoveredValue = opt.value;
        if (hoverDebounce) clearTimeout(hoverDebounce);
        hoverDebounce = setTimeout(() => updateLanguageWarning(opt.value), 100);
      }
    });
    // Show warning on interaction (click/focus) before change is committed
    languageSelect.addEventListener('mousedown', () => updateLanguageWarning(languageSelect.value));
    languageSelect.addEventListener('focus', () => updateLanguageWarning(languageSelect.value));
    languageSelect.addEventListener('change', () => { lastHoveredValue = null; if (hoverDebounce) clearTimeout(hoverDebounce); updateLanguageWarning(languageSelect.value); });
    // Reset to current selection when mouse leaves dropdown
    languageSelect.addEventListener('mouseleave', () => { lastHoveredValue = null; if (hoverDebounce) clearTimeout(hoverDebounce); updateLanguageWarning(languageSelect.value); });
    languageSelect.addEventListener('blur', () => { lastHoveredValue = null; if (hoverDebounce) clearTimeout(hoverDebounce); updateLanguageWarning(languageSelect.value); });
    // Initial check
    updateLanguageWarning();

    container.querySelector('#saveLanguage').addEventListener('click', async () => {
      const language = container.querySelector('#languageSelect').value;
      const status = container.querySelector('#languageStatus');
      try {
        await window.I18n.setLocale(language);
        await Api.updateSettings({ ui: { language } });
        // Fetch catalog for newly selected language so warning can show "in development" text
        try {
          const catalog = await window.api.invoke('i18n:getCatalog', language);
          if (catalog && catalog['settings.languageInDevelopment']) {
            languageInDevMap[language] = catalog['settings.languageInDevelopment'];
          }
        } catch (_) {}
        // Re-render the current page so template-literal text updates to the new locale
        if (window.AppRouter && typeof window.AppRouter.navigate === 'function') {
          window.AppRouter.navigate(window.AppRouter.current() || 'settings');
        }
      } catch (err) {
        status.textContent = err.message || String(err);
      }
    });

    async function saveFeature(key, value, input) {
      input.disabled = true;
      try {
        await Api.updateSettings({ features: { [key]: value } });
        window.DashboardCache?.invalidate?.();
        if (showToast) {
          const featureName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
          if (value) {
            showToast(t('settings.toast.featureEnabled', { feature: featureName }), 'success');
          } else {
            showToast(t('settings.toast.featureDisabled', { feature: featureName }), 'info');
          }
        }
      } catch (err) {
        input.checked = !value;
        if (showToast) {
          showToast(t('settings.toast.featureError'), 'error');
        }
      } finally {
        input.disabled = false;
      }
    }

    container.querySelector('#rtpToggle').addEventListener('change', (event) => saveFeature('realtimeProtection', event.target.checked, event.target));
    container.querySelector('#folderWatchToggle').addEventListener('change', (event) => saveFeature('folderWatch', event.target.checked, event.target));
    container.querySelector('#networkAlertsToggle').addEventListener('change', (event) => saveFeature('networkAlerts', event.target.checked, event.target));
    container.querySelector('#networkTrafficHistoryToggle').addEventListener('change', (event) => saveFeature('networkTrafficHistory', event.target.checked, event.target));
    container.querySelector('#aiAssistantToggle').addEventListener('change', (event) => saveFeature('aiAssistant', event.target.checked, event.target));
    container.querySelector('#vpnAutoConnectToggle').addEventListener('change', (event) => saveFeature('vpnAutoConnect', event.target.checked, event.target));
    container.querySelector('#autoReportToggle').addEventListener('change', (event) => saveFeature('autoReports', event.target.checked, event.target));
    container.querySelector('#scanHistoryToggle').addEventListener('change', (event) => saveFeature('scanHistory', event.target.checked, event.target));
    container.querySelector('#externalLookupsToggle').addEventListener('change', (event) => saveFeature('externalLookups', event.target.checked, event.target));
    container.querySelector('#geoLookupToggle').addEventListener('change', (event) => saveFeature('geoLookup', event.target.checked, event.target));
    container.querySelector('#networkPerimeterMapToggle').addEventListener('change', (event) => saveFeature('networkPerimeterMap', event.target.checked, event.target));
    container.querySelector('#generateToolRunReportsToggle').addEventListener('change', (event) => saveFeature('generateToolRunReports', event.target.checked, event.target));
    container.querySelector('#skipDeleteConfirmToggle').addEventListener('change', (event) => saveFeature('skipDeleteConfirm', event.target.checked, event.target));

    const privacyModeToggle = container.querySelector('#privacyModeToggle');
    const privacyModeStatus = container.querySelector('#privacyModeStatus');

    // Toggle element ids for every privacy-sensitive feature so the UI can
    // lock them (uncheck + disable + dim + hint) while Privacy Mode is on.
    const privacyLockedToggleIds = {
      externalLookups: '#externalLookupsToggle',
      geoLookup: '#geoLookupToggle',
      aiAssistant: '#aiAssistantToggle',
      networkTrafficHistory: '#networkTrafficHistoryToggle',
      scanHistory: '#scanHistoryToggle',
      autoReports: '#autoReportToggle'
    };

    function applyPrivacyModeLock(privacyOn, snapshot) {
      const lockedCards = new Set();
      for (const key of Object.keys(privacyLockedToggleIds)) {
        const el = container.querySelector(privacyLockedToggleIds[key]);
        if (!el) continue;
        const row = el.closest('.toggle-row');
        if (privacyOn) {
          el.checked = false;
          el.disabled = true;
          if (row) row.style.opacity = '0.55';
          const card = el.closest('.card');
          if (card) lockedCards.add(card);
        } else {
          el.disabled = false;
          if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, key)) {
            el.checked = Boolean(snapshot[key]);
          }
          if (row) row.style.opacity = '';
        }
      }
      const lockedText = t('settings.privacyMode.locked');
      for (const hintEl of container.querySelectorAll('.privacy-lock-hint')) {
        const show = privacyOn && lockedCards.has(hintEl.closest('.card'));
        hintEl.style.display = show ? 'block' : 'none';
        hintEl.textContent = show ? lockedText : '';
      }
    }

    async function updatePrivacyModeStatus() {
      if (!privacyModeStatus) return;
      try {
        const helpers = await window.api.invoke('privacy:helpers');
        let disabledCount = 0;
        for (const key of helpers.sensitiveFeatures) {
          const value = await window.api.invoke('db:getSetting', `feature.${key}`, true);
          if (!value) disabledCount++;
        }
        if (disabledCount === 0) {
          privacyModeStatus.textContent = t('settings.privacyMode.allEnabled');
        } else {
          privacyModeStatus.textContent = t('settings.privacyMode.someDisabled', {
            count: String(disabledCount),
            total: String(helpers.sensitiveFeatures.length)
          });
        }
      } catch (_) {
        privacyModeStatus.textContent = '';
      }
    }
    privacyModeToggle.addEventListener('change', async (event) => {
      const input = event.target;
      const enable = input.checked;
      input.disabled = true;
      privacyModeStatus.textContent = t('settings.privacyMode.applying');
      try {
        const helpers = await window.api.invoke('privacy:helpers');
        if (enable) {
          const snapshot = {};
          for (const key of helpers.sensitiveFeatures) {
            snapshot[key] = Boolean(await window.api.invoke('db:getSetting', `feature.${key}`, true));
          }
          await window.api.invoke('db:setSetting', 'privacy.snapshot', JSON.stringify(snapshot));
          await Api.updateSettings({ features: helpers.disablePatch });
          await Api.updateSettings({ features: { privacyMode: true } });
          applyPrivacyModeLock(true, snapshot);
        } else {
          let snapshot = {};
          try {
            snapshot = JSON.parse(await window.api.invoke('db:getSetting', 'privacy.snapshot', '{}')) || {};
          } catch (_) {}
          const restorePatch = await window.api.invoke('privacy:restorePatch', snapshot);
          if (Object.keys(restorePatch).length > 0) {
            await Api.updateSettings({ features: restorePatch });
          }
          await window.api.invoke('db:setSetting', 'privacy.snapshot', '');
          await Api.updateSettings({ features: { privacyMode: false } });
          applyPrivacyModeLock(false, snapshot);
        }
        await updatePrivacyModeStatus();
      } catch (err) {
        input.checked = !enable;
        privacyModeStatus.textContent = err.message || String(err);
      } finally {
        input.disabled = false;
      }
    });
updatePrivacyModeStatus();
    applyPrivacyModeLock(!!settings.features.privacyMode);

    let selectedExtensionBrowserId = null;
    async function renderBrowserExtensionSection(container) {
      const body = container.querySelector('#browserExtensionBody');
      if (!body) return;
      try {
        const state = await window.api.invoke('browserExtension:getState');
        if (!state || !state.ok) throw new Error(state?.error || 'Failed to load browser extension state');
        const detected = state.browsers.filter((b) => b.installed);
        if (detected.length === 0) {
          body.innerHTML = `<div class="toggle-desc">${escapeHtml(t('settings.browserExtension.noBrowser'))}</div>`;
          return;
        }
        if (!detected.some((browser) => browser.id === selectedExtensionBrowserId)) {
          selectedExtensionBrowserId = detected[0].id;
        }
        const rows = detected.map((b) => {
          const status = b.loaded
            ? `<span style="color:var(--success, #28a745);">&#9679; ${escapeHtml(t('settings.browserExtension.loaded'))}</span>`
            : `<span style="color:var(--text-muted);">&#9675; ${escapeHtml(t('settings.browserExtension.notLoaded'))}</span>`;
          const hostStatus = b.nativeHostActive
            ? '<span style="color:var(--success, #28a745);">Native host registered</span>'
            : '<span style="color:var(--text-muted);">Native host not registered</span>';
          return `
          <div class="browser-ext-row${b.id === selectedExtensionBrowserId ? ' is-selected' : ''}" role="button" tabindex="0" aria-pressed="${b.id === selectedExtensionBrowserId}" data-browser-select="${escapeHtml(b.id)}" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px; margin:4px 0; border:1px solid var(--border, rgba(128,128,128,0.2)); border-radius:8px; cursor:pointer;">
            <div style="min-width:0;">
              <div class="toggle-label">${escapeHtml(b.name)} &nbsp; ${status}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.browserExtension.extensionId', { id: state.extensionId }))}</div>
              <div class="toggle-desc">${hostStatus}</div>
            </div>
            <button class="btn btn-sm browser-ext-install" data-browser="${escapeHtml(b.id)}" style="flex-shrink:0;">${escapeHtml(t('settings.browserExtension.installBtn'))}</button>
          </div>`;
        }).join('');
body.innerHTML = `
          <div class="toggle-desc" style="margin-bottom:8px;">Bundled extension: ${escapeHtml(state.bundledVersion || 'unavailable')} &nbsp;·&nbsp; Installed: ${escapeHtml(state.installedVersion || 'not staged')} &nbsp;·&nbsp; Native binary: ${state.nativeHostBinaryPresent ? 'present' : 'not staged'} &nbsp;·&nbsp; Desktop bridge: ${state.bridge?.connected ? 'host connected' : state.bridge?.listening ? 'ready' : 'unavailable'}</div>
          ${rows}
          <div id="browserExtSteps" style="display:none; margin-top:12px; padding:12px; background:var(--panel-bg-alt, rgba(128,128,128,0.08)); border-radius:6px;">
            <div class="toggle-desc" style="margin-bottom:8px;">${escapeHtml(t('settings.browserExtension.stepsIntro'))}</div>
            <ol style="margin:0 0 12px 18px; padding:0; font-size:0.85rem; line-height:1.8;">
              <li>${escapeHtml(t('settings.browserExtension.stepDevMode'))}</li>
              <li>${escapeHtml(t('settings.browserExtension.stepLoadUnpacked'))}</li>
              <li>After an update, return to this page and click the extension card's Reload button.</li>
            </ol>
            <div style="font-size:0.85rem; word-break:break-all; margin-bottom:12px;"><code id="browserExtFolder" style="background:var(--panel-bg, rgba(128,128,128,0.12)); padding:2px 6px; border-radius:4px;">${escapeHtml(state.extDir || '')}</code></div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn btn-sm" id="browserExtOpenFolder">${escapeHtml(t('settings.browserExtension.openFolder'))}</button>
              <button class="btn btn-sm" id="browserExtOpenPage">${escapeHtml(t('settings.browserExtension.openPage'))}</button>
            </div>
            <div class="toggle-desc" style="margin-top:12px;">${escapeHtml(t('settings.browserExtension.stepNote'))}</div>
          </div>
          <div id="browserExtStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        `;
        body.querySelectorAll('[data-browser-select]').forEach((row) => {
          const select = () => {
            selectedExtensionBrowserId = row.dataset.browserSelect;
            body.querySelectorAll('[data-browser-select]').forEach((candidate) => {
              const selected = candidate.dataset.browserSelect === selectedExtensionBrowserId;
              candidate.classList.toggle('is-selected', selected);
              candidate.setAttribute('aria-pressed', String(selected));
            });
          };
          row.addEventListener('click', (event) => {
            if (!event.target.closest('button')) select();
          });
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
          });
        });
        body.querySelectorAll('.browser-ext-install').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const browserId = btn.dataset.browser;
            const status = body.querySelector('#browserExtStatus');
            const steps = body.querySelector('#browserExtSteps');
            setButtonLoading(btn, true, t('settings.browserExtension.installing'));
            status.textContent = '';
            try {
              const result = await window.api.invoke('browserExtension:install', browserId);
              if (!result.ok) throw new Error(result.error);
              const folder = body.querySelector('#browserExtFolder');
              if (folder) folder.textContent = result.extDir;
              if (steps) steps.style.display = 'block';
              status.textContent = `Extension ${result.installedVersion || '2.0.0'} staged. Native host ${result.nativeHostOk ? 'registered' : 'registration needs attention'}.`;
              // Don't re-render - keep the steps visible so user can follow them
            } catch (err) {
              status.textContent = err.message || String(err);
              if (showToast) showToast(t('settings.browserExtension.error'), 'error');
            } finally {
              setButtonLoading(btn, false);
            }
          });
        });
        const openFolderBtn = body.querySelector('#browserExtOpenFolder');
        if (openFolderBtn) {
          openFolderBtn.addEventListener('click', async () => {
            const folder = body.querySelector('#browserExtFolder')?.textContent;
            if (folder) {
              try {
                const result = await Api.openFolder(folder);
                if (!result || !result.success) {
                  throw new Error((result && result.error) || 'Failed to open folder');
                }
              } catch (err) {
                console.error('Failed to open folder:', err);
                alert(err.message || 'Failed to open folder');
              }
            }
          });
        }
        const openPageBtn = body.querySelector('#browserExtOpenPage');
        if (openPageBtn) {
          openPageBtn.addEventListener('click', async () => {
            const current = detected.find((b) => b.id === selectedExtensionBrowserId) || detected[0];
            if (!current) return;
            await window.api.invoke('browserExtension:openPage', current.id);
          });
        }
      } catch (err) {
        body.innerHTML = `<div class="toggle-desc">${escapeHtml(err.message || String(err))}</div>`;
      }
    }
    renderBrowserExtensionSection(container);
    container.querySelector('#emergencyLockdownToggle').addEventListener('change', async (event) => {
      const checked = event.target.checked;
      event.target.disabled = true;
      try {
        await Api.updateSettings({ features: { emergencyLockdown: checked } });
        
        // Update lockdown nav visibility immediately
        const lockdownNav = document.getElementById('lockdownNav');
        if (lockdownNav) {
          lockdownNav.style.display = checked ? 'flex' : 'none';
        }
      } catch (err) {
        event.target.checked = !checked;
      } finally {
        event.target.disabled = false;
      }
    });
    container.querySelector('#notificationsToggle').addEventListener('change', async (event) => {
      const checked = event.target.checked;
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
      } catch (err) {
        event.target.checked = !checked;
      } finally {
        event.target.disabled = false;
      }
    });
    container.querySelector('#scanNotificationsToggle').addEventListener('change', (event) => saveFeature('scanNotifications', event.target.checked, event.target));

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

    const updateStatusEl = container.querySelector('#updateStatusText');
    const installUpdateBtn = container.querySelector('#installUpdateBtn');

    async function refreshUpdateStatus() {
      try {
        const status = await window.api.invoke('update:status');
        updateStatusEl.textContent = translateUpdateStatus(status) || t('settings.updateUnavailable');
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
