window.Pages = window.Pages || {};
window.Pages.tools = {
  allowedScripts: [
    'clear-temp-files',
    'large-files-report',
    'list-startup-items',
    'browser-cache-report',
    'disk-space-report',
    'windows-services-report'
  ],

  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Tools & Maintenance</h1>
        <div class="page-subtitle">Run focused maintenance checks.</div>
      </div>
      <div id="scriptList" class="dashboard-grid compact"></div>
      <div class="card" style="padding:0; display:flex; flex-direction:column; margin-top:24px; max-height:calc(100vh - 220px);">
        <div style="padding:16px; background:var(--bg-surface-hover); border-bottom:1px solid var(--glass-border); font-weight:600; display:flex; justify-content:space-between; align-items:center;">
          <span>Output</span>
          <button class="btn btn-sm" id="clearOutputBtn" style="display:none;">Clear</button>
        </div>
        <div class="log-surface" id="toolOutput" style="padding:16px; min-height:160px; overflow:auto; flex:1;"><div class="empty-state"></div></div>
      </div>`;
    this.load(container);
  },

  async load(container) {
    const scriptList = container.querySelector('#scriptList');
    container.querySelector('#clearOutputBtn').addEventListener('click', () => {
      container.querySelector('#toolOutput').innerHTML = '<div class="empty-state">Cleared.</div>';
      container.querySelector('#clearOutputBtn').style.display = 'none';
    });

    try {
      const scripts = (await Api.runTool('list-scripts', {}))
        .filter((script) => this.allowedScripts.includes(script.id))
        .sort((a, b) => this.allowedScripts.indexOf(a.id) - this.allowedScripts.indexOf(b.id));
      scriptList.innerHTML = scripts.map((s) => `
        <div class="card compact" style="display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="status-icon info" style="width:38px;height:38px;">${iconFor(this.iconForScript(s.id))}</div>
            <div style="font-weight:600;">${escapeHtml(s.name)}</div>
          </div>
          <div class="page-subtitle" style="font-size:0.85rem;">${escapeHtml(s.description)}</div>
          <div class="history-meta" data-complete-for="${escapeHtml(s.id)}">Not run yet.</div>
          <button class="btn btn-primary btn-sm" data-script-id="${escapeHtml(s.id)}">Run</button>
        </div>`).join('');
      scriptList.querySelectorAll('[data-script-id]').forEach((btn) => btn.addEventListener('click', () => this.runScript(container, btn)));
    } catch (err) {
      showToolError(scriptList, err);
    }
  },

  iconForScript(id) {
    return {
      'clear-temp-files': 'archive',
      'large-files-report': 'search',
      'list-startup-items': 'list',
      'browser-cache-report': 'archive',
      'disk-space-report': 'activity',
      'windows-services-report': 'list-checks'
    }[id] || 'terminal';
  },

  async runScript(container, btn) {
    const scriptId = btn.dataset.scriptId;
    const output = container.querySelector('#toolOutput');
    const status = container.querySelector(`[data-complete-for="${scriptId}"]`);
    const scriptArgs = scriptId === 'clear-temp-files' ? { dryRun: false } : {};
    const originalLabel = btn.textContent;
    setButtonLoading(btn, true, 'Running...');
    output.innerHTML = '<div class="empty-state">Running...</div>';
    if (status) status.textContent = 'Running...';
    try {
      const result = await Api.runTool('run-script', { scriptId, scriptArgs });
      const when = new Date().toLocaleString();
      if (status) status.textContent = `Completed ${when}`;
      output.innerHTML = this.renderOutput(scriptId, result, when);
      setButtonLoading(btn, false);
      btn.textContent = 'Completed';
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.textContent = originalLabel;
        btn.classList.remove('btn-success');
      }, 2000);
    } catch (err) {
      if (status) status.textContent = 'Failed.';
      showToolError(output, err);
      setButtonLoading(btn, false);
    } finally {
      container.querySelector('#clearOutputBtn').style.display = 'block';
    }
  },

  renderOutput(scriptId, result, when) {
    let html = `<div class="log-row" style="background:var(--panel-raised);"><span class="log-tag clean">done</span><span class="log-path">Completed ${escapeHtml(when)}</span></div>`;
    const truncate = (s, n = 80) => (typeof s === 'string' && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');
    if (scriptId === 'clear-temp-files') {
      html += `<div class="log-row"><span class="log-tag clean">cleared</span><span class="log-path">${result.deletedCount || 0} file(s), ${result.freedMB || 0} MB freed</span></div>`;
      if (result.skippedCount) html += `<div class="log-row"><span class="log-tag warn">skipped</span><span class="log-path">${result.skippedCount} item(s) (locked/denied)</span></div>`;
      // show up to 15 important log lines (dry-run or actual)
      const logs = (result.log || []).filter(Boolean).slice(0, 15);
      if (logs.length) html += logs.map(line => `<div class="log-row"><span class="log-path">${escapeHtml(truncate(line, 200))}</span></div>`).join('');
      if ((result.log || []).length > 15) html += `<div class="log-row"><span class="log-path">... ${escapeHtml(String((result.log || []).length - 15))} more lines omitted</span></div>`;
    } else if (scriptId === 'disk-space-report' && Array.isArray(result.volumes)) {
      html += result.volumes.map(v => `<div class="log-row"><span class="log-tag ${v.usePercent > 90 ? 'match' : v.usePercent > 75 ? 'warn' : 'clean'}">${v.usePercent}%</span><span class="log-path">${escapeHtml(v.mount)} - ${v.usedGB}/${v.sizeGB} GB used, ${v.freeGB} GB free</span></div>`).join('');
    } else if (scriptId === 'browser-cache-report' && Array.isArray(result.browsers)) {
      html += `<div class="log-row"><span class="log-tag info">total</span><span class="log-path">${result.totalMB || 0} MB</span></div>`;
      html += result.browsers.map(b => `<div class="log-row"><span class="log-tag ${b.exists ? 'info' : 'warn'}">${b.sizeMB || 0} MB</span><span class="log-path">${escapeHtml(b.name)}${b.exists ? '' : ' (not found)'}</span></div>`).join('');
    } else if (scriptId === 'large-files-report' && Array.isArray(result.files)) {
      html += `<div class="log-row"><span class="log-tag info">${result.count || 0}</span><span class="log-path">Files over ${result.minSizeMB || 0} MB under ${escapeHtml(result.root || '')}</span></div>`;
      html += result.files.slice(0, 100).map(f => `<div class="log-row"><span class="log-tag warn">${f.sizeMB} MB</span><span class="log-path">${escapeHtml(f.path)}</span></div>`).join('');
    } else if (scriptId === 'list-startup-items' && Array.isArray(result.items)) {
      html += `<div class="log-row"><span class="log-tag info">${result.itemCount || result.items.length}</span><span class="log-path">${escapeHtml(result.note || 'Startup entries')}</span></div>`;
      // show up to 12 readable items focusing on name and source/command
      const list = result.items.slice(0, 12).map(item => {
        const name = item.name || item.raw || item.path || 'unknown';
        const src = item.source || (item.command ? 'registry' : 'unknown');
        const cmd = item.command || item.path || item.raw || '';
        return `<div class="log-row"><span class="log-tag info">${escapeHtml(src)}</span><span class="log-path">${escapeHtml(truncate(name + (cmd ? ' — ' + cmd : ''), 140))}</span></div>`;
      }).join('');
      html += list;
      if (result.items.length > 12) html += `<div class="log-row"><span class="log-path">... ${escapeHtml(String(result.items.length - 12))} more items omitted</span></div>`;
    } else if (scriptId === 'windows-services-report') {
      html += `<div class="log-row"><span class="log-tag info">${result.autoStartCount || 0}</span><span class="log-path">Auto-start services, ${result.flaggedCount || 0} flagged</span></div>`;
      html += (result.flagged || []).map(s => `<div class="log-row"><span class="log-tag match">flag</span><span class="log-path">${escapeHtml(s.displayName || s.name)} ${s.pathName ? '(' + escapeHtml(s.pathName) + ')' : ''}</span></div>`).join('');
      html += (result.services || []).slice(0, 120).map(s => `<div class="log-row"><span class="log-tag clean">${escapeHtml(s.state || '')}</span><span class="log-path">${escapeHtml(s.displayName || s.name)}</span></div>`).join('');
    } else {
      html += `<pre class="log-path" style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
    }
    return html;
  }
};
