window.Pages = window.Pages || {};

window.Pages.processes = {
  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="flex-between">
          <div>
            <h1 class="page-title">Processes</h1>
            <div class="page-subtitle">Running processes sorted by CPU usage</div>
          </div>
          <button class="btn" id="refreshBtn">Refresh</button>
        </div>
      </div>

      <div class="panel" style="padding:0; overflow:hidden;">
        <div id="processList"><div class="empty-state">Loading…</div></div>
      </div>
    `;

    container.querySelector('#refreshBtn').addEventListener('click', () => this.load(container));
    this.load(container);
  },

  async load(container) {
    const listEl = container.querySelector('#processList');
    listEl.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const processes = await Api.runTool('process-viewer', {});
      const top = processes.slice(0, 100);

      const headerRow = `
        <div class="log-row" style="background:var(--panel-raised); font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-dim);">
          <span style="width:64px; flex-shrink:0;">PID</span>
          <span style="flex:1;">Name</span>
          <span style="width:70px; flex-shrink:0; text-align:right;">CPU %</span>
          <span style="width:80px; flex-shrink:0; text-align:right;">Mem %</span>
        </div>
      `;

      const rows = top.map((p) => `
        <div class="log-row">
          <span style="width:64px; flex-shrink:0; color:var(--text-dim);">${p.pid}</span>
          <span style="flex:1; color:var(--text);">${escapeHtml(p.name)}</span>
          <span style="width:70px; flex-shrink:0; text-align:right; color:${(p.cpu || 0) > 50 ? 'var(--warn)' : 'var(--text-muted)'};">${p.cpu !== null ? p.cpu + '%' : '—'}</span>
          <span style="width:80px; flex-shrink:0; text-align:right; color:var(--text-muted);">${p.memory !== null ? p.memory + '%' : '—'}</span>
        </div>
      `).join('');

      listEl.innerHTML = `<div class="log-surface" style="max-height:560px;">${headerRow}${rows}</div>`;
    } catch (err) {
      showToolError(listEl, err);
    }
  }
};
