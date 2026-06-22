window.Pages = window.Pages || {};

window.Pages.monitor = {
  refreshInterval: null,

  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="flex-between">
          <div>
            <h1 class="page-title">System Monitor</h1>
            <div class="page-subtitle">CPU, memory, disk, and OS information</div>
          </div>
          <button class="btn" id="refreshBtn">Refresh</button>
        </div>
      </div>

      <div id="monitorContent"><div class="empty-state">Loading…</div></div>
    `;

    container.querySelector('#refreshBtn').addEventListener('click', () => this.load(container));

    this.load(container);

    // Auto-refresh every 5s while this page is visible; router replaces
    // innerHTML on navigation so we clear this on teardown via MutationObserver-free
    // simple approach: clear any prior interval, set a new one.
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => {
      if (window.AppRouter.current() === 'monitor') {
        this.load(container, true);
      } else {
        clearInterval(this.refreshInterval);
      }
    }, 5000);
  },

  async load(container, silent) {
    const content = container.querySelector('#monitorContent');
    if (!silent) content.innerHTML = '<div class="empty-state">Loading…</div>';

    try {
      const data = await Api.runTool('system-monitor', {});
      content.innerHTML = `
        <div class="grid grid-3" style="margin-bottom:18px;">
          <div class="stat-tile">
            <div class="stat-label">CPU Load</div>
            <div class="stat-value">${data.cpu.currentLoadPercent}%</div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${data.cpu.currentLoadPercent}%"></div></div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">Memory Used</div>
            <div class="stat-value">${data.memory.usedGB} / ${data.memory.totalGB} GB</div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${data.memory.usedPercent}%"></div></div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" style="font-size:18px;">${formatUptime(data.uptimeSeconds)}</div>
          </div>
        </div>

        <div class="grid grid-2" style="margin-bottom:18px;">
          <div class="panel">
            <div class="panel-title">CPU</div>
            <div class="data" style="font-size:12.5px; line-height:2;">
              <div>${escapeHtml(data.cpu.manufacturer)} ${escapeHtml(data.cpu.brand)}</div>
              <div style="color:var(--text-muted);">${data.cpu.physicalCores} physical cores / ${data.cpu.cores} logical · ${data.cpu.speedGHz} GHz</div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">Operating System</div>
            <div class="data" style="font-size:12.5px; line-height:2;">
              <div>${escapeHtml(data.os.distro)} ${escapeHtml(data.os.release)}</div>
              <div style="color:var(--text-muted);">${escapeHtml(data.os.platform)} / ${escapeHtml(data.os.arch)} · ${escapeHtml(data.os.hostname)}</div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">Disks</div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            ${data.disks.map((d) => `
              <div>
                <div class="flex-between" style="font-size:12px; margin-bottom:5px;">
                  <span class="data">${escapeHtml(d.mount)} <span style="color:var(--text-dim);">(${escapeHtml(d.fs)})</span></span>
                  <span class="data" style="color:var(--text-muted);">${d.usedGB} / ${d.sizeGB} GB · ${d.usePercent}%</span>
                </div>
                <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${d.usePercent}%; background:${d.usePercent > 90 ? 'var(--danger)' : d.usePercent > 75 ? 'var(--warn)' : 'var(--accent)'}"></div></div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      showToolError(content, err);
    }
  }
};
