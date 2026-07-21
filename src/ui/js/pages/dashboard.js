window.Pages = window.Pages || {};

window.Pages['dashboard'] = {
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;

    // Warning title/detail translation map for security-overview tool
    const warningTranslations = {
      'Real-time protection is disabled': { title: 'dashboard.warn.rtpDisabled.title', detail: 'dashboard.warn.rtpDisabled.detail' },
      'Folder watch is disabled': { title: 'dashboard.warn.folderWatchDisabled.title', detail: 'dashboard.warn.folderWatchDisabled.detail' },
      'Suspicious network alerts are disabled': { title: 'dashboard.warn.networkAlertsDisabled.title', detail: 'dashboard.warn.networkAlertsDisabled.detail' },
      'Network traffic history is disabled': { title: 'dashboard.warn.networkTrafficHistoryDisabled.title', detail: 'dashboard.warn.networkTrafficHistoryDisabled.detail' },
      'Auto-generate reports is disabled': { title: 'dashboard.warn.autoReportsDisabled.title', detail: 'dashboard.warn.autoReportsDisabled.detail' },
      'Scan history is disabled': { title: 'dashboard.warn.scanHistoryDisabled.title', detail: 'dashboard.warn.scanHistoryDisabled.detail' },
      'External lookups are disabled': { title: 'dashboard.warn.externalLookupsDisabled.title', detail: 'dashboard.warn.externalLookupsDisabled.detail' },
      'Geolocation heat map is disabled': { title: 'dashboard.warn.geoLookupDisabled.title', detail: 'dashboard.warn.geoLookupDisabled.detail' },
      'Network perimeter map is disabled': { title: 'dashboard.warn.perimeterMapDisabled.title', detail: 'dashboard.warn.perimeterMapDisabled.detail' },
      'ClamAV definitions are outdated': { title: 'dashboard.warn.definitionsOutdated.title', detail: 'dashboard.warn.definitionsOutdated.detail' },
      'Windows Firewall is disabled': { title: 'dashboard.warn.firewallDisabled.title', detail: 'dashboard.warn.firewallDisabled.detail' },
      'High memory usage detected': { title: 'dashboard.warn.highMemory.title', detail: 'dashboard.warn.highMemory.detail' },
      'High CPU usage detected': { title: 'dashboard.warn.highCpu.title', detail: 'dashboard.warn.highCpu.detail' },
      'Low disk space': { title: 'dashboard.warn.lowDisk.title', detail: 'dashboard.warn.lowDisk.detail' },
    };

    function translateWarning(w) {
      const trans = warningTranslations[w.title];
      if (trans) return { ...w, title: t(trans.title), detail: t(trans.detail) };
      return w;
    }

    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('dashboard.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('dashboard.subtitle'))}</p>
      </header>
      <div id="dashboardContent" style="overflow-y:auto; margin-right:8px; padding-right:8px;">
        <div class="dashboard-grid">
          <div class="card" id="healthCard" style="cursor:pointer;" title="${escapeHtml(t('dashboard.healthClickDetails'))}">
            <div class="status-card">
              <div class="status-icon info" id="healthIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

  <rect x="3" y="4" width="18" height="13" rx="2"/>
  <path d="M8 21h8"/>
  <path d="M12 17v4"/>
  <path d="m8 11 2 2 5-5"/>
</svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('dashboard.healthScore'))}</h3>
                <div class="value" id="healthScore">Loading...</div>
              </div>
            </div>
            <div id="healthDetail" class="page-subtitle" style="margin-top:12px; font-size:0.85rem;">${escapeHtml(t('dashboard.healthCalculating'))}</div>
            <div class="page-subtitle" style="margin-top:8px; font-size:0.75rem; color:var(--accent-primary);">${escapeHtml(t('dashboard.healthClickDetails'))}</div>
          </div>

          <!-- Protection Status -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon safe" id="rtpIcon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('dashboard.rtpTitle'))}</h3>
                <div class="value" id="rtpStatusText">${escapeHtml(t('dashboard.rtpActive'))}</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnToggleRtp">${escapeHtml(t('dashboard.rtpDisable'))}</button>
            </div>
          </div>

          <!-- Firewall Status -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon info" id="fwIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

  <rect x="3" y="6" width="18" height="12" rx="1" />
  <line x1="3" y1="10" x2="21" y2="10" />
  <line x1="3" y1="14" x2="21" y2="14" />
  <line x1="9" y1="6" x2="9" y2="10" />
  <line x1="15" y1="10" x2="15" y2="14" />
  <line x1="9" y1="14" x2="9" y2="18" />

</svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('nav.firewall'))}</h3>
                <div class="value" id="fwStatusText">${escapeHtml(t('common.loading'))}</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnManageFirewall">${escapeHtml(t('dashboard.firewallManage'))}</button>
            </div>
          </div>

          <!-- Last Scan -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('dashboard.lastScan'))}</h3>
                <div class="value" id="lastScanTime">${escapeHtml(t('dashboard.lastScanLoading'))}</div>
              </div>
            </div>
            <div style="margin-top: 16px; display: flex; gap: 12px;">
              <button class="btn btn-primary" id="btnQuickScan">${escapeHtml(t('dashboard.quickScan'))}</button>
              <button class="btn" id="btnFullScan">${escapeHtml(t('dashboard.fullScan'))}</button>
            </div>
          </div>

          <!-- Database Age -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

  <!-- bug body -->
  <ellipse cx="10" cy="12" rx="4" ry="6"/>

  <!-- bug head -->
  <circle cx="10" cy="6" r="2"/>

  <!-- antenna -->
  <path d="M8.5 4.5 7 3"/>
  <path d="M11.5 4.5 13 3"/>

  <!-- bug legs -->
  <path d="M6 10H3"/>
  <path d="M6 13H2.5"/>
  <path d="M6 16H3"/>
  <path d="M14 10h2"/>
  <path d="M14 13h2"/>
  <path d="M14 16h2"/>

  <!-- magnifying glass -->
  <circle cx="16.5" cy="16.5" r="4"/>
  <path d="m19.5 19.5 3 3"/>
</svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('dashboard.dbDefinitions'))}</h3>
                <div class="value" id="dbAge">${escapeHtml(t('dashboard.dbUpToDate'))}</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnUpdateDb">${escapeHtml(t('dashboard.dbUpdate'))}</button>
            </div>
          </div>

          <!-- Threats Blocked -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon danger">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">

  <!-- virus body -->
  <circle cx="12" cy="12" r="5"/>

  <!-- spikes -->
  <path d="M12 2v3"/>
  <path d="M12 19v3"/>
  <path d="M2 12h3"/>
  <path d="M19 12h3"/>

  <path d="M5.6 5.6l2.1 2.1"/>
  <path d="M18.3 18.3l-2.1-2.1"/>
  <path d="M18.3 5.6l-2.1 2.1"/>
  <path d="M5.6 18.3l2.1-2.1"/>

  <!-- inner details -->
  <circle cx="10" cy="10" r=".5"/>
  <circle cx="14.5" cy="10.5" r=".5"/>
  <circle cx="13" cy="14.5" r=".5"/>
  <circle cx="9.5" cy="14" r=".5"/>

