window.Pages = window.Pages || {};

window.Pages.dashboard = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <div class="page-subtitle">System health at a glance</div>
      </div>

      <div class="grid grid-2" style="margin-bottom:18px;">
        <div class="panel">
          <div class="panel-title">System Health Score</div>
          <div class="health-ring-wrap" id="healthRingWrap">
            <div class="empty-state" style="padding:8px 0;">Loading…</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">Quick Actions</div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn btn-primary" id="qaScan">${iconButtonSvg('search')} Run File Scan</button>
            <button class="btn" id="qaPassword">${iconButtonSvg('key')} Generate Password</button>
            <button class="btn" id="qaCleanup">${iconButtonSvg('terminal')} Clear Temp Files</button>
          </div>
        </div>
      </div>

      <div class="grid grid-3" id="statTiles">
        <div class="stat-tile"><div class="stat-label">CPU Load</div><div class="stat-value">—</div></div>
        <div class="stat-tile"><div class="stat-label">Memory</div><div class="stat-value">—</div></div>
        <div class="stat-tile"><div class="stat-label">Disk Free</div><div class="stat-value">—</div></div>
      </div>

      <div class="section-spacer"></div>

      <div class="panel">
        <div class="panel-title">Last Scan</div>
        <div id="lastScanSummary" class="empty-state">No scan has been run yet. Go to File Scanner to run one.</div>
      </div>
    `;

    container.querySelector('#qaScan').addEventListener('click', () => window.AppRouter.navigate('scanner'));
    container.querySelector('#qaPassword').addEventListener('click', () => window.AppRouter.navigate('passwords'));
    container.querySelector('#qaCleanup').addEventListener('click', () => window.AppRouter.navigate('scripts'));

    this.loadHealthScore(container);
    this.loadStats(container);
    this.loadLastScan(container);
  },

  async loadHealthScore(container) {
    const wrap = container.querySelector('#healthRingWrap');
    try {
      const lastScan = window.AppState && window.AppState.lastScanSummary;
      const args = {
        lastScanMatches: lastScan ? lastScan.matches : null,
        passwordScore: window.AppState ? window.AppState.lastPasswordScore : null
      };
      const result = await Api.runTool('health-score', args);
      renderHealthRing(wrap, result);

      // Reflect score on the sidebar status rail
      const rail = document.getElementById('statusRail');
      if (rail) {
        const level = result.score >= 70 ? 'ok' : result.score >= 40 ? 'warn' : 'danger';
        rail.dataset.level = level;
      }
    } catch (err) {
      wrap.innerHTML = `<div class="empty-state">Could not compute health score: ${escapeHtml(err.message)}</div>`;
    }
  },

  async loadStats(container) {
    const tiles = container.querySelector('#statTiles');
    try {
      const data = await Api.runTool('system-monitor', {});
      tiles.innerHTML = `
        <div class="stat-tile">
          <div class="stat-label">CPU Load</div>
          <div class="stat-value ${tileColor(data.cpu.currentLoadPercent, 70, 90)}">${data.cpu.currentLoadPercent}%</div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${data.cpu.currentLoadPercent}%"></div></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Memory</div>
          <div class="stat-value ${tileColor(data.memory.usedPercent, 75, 90)}">${data.memory.usedPercent}%</div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${data.memory.usedPercent}%"></div></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Disk (primary)</div>
          <div class="stat-value ${tileColor(data.disks[0]?.usePercent || 0, 80, 92)}">${data.disks[0] ? data.disks[0].usePercent + '%' : 'n/a'}</div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${data.disks[0]?.usePercent || 0}%"></div></div>
        </div>
      `;
    } catch (err) {
      tiles.innerHTML = `<div class="empty-state">Could not load system stats: ${escapeHtml(err.message)}</div>`;
    }
  },

  loadLastScan(container) {
    const el = container.querySelector('#lastScanSummary');
    const summary = window.AppState && window.AppState.lastScanSummary;
    if (!summary) return;
    el.classList.remove('empty-state');
    el.innerHTML = `
      <div class="grid grid-4">
        <div class="stat-tile"><div class="stat-label">Scanned</div><div class="stat-value">${summary.totalScanned}</div></div>
        <div class="stat-tile"><div class="stat-label">Clean</div><div class="stat-value ok">${summary.clean}</div></div>
        <div class="stat-tile"><div class="stat-label">Suspicious</div><div class="stat-value warn">${summary.suspicious}</div></div>
        <div class="stat-tile"><div class="stat-label">Matches</div><div class="stat-value danger">${summary.matches}</div></div>
      </div>
    `;
  }
};

function iconButtonSvg(name) {
  return `<span style="width:14px;height:14px;display:inline-flex;">${iconFor(name)}</span>`;
}

function tileColor(value, warnAt, dangerAt) {
  if (value >= dangerAt) return 'danger';
  if (value >= warnAt) return 'warn';
  return 'ok';
}

function renderHealthRing(wrap, result) {
  const score = result.score;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'var(--ok)' : score >= 40 ? 'var(--warn)' : 'var(--danger)';

  const rowsHtml = Object.entries(result.breakdown)
    .map(([key, info]) => `
      <div class="health-row">
        <span class="label">${escapeHtml(info.reason)}</span>
        <span class="pts">${info.points}/${info.max}</span>
      </div>
    `)
    .join('');

  wrap.innerHTML = `
    <div class="health-ring">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle class="health-ring-track" cx="54" cy="54" r="${radius}"></circle>
        <circle class="health-ring-value" cx="54" cy="54" r="${radius}"
          stroke="${color}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="health-ring-number" style="color:${color}">${score}</div>
    </div>
    <div class="health-breakdown">${rowsHtml}</div>
  `;
}
