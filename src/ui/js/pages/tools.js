window.Pages = window.Pages || {};
window.Pages.tools = {
  _startupItems: [],
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
      <div class="panel" style="padding:0; display:flex; flex-direction:column; margin-top:24px; max-height:calc(100vh - 220px);">
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
          ${s.id === 'clear-temp-files' ? `
          <label class="page-subtitle" style="font-size:0.8rem; display:flex; align-items:center; gap:8px;">
            Delete files older than
            <input type="number" min="0" max="365" value="7" id="tempAgeDaysInput" style="width:60px;" />
            day(s)
          </label>` : ''}
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

  getTempAgeDays(container) {
    const input = container.querySelector('#tempAgeDaysInput');
    let val = input ? Number(input.value) : 7;
    if (!Number.isFinite(val) || val < 0) val = 7;
    if (val > 365) val = 365;
    return val;
  },

  async runScript(container, btn) {
    const scriptId = btn.dataset.scriptId;
    const output = container.querySelector('#toolOutput');
    const status = container.querySelector(`[data-complete-for="${scriptId}"]`);
    const scriptArgs = scriptId === 'clear-temp-files'
      ? { dryRun: false, maxAgeDays: this.getTempAgeDays(container) }
      : {};
    const originalLabel = btn.textContent;
    setButtonLoading(btn, true, 'Running...');

    // Only these scripts actually report progress (see clearTemp.js,
    // largeFilesReport.js, browserCacheReport.js) -- everything else is a
    // single atomic call with no real subdivision to report, so it just
    // gets an honest spinner rather than a fabricated percentage.
    const reportsProgress = ['clear-temp-files', 'large-files-report', 'browser-cache-report'].includes(scriptId);
    output.innerHTML = reportsProgress
      ? '<div class="empty-state"><span class="spinner"></span>&nbsp;<span id="scriptProgressLabel">Starting...</span></div>'
      : '<div class="empty-state"><span class="spinner"></span>&nbsp;Running...</div>';
    if (status) status.textContent = 'Running...';

    let unsubscribeProgress = null;
    if (reportsProgress) {
      unsubscribeProgress = Api.onToolProgress('run-script', (progress) => {
        const labelEl = output.querySelector('#scriptProgressLabel');
        if (!labelEl || !progress) return;
        const label = progress.label || 'Working';
        if (typeof progress.total === 'number' && progress.total > 0) {
          // Real fraction (e.g. browser-cache-report: known total of 4).
          labelEl.textContent = `${label}... (${progress.count}/${progress.total})`;
        } else if (typeof progress.count === 'number') {
          // Live count only -- total isn't knowable ahead of a file walk,
          // so this reports what's genuinely been scanned, not a percentage.
          labelEl.textContent = `${label}... (${progress.count.toLocaleString()} scanned)`;
        } else {
          labelEl.textContent = label;
        }
      });
    }

    try {
      const result = await Api.runTool('run-script', { scriptId, scriptArgs });
      const when = new Date().toLocaleString();
      if (status) status.textContent = `Completed ${when}`;
      output.innerHTML = this.renderOutput(scriptId, result, when);
      if (scriptId === 'large-files-report') this.wireLargeFilesActions(container);
      if (scriptId === 'browser-cache-report') this.wireBrowserCacheActions(container);
      if (scriptId === 'list-startup-items' && Array.isArray(result.items)) {
        this._startupItems = result.items;
        this.wireStartupActions(container);
      }
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
      if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
      container.querySelector('#clearOutputBtn').style.display = 'block';
    }
  },

  // Applied to rows in long lists (services, large files) so the browser can
  // skip layout/paint for rows that are scrolled out of view. This is what
  // actually fixes scroll jank on 100+ row outputs -- it's not the row count
  // itself that's expensive, it's repainting every row's card styling
  // (borders/backgrounds) on every scroll frame.
  lazyRowStyle: 'content-visibility:auto;contain-intrinsic-size:0 36px;',

  renderOutput(scriptId, result, when) {
    let html = `<div class="log-row" style="background:var(--panel-raised);"><span class="log-tag clean">done</span><span class="log-path">Completed ${escapeHtml(when)}</span></div>`;
    const truncate = (s, n = 80) => (typeof s === 'string' && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');
    if (scriptId === 'clear-temp-files') {
      html += `<div class="log-row"><span class="log-tag clean">cleared</span><span class="log-path">${result.deletedCount || 0} file(s), ${result.freedMB || 0} MB freed (older than ${result.maxAgeDays ?? '?'} day(s))</span></div>`;
      if (result.skippedCount) html += `<div class="log-row"><span class="log-tag warn">skipped</span><span class="log-path">${result.skippedCount} item(s) (locked/denied)</span></div>`;
      // show up to 15 important log lines (dry-run or actual)
      const logs = (result.log || []).filter(Boolean).slice(0, 15);
      if (logs.length) html += logs.map(line => `<div class="log-row"><span class="log-path">${escapeHtml(truncate(line, 200))}</span></div>`).join('');
      if ((result.log || []).length > 15) html += `<div class="log-row"><span class="log-path">... ${escapeHtml(String((result.log || []).length - 15))} more lines omitted</span></div>`;
    } else if (scriptId === 'disk-space-report' && Array.isArray(result.volumes)) {
      html += result.volumes.map(v => `<div class="log-row"><span class="log-tag ${v.usePercent > 90 ? 'match' : v.usePercent > 75 ? 'warn' : 'clean'}">${v.usePercent}%</span><span class="log-path">${escapeHtml(v.mount)} - ${v.usedGB}/${v.sizeGB} GB used, ${v.freeGB} GB free</span></div>`).join('');
    } else if (scriptId === 'browser-cache-report' && Array.isArray(result.browsers)) {
      const anyExists = result.browsers.some((b) => b.exists);
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <div class="log-row" style="border:none; padding:0;"><span class="log-tag info">total</span><span class="log-path">${result.totalMB || 0} MB</span></div>
        <button class="btn btn-sm" id="clearAllCacheBtn" ${anyExists ? '' : 'disabled'}>Clear All Caches</button>
      </div>`;
      html += result.browsers.map((b) => `
        <div class="log-row" style="display:flex; align-items:center; gap:8px;">
          <span class="log-tag ${b.exists ? 'info' : 'warn'}">${b.sizeMB || 0} MB</span>
          <span class="log-path" style="flex:1;">${escapeHtml(b.name)}${b.exists ? '' : ' (not found)'}</span>
          ${b.exists ? `<button class="btn btn-sm clear-single-cache-btn" data-browser="${escapeHtml(b.name)}" style="flex-shrink:0;">Clear</button>` : ''}
        </div>`).join('');
    } else if (scriptId === 'large-files-report' && Array.isArray(result.files)) {
      html += `<div class="log-row"><span class="log-tag info">${result.count || 0}</span><span class="log-path">Files over ${result.minSizeMB || 0} MB under ${escapeHtml(result.root || '')}</span></div>`;
      if (result.files.length) {
        html += `<div style="display:flex; justify-content:flex-end; margin:8px 0;"><button class="btn btn-sm" style="color:var(--accent-danger);" id="deleteSelectedFilesBtn" disabled>Delete Selected (0)</button></div>`;
        html += result.files.slice(0, 100).map((f) => `
          <div class="log-row" style="display:flex; align-items:center; gap:8px; ${this.lazyRowStyle}">
            <input type="checkbox" class="large-file-checkbox" data-file-path="${escapeHtml(f.path)}" data-file-size="${f.sizeMB}" />
            <span class="log-tag warn">${f.sizeMB} MB</span>
            <span class="log-path" style="flex:1;">${escapeHtml(f.path)}</span>
          </div>`).join('');
      }
    } else if (scriptId === 'list-startup-items' && Array.isArray(result.items)) {
      html += `<div class="log-row"><span class="log-tag info">${result.itemCount || result.items.length}</span><span class="log-path">Startup entries — click a toggle to disable/enable an item</span></div>`;
      result.items.forEach((item, idx) => {
        const name = item.name || item.raw || item.path || 'unknown';
        const cmd = item.command || item.path || item.raw || '';
        const displayCmd = truncate(name + (cmd && cmd !== name ? ' — ' + cmd : ''), 200);
        html += `<div class="log-row startup-row" data-idx="${idx}">
          <img class="startup-icon" data-exe="${escapeHtml(item.exePath || '')}" src="" alt="" />
          <span class="log-tag info">${escapeHtml(item.source || 'unknown')}</span>
          <span class="log-path" style="flex:1;">${escapeHtml(displayCmd)}</span>
          <button class="btn btn-sm startup-toggle-btn" data-idx="${idx}">Disable</button>
        </div>`;
      });
    } else if (scriptId === 'windows-services-report') {
      html += `<div class="log-row"><span class="log-tag info">${result.autoStartCount || 0}</span><span class="log-path">Auto-start services, ${result.flaggedCount || 0} flagged</span></div>`;
      html += (result.flagged || []).map(s => `<div class="log-row" style="${this.lazyRowStyle}"><span class="log-tag match">flag</span><span class="log-path">${escapeHtml(s.displayName || s.name)} ${s.pathName ? '(' + escapeHtml(s.pathName) + ')' : ''}</span></div>`).join('');
      html += (result.services || []).slice(0, 120).map(s => `<div class="log-row" style="${this.lazyRowStyle}"><span class="log-tag clean">${escapeHtml(s.state || '')}</span><span class="log-path">${escapeHtml(s.displayName || s.name)}</span></div>`).join('');
    } else {
      html += `<pre class="log-path" style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
    }
    return html;
  },

  wireLargeFilesActions(container) {
    const output = container.querySelector('#toolOutput');
    const deleteBtn = output.querySelector('#deleteSelectedFilesBtn');
    if (!deleteBtn) return;

    const updateButton = () => {
      const selected = output.querySelectorAll('.large-file-checkbox:checked');
      deleteBtn.textContent = `Delete Selected (${selected.length})`;
      deleteBtn.disabled = selected.length === 0;
    };

    output.querySelectorAll('.large-file-checkbox').forEach((cb) => cb.addEventListener('change', updateButton));

    deleteBtn.addEventListener('click', async () => {
      const selected = [...output.querySelectorAll('.large-file-checkbox:checked')];
      if (!selected.length) return;
      const totalMB = selected.reduce((sum, cb) => sum + Number(cb.dataset.fileSize || 0), 0).toFixed(1);
      if (!window.confirm(`Permanently delete ${selected.length} file(s), freeing about ${totalMB} MB? This cannot be undone.`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      try {
        const paths = selected.map((cb) => cb.dataset.filePath);
        const result = await Api.runTool('run-script', { scriptId: 'delete-files', scriptArgs: { paths } });
        alert(`Deleted ${result.deletedCount} file(s), freed ${result.freedMB} MB.${result.skippedCount ? ` ${result.skippedCount} skipped.` : ''}`);

        const refreshed = await Api.runTool('run-script', { scriptId: 'large-files-report', scriptArgs: {} });
        output.innerHTML = this.renderOutput('large-files-report', refreshed, new Date().toLocaleString());
        this.wireLargeFilesActions(container);
      } catch (err) {
        alert(err.message || 'Failed to delete selected files.');
        deleteBtn.disabled = false;
        updateButton();
      }
    });
  },

  wireBrowserCacheActions(container) {
    const output = container.querySelector('#toolOutput');
    const clearAllBtn = output.querySelector('#clearAllCacheBtn');
    const singleBtns = output.querySelectorAll('.clear-single-cache-btn');

    const runClear = async (browsers, triggerBtn) => {
      const label = browsers.length === 1 ? browsers[0] : 'all browsers';
      if (!window.confirm(`Clear cache for ${label}? Saved logins and bookmarks are not affected, but you may be signed out of some sites.`)) return;
      const originalLabel = triggerBtn.textContent;
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Clearing...';
      try {
        const result = await Api.runTool('run-script', { scriptId: 'clear-browser-cache', scriptArgs: { browsers } });
        alert(`Freed ${result.totalMB} MB.${result.note ? ' ' + result.note : ''}`);

        const refreshed = await Api.runTool('run-script', { scriptId: 'browser-cache-report', scriptArgs: {} });
        output.innerHTML = this.renderOutput('browser-cache-report', refreshed, new Date().toLocaleString());
        this.wireBrowserCacheActions(container);
      } catch (err) {
        alert(err.message || 'Failed to clear browser cache.');
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalLabel;
      }
    };

    if (clearAllBtn) clearAllBtn.addEventListener('click', () => runClear([], clearAllBtn));
    singleBtns.forEach((btn) => btn.addEventListener('click', () => runClear([btn.dataset.browser], btn)));
  },

  wireStartupActions(container) {
    const output = container.querySelector('#toolOutput');

    // Load icons
    const iconImgs = output.querySelectorAll('.startup-icon[data-exe]');
    const exePaths = [...new Set([...iconImgs].map((img) => img.dataset.exe).filter(Boolean))];
    if (exePaths.length) {
      window.api.invoke('startup:getIcons', exePaths).then((icons) => {
        iconImgs.forEach((img) => {
          const dataUrl = icons && icons[img.dataset.exe];
          if (dataUrl) img.src = dataUrl;
          else img.style.display = 'none';
        });
      }).catch(() => {
        iconImgs.forEach((img) => img.style.display = 'none');
      });
    } else {
      iconImgs.forEach((img) => img.style.display = 'none');
    }

    // Wire toggle buttons
    output.querySelectorAll('.startup-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const item = this._startupItems[idx];
        if (!item) return;
        const currentlyEnabled = btn.dataset.enabled !== 'false';
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const result = await window.api.invoke('startup:toggle', item, !currentlyEnabled);
          if (result.ok) {
            btn.dataset.enabled = String(!currentlyEnabled);
            btn.textContent = !currentlyEnabled ? 'Disable' : 'Enable';
            btn.classList.toggle('btn-success', !currentlyEnabled);
          } else {
            alert(result.error || 'Failed to toggle startup item');
            btn.textContent = currentlyEnabled ? 'Disable' : 'Enable';
          }
        } catch (err) {
          alert(err.message || 'Failed to toggle startup item');
          btn.textContent = currentlyEnabled ? 'Disable' : 'Enable';
        }
        btn.disabled = false;
      });
    });
  }
};