</svg>
              </div>
              <div class="status-info">
                <h3>${escapeHtml(t('dashboard.threatsBlocked'))}</h3>
                <div class="value" id="threatsCount">0</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnViewQuarantine">${escapeHtml(t('dashboard.viewQuarantine'))}</button>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:24px;">
          <div class="flex-between">
            <div>
              <div class="panel-title">${escapeHtml(t('dashboard.warnings'))}</div>
              <div class="page-subtitle" style="font-size:0.85rem;">${escapeHtml(t('dashboard.warningsDesc'))}</div>
            </div>
            <button class="btn btn-sm" id="btnRefreshWarnings">${escapeHtml(t('dashboard.refreshWarnings'))}</button>
          </div>
          <div id="warningList" class="history-list" style="margin-top:12px;"><div class="empty-state">${escapeHtml(t('common.loading'))}</div></div>
          <div class="panel-title" style="margin-top:16px;">${escapeHtml(t('dashboard.ignoredWarnings'))}</div>
          <div id="ignoredWarningList" class="history-list" style="max-height:300px; overflow-y:auto;"><div class="empty-state">${escapeHtml(t('common.loading'))}</div></div>
        </div>
      </div>
    `;

    window.api.invoke('splash:progress', { pct: 20, label: t('splash.loadingDashboard') });

    const btnToggleRtp = document.getElementById('btnToggleRtp');
    const rtpStatusText = document.getElementById('rtpStatusText');
    const rtpIcon = document.getElementById('rtpIcon');
    const healthScore = document.getElementById('healthScore');
    const healthDetail = document.getElementById('healthDetail');
    const healthIcon = document.getElementById('healthIcon');
    const healthCard = document.getElementById('healthCard');
    let isRtpActive = true;
    let lastHealthResult = null;

    function summarizeHealth(health) {
      const translatedBreakdown = translateHealthReason(health.breakdown || {});
      const entries = Object.values(translatedBreakdown);
      const weak = entries.filter((e) => e.max > 0 && e.points < e.max);
      if (!weak.length) return t('dashboard.healthAllPassing');
      if (weak.length === 1) return weak[0].reason;
      return t('dashboard.healthWeakAreas', { count: weak.length });
    }

    function translateHealthReason(breakdown) {
      const translated = { ...breakdown };
      for (const [key, item] of Object.entries(translated)) {
        // Translate labels
        const labelMap = {
          'Malware Scan Results': 'health.label.malware',
          'Scan Recency': 'health.label.scanRecency',
          'Disk Space': 'health.label.disk',
          'Memory Usage': 'health.label.memory',
          'CPU Load': 'health.label.load',
          'System Uptime': 'health.label.uptime',
          'Real-Time Protection': 'health.label.rtp',
          'Firewall': 'health.label.firewall'
        };
        if (labelMap[item.label]) {
          item.label = t(labelMap[item.label]);
        }

        if (item.reason) {
          // Map known reasons to translation keys
          if (item.reason === 'No scan has been run yet.') {
            item.reason = t('health.reason.noScan');
          } else if (item.reason === 'No threats found in the most recent scan.') {
            item.reason = t('health.reason.noThreats');
          } else if (item.reason.includes('threat match') && item.reason.includes('found in the most recent scan')) {
            // Handle "X threat match(es) found..." and "X threat matches found..."
            const match = item.reason.match(/^(\d+)\s+threat\s+match(?:es)?\s+found/);
            if (match) item.reason = t('health.reason.threatsFound', { count: match[1] });
          } else if (item.reason.startsWith('Last scan ran within the last day.')) {
            item.reason = t('health.reason.scanToday');
          } else if (item.reason.startsWith('Last scan ran ')) {
            const days = item.reason.match(/Last scan ran (\d+) day\(s\) ago/);
            if (days) item.reason = t('health.reason.scanDaysAgo', { days: days[1] });
          } else if (item.reason.startsWith('Low space on:')) {
            // Extract volumes and percentage
            const match = item.reason.match(/Low space on: (.+) \((\d+)% used\)/);
            if (match) item.reason = t('health.reason.diskLowSpace', { volumes: match[1], pct: match[2] });
          } else if (item.reason === 'No user-facing volumes found for disk scoring.') {
            item.reason = t('health.reason.diskNoVolumes');
          } else if (item.reason.startsWith('All volumes healthy')) {
            // Extract percentage
            const pct = item.reason.match(/highest usage (\d+)%/);
            if (pct) item.reason = t('health.reason.diskHealthy', { pct: pct[1] });
          } else if (item.reason.endsWith('% of memory in use.')) {
            // Extract percentage and use translation key
            const pct = item.reason.match(/^(\d+)% of memory in use/);
            if (pct) item.reason = t('health.reason.memoryUsage', { pct: pct[1] });
          } else if (item.reason.startsWith('CPU load at ')) {
            // Extract percentage and use translation key
            const pct = item.reason.match(/CPU load at (\d+)%/);
            if (pct) item.reason = t('health.reason.cpuLoad', { pct: pct[1] });
          } else if (item.reason === 'Rebooted within the last day.') {
            item.reason = t('health.reason.uptimeToday');
          } else if (item.reason.startsWith('Restarted ') && item.reason.includes(' day(s) ago — within normal range.')) {
            const days = item.reason.match(/Restarted (\d+) day\(s\) ago/);
            if (days) item.reason = t('health.reason.uptimeDays', { days: days[1] });
          } else if (item.reason.startsWith('Running ') && item.reason.includes(' days without a restart — consider rebooting soon')) {
            const days = item.reason.match(/Running (\d+) days without a restart/);
            if (days) item.reason = t('health.reason.uptimeWeeks', { days: days[1] });
          } else if (item.reason.startsWith('Running ') && item.reason.includes(' days without a restart — a reboot is recommended')) {
            const days = item.reason.match(/Running (\d+) days without a restart/);
            if (days) item.reason = t('health.reason.uptimeLong', { days: days[1] });
          } else if (item.reason === 'Real-time protection is active.') {
            item.reason = t('health.reason.rtpActive');
          } else if (item.reason === 'Real-time protection is disabled.') {
            item.reason = t('health.reason.rtpDisabled');
          } else if (item.reason === 'Windows Firewall is active.') {
            item.reason = t('health.reason.firewallActive');
          } else if (item.reason === 'Windows Firewall is disabled.') {
            item.reason = t('health.reason.firewallDisabled');
          } else if (item.reason.startsWith('Last scan ran ') && item.reason.includes(' day(s) ago.')) {
            const days = item.reason.match(/Last scan ran (\d+) day\(s\) ago/);
            if (days) item.reason = t('health.reason.scanDaysAgo', { days: days[1] });
          } else if (item.reason.startsWith('Low space on:') && item.reason.includes('used)')) {
            item.reason = item.reason; // Keep dynamic
          } else if (item.reason.startsWith('All volumes healthy')) {
            item.reason = item.reason; // Keep dynamic
          } else if (item.reason.startsWith('CPU load at')) {
            item.reason = item.reason; // Keep dynamic
          } else if (item.reason.startsWith('Restarted ')) {
            const days = item.reason.match(/Restarted (\d+) day\(s\) ago/);
            if (days) item.reason = t('health.reason.uptimeDays', { days: days[1] });
          }
        }
      }
      return translated;
    }

    function showHealthDetailModal(health) {
      if (!health) return;
      const translatedBreakdown = translateHealthReason(health.breakdown || {});
      const entries = Object.values(translatedBreakdown);
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:1000; padding:24px;';
      overlay.innerHTML = `
        <div class="panel" style="max-width:520px; width:100%; max-height:80vh; overflow:auto;">
          <div class="flex-between">
            <div>
              <div class="panel-title">${escapeHtml(t('dashboard.healthScore'))}</div>
              <div class="page-subtitle" style="font-size:0.85rem;">${escapeHtml(t('dashboard.healthScoreDetail', { score: String(health.score) }))}</div>
            </div>
            <button class="btn btn-sm" id="closeHealthModal">${escapeHtml(t('common.close'))}</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px; margin-top:16px;">
            ${entries.map((item) => `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:4px;">
                  <span style="font-weight:600;">${escapeHtml(item.label || '')}</span>
                  <span class="page-subtitle" style="font-size:0.85rem;">${escapeHtml(String(item.points))}/${escapeHtml(String(item.max))}</span>
                </div>
                <div class="stat-bar-track" style="height:6px;">
                  <div class="stat-bar-fill" style="width:${item.max ? (item.points / item.max) * 100 : 0}%; background:${item.points >= item.max ? 'var(--ok)' : item.points === 0 ? 'var(--danger)' : 'var(--warn)'};"></div>
                </div>
                <div class="page-subtitle" style="font-size:0.8rem; margin-top:4px;">${escapeHtml(item.reason || '')}</div>
              </div>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      overlay.querySelector('#closeHealthModal').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }

    function parseSqliteTimestamp(value) {
      if (!value) return new Date(NaN);
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return new Date(value.replace(' ', 'T') + 'Z');
      }
      return new Date(value);
    }

    async function loadLastScan() {
      const el = container.querySelector('#lastScanTime');
      if (!el) return;
      const latest = await window.api.invoke('scanReports:latest');
      el.textContent = latest
        ? `${parseSqliteTimestamp(latest.timestamp).toLocaleString()} (${latest.status})`
        : t('dashboard.lastScanNever');
    }

    function translateWarning(w) {
      const trans = warningTranslations[w.title];
      if (trans) {
        return {
          ...w,
          title: t(trans.title),
          detail: t(trans.detail)
        };
      }
      return w;
    }

    async function loadWarnings() {
      const warningList = document.getElementById('warningList');
      const ignoredList = document.getElementById('ignoredWarningList');
      if (!warningList || !ignoredList) return;
      try {
        const data = await Api.runTool('security-overview', {});
        const warnings = (data.recommendations || []).filter((i) => i.level === 'warn' || i.level === 'danger');
        const translatedWarnings = warnings.map(translateWarning);
        warningList.innerHTML = translatedWarnings.length ? translatedWarnings.map((w) => `
          <div class="history-item">
            <div>
              <div class="history-title">${escapeHtml(w.title)} <span class="log-tag ${w.level === 'danger' ? 'match' : 'warn'}">${escapeHtml(w.level)}</span></div>
              <div class="history-meta">${escapeHtml(w.detail)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm" data-open-warning="${escapeHtml(w.actionPage || 'dashboard')}">${escapeHtml(t('dashboard.warningOpen'))}</button>
              <button class="btn btn-sm" data-ignore-warning="${escapeHtml(w.id || w.title)}" data-title="${escapeHtml(w.title)}" data-detail="${escapeHtml(w.detail)}">${escapeHtml(t('dashboard.warningIgnore'))}</button>
            </div>
          </div>`).join('') : `<div class="empty-state">${escapeHtml(t('dashboard.noWarnings'))}</div>`;
        warningList.querySelectorAll('[data-open-warning]').forEach((btn) => btn.addEventListener('click', () => window.AppRouter.navigate(btn.dataset.openWarning)));
        warningList.querySelectorAll('[data-ignore-warning]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = btn.closest('.history-item');
          btn.disabled = true;
          try {
            await window.api.invoke('warnings:ignore', { id: btn.dataset.ignoreWarning, title: btn.dataset.title, detail: btn.dataset.detail });
            if (item) item.remove();
            await loadWarnings();
          } catch (err) {
            btn.disabled = false;
            alert(err.message || t('common.failed'));
          }
        }));

        const ignored = await window.api.invoke('warnings:listIgnored');
        // Also translate ignored warnings if they match our known warnings
        const translatedIgnored = ignored.map(w => {
          const trans = warningTranslations[w.title];
          if (trans) return { ...w, title: t(trans.title), detail: t(trans.detail) };
          return w;
        });
        ignoredList.innerHTML = translatedIgnored.length ? translatedIgnored.map((w) => `
          <div class="history-item">
            <div>
              <div class="history-title">${escapeHtml(w.title)}</div>
              <div class="history-meta">${escapeHtml(w.detail || '')}</div>
            </div>
            <button class="btn btn-sm" data-unignore-warning="${escapeHtml(w.id)}">${escapeHtml(t('dashboard.warningRestore'))}</button>
          </div>`).join('') : `<div class="empty-state">${escapeHtml(t('dashboard.noIgnoredWarnings'))}</div>`;
        ignoredList.querySelectorAll('[data-unignore-warning]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = btn.closest('.history-item');
          btn.disabled = true;
          try {
            await window.api.invoke('warnings:unignore', btn.dataset.unignoreWarning);
            if (item) item.remove();
            await loadWarnings();
          } catch (err) {
            btn.disabled = false;
            alert(err.message || t('common.failed'));
          }
        }));
      } catch (err) {
        if (warningList) warningList.innerHTML = `<div class="empty-state">${escapeHtml(t('common.error') + ': ' + err.message)}</div>`;
      }
    }

    function errorMessage(err) {
      try {
        if (!err) return '';
        const message = typeof err === 'string' ? err : err.message || String(err);
        const match = message.match(/Error invoking remote method ['"].*?['"]:\s*(.*)/);
        if (match && match[1]) return match[1];
        return message;
      } catch (_) {
        return t('common.errorUnknown');
      }
    }

    function setRtpState(active) {
      isRtpActive = !!active;
      btnToggleRtp.textContent = isRtpActive ? t('dashboard.rtpDisable') : t('dashboard.rtpEnable');
      rtpStatusText.textContent = isRtpActive ? t('dashboard.rtpActive') : t('dashboard.rtpDisabled');
      rtpIcon.className = 'status-icon ' + (isRtpActive ? 'safe' : 'danger');
    }

    try {
      isRtpActive = await window.api.invoke('rtp:status');
      setRtpState(isRtpActive);
    } catch (_) {
      setRtpState(false);
    }
    window.api.invoke('splash:progress', { pct: 35, label: t('splash.checkingProtection') });

    let fwEnabled = null;
    try {
      fwEnabled = await window.api.invoke('firewall:status');
      const fwIcon = document.getElementById('fwIcon');
      const fwStatusText = document.getElementById('fwStatusText');
      if (fwStatusText) fwStatusText.textContent = fwEnabled ? t('dashboard.firewallActive') : t('dashboard.firewallDisabled');
      if (fwIcon) fwIcon.className = 'status-icon ' + (fwEnabled ? 'safe' : 'danger');
    } catch (_) {
      fwEnabled = null;
      const fwIcon = document.getElementById('fwIcon');
      const fwStatusText = document.getElementById('fwStatusText');
      if (fwStatusText) fwStatusText.textContent = t('common.unknown');
      if (fwIcon) fwIcon.className = 'status-icon warning';
    }
    window.api.invoke('splash:progress', { pct: 50, label: t('splash.verifyingFirewall') });

    let latestScanForHealth = null;
    try {
      latestScanForHealth = await window.api.invoke('scanReports:latest');
    } catch (_) {
      latestScanForHealth = null;
    }

    const lastScanEl = container.querySelector('#lastScanTime');
    if (lastScanEl) {
      lastScanEl.textContent = latestScanForHealth
        ? `${parseSqliteTimestamp(latestScanForHealth.timestamp).toLocaleString()} (${latestScanForHealth.status})`
        : t('dashboard.lastScanNever');
    }

    try {
      const health = await window.api.invoke('health:score', {
        lastScanMatches: latestScanForHealth ? (latestScanForHealth.threats_found ?? null) : null,
        lastScanDate: latestScanForHealth ? latestScanForHealth.timestamp : null,
        rtpActive: isRtpActive,
        firewallActive: fwEnabled === null ? undefined : fwEnabled
      });
      lastHealthResult = health;
      healthScore.textContent = String(health.score);
      const level = health.score >= 80 ? 'safe' : health.score >= 60 ? 'warning' : 'danger';
      healthIcon.className = 'status-icon ' + level;
      healthDetail.textContent = summarizeHealth(health);
    } catch (e) {
      healthScore.textContent = t('common.notAvailable');
      healthDetail.textContent = e.message || t('common.failed');
      healthIcon.className = 'status-icon warning';
    }
    window.api.invoke('splash:progress', { pct: 65, label: t('splash.calculatingHealth') });

    const btnManageFirewall = document.getElementById('btnManageFirewall');
    if (btnManageFirewall) {
      btnManageFirewall.addEventListener('click', () => {
        if (window.AppRouter) window.AppRouter.navigate('firewall');
      });
    }

    // Add click handler for health card to show detail modal
    if (healthCard) {
      healthCard.addEventListener('click', () => {
        showHealthDetailModal(lastHealthResult);
      });
    }

    const btnRefreshWarnings = container.querySelector('#btnRefreshWarnings');
    const btnQuickScan = document.getElementById('btnQuickScan');
    const btnFullScan = document.getElementById('btnFullScan');
    const btnUpdateDb = document.getElementById('btnUpdateDb');
    const btnViewQuarantine = document.getElementById('btnViewQuarantine');
    const originalQuickLabel = btnQuickScan ? btnQuickScan.textContent : t('dashboard.quickScan');
    const originalFullLabel = btnFullScan ? btnFullScan.textContent : t('dashboard.fullScan');
    if (btnRefreshWarnings) btnRefreshWarnings.addEventListener('click', loadWarnings);
    if (btnUpdateDb) {
      btnUpdateDb.addEventListener('click', async () => {
        btnUpdateDb.disabled = true;
        const originalText = btnUpdateDb.textContent;
        btnUpdateDb.textContent = t('scanner.updatingDefs');
        try {
          const res = await window.api.invoke('scan:updateDefinitions');
          if (res && !res.success) {
            alert(res.error || t('scanner.defsUpdateFailed'));
          }
        } catch (err) {
          alert(err.message || t('scanner.defsUpdateFailed'));
        } finally {
          btnUpdateDb.disabled = false;
          btnUpdateDb.textContent = originalText;
        }
      });
    }
    if (btnViewQuarantine) {
      btnViewQuarantine.addEventListener('click', () => {
        if (window.AppRouter) window.AppRouter.navigate('quarantine');
      });
    }
    await loadWarnings();
    window.api.invoke('splash:progress', { pct: 75, label: t('splash.loadingWarnings') });

    btnToggleRtp.addEventListener('click', async () => {
      const previous = isRtpActive;
      const next = !isRtpActive;
      btnToggleRtp.disabled = true;
      btnToggleRtp.textContent = next ? t('dashboard.rtpEnabling') : t('dashboard.rtpDisabling');
      try {
        const status = await window.api.invoke('rtp:toggle', next);
        await window.api.invoke('db:setSetting', 'feature.realtimeProtection', !!status);
        setRtpState(status);
      } catch (err) {
        setRtpState(previous);
        alert(errorMessage(err) || t('common.failed'));
      } finally {
        btnToggleRtp.disabled = false;
      }
    });

    if (btnQuickScan) {
      btnQuickScan.addEventListener('click', async () => {
        const lastScanEl = container.querySelector('#lastScanTime');
        if (lastScanEl) lastScanEl.textContent = t('scanner.statusScanning');
        btnQuickScan.disabled = true;
        btnQuickScan.textContent = t('scanner.statusScanning');
        try {
          const res = await window.api.invoke('scan:quick');
          if (res.error) {
            alert(res.error);
          } else if (container.querySelector('#lastScanTime')) {
            await loadLastScan();
          }
        } catch (e) {
          alert(t('scanner.scanFailed', { error: e }));
        } finally {
          btnQuickScan.disabled = false;
          btnQuickScan.textContent = originalQuickLabel;
        }
      });
    }

    if (btnFullScan) {
      btnFullScan.addEventListener('click', async () => {
        const lastScanEl = container.querySelector('#lastScanTime');
        if (lastScanEl) lastScanEl.textContent = t('scanner.statusScanning');
        btnFullScan.disabled = true;
        btnFullScan.textContent = t('scanner.statusScanning');
        try {
          const res = await window.api.invoke('scan:full');
          if (res.error) {
            alert(res.error);
          } else if (container.querySelector('#lastScanTime')) {
            await loadLastScan();
          }
        } catch (e) {
          alert(t('scanner.scanFailed', { error: e }));
        } finally {
          btnFullScan.disabled = false;
          btnFullScan.textContent = originalFullLabel;
        }
      });
    }

    try {
      await loadLastScan();
      window.api.invoke('splash:progress', { pct: 85, label: t('dashboard.lastScan') });

      const quarantineList = await window.api.invoke('db:getQuarantineList');
      if (quarantineList) {
        const threatsCountEl = container.querySelector('#threatsCount');
        if (threatsCountEl) {
          threatsCountEl.textContent = quarantineList.length;
        }
      }
      window.api.invoke('splash:progress', { pct: 90, label: t('nav.quarantine') });
    } catch (e) {
      console.warn('Failed to load dashboard data:', e);
    }

    try {
      window.api.invoke('splash:progress', { pct: 100, label: t('splash.ready') });
      // Small delay to allow progress bar to finish animating to 100%
      await new Promise(resolve => setTimeout(resolve, 300));
      await window.api.invoke('app:ready');
    } catch (_) {
    }
  }
};