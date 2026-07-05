window.Pages = window.Pages || {};
window.Pages['audit'] = {
  render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Windows Security Audit</h1>
        <p class="page-subtitle">Comprehensive check of system security policies and configurations</p>
      </header>
      <div id="auditContent">
        <div class="empty-state">Running audit checks\u2026</div>
        <div class="loading-progress" style="margin-top:8px;">
          <div class="loading-progress-bar"></div>
        </div>
        <div id="auditProgressLabel" class="page-subtitle" style="margin-top:6px; font-size:0.8rem; opacity:0.85;"></div>
      </div>
    `;
    this.load(container);
  },
  async load(container) {
    const content = container.querySelector('#auditContent');
    const progressBar = content?.querySelector('.loading-progress-bar');

    // Real progress is reported in discrete steps (N of 6 checks complete),
    // but checks run concurrently and one of them (Windows Update) can take
    // up to 90s on its own -- snapping the bar directly to each new
    // milestone would leave it sitting frozen for most of that wait. This
    // creeper fills the gap with continuous motion that always stays
    // truthful: it only ever approaches the NEXT real milestone (never
    // claims more progress than is actually known), decelerating as it
    // nears that ceiling, and snaps immediately to the exact real value the
    // moment a check genuinely completes.
    let currentPct = 4;
    let ceilingPct = 4;
    let creepTimer = null;

    const startCreeping = () => {
      if (creepTimer) return;
      creepTimer = setInterval(() => {
        const gap = ceilingPct - currentPct;
        if (gap <= 0.1) return; // effectively at the ceiling, nothing more to do until it moves
        currentPct += gap * 0.06; // approach asymptotically -- never reaches or crosses ceilingPct
        if (progressBar) progressBar.style.width = `${currentPct}%`;
      }, 150);
    };

    const stopCreeping = () => {
      if (creepTimer) {
        clearInterval(creepTimer);
        creepTimer = null;
      }
    };

    const setLoadingState = (active) => {
      if (!active) {
        stopCreeping();
        if (progressBar) {
          progressBar.style.opacity = '0';
          progressBar.style.width = '100%';
        }
        return;
      }
      if (!progressBar) return;
      progressBar.style.opacity = '1';
      progressBar.style.width = `${currentPct}%`;
      startCreeping();
    };
    setLoadingState(true);
    let unsubscribeProgress = null;
    try {
      unsubscribeProgress = window.api.on('audit:progress', (event) => {
        const labelEl = container.querySelector('#auditProgressLabel');
        if (!event) return;
        const { type, label, completed, total } = event;
        if (labelEl) {
          labelEl.textContent = type === 'complete'
            ? `${label} check completed (${completed}/${total})`
            : `Checking ${label}...`;
        }
        if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
          if (type === 'complete') {
            // A check genuinely finished -- snap to the real value now,
            // overriding wherever the creep had gotten to.
            currentPct = Math.max(4, Math.round((completed / total) * 100));
            if (progressBar) progressBar.style.width = `${currentPct}%`;
          }
          // Whether this was a start or complete event, the next ceiling is
          // always "one more check done than we've confirmed so far" --
          // buffered a few points short so the creep never visually touches
          // a milestone before it's actually true.
          const nextMilestone = Math.min(total, completed + 1);
          ceilingPct = nextMilestone >= total ? 100 : Math.max(currentPct + 1, Math.round((nextMilestone / total) * 100) - 3);
        }
      });
      const results = await window.api.invoke('audit:run');
      const ignored = await window.api.invoke('warnings:listIgnored');
      const ignoredIds = new Set((ignored || []).map((w) => w.id));
      if (!results || results.length === 0) {
        content.innerHTML = '<div class="empty-state">No audit results returned.</div>';
        return;
      }
      let pass = 0, fail = 0, warn = 0, err = 0;
      const visibleResults = results.filter((r) => !ignoredIds.has(this.warningId(r)));
      visibleResults.forEach(r => { if (r.status === 'pass') pass++; else if (r.status === 'fail') fail++; else if (r.status === 'warn') warn++; else if (r.status === 'error') err++; });
      let html = `<div class="grid grid-4" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="stat-label">Passed</div><div class="stat-value" style="color:var(--ok);">${pass}</div></div>
        <div class="stat-tile"><div class="stat-label">Failed</div><div class="stat-value" style="color:var(--danger);">${fail}</div></div>
        <div class="stat-tile"><div class="stat-label">Warnings</div><div class="stat-value" style="color:var(--warn);">${warn}</div></div>
        <div class="stat-tile"><div class="stat-label">Errors</div><div class="stat-value" style="color:var(--text-dim);">${err}</div></div>
      </div>`;
      html += '<div class="dashboard-grid">';
      for (const res of visibleResults) {
        let iconClass = 'info';
        let iconSvg = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>';
        let statusLabel = 'Info';
        if (res.status === 'pass') { iconClass = 'safe'; iconSvg = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'; statusLabel = 'Pass'; }
        else if (res.status === 'fail') { iconClass = 'danger'; iconSvg = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; statusLabel = 'Fail'; }
        else if (res.status === 'warn') { iconClass = 'warning'; iconSvg = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'; statusLabel = 'Warn'; }
        else if (res.status === 'error') { iconClass = 'danger'; iconSvg = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; statusLabel = 'Error'; }
        html += `<div class="card" style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div class="status-icon ${iconClass}" style="width:40px;height:40px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;">${iconSvg}</svg>
            </div>
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(res.name)}</div>
                <span style="font-size:0.8rem; font-weight:600; text-transform:uppercase; color:${iconClass === 'safe' ? 'var(--ok)' : iconClass === 'danger' ? 'var(--danger)' : 'var(--warn)'};">${statusLabel}</span>
              </div>
              <div class="page-subtitle" style="font-size:0.9rem; margin-top:4px;">${escapeHtml(res.message)}</div>
            </div>
          </div>
          ${res.detail ? `<div style="font-size:0.85rem; color:var(--text-dim); padding:8px; background:var(--bg-surface); border-radius:6px; font-family:monospace;">${escapeHtml(res.detail)}</div>` : ''}
          ${res.recommendation ? `<div style="font-size:0.85rem;"><strong>Recommendation:</strong> ${escapeHtml(res.recommendation)}</div>` : ''}
          ${res.status === 'warn' || res.status === 'fail' ? `<button class="btn btn-sm audit-ignore" data-id="${escapeHtml(this.warningId(res))}" data-title="${escapeHtml(res.name)}" data-detail="${escapeHtml(res.message || res.detail || '')}">Ignore Warning</button>` : ''}
        </div>`;
      }
      html += '</div>';
      if ((ignored || []).some((w) => String(w.id || '').startsWith('audit:'))) {
        html += `<div class="panel" style="margin-top:18px;"><div class="panel-title">Ignored Audit Warnings</div>
          <div class="history-list">${ignored.filter((w) => String(w.id || '').startsWith('audit:')).map((w) => `
            <div class="history-item"><div><div class="history-title">${escapeHtml(w.title)}</div><div class="history-meta">${escapeHtml(w.detail || '')}</div></div>
            <button class="btn btn-sm audit-restore" data-id="${escapeHtml(w.id)}">Restore</button></div>`).join('')}</div></div>`;
      }
      content.innerHTML = html + '<div class="loading-progress" style="margin-top:16px;"><div class="loading-progress-bar" style="width:100%;opacity:1"></div></div>';
      content.querySelectorAll('.audit-ignore').forEach((btn) => btn.addEventListener('click', async () => {
        const card = btn.closest('.card');
        btn.disabled = true;
        try {
          await window.api.invoke('warnings:ignore', { id: btn.dataset.id, title: btn.dataset.title, detail: btn.dataset.detail });
          if (card) card.remove();
          await this.load(container);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || 'Unable to ignore warning.');
        }
      }));
      content.querySelectorAll('.audit-restore').forEach((btn) => btn.addEventListener('click', async () => {
        const item = btn.closest('.history-item');
        btn.disabled = true;
        try {
          await window.api.invoke('warnings:unignore', btn.dataset.id);
          if (item) item.remove();
          await this.load(container);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || 'Unable to restore warning.');
        }
      }));
    } catch (e) {
      content.innerHTML = `<div class="empty-state">Error running audit: ${escapeHtml(e.message)}</div>`;
    } finally {
      if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
      setLoadingState(false);
    }
  }
  ,
  warningId(result) {
    return 'audit:' + String(result.name || result.message || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
};