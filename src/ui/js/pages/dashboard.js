window.Pages = window.Pages || {};

// Module-level cache so the expensive dashboard reads (security-overview
// tool call + health score) survive navigating away and back. Entries are
// invalidated on any mutation (ignore/restore/action, scan completion,
// RTP toggle) or expire after the TTL.
const dashboardCache = {
  overview: { ts: 0, data: null },
  health: { ts: 0, data: null }
};
const dashboardCacheTtl = 60_000; // 60 seconds

function invalidateDashboardCache() {
  dashboardCache.overview = { ts: 0, data: null };
  dashboardCache.health = { ts: 0, data: null };
}

// Shared invalidation hook for other pages whose mutations feed the
// dashboard's cached reads (e.g. the firewall profile toggle changes the
// firewall status the health score is computed from).
window.DashboardCache = { invalidate: invalidateDashboardCache };

window.Pages['dashboard'] = {
  cleanups: [],
  destroy() {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
  },
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    let alive = true;
    this.cleanups.push(() => { alive = false; });

    function hasView() {
      return alive && document.body.contains(container);
    }

    // Warning metadata for security-overview tool. Single source of truth:
    // each entry is keyed by the raw warning title and carries both the i18n
    // keys used to translate it and the action button used to resolve it.
    const warningActions = {
      'Real-time protection is disabled': {
        title: 'dashboard.warn.rtpDisabled.title',
        detail: 'dashboard.warn.rtpDisabled.detail',
        label: 'dashboard.action.enableRtp',
        handler: async () => {
          await window.api.invoke('rtp:toggle', true);
          await window.api.invoke('db:setSetting', 'feature.realtimeProtection', true);
        }
      },
      'Folder watch is disabled': {
        title: 'dashboard.warn.folderWatchDisabled.title',
        detail: 'dashboard.warn.folderWatchDisabled.detail',
        label: 'dashboard.action.enableFolderWatch',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.folderWatch', true);
        }
      },
      'Suspicious network alerts are disabled': {
        title: 'dashboard.warn.networkAlertsDisabled.title',
        detail: 'dashboard.warn.networkAlertsDisabled.detail',
        label: 'dashboard.action.enableNetworkAlerts',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.networkAlerts', true);
        }
      },
      'Network traffic history is disabled': {
        title: 'dashboard.warn.networkTrafficHistoryDisabled.title',
        detail: 'dashboard.warn.networkTrafficHistoryDisabled.detail',
        label: 'dashboard.action.enableHistory',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.networkTrafficHistory', true);
        }
      },
      'Auto-generate reports is disabled': {
        title: 'dashboard.warn.autoReportsDisabled.title',
        detail: 'dashboard.warn.autoReportsDisabled.detail',
        label: 'dashboard.action.enableReports',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.autoReports', true);
        }
      },
      'Scan history is disabled': {
        title: 'dashboard.warn.scanHistoryDisabled.title',
        detail: 'dashboard.warn.scanHistoryDisabled.detail',
        label: 'dashboard.action.enableHistory',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.scanHistory', true);
        }
      },
      'External lookups are disabled': {
        title: 'dashboard.warn.externalLookupsDisabled.title',
        detail: 'dashboard.warn.externalLookupsDisabled.detail',
        label: 'dashboard.action.enableLookups',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.externalLookups', true);
        }
      },
      'Geolocation heat map is disabled': {
        title: 'dashboard.warn.geoLookupDisabled.title',
        detail: 'dashboard.warn.geoLookupDisabled.detail',
        label: 'dashboard.action.enableGeo',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.geoLookup', true);
        }
      },
      'Network perimeter map is disabled': {
        title: 'dashboard.warn.perimeterMapDisabled.title',
        detail: 'dashboard.warn.perimeterMapDisabled.detail',
        label: 'dashboard.action.enableMap',
        handler: async () => {
          await window.api.invoke('db:setSetting', 'feature.networkPerimeterMap', true);
        }
      },
      'ClamAV definitions are outdated': {
        title: 'dashboard.warn.definitionsOutdated.title',
        detail: 'dashboard.warn.definitionsOutdated.detail',
        label: 'dashboard.action.updateDefinitions',
        handler: async () => {
          const res = await window.api.invoke('scan:updateDefinitions');
          if (res && !res.success) throw new Error(res.error || t('scanner.defsUpdateFailed'));
        }
      },
      'Windows Firewall is disabled': {
        title: 'dashboard.warn.firewallDisabled.title',
        detail: 'dashboard.warn.firewallDisabled.detail',
        label: 'dashboard.action.enableFirewall',
        handler: async () => {
          await window.api.invoke('firewall:enableAll');
        }
      },
      'High memory usage detected': {
        title: 'dashboard.warn.highMemory.title',
        detail: 'dashboard.warn.highMemory.detail',
        label: 'dashboard.action.runCleanup',
        handler: async () => {
          await window.api.invoke('tools:runScript', 'clearTempFiles');
        }
      },
      'High CPU usage detected': {
        title: 'dashboard.warn.highCpu.title',
        detail: 'dashboard.warn.highCpu.detail',
        label: 'dashboard.action.runCleanup',
        handler: async () => {
          await window.api.invoke('tools:runScript', 'clearTempFiles');
        }
      },
      'Low disk space': {
        title: 'dashboard.warn.lowDisk.title',
        detail: 'dashboard.warn.lowDisk.detail',
        label: 'dashboard.action.diskCleanup',
        handler: async () => {
          await window.api.invoke('tools:runScript', 'largeFilesReport');
        }
      }
    };

    function translateWarning(w) {
      const meta = warningActions[w.title];
      if (meta) return { ...w, title: t(meta.title), detail: t(meta.detail) };
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

async function loadWarnings() {
      const warningList = document.getElementById('warningList');
      const ignoredList = document.getElementById('ignoredWarningList');
      if (!warningList || !ignoredList) return;
      try {
        // Only the slow security-overview tool call is cached; the ignored
        // list always comes fresh from the DB so Restore/Ignore take effect
        // immediately instead of rendering from stale cached recommendations.
        const now = Date.now();
        let data = dashboardCache.overview.data;
        if (data === null || now - dashboardCache.overview.ts >= dashboardCacheTtl) {
          data = await Api.runTool('security-overview', {});
          dashboardCache.overview.data = data;
          dashboardCache.overview.ts = now;
        }

        const translatedWarnings = (data.recommendations || [])
          .filter((i) => i.level === 'warn' || i.level === 'danger')
          .map(translateWarning);
        warningList.innerHTML = translatedWarnings.length ? translatedWarnings.map((w) => {
          const action = warningActions[w.title];
          const actionButton = action ? `<button class="btn btn-sm btn-primary" data-action-warning="${escapeHtml(w.title)}">${escapeHtml(t(action.label))}</button>` : '';
          return `
          <div class="history-item">
            <div>
              <div class="history-title">${escapeHtml(w.title)} <span class="log-tag ${w.level === 'danger' ? 'match' : 'warn'}">${escapeHtml(w.level)}</span></div>
              <div class="history-meta">${escapeHtml(w.detail)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              ${actionButton}
              <button class="btn btn-sm" data-open-warning="${escapeHtml(w.actionPage || 'dashboard')}">${escapeHtml(t('dashboard.warningOpen'))}</button>
              <button class="btn btn-sm" data-ignore-warning="${escapeHtml(w.id || w.title)}" data-title="${escapeHtml(w.title)}" data-detail="${escapeHtml(w.detail)}">${escapeHtml(t('dashboard.warningIgnore'))}</button>
            </div>
          </div>`;
        }).join('') : `<div class="empty-state">${escapeHtml(t('dashboard.noWarnings'))}</div>`;

        // Re-attach event listeners (they were lost when innerHTML was set)
        warningList.querySelectorAll('[data-open-warning]').forEach((btn) => btn.addEventListener('click', () => window.AppRouter.navigate(btn.dataset.openWarning)));
        warningList.querySelectorAll('[data-action-warning]').forEach((btn) => btn.addEventListener('click', async () => {
          const warningTitle = btn.dataset.actionWarning;
          const action = warningActions[warningTitle];
          if (!action) return;

          const item = btn.closest('.history-item');
          const originalText = btn.textContent;
          btn.disabled = true;
          btn.textContent = t('common.loading');

          try {
            await action.handler();
            invalidateDashboardCache();
            await loadWarnings();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = originalText;
            alert(err.message || t('common.failed'));
          }
        }));
        warningList.querySelectorAll('[data-ignore-warning]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = btn.closest('.history-item');
          btn.disabled = true;
          try {
            await window.api.invoke('warnings:ignore', { id: btn.dataset.ignoreWarning, title: btn.dataset.title, detail: btn.dataset.detail });
            if (item) item.remove();
            invalidateDashboardCache();
            await loadWarnings();
          } catch (err) {
            btn.disabled = false;
            alert(err.message || t('common.failed'));
          }
        }));

        const ignored = await window.api.invoke('warnings:listIgnored');
        // Also translate ignored warnings if they match our known warnings
        const translatedIgnored = ignored.map(w => {
          const meta = warningActions[w.title];
          if (meta) return { ...w, title: t(meta.title), detail: t(meta.detail) };
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
            invalidateDashboardCache();
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
      if (btnToggleRtp) btnToggleRtp.textContent = isRtpActive ? t('dashboard.rtpDisable') : t('dashboard.rtpEnable');
      if (rtpStatusText) rtpStatusText.textContent = isRtpActive ? t('dashboard.rtpActive') : t('dashboard.rtpDisabled');
      if (rtpIcon) rtpIcon.className = 'status-icon ' + (isRtpActive ? 'safe' : 'danger');
    }

    window.api.invoke('splash:progress', { pct: 35, label: t('splash.checkingProtection') });

    // Fetch the independent dashboard reads concurrently instead of one at a
    // time so the splash doesn't linger on the slowest sequential call.
    const [rtpResult, fwResult, scanResult, quarantineResult] = await Promise.allSettled([
      window.api.invoke('rtp:status'),
      window.api.invoke('firewall:status'),
      window.api.invoke('scanReports:latest'),
      window.api.invoke('quarantine:list', 'quarantined')
    ]);

    isRtpActive = rtpResult.status === 'fulfilled' ? !!rtpResult.value : false;
    setRtpState(isRtpActive);
    window.api.invoke('splash:progress', { pct: 40, label: t('splash.checkingProtection') });

    let fwEnabled = null;
    if (fwResult.status === 'fulfilled') {
      fwEnabled = fwResult.value;
    }
    const fwIcon = document.getElementById('fwIcon');
    const fwStatusText = document.getElementById('fwStatusText');
    if (fwEnabled === null) {
      if (fwStatusText) fwStatusText.textContent = t('common.unknown');
      if (fwIcon) fwIcon.className = 'status-icon warning';
    } else {
      if (fwStatusText) fwStatusText.textContent = fwEnabled ? t('dashboard.firewallActive') : t('dashboard.firewallDisabled');
      if (fwIcon) fwIcon.className = 'status-icon ' + (fwEnabled ? 'safe' : 'danger');
    }
    window.api.invoke('splash:progress', { pct: 50, label: t('splash.verifyingFirewall') });

    const latestScanForHealth = scanResult.status === 'fulfilled' ? scanResult.value : null;
    const lastScanEl = container.querySelector('#lastScanTime');
    if (lastScanEl) {
      lastScanEl.textContent = latestScanForHealth
        ? `${parseSqliteTimestamp(latestScanForHealth.timestamp).toLocaleString()} (${latestScanForHealth.status})`
        : t('dashboard.lastScanNever');
    }

    if (quarantineResult.status === 'fulfilled' && quarantineResult.value) {
      const threatsCountEl = container.querySelector('#threatsCount');
      if (threatsCountEl) {
        threatsCountEl.textContent = quarantineResult.value.length;
      }
    }
      window.api.invoke('splash:progress', { pct: 55, label: t('splash.loadingQuarantine') });

    // health:score depends on the reads above; warnings (security-overview,
    // the slowest call) is independent, so run both concurrently. Both are
    // cached at module scope so re-entering the dashboard is instant.
    const [healthResult, warningsResult] = await Promise.allSettled([
      (async () => {
        const hNow = Date.now();
        if (dashboardCache.health.data !== null && hNow - dashboardCache.health.ts < dashboardCacheTtl) {
          return dashboardCache.health.data;
        }
        const result = await window.api.invoke('health:score', {
          lastScanMatches: latestScanForHealth ? (latestScanForHealth.threats_found ?? null) : null,
          lastScanDate: latestScanForHealth ? latestScanForHealth.timestamp : null,
          rtpActive: isRtpActive,
          firewallActive: fwEnabled === null ? undefined : fwEnabled
        });
        dashboardCache.health.data = result;
        dashboardCache.health.ts = Date.now();
        return result;
      })(),
      loadWarnings()
    ]);

    if (healthResult.status === 'fulfilled') {
      lastHealthResult = healthResult.value;
      healthScore.textContent = String(healthResult.value.score);
      const level = healthResult.value.score >= 80 ? 'safe' : healthResult.value.score >= 60 ? 'warning' : 'danger';
      healthIcon.className = 'status-icon ' + level;
      healthDetail.textContent = summarizeHealth(healthResult.value);
    } else {
      healthScore.textContent = t('common.notAvailable');
      healthDetail.textContent = (healthResult.reason && healthResult.reason.message) || t('common.failed');
      healthIcon.className = 'status-icon warning';
    }
    window.api.invoke('splash:progress', { pct: 65, label: t('splash.calculatingHealth') });
    if (warningsResult.status === 'rejected') {
      console.warn('Failed to load dashboard warnings:', warningsResult.reason);
    }
    window.api.invoke('splash:progress', { pct: 75, label: t('splash.loadingWarnings') });

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

    function setScanButtonsState(scanning) {
      if (!hasView()) return;
      if (btnQuickScan) {
        btnQuickScan.disabled = scanning;
        btnQuickScan.textContent = scanning ? t('scanner.statusScanning') : originalQuickLabel;
      }
      if (btnFullScan) {
        btnFullScan.disabled = scanning;
        btnFullScan.textContent = scanning ? t('scanner.statusScanning') : originalFullLabel;
      }
      const lastScanEl = container.querySelector('#lastScanTime');
      if (lastScanEl && scanning) {
        lastScanEl.textContent = t('scanner.statusScanning');
      }
      if (btnUpdateDb) {
        btnUpdateDb.disabled = scanning;
      }
    }

    async function restoreScanRunningState() {
      if (!hasView()) return;
      try {
        const status = await window.api.invoke('scan:status');
        if (!hasView()) return;
        if (status.scan && status.scan.isScanning) {
          setScanButtonsState(true);
        }
      } catch (_) {
        // Status query must never break dashboard rendering.
      }
    }

    if (btnRefreshWarnings) btnRefreshWarnings.addEventListener('click', () => { invalidateDashboardCache(); loadWarnings(); });
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

    btnToggleRtp.addEventListener('click', async () => {
      const previous = isRtpActive;
      const next = !isRtpActive;
      btnToggleRtp.disabled = true;
      btnToggleRtp.textContent = next ? t('dashboard.rtpEnabling') : t('dashboard.rtpDisabling');
      try {
        const status = await window.api.invoke('rtp:toggle', next);
        await window.api.invoke('db:setSetting', 'feature.realtimeProtection', !!status);
        setRtpState(status);
        invalidateDashboardCache();
      } catch (err) {
        setRtpState(previous);
        alert(errorMessage(err) || t('common.failed'));
      } finally {
        btnToggleRtp.disabled = false;
      }
    });

    if (btnQuickScan) {
      btnQuickScan.addEventListener('click', async () => {
        setScanButtonsState(true);
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
          setScanButtonsState(false);
        }
      });
    }

    if (btnFullScan) {
      btnFullScan.addEventListener('click', async () => {
        setScanButtonsState(true);
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
          setScanButtonsState(false);
        }
      });
    }

    // Listen for scan progress events from other sources (scanner page, tray, etc.)
    this.cleanups.push(window.api.on('scan:progress', (data) => {
      if (!hasView()) return;
      if (data?.scanType === 'folderwatch') return;
      if (data && data.pct !== undefined) {
        setScanButtonsState(true);
      }
    }));

    // Listen for scan complete events to reset button state
    this.cleanups.push(window.api.on('scan:complete', async (data) => {
      if (!hasView()) return;
      if (data?.scanType === 'folderwatch') return;
      setScanButtonsState(false);
      invalidateDashboardCache();
      if (container.querySelector('#lastScanTime')) {
        await loadLastScan();
      }
    }));

    // Restore "Scanning..." state if a scan is already in progress
    // (e.g. page reloaded while a scan is still running).
    restoreScanRunningState();

    window.api.invoke('splash:progress', { pct: 85, label: t('dashboard.lastScan') });
    window.api.invoke('splash:progress', { pct: 90, label: t('splash.loadingQuarantine') });

try {
      window.api.invoke('splash:progress', { pct: 100, label: t('splash.ready') });
      // Small delay to allow progress bar to finish animating to 100%
      await new Promise(resolve => setTimeout(resolve, 300));
      await window.api.invoke('app:ready');
    } catch (_) {
      // app:ready failed or was never reached - ensure splash dismisses
      await window.api.invoke('app:ready').catch(() => {});
}
  }
};