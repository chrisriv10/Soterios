window.Pages = window.Pages || {};
window.Pages.tools = {
  _startupItems: [],
  _uninstallerApps: [],
  _selectedShredFiles: [],
  allowedScripts: [
    'clear-temp-files',
    'large-files-report',
    'list-startup-items',
    'browser-cache-report',
    'disk-space-report',
    'windows-services-report',
    'uninstaller-report',
    'duplicate-finder',
    'file-shredder'
  ],

  toolCategories: [
    {
      id: 'cleanup',
      labelKey: 'tools.category.cleanup',
      icon: 'archive',
      scripts: ['clear-temp-files', 'large-files-report', 'browser-cache-report']
    },
    {
      id: 'diagnostics',
      labelKey: 'tools.category.diagnostics',
      icon: 'activity',
      scripts: ['disk-space-report', 'windows-services-report', 'duplicate-finder']
    },
    {
      id: 'management',
      labelKey: 'tools.category.management',
      icon: 'settings',
      scripts: ['list-startup-items', 'uninstaller-report', 'file-shredder']
    }
  ],

  t(key, vars) {
    return window.I18n?.t(key, vars) ?? key;
  },

  render(container) {
    this._selectedShredFiles = [];
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${escapeHtml(this.t('tools.title'))}</h1>
        <div class="page-subtitle">${escapeHtml(this.t('tools.subtitle'))}</div>
      </div>
      <div class="tools-page" id="toolsPage">
        <div class="tools-column" id="toolsColumn">
          ${this.toolCategories.map(cat => this.renderCategory(cat)).join('')}
        </div>
        <aside class="output-panel" id="outputPanel">
          <div class="output-header">
            <span>${escapeHtml(this.t('tools.output'))}</span>
            <button class="btn btn-sm btn-ghost" id="clearOutputBtn" style="display:none;">${escapeHtml(this.t('tools.clear'))}</button>
          </div>
          <div class="output-body" id="toolOutput">
            <div class="empty-state">${escapeHtml(this.t('tools.noOutput'))}</div>
          </div>
          <div class="output-actions">
            <div class="output-status" id="outputStatus">${escapeHtml(this.t('tools.ready'))}</div>
            <button class="btn btn-sm btn-ghost" id="exportLogBtn" style="display:none;">${escapeHtml(this.t('tools.export'))}</button>
          </div>
        </aside>
      </div>`;
    this.load(container);
  },

  renderCategory(cat) {
    const scripts = cat.scripts.map(id => this.allowedScripts.includes(id) ? id : null).filter(Boolean);
    return `
      <section class="tool-section" data-category="${cat.id}">
        <header class="tool-section-header">
          <span class="tool-section-icon">${iconFor(cat.icon)}</span>
          ${escapeHtml(this.t(cat.labelKey))}
        </header>
        <div class="tool-list" id="toolList-${cat.id}"></div>
      </section>`;
  },

  async load(container) {
    container.querySelector('#clearOutputBtn').addEventListener('click', () => {
      container.querySelector('#toolOutput').innerHTML = '<div class="empty-state">Cleared.</div>';
      container.querySelector('#clearOutputBtn').style.display = 'none';
      container.querySelector('#exportLogBtn').style.display = 'none';
    });

    container.querySelector('#exportLogBtn').addEventListener('click', () => {
      const output = container.querySelector('#toolOutput');
      const text = output.innerText || output.textContent || '';
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `soterios-tools-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    try {
      const scripts = (await Api.runTool('list-scripts', {}))
        .filter((script) => this.allowedScripts.includes(script.id))
        .sort((a, b) => this.allowedScripts.indexOf(a.id) - this.allowedScripts.indexOf(b.id));

      const scriptMap = Object.fromEntries(scripts.map(s => [s.id, s]));

      this.toolCategories.forEach(cat => {
        const listEl = container.querySelector(`#toolList-${cat.id}`);
        const catScripts = cat.scripts.map(id => scriptMap[id]).filter(Boolean);
        listEl.innerHTML = catScripts.map(s => this.renderToolRow(s)).join('');
      });

      container.querySelectorAll('.tool-action .btn[data-script-id]').forEach((btn) =>
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.runScript(container, btn); })
      );

      const selectFilesBtn = container.querySelector('#selectFilesToShredBtn');
      if (selectFilesBtn) {
        selectFilesBtn.addEventListener('click', async () => {
          try {
            const files = await Api.pickFiles();
            if (files && files.length > 0) {
              this._selectedShredFiles = files;
              const listEl = container.querySelector('#selectedFilesList');
              const basenames = files.map(f => f.split(/[\\/]/).pop());
              listEl.textContent = `${files.length} file(s) selected: ${basenames.join(', ')}`;
            }
          } catch (err) {
            console.error('File picker error:', err);
          }
        });
      }
    } catch (err) {
      showToolError(container.querySelector('#toolsColumn'), err);
    }
  },

  renderToolRow(s) {
    const hasInput = s.id === 'clear-temp-files' || s.id === 'file-shredder' || s.id === 'large-files-report';
    const inputHtml = s.id === 'clear-temp-files' ? `
      <div class="tool-input-inline">
        <label style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--text-muted); cursor:pointer;">
          ${escapeHtml(this.t('tools.deleteOlderThan'))}
          <input type="number" min="0" max="365" value="7" id="tempAgeDaysInput" class="temp-age-input" style="width:56px;" />
          ${escapeHtml(this.t('tools.days'))}
        </label>
      </div>` : s.id === 'file-shredder' ? `
      <div class="tool-input-inline">
        <button class="btn btn-sm" id="selectFilesToShredBtn" style="flex:1;">${escapeHtml(this.t('tools.selectFilesToShred'))}</button>
      </div>
      <div id="selectedFilesList" style="font-size:0.75rem; color:var(--text-muted); min-height:20px;"></div>` : s.id === 'large-files-report' ? `
      <div class="tool-input-inline">
        <label style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--text-muted); cursor:pointer;">
          ${escapeHtml(this.t('tools.filesLargerThan'))}
          <input type="number" min="1" max="10000" value="100" id="minSizeMBInput" class="min-size-input" style="width:56px;" />
          ${escapeHtml(this.t('tools.megabytes'))}
        </label>
      </div>` : '';

    // Translate tool names and descriptions
    const toolTranslations = {
      'clear-temp-files': { name: 'tools.script.clearTempFiles.name', desc: 'tools.script.clearTempFiles.desc' },
      'large-files-report': { name: 'tools.script.largeFilesReport.name', desc: 'tools.script.largeFilesReport.desc' },
      'list-startup-items': { name: 'tools.script.listStartupItems.name', desc: 'tools.script.listStartupItems.desc' },
      'browser-cache-report': { name: 'tools.script.browserCacheReport.name', desc: 'tools.script.browserCacheReport.desc' },
      'disk-space-report': { name: 'tools.script.diskSpaceReport.name', desc: 'tools.script.diskSpaceReport.desc' },
      'windows-services-report': { name: 'tools.script.windowsServicesReport.name', desc: 'tools.script.windowsServicesReport.desc' },
      'uninstaller-report': { name: 'tools.script.uninstallerReport.name', desc: 'tools.script.uninstallerReport.desc' },
      'duplicate-finder': { name: 'tools.script.duplicateFinder.name', desc: 'tools.script.duplicateFinder.desc' },
      'file-shredder': { name: 'tools.script.fileShredder.name', desc: 'tools.script.fileShredder.desc' },
    };
    const trans = toolTranslations[s.id];
    const toolName = trans ? this.t(trans.name, s.name) : s.name;
    const toolDesc = trans ? this.t(trans.desc, s.description) : s.description;

    return `
      <div class="tool-row">
        <div class="tool-icon status-icon info" style="width:34px;height:34px;">${iconFor(this.iconForScript(s.id))}</div>
        <div class="tool-info">
          <span class="tool-name">${escapeHtml(toolName)}</span>
          <span class="tool-desc">${escapeHtml(toolDesc)}</span>
          ${inputHtml}
        </div>
        <div class="tool-action">
          <button class="btn btn-primary btn-sm" data-script-id="${escapeHtml(s.id)}">${escapeHtml(this.t('tools.run'))}</button>
          <div class="history-meta" data-complete-for="${escapeHtml(s.id)}">${escapeHtml(this.t('tools.notRunYet'))}</div>
        </div>
      </div>`;
  },

  iconForScript(id) {
    return {
      'clear-temp-files': 'archive',
      'large-files-report': 'search',
      'list-startup-items': 'list',
      'browser-cache-report': 'archive',
      'disk-space-report': 'activity',
      'windows-services-report': 'list-checks',
      'uninstaller-report': 'archive',
      'duplicate-finder': 'copy',
      'file-shredder': 'trash-2'
    }[id] || 'terminal';
  },

  getTempAgeDays(container) {
    const input = container.querySelector('#tempAgeDaysInput');
    let val = input ? Number(input.value) : 7;
    if (!Number.isFinite(val) || val < 0) val = 7;
    if (val > 365) val = 365;
    return val;
  },

  getMinSizeMB(container) {
    const input = container.querySelector('#minSizeMBInput');
    let val = input ? Number(input.value) : 100;
    if (!Number.isFinite(val) || val < 1) val = 1;
    if (val > 10000) val = 10000;
    return val;
  },

