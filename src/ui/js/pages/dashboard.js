window.Pages = window.Pages || {};

window.Pages['dashboard'] = {
  async render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Security Dashboard</h1>
        <p class="page-subtitle">System status and real-time protection overview</p>
      </header>

      <div class="dashboard-grid">
        <div class="card">
          <div class="status-card">
            <div class="status-icon info" id="healthIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
            </div>
            <div class="status-info">
              <h3>System Health Score</h3>
              <div class="value" id="healthScore">Loading...</div>
            </div>
          </div>
          <div id="healthDetail" class="page-subtitle" style="margin-top:12px; font-size:0.85rem;">Calculating system health.</div>
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

        <!-- Last Scan -->
        <div class="card">
          <div class="status-card">
            <div class="status-icon info">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <div class="status-info">
              <h3>Last Scan</h3>
              <div class="value" id="lastScanTime">Never</div>
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div class="status-info">
              <h3>Threats Blocked</h3>
              <div class="value" id="threatsCount">0</div>
            </div>
          </div>
          <div style="margin-top: 16px;">
            <button class="btn" onclick="window.AppRouter.navigate('quarantine')">View Quarantine</button>
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
        <div id="ignoredWarningList" class="history-list"><div class="empty-state">Loading ignored warnings...</div></div>
      </div>
    `;

    const btnToggleRtp = document.getElementById('btnToggleRtp');
    const rtpStatusText = document.getElementById('rtpStatusText');
    const rtpIcon = document.getElementById('rtpIcon');
    const healthScore = document.getElementById('healthScore');
    const healthDetail = document.getElementById('healthDetail');
    const healthIcon = document.getElementById('healthIcon');
    let isRtpActive = true;

    async function loadLastScan() {
      const el = container.querySelector('#lastScanTime');
      if (!el) return;
      const latest = await window.api.invoke('scanReports:latest');
      el.textContent = latest
        ? `${new Date(latest.timestamp).toLocaleString()} (${latest.status})`
        : 'Never';
    }

    async function loadWarnings() {
      const warningList = document.getElementById('warningList');
      const ignoredList = document.getElementById('ignoredWarningList');
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
        warningList.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
      }
    }

    function setRtpState(active) {
      isRtpActive = !!active;
      btnToggleRtp.textContent = isRtpActive ? 'Disable' : 'Enable';
      rtpStatusText.textContent = isRtpActive ? 'Active' : 'Disabled';
      rtpIcon.className = 'status-icon ' + (isRtpActive ? 'safe' : 'danger');
    }

    try {
      setRtpState(await window.api.invoke('rtp:status'));
    } catch (_) {
      setRtpState(false);
    }

    try {
      const health = await window.api.invoke('health:score');
      healthScore.textContent = String(health.score);
      const level = health.score >= 80 ? 'safe' : health.score >= 60 ? 'warning' : 'danger';
      healthIcon.className = 'status-icon ' + level;
      healthDetail.textContent = Object.values(health.breakdown || {}).map((item) => item.reason).join(' | ');
    } catch (e) {
      healthScore.textContent = 'N/A';
      healthDetail.textContent = e.message || 'Unable to calculate health score.';
      healthIcon.className = 'status-icon warning';
    }
    const btnRefreshWarnings = container.querySelector('#btnRefreshWarnings');
    if (btnRefreshWarnings) btnRefreshWarnings.addEventListener('click', loadWarnings);
    await loadWarnings();

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
        alert(err.message || 'Unable to update real-time protection.');
      } finally {
        btnToggleRtp.disabled = false;
      }
    });

    // Scan buttons
    document.getElementById('btnQuickScan').addEventListener('click', async () => {
      const lastScanEl = container.querySelector('#lastScanTime');
      if (lastScanEl) lastScanEl.textContent = 'Scanning...';
      try {
        const res = await window.api.invoke('scan:quick');
        if (res.error) alert(res.error);
        else {
          if (container.querySelector('#lastScanTime')) await loadLastScan();
          alert(res.canceled ? 'Scan canceled.' : 'Scan completed.');
        }
      } catch(e) {
        alert('Scan failed: ' + e);
      }
    });

    document.getElementById('btnFullScan').addEventListener('click', async () => {
      const lastScanEl = container.querySelector('#lastScanTime');
      if (lastScanEl) lastScanEl.textContent = 'Scanning...';
      try {
        const res = await window.api.invoke('scan:full');
        if (res.error) alert(res.error);
        else {
          if (container.querySelector('#lastScanTime')) await loadLastScan();
          alert(res.canceled ? 'Scan canceled.' : 'Scan completed.');
        }
      } catch(e) {
        alert('Scan failed: ' + e);
      }
    });

    // We could fetch scan history and quarantine count here from API
    try {
      await loadLastScan();

      const quarantineList = await window.api.invoke('db:getQuarantineList');
      if (quarantineList) {
        document.getElementById('threatsCount').textContent = quarantineList.length;
      }
    } catch(e) {
      console.warn('Failed to load dashboard data:', e);
    }
  }
};
