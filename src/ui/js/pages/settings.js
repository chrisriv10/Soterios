let savedTheme = 'dark';

window.Pages = window.Pages || {};
window.Pages.settings = {
  async render(container) {
    const settings = await Api.getSettings();
    const appInfo = await Api.getAppInfo();
    let launchAtStartup = false;
    try {
      // Assumes 'app:getLaunchAtStartup' reflects the real OS-level login
      // item state (e.g. via Electron's app.getLoginItemSettings()), not
      // just a saved preference -- so this stays accurate even if the user
      // changed it outside the app. Falls back to the saved flag if that
      // channel isn't wired up yet.
      launchAtStartup = await window.api.invoke('app:getLaunchAtStartup');
    } catch (_) {
      launchAtStartup = !!(settings.features && settings.features.launchAtStartup);
    }
    savedTheme = settings.ui?.theme || 'dark';
    const activeTheme = (window.AppState && window.AppState.currentTheme) || savedTheme;
    Api.applyTheme(activeTheme);
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">Settings</h1>
        <div class="page-subtitle">Local app preferences and feature toggles</div></div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Feature Toggles</div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Real-Time Protection</div>
              <div class="toggle-desc">Monitor file system changes and alert on suspicious activity</div>
            </div>
            <label class="toggle" id="rtpToggleWrap"><input type="checkbox" id="rtpToggle" ${settings.features.realtimeProtection ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Auto-Generate Reports</div>
              <div class="toggle-desc">Automatically create a security report after each scan completes</div>
            </div>
            <label class="toggle"><input type="checkbox" id="autoReportToggle" ${settings.features.autoReports ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Scan History</div>
              <div class="toggle-desc">Keep a record of all past scan results</div>
            </div>
            <label class="toggle"><input type="checkbox" id="scanHistoryToggle" ${settings.features.scanHistory ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">External Lookups</div>
              <div class="toggle-desc">Allow breach checks using HIBP and XposedOrNot</div>
            </div>
            <label class="toggle"><input type="checkbox" id="externalLookupsToggle" ${settings.features.externalLookups ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Geolocation Heat Map</div>
              <div class="toggle-desc">Resolve IP addresses to display a world map of active connections</div>
            </div>
            <label class="toggle"><input type="checkbox" id="geoLookupToggle" ${settings.features.geoLookup ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Network Perimeter Map</div>
              <div class="toggle-desc">Show the live connection visualization on the Firewall page</div>
            </div>
            <label class="toggle"><input type="checkbox" id="networkPerimeterMapToggle" ${settings.features.networkPerimeterMap !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="featureToggleStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Appearance</div>
          <div class="field">
            <label class="field-label">Color Scheme</label>
            <select id="themeSelect" style="width:100%;">
              <option value="dark" ${settings.ui?.theme === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="light" ${settings.ui?.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="ocean" ${settings.ui?.theme === 'ocean' ? 'selected' : ''}>Ocean</option>
              <option value="emerald" ${settings.ui?.theme === 'emerald' ? 'selected' : ''}>Emerald</option>
              <option value="sunset" ${settings.ui?.theme === 'sunset' ? 'selected' : ''}>Sunset</option>
              <option value="violet" ${settings.ui?.theme === 'violet' ? 'selected' : ''}>Violet</option>
              <option value="crimson" ${settings.ui?.theme === 'crimson' ? 'selected' : ''}>Crimson</option>
              <option value="terminal" ${settings.ui?.theme === 'terminal' ? 'selected' : ''}>Terminal</option>
              <option value="midnight" ${settings.ui?.theme === 'midnight' ? 'selected' : ''}>Midnight</option>
              <option value="rose" ${settings.ui?.theme === 'rose' ? 'selected' : ''}>Rose</option>
            </select>
          </div>
          <div class="toggle-desc" style="margin-bottom:12px;">Choose a palette for the full app experience.</div>
          <button class="btn btn-primary" id="saveTheme" style="margin-top:4px;">Apply Theme</button>
          <div id="themeStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Scanner Defaults</div>

          <div class="field"><label class="field-label">Default scan path</label><input type="text" id="defaultPath" value="${escapeHtml(settings.scanner.defaultPath || '')}" placeholder="e.g. C:\\Users\\..." /></div>
          <div class="grid grid-2">
            <div class="field"><label class="field-label">Max directory depth</label><input type="number" id="maxDepthSetting" min="1" max="32" value="${escapeHtml(settings.scanner.maxDepth)}" /></div>
            <div class="field"><label class="field-label">Max file size (MB)</label><input type="number" id="maxFileSizeSetting" min="1" max="4096" value="${escapeHtml(settings.scanner.maxFileSizeMB)}" /></div>
          </div>
          <label class="checkbox-row"><input type="checkbox" id="includeCleanSetting" ${settings.scanner.includeCleanResults ? 'checked' : ''} />Include clean files in results</label>
          <div class="field"><label class="field-label">Excluded directories (comma-separated)</label><input type="text" id="excludedDirs" value="${escapeHtml((settings.scanner.excludedDirNames || []).join(', '))}" /></div>
          <button class="btn btn-primary" id="saveSettings" style="margin-top:12px;">Save Scanner Settings</button>
          <div id="settingsStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Notifications</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">Enable Notifications</div>
              <div class="toggle-desc">Show desktop notifications for scan results, threats, and completed reports</div>
            </div>
            <label class="toggle"><input type="checkbox" id="notificationsToggle" ${settings.features.notificationsEnabled !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div class="toggle-row" style="margin-top:8px;">
            <div>
              <div class="toggle-label">Scan Progress Notifications</div>
              <div class="toggle-desc">Show desktop notifications as a scan progresses</div>
            </div>
            <label class="toggle"><input type="checkbox" id="scanNotificationsToggle" ${settings.features.scanNotifications !== false ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="notificationStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">Startup</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">Launch at System Startup</div>
              <div class="toggle-desc">Automatically start Soterios in the background when you log in to Windows</div>
            </div>
            <label class="toggle"><input type="checkbox" id="launchAtStartupToggle" ${launchAtStartup ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          </div>
          <div id="startupStatus" style="margin-top:8px; font-size:0.85rem; color:var(--text-muted);"></div>
        </div>

        <div class="card">
          <div class="panel-title" style="margin-bottom:16px;">About</div>
          <div style="font-size:0.9rem; line-height:1.8;">
            <div><strong>Soterios</strong> v${escapeHtml(appInfo.version || '1.2.1')}</div>
            <div style="color:var(--text-muted); margin-top:8px;">Local-first security and maintenance platform.</div>
            <div style="margin-top:12px; font-size:0.8rem;">
              <div>ClamAV engine at <code style="color:var(--accent-primary);">assets/clamav/</code></div>
              <div>Quarantine path: <code style="color:var(--accent-primary);">~/.soterios-quarantine</code></div>
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
        status.textContent = `Theme updated to ${theme.charAt(0).toUpperCase() + theme.slice(1)}.`;
      } catch (err) {
        status.textContent = err.message || String(err);
      }
    });

    container.querySelector('#themeSelect').addEventListener('change', (event) => {
      const theme = event.target.value;
      Api.applyTheme(theme);
      const status = container.querySelector('#themeStatus');
      status.textContent = 'Preview updated. Click Apply Theme to save it.';
    });

    container.querySelector('#saveSettings').addEventListener('click', async () => {
      const btn = container.querySelector('#saveSettings');
      const status = container.querySelector('#settingsStatus');
      setButtonLoading(btn, true, 'Saving\u2026');
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
        status.textContent = 'Settings saved.';
      } catch (err) { status.textContent = err.message || String(err); }
      finally { setButtonLoading(btn, false); }
    });

    async function saveFeature(key, value, input, statusEl) {
      if (!statusEl) statusEl = container.querySelector('#featureToggleStatus');
      statusEl.textContent = '';
      input.disabled = true;
      try {
        await Api.updateSettings({ features: { [key]: value } });
        statusEl.textContent = 'Feature toggle saved.';
      } catch (err) {
        input.checked = !value;
        statusEl.textContent = err.message || String(err);
      } finally {
        input.disabled = false;
      }
    }

    container.querySelector('#rtpToggle').addEventListener('change', (event) => saveFeature('realtimeProtection', event.target.checked, event.target));
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
        statusEl.textContent = 'Feature toggle saved.';
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
        // Assumes 'app:setLaunchAtStartup' actually flips the OS-level login
        // item (e.g. via Electron's app.setLoginItemSettings) and returns
        // the resulting boolean -- not just a saved preference, since a
        // saved-only flag wouldn't make Windows launch the app at all.
        const result = await window.api.invoke('app:setLaunchAtStartup', checked);
        await Api.updateSettings({ features: { launchAtStartup: !!result } });
        input.checked = !!result;
        status.textContent = result ? 'Soterios will launch at startup.' : 'Startup launch disabled.';
      } catch (err) {
        input.checked = !checked;
        status.textContent = err.message || 'Unable to update startup setting.';
      } finally {
        input.disabled = false;
      }
    });
  },

  destroy() {
    if (typeof savedTheme !== 'undefined') {
      Api.applyTheme(savedTheme);
    }
  }
};