async runScript(container, btn) {
    const scriptId = btn.dataset.scriptId;
    const output = container.querySelector('#toolOutput');
    const statusEl = container.querySelector(`[data-complete-for="${scriptId}"]`);
    const outputStatus = container.querySelector('#outputStatus');
    const exportBtn = container.querySelector('#exportLogBtn');
    let scriptArgs = scriptId === 'clear-temp-files'
      ? { dryRun: false, maxAgeDays: this.getTempAgeDays(container) }
      : scriptId === 'large-files-report'
      ? { minSizeMB: this.getMinSizeMB(container) }
      : {};

    if (scriptId === 'file-shredder') {
      if (this._selectedShredFiles.length === 0) {
        alert(this.t('tools.selectFilesFirst'));
        return;
      }
      scriptArgs = { filePaths: this._selectedShredFiles, passes: 3 };
    }

    const originalLabel = btn.textContent;
    setButtonLoading(btn, true, this.t('tools.running'));

    const reportsProgress = ['clear-temp-files', 'large-files-report', 'browser-cache-report'].includes(scriptId);
    output.innerHTML = reportsProgress
      ? '<div class="empty-state"><span class="spinner"></span>&nbsp;<span id="scriptProgressLabel">Starting...</span></div>'
      : '<div class="empty-state"><span class="spinner"></span>&nbsp;Running...</div>';
    if (statusEl) statusEl.textContent = this.t('tools.running');
    if (outputStatus) outputStatus.textContent = this.t('tools.runningStatus', { script: scriptId });

    let unsubscribeProgress = null;
    if (reportsProgress) {
      unsubscribeProgress = Api.onToolProgress('run-script', (progress) => {
        const labelEl = output.querySelector('#scriptProgressLabel');
        if (!labelEl || !progress) return;
        const label = progress.label || this.t('tools.working');
        if (typeof progress.total === 'number' && progress.total > 0) {
          labelEl.textContent = `${label}... (${progress.count}/${progress.total})`;
        } else if (typeof progress.count === 'number') {
          labelEl.textContent = `${label}... (${progress.count.toLocaleString()} ${this.t('tools.scanned')})`;
        } else {
          labelEl.textContent = label;
        }
      });
    }

    try {
      const result = await Api.runTool('run-script', { scriptId, scriptArgs });
      const when = new Date().toLocaleString();
      if (statusEl) statusEl.textContent = `${this.t('tools.completed')} ${when}`;
      output.innerHTML = this.renderOutput(scriptId, result, when);
      if (outputStatus) outputStatus.textContent = this.t('tools.completedStatus', { script: scriptId, when });
      if (exportBtn) exportBtn.style.display = 'inline-flex';

      if (scriptId === 'uninstaller-report') {
        this._uninstallerApps = Array.isArray(result.apps) ? result.apps : [];
        if (result.scannedApp) this._lastScannedAppName = result.scannedApp;
        this.wireUninstallerActions(container);
      }
      if (scriptId === 'large-files-report') this.wireLargeFilesActions(container);
      if (scriptId === 'duplicate-finder') this.wireDuplicateFinderActions(container);
      if (scriptId === 'browser-cache-report') this.wireBrowserCacheActions(container);
      if (scriptId === 'list-startup-items' && Array.isArray(result.items)) {
        this._startupItems = result.items;
        this.wireStartupActions(container);
      }
      setButtonLoading(btn, false);
      btn.textContent = this.t('tools.completed');
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.textContent = originalLabel;
        btn.classList.remove('btn-success');
      }, 2000);
    } catch (err) {
      if (statusEl) statusEl.textContent = this.t('tools.failed');
      if (outputStatus) outputStatus.textContent = this.t('tools.failedStatus', { script: scriptId });
      showToolError(output, err);
      setButtonLoading(btn, false);
    } finally {
      if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
      container.querySelector('#clearOutputBtn').style.display = 'inline-flex';
    }
  },

  lazyRowStyle: 'content-visibility:auto;contain-intrinsic-size:0 36px;',

  renderOutput(scriptId, result, when) {
    let html = `<div class="log-row" style="background:var(--panel-raised);"><span class="log-tag clean">${this.t('tools.done')}</span><span class="log-path">${this.t('tools.completedAt', { when: escapeHtml(when) })}</span></div>`;
    const truncate = (s, n = 80) => (typeof s === 'string' && s.length > n) ? s.slice(0, n - 1) + '…' : (s || '');
    if (scriptId === 'clear-temp-files') {
      html += `<div class="log-row"><span class="log-tag clean">${this.t('tools.cleared')}</span><span class="log-path">${result.deletedCount || 0} ${this.t('tools.files')} ${this.t('tools.comma')} ${result.freedMB || 0} MB ${this.t('tools.freed')} (${this.t('tools.olderThan')} ${result.maxAgeDays ?? '?'} ${this.t('tools.daysShort')})</span></div>`;
      if (result.skippedCount) html += `<div class="log-row"><span class="log-tag warn">${this.t('tools.skipped')}</span><span class="log-path">${result.skippedCount} ${this.t('tools.items')} (${this.t('tools.lockedDenied')})</span></div>`;
      const logs = (result.log || []).filter(Boolean).slice(0, 15);
      if (logs.length) html += logs.map(line => `<div class="log-row"><span class="log-path">${escapeHtml(truncate(line, 200))}</span></div>`).join('');
      if ((result.log || []).length > 15) html += `<div class="log-row"><span class="log-path">... ${escapeHtml(String((result.log || []).length - 15))} ${this.t('tools.moreLinesOmitted')}</span></div>`;
    } else if (scriptId === 'disk-space-report' && Array.isArray(result.volumes)) {
      html += result.volumes.map(v => `<div class="log-row"><span class="log-tag ${v.usePercent > 90 ? 'match' : v.usePercent > 75 ? 'warn' : 'clean'}">${v.usePercent}%</span><span class="log-path">${escapeHtml(v.mount)} - ${v.usedGB}/${v.sizeGB} GB ${this.t('tools.used')}, ${v.freeGB} GB ${this.t('tools.free')}</span></div>`).join('');
    } else if (scriptId === 'browser-cache-report' && Array.isArray(result.browsers)) {
      const anyExists = result.browsers.some((b) => b.exists);
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <div class="log-row" style="border:none; padding:0;"><span class="log-tag info">${this.t('tools.total')}</span><span class="log-path">${result.totalMB || 0} MB</span></div>
        <button class="btn btn-sm" id="clearAllCacheBtn" ${anyExists ? '' : 'disabled'}>${this.t('tools.clearAllCaches')}</button>
      </div>`;
      html += result.browsers.map((b) => `
        <div class="log-row" style="display:flex; align-items:center; gap:8px;">
          <span class="log-tag ${b.exists ? 'info' : 'warn'}">${b.sizeMB || 0} MB</span>
          <span class="log-path" style="flex:1;">${escapeHtml(b.name)}${b.exists ? '' : ` (${this.t('tools.notFound')})`}</span>
          ${b.exists ? `<button class="btn btn-sm clear-single-cache-btn" data-browser="${escapeHtml(b.name)}" style="flex-shrink:0;">${this.t('tools.clear')}</button>` : ''}
        </div>`).join('');
    } else if (scriptId === 'large-files-report' && Array.isArray(result.files)) {
      html += `<div class="log-row"><span class="log-tag info">${result.count || 0}</span><span class="log-path">${this.t('tools.filesOver', { count: result.minSizeMB || 0 })} ${escapeHtml(this.t('tools.under', { root: result.root || '' }))}</span></div>`;
      if (result.files.length) {
        html += `<div style="display:flex; justify-content:flex-end; margin:8px 0;"><button class="btn btn-sm" style="color:var(--accent-danger);" id="deleteSelectedFilesBtn" disabled>${this.t('tools.deleteSelected', { count: 0 })}</button></div>`;
        html += result.files.slice(0, 100).map((f) => `
          <div class="log-row" style="display:flex; align-items:center; gap:8px; ${this.lazyRowStyle}">
            <input type="checkbox" class="large-file-checkbox" data-file-path="${escapeHtml(f.path)}" data-file-size="${f.sizeMB}" />
            <span class="log-tag warn">${f.sizeMB} MB</span>
            <span class="log-path" style="flex:1;">${escapeHtml(f.path)}</span>
          </div>`).join('');
      }
    } else if (scriptId === 'list-startup-items' && Array.isArray(result.items)) {
      html += `<div class="log-row"><span class="log-tag info">${result.itemCount || result.items.length}</span><span class="log-path">${this.t('tools.startupEntries')}</span></div>`;
      result.items.forEach((item, idx) => {
        const name = item.name || item.raw || item.path || 'unknown';
        const cmd = item.command || item.path || item.raw || '';
        const displayCmd = truncate(name + (cmd && cmd !== name ? ' — ' + cmd : ''), 200);
        html += `<div class="log-row startup-row" data-idx="${idx}">
          <img class="startup-icon" data-exe="${escapeHtml(item.exePath || '')}" src="" alt="" />
          <span class="log-tag info">${escapeHtml(item.source || 'unknown')}</span>
          <span class="log-path" style="flex:1;">${escapeHtml(displayCmd)}</span>
          <button class="btn btn-sm startup-toggle-btn" data-idx="${idx}">${this.t('tools.disable')}</button>
        </div>`;
      });
    } else if (scriptId === 'windows-services-report') {
      html += `<div class="log-row"><span class="log-tag info">${result.autoStartCount || 0}</span><span class="log-path">${this.t('tools.autoStartServices')}, ${result.flaggedCount || 0} ${this.t('tools.flagged')}</span></div>`;
      html += (result.flagged || []).map(s => `<div class="log-row" style="${this.lazyRowStyle}"><span class="log-tag match">${this.t('tools.flag')}</span><span class="log-path">${escapeHtml(s.displayName || s.name)} ${s.pathName ? '(' + escapeHtml(s.pathName) + ')' : ''}</span></div>`).join('');
      html += (result.services || []).slice(0, 120).map(s => `<div class="log-row" style="${this.lazyRowStyle}"><span class="log-tag clean">${escapeHtml(s.state || '')}</span><span class="log-path">${escapeHtml(s.displayName || s.name)}</span></div>`).join('');
    } else if (scriptId === 'uninstaller-report') {
      if (result.supported === false) {
        html += `<div class="log-row"><span class="log-tag warn">${this.t('tools.info')}</span><span class="log-path">${escapeHtml(result.message || this.t('uninstaller.unavailable'))}</span></div>`;
      } else {
        html += `<div class="log-row"><span class="log-tag info">${result.appCount || 0}</span><span class="log-path">${escapeHtml(this.t('uninstaller.installedApps'))}</span></div>`;
        if (Array.isArray(result.leftovers) && result.leftovers.length) {
          html += `<div class="log-row"><span class="log-tag warn">${result.leftovers.length}</span><span class="log-path">${escapeHtml(this.t('uninstaller.leftoverFoldersFor', { app: result.scannedApp || this.t('tools.selectedApp') }))}</span></div>`;
          html += `<div style="display:flex; justify-content:flex-end; margin:8px 0;"><button class="btn btn-sm" id="removeLeftoversBtn" data-scanned-app="${escapeHtml(result.scannedApp || '')}" disabled>${escapeHtml(this.t('uninstaller.removeSelected'))} (0)</button></div>`;
          html += result.leftovers.map((entry) => `
            <div class="log-row leftover-row" style="display:flex; align-items:center; gap:8px; ${this.lazyRowStyle}">
              ${entry.kind === 'registry'
    ? `<span class="log-tag info">${escapeHtml(this.t('uninstaller.registryHint'))}</span>`
    : `<input type="checkbox" class="leftover-checkbox" data-leftover-path="${escapeHtml(entry.path)}" />`}
              <span class="log-path" style="flex:1;">${escapeHtml(entry.path)}</span>
            </div>`).join('');
        }
        html += (result.apps || []).slice(0, 120).map((app, idx) => `
          <div class="log-row uninstaller-row" data-app-idx="${idx}" style="display:flex; align-items:center; gap:8px; ${this.lazyRowStyle}">
            <img class="uninstaller-icon" data-exe="${escapeHtml(app.iconPath || '')}" src="" alt="" style="width:20px;height:20px;flex-shrink:0;" />
            <span class="log-path" style="flex:1;">${escapeHtml(app.name)}${app.version ? ` (${escapeHtml(app.version)})` : ''}${app.estimatedSizeMB ? ` — ${app.estimatedSizeMB} MB` : ''}</span>
            <button class="btn btn-sm uninstaller-scan-btn" data-app-name="${escapeHtml(app.name)}">${escapeHtml(this.t('uninstaller.scanLeftovers'))}</button>
            <button class="btn btn-sm uninstaller-launch-btn" data-app-idx="${idx}" ${app.uninstallString ? '' : 'disabled'}>${escapeHtml(this.t('uninstaller.uninstall'))}</button>
          </div>`).join('');
      }
    } else if (scriptId === 'duplicate-finder' && Array.isArray(result.duplicateGroups)) {
      html += `<div class="log-row"><span class="log-tag info">${result.totalFilesScanned || 0}</span><span class="log-path">${this.t('tools.filesScanned')}</span></div>`;
      html += `<div class="log-row"><span class="log-tag warn">${result.duplicateGroups.length}</span><span class="log-path">${this.t('tools.duplicateGroups')}</span></div>`;
      html += `<div class="log-row"><span class="log-tag match">${result.totalDuplicates || 0}</span><span class="log-path">${this.t('tools.totalDuplicates')}</span></div>`;
      html += `<div class="log-row"><span class="log-tag clean">${((result.totalWastedSpace || 0) / 1024 / 1024).toFixed(1)} MB</span><span class="log-path">${this.t('tools.wastedSpace')}</span></div>`;
      if (result.duplicateGroups.length) {
        html += `<div style="display:flex; justify-content:flex-end; margin:8px 0;"><button class="btn btn-sm" style="color:var(--accent-danger);" id="deleteDuplicatesBtn" disabled>${this.t('tools.deleteSelected', { count: 0 })}</button></div>`;
        html += result.duplicateGroups.slice(0, 50).map((group, gIdx) => `
          <div class="log-row" style="background:var(--panel-raised); padding:8px; margin:4px 0;">
            <div style="font-weight:600; margin-bottom:4px;">${this.t('tools.group')} ${gIdx + 1} — ${group.files.length} ${this.t('tools.copies')}, ${((group.size || 0) / 1024).toFixed(1)} KB ${this.t('tools.each')}</div>
            ${group.files.map((f, fIdx) => `
              <div class="log-row" style="display:flex; align-items:center; gap:8px; ${this.lazyRowStyle}">
                ${fIdx === 0
                  ? `<span class="log-tag clean">${this.t('tools.original')}</span>`
                  : `<input type="checkbox" class="duplicate-checkbox" data-file-path="${escapeHtml(f.path)}" />`}
                <span class="log-path" style="flex:1; cursor:pointer;" title="${escapeHtml(f.path)}">${escapeHtml(truncate(f.path, 60))}</span>
              </div>`).join('')}
          </div>`).join('');
      }
    } else if (scriptId === 'file-shredder') {
      if (result.success === false) {
        html += `<div class="log-row"><span class="log-tag match">${this.t('tools.error')}</span><span class="log-path">${escapeHtml(result.error || this.t('tools.shreddingFailed'))}</span></div>`;
      } else if (result.results && Array.isArray(result.results)) {
        html += `<div class="log-row"><span class="log-tag info">${result.total || 0}</span><span class="log-path">${this.t('tools.filesProcessed')}</span></div>`;
        html += `<div class="log-row"><span class="log-tag clean">${result.successful || 0}</span><span class="log-path">${this.t('tools.successfullyShredded')}</span></div>`;
        html += `<div class="log-row"><span class="log-tag match">${result.failed || 0}</span><span class="log-path">${this.t('tools.failed')}</span></div>`;
        html += `<div class="log-row"><span class="log-tag clean">${((result.totalBytesShredded || 0) / 1024 / 1024).toFixed(2)} MB</span><span class="log-path">${this.t('tools.totalDataShredded')}</span></div>`;
        html += result.results.map(r => `
          <div class="log-row" style="${this.lazyRowStyle}">
            <span class="log-tag ${r.success ? 'clean' : 'match'}">${r.success ? this.t('tools.shredded') : this.t('tools.failed')}</span>
            <span class="log-path" style="flex:1;">${escapeHtml(r.originalPath || r.path || 'unknown')}</span>
            ${r.error ? `<span class="log-tag warn">${escapeHtml(r.error)}</span>` : ''}
          </div>`).join('');
      } else if (result.success) {
        html += `<div class="log-row"><span class="log-tag clean">${this.t('tools.shredded')}</span><span class="log-path">${escapeHtml(result.originalPath)}</span></div>`;
        html += `<div class="log-row"><span class="log-tag clean">${((result.sizeBytes || 0) / 1024).toFixed(1)} KB</span><span class="log-path">${this.t('tools.size')}</span></div>`;
        html += `<div class="log-row"><span class="log-tag info">${result.passes || 3}</span><span class="log-path">${this.t('tools.passesCompleted')}</span></div>`;
      }
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
      deleteBtn.textContent = `${this.t('tools.deleteSelected', { count: selected.length })}`;
      deleteBtn.disabled = selected.length === 0;
    };

    output.querySelectorAll('.large-file-checkbox').forEach((cb) => cb.addEventListener('change', updateButton));

    deleteBtn.addEventListener('click', async () => {
      const selected = [...output.querySelectorAll('.large-file-checkbox:checked')];
      if (!selected.length) return;
      const totalMB = selected.reduce((sum, cb) => sum + Number(cb.dataset.fileSize || 0), 0).toFixed(1);
      if (!window.confirm(`${this.t('tools.confirmDelete', { count: selected.length, mb: totalMB })}`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = this.t('tools.deleting');
      try {
        const paths = selected.map((cb) => cb.dataset.filePath);
        const result = await Api.runTool('run-script', { scriptId: 'delete-files', scriptArgs: { paths } });
        alert(`${this.t('tools.deleted', { count: result.deletedCount })} ${this.t('tools.freed', { mb: result.freedMB })}${result.skippedCount ? ` ${this.t('tools.skipped', { count: result.skippedCount })}` : ''}`);

        const refreshed = await Api.runTool('run-script', { scriptId: 'large-files-report', scriptArgs: { minSizeMB: this.getMinSizeMB(container) } });
        output.innerHTML = this.renderOutput('large-files-report', refreshed, new Date().toLocaleString());
        this.wireLargeFilesActions(container);
      } catch (err) {
        alert(err.message || this.t('tools.failedDelete'));
        deleteBtn.disabled = false;
        updateButton();
      }
    });
  },

  wireDuplicateFinderActions(container) {
    const output = container.querySelector('#toolOutput');
    const deleteBtn = output.querySelector('#deleteDuplicatesBtn');
    if (!deleteBtn) return;

    const updateButton = () => {
      const selected = output.querySelectorAll('.duplicate-checkbox:checked');
      deleteBtn.textContent = `${this.t('tools.deleteSelected', { count: selected.length })}`;
      deleteBtn.disabled = selected.length === 0;
    };

    output.querySelectorAll('.duplicate-checkbox').forEach((cb) => cb.addEventListener('change', updateButton));

    deleteBtn.addEventListener('click', async () => {
      const selected = [...output.querySelectorAll('.duplicate-checkbox:checked')];
      if (!selected.length) return;
      if (!window.confirm(`${this.t('tools.confirmDeleteDuplicates', { count: selected.length })}`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = this.t('tools.deleting');
      try {
        const paths = selected.map((cb) => cb.dataset.filePath);
        const result = await Api.runTool('run-script', { scriptId: 'duplicate-finder', scriptArgs: { deletePaths: paths } });
        alert(`${this.t('tools.deleted', { count: result.deleted.length })}${result.failed.length ? ` ${this.t('tools.failed', { count: result.failed.length })}` : ''}`);

        const refreshed = await Api.runTool('run-script', { scriptId: 'duplicate-finder', scriptArgs: {} });
        output.innerHTML = this.renderOutput('duplicate-finder', refreshed, new Date().toLocaleString());
        this.wireDuplicateFinderActions(container);
      } catch (err) {
        alert(err.message || this.t('tools.failedDelete'));
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
      const label = browsers.length === 1 ? browsers[0] : this.t('tools.allBrowsers');
      if (!window.confirm(`${this.t('tools.confirmClearCache', { label })}`)) return;
      const originalLabel = triggerBtn.textContent;
      triggerBtn.disabled = true;
      triggerBtn.textContent = this.t('tools.clearing');
      try {
        const result = await Api.runTool('run-script', { scriptId: 'clear-browser-cache', scriptArgs: { browsers } });
        alert(`${this.t('tools.freed', { mb: result.totalMB })}${result.note ? ' ' + result.note : ''}`);

        const refreshed = await Api.runTool('run-script', { scriptId: 'browser-cache-report', scriptArgs: {} });
        output.innerHTML = this.renderOutput('browser-cache-report', refreshed, new Date().toLocaleString());
        this.wireBrowserCacheActions(container);
      } catch (err) {
        alert(err.message || this.t('tools.failedClearCache'));
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalLabel;
      }
    };

    if (clearAllBtn) clearAllBtn.addEventListener('click', () => runClear([], clearAllBtn));
    singleBtns.forEach((btn) => btn.addEventListener('click', () => runClear([btn.dataset.browser], btn)));
  },

  wireStartupActions(container) {
    const output = container.querySelector('#toolOutput');

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
            btn.textContent = !currentlyEnabled ? this.t('tools.disable') : this.t('tools.enable');
            btn.classList.toggle('btn-success', !currentlyEnabled);
          } else {
            alert(result.error || this.t('tools.failedToggle'));
            btn.textContent = currentlyEnabled ? this.t('tools.disable') : this.t('tools.enable');
          }
        } catch (err) {
          alert(err.message || this.t('tools.failedToggle'));
          btn.textContent = currentlyEnabled ? this.t('tools.disable') : this.t('tools.enable');
        }
        btn.disabled = false;
      });
    });
  },

  wireUninstallerActions(container) {
    const output = container.querySelector('#toolOutput');
    if (!output) return;

    const iconImgs = output.querySelectorAll('.uninstaller-icon[data-exe]');
    const exePaths = [...new Set([...iconImgs].map((img) => img.dataset.exe).filter(Boolean))];
    if (exePaths.length) {
      window.api.invoke('startup:getIcons', exePaths).then((icons) => {
        iconImgs.forEach((img) => {
          const dataUrl = icons && icons[img.dataset.exe];
          if (dataUrl) img.src = dataUrl;
          else img.style.display = 'none';
        });
      }).catch(() => {
        iconImgs.forEach((img) => { img.style.display = 'none'; });
      });
    } else {
      iconImgs.forEach((img) => { img.style.display = 'none'; });
    }

    output.querySelectorAll('.uninstaller-launch-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.appIdx);
        const app = this._uninstallerApps[idx];
        const uninstallString = app && app.uninstallString;
        if (!uninstallString) return;
        if (!window.confirm(this.t('uninstaller.launchConfirm', { command: uninstallString }))) return;
        btn.disabled = true;
        try {
          const result = await Api.runTool('run-script', {
            scriptId: 'launch-uninstaller',
            scriptArgs: { uninstallString }
          });
          alert(result.ok === false
            ? (result.error || this.t('uninstaller.launchFailed'))
            : this.t('uninstaller.launchSuccess'));
        } catch (err) {
          alert(err.message || this.t('uninstaller.launchFailed'));
        } finally {
          btn.disabled = false;
        }
      });
    });

    output.querySelectorAll('.uninstaller-scan-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const appName = btn.dataset.appName;
        if (!appName) return;
        btn.disabled = true;
        btn.textContent = this.t('tools.running');
        try {
          const refreshed = await Api.runTool('run-script', {
            scriptId: 'uninstaller-report',
            scriptArgs: { scanLeftoversFor: appName }
          });
          output.innerHTML = this.renderOutput('uninstaller-report', refreshed, new Date().toLocaleString());
          this._uninstallerApps = Array.isArray(refreshed.apps) ? refreshed.apps : [];
          if (appName) this._lastScannedAppName = appName;
          this.wireUninstallerActions(container);
        } catch (err) {
          alert(err.message || this.t('uninstaller.scanFailed'));
          btn.textContent = this.t('uninstaller.scanLeftovers');
          btn.disabled = false;
        }
      });
    });

    const removeBtn = output.querySelector('#removeLeftoversBtn');
    if (!removeBtn) return;

    const updateRemoveButton = () => {
      const selected = output.querySelectorAll('.leftover-checkbox:checked');
      removeBtn.textContent = `${this.t('uninstaller.removeSelected')} (${selected.length})`;
      removeBtn.disabled = selected.length === 0;
    };

    output.querySelectorAll('.leftover-checkbox').forEach((cb) => cb.addEventListener('change', updateRemoveButton));

    removeBtn.addEventListener('click', async () => {
      const selected = [...output.querySelectorAll('.leftover-checkbox:checked')];
      if (!selected.length) return;
      const paths = selected.map((cb) => cb.dataset.leftoverPath);
      if (!window.confirm(this.t('uninstaller.removeFoldersConfirm', { count: String(paths.length) }))) return;

      removeBtn.disabled = true;
      removeBtn.textContent = this.t('tools.running');
      try {
        const preview = await Api.runTool('run-script', {
          scriptId: 'remove-leftovers',
          scriptArgs: { paths, dryRun: true }
        });
        if (!window.confirm(this.t('uninstaller.dryRunConfirm', { count: String(preview.removedCount) }))) {
          updateRemoveButton();
          return;
        }
        const result = await Api.runTool('run-script', {
          scriptId: 'remove-leftovers',
          scriptArgs: { paths, dryRun: false }
        });
        const skippedText = result.skippedCount
          ? this.t('uninstaller.skippedSummary', { skipped: String(result.skippedCount) })
          : '';
        alert(this.t('uninstaller.removedSummary', { removed: String(result.removedCount), skipped: skippedText }));
        const appName = removeBtn.dataset.scannedApp || this._lastScannedAppName;
        const refreshed = await Api.runTool('run-script', {
          scriptId: 'uninstaller-report',
          scriptArgs: appName ? { scanLeftoversFor: appName } : {}
        });
        output.innerHTML = this.renderOutput('uninstaller-report', refreshed, new Date().toLocaleString());
        this._uninstallerApps = Array.isArray(refreshed.apps) ? refreshed.apps : [];
        if (appName) this._lastScannedAppName = appName;
        this.wireUninstallerActions(container);
      } catch (err) {
        alert(err.message || this.t('tools.failedRemove'));
        updateRemoveButton();
      }
    });
  }
};