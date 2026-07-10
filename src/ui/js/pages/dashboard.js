window.Pages = window.Pages || {};

window.Pages['dashboard'] = {
  async render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Security Dashboard</h1>
        <p class="page-subtitle">System status and real-time protection overview</p>
      </header>
      <div id="dashboardContent" style="overflow-y:auto; margin-right:8px; padding-right:8px;">
        <div class="dashboard-grid">
          <div class="card" id="healthCard" style="cursor:pointer;" title="Click for a detailed breakdown">
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
                <h3>System Health Score</h3>
                <div class="value" id="healthScore">Loading...</div>
              </div>
            </div>
            <div id="healthDetail" class="page-subtitle" style="margin-top:12px; font-size:0.85rem;">Calculating system health.</div>
            <div class="page-subtitle" style="margin-top:8px; font-size:0.75rem; color:var(--accent-primary);">Click for full breakdown →</div>
          </div>

          <!-- Protection Status -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon safe" id="rtpIcon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
              </div>
              <div class="status-info">
                <h3>Real-Time Protection</h3>
                <div class="value" id="rtpStatusText">Active</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnToggleRtp">Disable</button>
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
                <h3>Windows Firewall</h3>
                <div class="value" id="fwStatusText">Checking...</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnManageFirewall">Manage Firewall</button>
            </div>
          </div>

          <!-- Last Scan -->
          <div class="card">
            <div class="status-card">
              <div class="status-icon info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <div class="status-info">
                <h3>Last Scan</h3>
                <div class="value" id="lastScanTime">Loading...</div>
              </div>
            </div>
            <div style="margin-top: 16px; display: flex; gap: 12px;">
              <button class="btn btn-primary" id="btnQuickScan">Quick Scan</button>
              <button class="btn" id="btnFullScan">Full Scan</button>
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
                <h3>ClamAV Definitions</h3>
                <div class="value" id="dbAge">Up to date</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnUpdateDb">Check for Updates</button>
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
                <h3>Threats Blocked</h3>
                <div class="value" id="threatsCount">0</div>
              </div>
            </div>
            <div style="margin-top: 16px;">
              <button class="btn" id="btnViewQuarantine">View Quarantine</button>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:24px;">
          <div class="flex-between">
            <div>
              <div class="panel-title">Warnings</div>
              <div class="page-subtitle" style="font-size:0.85rem;">Review or ignore warnings you have accepted.</div>
            </div>
            <button class="btn btn-sm" id="btnRefreshWarnings">Refresh</button>
          </div>
          <div id="warningList" class="history-list" style="margin-top:12px;"><div class="empty-state">Loading warnings...</div></div>
          <div class="panel-title" style="margin-top:16px;">Ignored Warnings</div>
          <div id="ignoredWarningList" class="history-list" style="max-height:300px; overflow-y:auto;"><div class="empty-state">Loading ignored warnings...</div></div>
        </div>
      </div>
    `;

    window.api.invoke('splash:progress', { pct: 20, label: 'Loading dashboard...' });

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
      const entries = Object.values(health.breakdown || {});
      const weak = entries.filter((e) => e.max > 0 && e.points < e.max);
      if (!weak.length) return 'All checks passing.';
      if (weak.length === 1) return weak[0].reason;
      return `${weak.length} area(s) need attention — click for details.`;
    }

    function showHealthDetailModal(health) {
      if (!health) return;
      const entries = Object.values(health.breakdown || {});
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:1000; padding:24px;';
      overlay.innerHTML = `
        <div class="panel" style="max-width:520px; width:100%; max-height:80vh; overflow:auto;">
          <div class="flex-between">
            <div>
              <div class="panel-title">System Health Score</div>
              <div class="page-subtitle" style="font-size:0.85rem;">Score: ${escapeHtml(String(health.score))} / 100</div>
            </div>
            <button class="btn btn-sm" id="closeHealthModal">Close</button>
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

    if (healthCard) {
      healthCard.addEventListener('click', () => showHealthDetailModal(lastHealthResult));
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
        : 'Never';
    }

    async function loadWarnings() {
      const warningList = document.getElementById('warningList');
      const ignoredList = document.getElementById('ignoredWarningList');
      if (!warningList || !ignoredList) return;
      try {
        const data = await Api.runTool('security-overview', {});
        const warnings = (data.recommendations || []).filter((i) => i.level === 'warn' || i.level === 'danger');
        warningList.innerHTML = warnings.length ? warnings.map((w) => `
          <div class="history-item">
            <div>
              <div class="history-title">${escapeHtml(w.title)} <span class="log-tag ${w.level === 'danger' ? 'match' : 'warn'}">${escapeHtml(w.level)}</span></div>
              <div class="history-meta">${escapeHtml(w.detail)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm" data-open-warning="${escapeHtml(w.actionPage || 'dashboard')}">Open</button>
              <button class="btn btn-sm" data-ignore-warning="${escapeHtml(w.id || w.title)}" data-title="${escapeHtml(w.title)}" data-detail="${escapeHtml(w.detail)}">Ignore</button>
            </div>
          </div>`).join('') : '<div class="empty-state">No active warnings.</div>';
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
            alert(err.message || 'Unable to ignore warning.');
          }
        }));

        const ignored = await window.api.invoke('warnings:listIgnored');
        ignoredList.innerHTML = ignored.length ? ignored.map((w) => `
          <div class="history-item">
            <div>
              <div class="history-title">${escapeHtml(w.title)}</div>
              <div class="history-meta">${escapeHtml(w.detail || '')}</div>
            </div>
            <button class="btn btn-sm" data-unignore-warning="${escapeHtml(w.id)}">Restore</button>
          </div>`).join('') : '<div class="empty-state">No ignored warnings.</div>';
        ignoredList.querySelectorAll('[data-unignore-warning]').forEach((btn) => btn.addEventListener('click', async () => {
          const item = btn.closest('.history-item');
          btn.disabled = true;
          try {
            await window.api.invoke('warnings:unignore', btn.dataset.unignoreWarning);
            if (item) item.remove();
            await loadWarnings();
          } catch (err) {
            btn.disabled = false;
            alert(err.message || 'Unable to restore warning.');
          }
        }));
      } catch (err) {
        if (warningList) warningList.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
      }
    }

    function errorMessage(err) {
      try {
        if (!err) return '';

        const message = typeof err === 'string'
          ? err
          : err.message || String(err);

        // Remove Electron IPC wrapper:
        const match = message.match(/Error invoking remote method ['"].*?['"]:\s*(.*)/);

        if (match && match[1]) {
          return match[1];
        }

        return message;
      } catch (_) {
        return 'An unknown error occurred.';
      }
    }

    function setRtpState(active) {
      isRtpActive = !!active;
      btnToggleRtp.textContent = isRtpActive ? 'Disable' : 'Enable';
      rtpStatusText.textContent = isRtpActive ? 'Active' : 'Disabled';
      rtpIcon.className = 'status-icon ' + (isRtpActive ? 'safe' : 'danger');
    }

    try {
      isRtpActive = await window.api.invoke('rtp:status');
      setRtpState(isRtpActive);
    } catch (_) {
      setRtpState(false);
    }
    window.api.invoke('splash:progress', { pct: 35, label: 'Checking protection status...' });

    let fwEnabled = null; // null = unknown/unavailable
    try {
      fwEnabled = await window.api.invoke('firewall:status');
      const fwIcon = document.getElementById('fwIcon');
      const fwStatusText = document.getElementById('fwStatusText');
      if (fwStatusText) fwStatusText.textContent = fwEnabled ? 'Active' : 'Disabled';
      if (fwIcon) fwIcon.className = 'status-icon ' + (fwEnabled ? 'safe' : 'danger');
    } catch (_) {
      fwEnabled = null;
      const fwIcon = document.getElementById('fwIcon');
      const fwStatusText = document.getElementById('fwStatusText');
      if (fwStatusText) fwStatusText.textContent = 'Unknown';
      if (fwIcon) fwIcon.className = 'status-icon warning';
    }
    window.api.invoke('splash:progress', { pct: 50, label: 'Verifying firewall...' });

    let latestScanForHealth = null;
    try {
      latestScanForHealth = await window.api.invoke('scanReports:latest');
    } catch (_) {
      latestScanForHealth = null;
    }

    // Set last scan text immediately from the already-fetched data so it never flashes "Never".
    const lastScanEl = container.querySelector('#lastScanTime');
    if (lastScanEl) {
      lastScanEl.textContent = latestScanForHealth
        ? `${parseSqliteTimestamp(latestScanForHealth.timestamp).toLocaleString()} (${latestScanForHealth.status})`
        : 'Never';
    }

    try {
      // Feed in whatever real signals are already available on this page --
      // RTP/firewall status and the latest scan's result and date -- so the
      // score reflects live protection state, not just resource usage.
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
      healthScore.textContent = 'N/A';
      healthDetail.textContent = e.message || 'Unable to calculate health score.';
      healthIcon.className = 'status-icon warning';
    }
    window.api.invoke('splash:progress', { pct: 65, label: 'Calculating health score...' });

    const btnManageFirewall = document.getElementById('btnManageFirewall');
    if (btnManageFirewall) {
      btnManageFirewall.addEventListener('click', () => {
        if (window.AppRouter) window.AppRouter.navigate('firewall');
      });
    }

    const btnRefreshWarnings = container.querySelector('#btnRefreshWarnings');
    const btnQuickScan = document.getElementById('btnQuickScan');
    const btnFullScan = document.getElementById('btnFullScan');
    const btnUpdateDb = document.getElementById('btnUpdateDb');
    const btnViewQuarantine = document.getElementById('btnViewQuarantine');
    const originalQuickLabel = btnQuickScan ? btnQuickScan.textContent : 'Quick Scan';
    const originalFullLabel = btnFullScan ? btnFullScan.textContent : 'Full Scan';
    if (btnRefreshWarnings) btnRefreshWarnings.addEventListener('click', loadWarnings);
    if (btnUpdateDb) {
      btnUpdateDb.addEventListener('click', async () => {
        btnUpdateDb.disabled = true;
        const originalText = btnUpdateDb.textContent;
        btnUpdateDb.textContent = 'Checking...';
        try {
          const res = await window.api.invoke('scan:updateDefinitions');
          if (res && !res.success) {
            alert(res.error || 'Definition update failed.');
          }
        } catch (err) {
          alert(err.message || 'Definition update failed.');
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
    window.api.invoke('splash:progress', { pct: 75, label: 'Loading warnings...' });

    btnToggleRtp.addEventListener('click', async () => {
      const previous = isRtpActive;
      const next = !isRtpActive;
      btnToggleRtp.disabled = true;
      btnToggleRtp.textContent = next ? 'Enabling...' : 'Disabling...';
      try {
        const status = await window.api.invoke('rtp:toggle', next);
        await window.api.invoke('db:setSetting', 'feature.realtimeProtection', !!status);
        setRtpState(status);
      } catch (err) {
        setRtpState(previous);
        alert(errorMessage(err) || 'Unable to update real-time protection.');
      } finally {
        btnToggleRtp.disabled = false;
      }
    });

    // Scan buttons
    if (btnQuickScan) {
      btnQuickScan.addEventListener('click', async () => {
        const lastScanEl = container.querySelector('#lastScanTime');
        if (lastScanEl) lastScanEl.textContent = 'Scanning...';
        btnQuickScan.disabled = true;
        btnQuickScan.textContent = 'Scanning...';
        try {
          const res = await window.api.invoke('scan:quick');
          if (res.error) {
            alert(res.error);
          } else if (container.querySelector('#lastScanTime')) {
            await loadLastScan();
          }
        } catch (e) {
          alert('Scan failed: ' + e);
        } finally {
          btnQuickScan.disabled = false;
          btnQuickScan.textContent = originalQuickLabel;
        }
      });
    }

    if (btnFullScan) {
      btnFullScan.addEventListener('click', async () => {
        const lastScanEl = container.querySelector('#lastScanTime');
        if (lastScanEl) lastScanEl.textContent = 'Scanning...';
        btnFullScan.disabled = true;
        btnFullScan.textContent = 'Scanning...';
        try {
          const res = await window.api.invoke('scan:full');
          if (res.error) {
            alert(res.error);
          } else if (container.querySelector('#lastScanTime')) {
            await loadLastScan();
          }
        } catch (e) {
          alert('Scan failed: ' + e);
        } finally {
          btnFullScan.disabled = false;
          btnFullScan.textContent = originalFullLabel;
        }
      });
    }

    // We could fetch scan history and quarantine count here from API
    try {
      await loadLastScan();
      window.api.invoke('splash:progress', { pct: 85, label: 'Loading scan history...' });

      const quarantineList = await window.api.invoke('db:getQuarantineList');
      if (quarantineList) {
        const threatsCountEl = container.querySelector('#threatsCount');
        if (threatsCountEl) {
          threatsCountEl.textContent = quarantineList.length;
        }
      }
      window.api.invoke('splash:progress', { pct: 90, label: 'Checking quarantine...' });
    } catch (e) {
      console.warn('Failed to load dashboard data:', e);
    }

    // Signal the main process that the Dashboard has actually finished
    // loading its data, so it can dismiss the startup splash screen and show
    // the main window now rather than as soon as the HTML merely parsed.
    // Placed after all the try/catch blocks above (each already handles its
    // own failures independently) so this always fires exactly once the
    // initial load sequence settles, success or partial failure alike.
    try {
      window.api.invoke('splash:progress', { pct: 100, label: 'Ready' });
      await window.api.invoke('app:ready');
    } catch (_) {
      // If this fails for some reason, main.js's own fallback timeout will
      // still show the window after a few seconds rather than leaving the
      // user stuck on the splash screen indefinitely.
    }
  }
};