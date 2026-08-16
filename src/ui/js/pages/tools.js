(function () {
  'use strict';

  const CATEGORY_META = {
    'cleanup-storage': { labelKey: 'tools.hub.category.cleanupStorage', label: 'Cleanup & Storage', description: 'Understand usage first, then make deliberate and reversible cleanup choices.', icon: 'archive' },
    'system-integrity': { labelKey: 'tools.hub.category.systemIntegrity', label: 'System Integrity', description: 'Read-only checks for persistence, services, tasks, and critical system files.', icon: 'shield-check' },
    'app-management': { labelKey: 'tools.hub.category.appManagement', label: 'App Management', description: 'Review installed software and the applications that launch with Windows.', icon: 'package' },
    'privacy-recovery': { labelKey: 'tools.hub.category.privacyRecovery', label: 'Privacy & Recovery', description: 'Recover staged cleanup or perform explicitly irreversible deletion.', icon: 'refresh-cw' }
  };

  const TOOL_I18N = {
    'clear-temp-files': ['tools.script.clearTempFiles.name', 'tools.script.clearTempFiles.desc'],
    'large-files-report': ['tools.script.largeFilesReport.name', 'tools.script.largeFilesReport.desc'],
    'list-startup-items': ['tools.script.listStartupItems.name', 'tools.script.listStartupItems.desc'],
    'browser-cache-report': ['tools.script.browserCacheReport.name', 'tools.script.browserCacheReport.desc'],
    'disk-space-report': ['tools.script.diskSpaceReport.name', 'tools.script.diskSpaceReport.desc'],
    'windows-services-report': ['tools.script.windowsServicesReport.name', 'tools.script.windowsServicesReport.desc'],
    'scheduled-tasks-report': ['tools.script.scheduledTasksReport.name', 'tools.script.scheduledTasksReport.desc'],
    'hosts-file-check': ['tools.script.hostsFileCheck.name', 'tools.script.hostsFileCheck.desc'],
    'uninstaller-report': ['tools.script.uninstallerReport.name', 'tools.script.uninstallerReport.desc'],
    'duplicate-finder': ['tools.script.duplicateFinder.name', 'tools.script.duplicateFinder.desc'],
    'file-shredder': ['tools.script.fileShredder.name', 'tools.script.fileShredder.desc'],
    'maintenance-safety-vault': ['tools.hub.vault.name', 'tools.hub.vault.desc'],
    'persistence-change-monitor': ['tools.hub.persistence.name', 'tools.hub.persistence.desc']
  };

  const ToolsPage = {
    _container: null,
    _registry: [],
    _selectedToolId: null,
    _results: {},
    _progress: {},
    _runs: {},
    _history: [],
    _subscriptionsReady: false,
    _largePath: null,
    _largeThreshold: 100,
    _duplicatePath: null,
    _duplicateMinMB: 1,
    _duplicateExtensions: '',
    _shredPaths: [],
    _selectedLarge: new Set(),
    _selectedTemp: new Set(),
    _selectedDuplicates: new Set(),
    _duplicateKeep: new Map(),
    _duplicateExpanded: new Set(),
    _selectedLeftovers: new Set(),
    _taskShowMicrosoft: false,
    _serviceRiskFilter: 'all',
    _softwareSearch: '',
    _leftoverAppName: '',
    _notice: null,

    e(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },

    t(key, fallback, vars) {
      const value = window.I18n?.t(key, vars) ?? key;
      return value === key ? fallback : value;
    },

    toolText(tool) {
      const keys = TOOL_I18N[tool.id] || [];
      return {
        name: keys[0] ? this.t(keys[0], tool.name) : tool.name,
        description: keys[1] ? this.t(keys[1], tool.description) : tool.description
      };
    },

    _impactPill(level) {
      const value = level || 'none';
      const label = this.t(`tools.impact.${value}`, value);
      return `<span class="tag-pill tag-${this.e(value)}">${this.e(this.t('tools.impact.label', `${value} impact`, { level: label }))}</span>`;
    },

    icon(name) {
      try { return iconFor(name || 'wrench'); } catch (_) { return ''; }
    },

    bytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    },

    duration(value) {
      const ms = Math.max(0, Number(value) || 0);
      if (ms < 1000) return `${ms} ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
      return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    },

    render(container) {
      this._container = container;
      container.innerHTML = `
        <div class="page-header tools-page-header">
          <h1 class="page-title">${this.e(this.t('tools.title', 'Tools & Maintenance'))}</h1>
          <div class="page-subtitle">${this.e(this.t('tools.hub.subtitle', 'Inspect, maintain, and recover your PC with clear previews and accountable results.'))}</div>
        </div>
        <div id="toolsWorkspace" class="maintenance-hub" aria-live="polite">
          <div class="maintenance-loading"><span class="spinner"></span> Loading maintenance tools…</div>
        </div>`;
      this._ensureSubscriptions();
      this._initialize().catch((error) => this._showFatal(error));
    },

    async _initialize() {
      const response = await Api.listTools();
      this._registry = (response?.ok ? response.data : response) || [];
      this._registry = this._registry.filter((tool) => tool.visible !== false);
      const [active, history] = await Promise.all([
        Api.getActiveTools().catch(() => []),
        Api.getToolHistory(100).catch(() => [])
      ]);
      this._history = history;
      for (const run of active) {
        this._runs[run.toolId] = run;
        this._progress[run.toolId] = run;
      }
      if (this._selectedToolId && !this._registry.some((tool) => tool.id === this._selectedToolId)) this._selectedToolId = null;
      await this._loadServiceState(this._selectedToolId);
      this._renderView();
    },

    _ensureSubscriptions() {
      if (this._subscriptionsReady) return;
      this._subscriptionsReady = true;
      Api.onToolRunProgress((payload) => {
        this._runs[payload.toolId] = payload;
        this._progress[payload.toolId] = payload;
        if (this._selectedToolId === payload.toolId) this._renderView();
      });
      Api.onToolRunComplete((payload) => {
        delete this._runs[payload.toolId];
        this._progress[payload.toolId] = payload;
        this._results[payload.toolId] = payload.status === 'completed'
          ? payload.result
          : { __error: payload.error || `Run ${payload.status}.`, __status: payload.status };
        this._history.unshift({
          runId: payload.runId, toolId: payload.toolId, source: payload.source,
          status: payload.status, startedAt: payload.startedAt, completedAt: payload.completedAt,
          durationMs: payload.durationMs, summary: {}
        });
        this._afterResult(payload.toolId).catch(() => {}).finally(() => {
          if (this._selectedToolId === payload.toolId) this._renderView();
        });
      });
      window.soterios.persistence?.onProgress?.((payload) => {
        this._progress['persistence-change-monitor'] = { ...payload, status: 'running', cancelable: false };
        if (this._selectedToolId === 'persistence-change-monitor') this._renderView();
      });
    },

    async _afterResult(toolId) {
      if (toolId === 'list-startup-items' && this._results[toolId]?.items) {
        const disabled = await window.soterios.startup.listDisabled().catch(() => []);
        this._results[toolId].items = [...this._results[toolId].items, ...disabled];
        this._results[toolId].itemCount = this._results[toolId].items.length;
      }
      if (toolId === 'duplicate-finder') {
        const groups = this._results[toolId]?.duplicateGroups || [];
        for (const group of groups) {
          if (!this._duplicateKeep.has(group.id)) this._duplicateKeep.set(group.id, group.files[0]?.path);
        }
      }
    },

    async _loadServiceState(toolId) {
      if (toolId === 'maintenance-safety-vault') {
        const response = await window.soterios.vault.list();
        this._results[toolId] = response.ok ? { items: response.data } : { __error: response.error };
      } else if (toolId === 'persistence-change-monitor') {
        const response = await window.soterios.persistence.getStatus();
        this._results[toolId] = response.ok ? response.data : { __error: response.error };
      }
    },

    _workspace() {
      return this._container?.querySelector('#toolsWorkspace');
    },

    _renderView() {
      const root = this._workspace();
      if (!root) return;
      root.innerHTML = this._selectedToolId ? this._renderDetail(this._selectedToolId) : this._renderHub();
      this._wire(root);
    },

    _renderHub() {
      return `<div class="maintenance-categories">
        ${Object.entries(CATEGORY_META).map(([categoryId, meta]) => {
          const tools = this._registry.filter((tool) => tool.category === categoryId);
          if (!tools.length) return '';
          return `<section class="maintenance-category" aria-labelledby="maintenance-cat-${categoryId}">
            <header class="maintenance-category-header">
              <span class="maintenance-category-icon">${this.icon(meta.icon)}</span>
              <div><h2 id="maintenance-cat-${categoryId}">${this.e(this.t(meta.labelKey, meta.label))}</h2><p>${this.e(meta.description)}</p></div>
            </header>
            <div class="maintenance-tool-grid">
              ${tools.map((tool) => this._renderHubCard(tool)).join('')}
            </div>
          </section>`;
        }).join('')}
      </div>`;
    },

    _renderHubCard(tool) {
      const text = this.toolText(tool);
      const run = this._runs[tool.id];
      const latest = this._history.find((item) => item.toolId === tool.id);
      return `<button type="button" class="maintenance-tool-card" data-action="open-tool" data-tool-id="${this.e(tool.id)}">
        <span class="maintenance-tool-card-icon">${this.icon(tool.icon)}</span>
        <span class="maintenance-tool-card-copy">
          <span class="maintenance-tool-card-title">${this.e(text.name)}</span>
          <span class="maintenance-tool-card-desc">${this.e(text.description)}</span>
          <span class="maintenance-tool-card-meta">
            ${run ? `<span class="maintenance-state running">Running · ${this.e(run.phase)}</span>`
              : latest ? `<span class="maintenance-state ${this.e(latest.status)}">Last run ${this.e(latest.status)}</span>`
                : '<span class="maintenance-state">Not run this session</span>'}
            ${this._impactPill(tool.impact)}
          </span>
        </span>
        <span class="maintenance-card-arrow" aria-hidden="true">${this.icon('chevron-right')}</span>
      </button>`;
    },

    _renderDetail(toolId) {
      const tool = this._registry.find((entry) => entry.id === toolId);
      if (!tool) return '<div class="empty-state">Tool not found.</div>';
      const text = this.toolText(tool);
      const run = this._runs[toolId]
        || (this._progress[toolId]?.status === 'running' ? this._progress[toolId] : null);
      const result = this._results[toolId];
      return `<div class="maintenance-workspace">
        <div class="maintenance-workspace-nav">
          <button type="button" class="btn btn-sm btn-ghost" data-action="back-hub">${this.icon('arrow-left')} All tools</button>
        </div>
        <header class="maintenance-workspace-header">
          <span class="maintenance-workspace-icon">${this.icon(tool.icon)}</span>
          <div class="maintenance-workspace-title"><h2>${this.e(text.name)}</h2><p>${this.e(text.description)}</p></div>
          ${this._impactPill(tool.impact)}
        </header>
        ${this._notice ? `<div class="maintenance-notice ${this.e(this._notice.type || 'info')}" role="status">${this.e(this._notice.message)}</div>` : ''}
        ${this._renderControls(tool, run)}
        ${run ? this._renderProgress(run) : ''}
        <section class="maintenance-results" aria-label="Tool results">
          ${result ? this._renderResult(toolId, result) : this._renderNoResult(tool, run)}
        </section>
        ${this._renderHistory(toolId)}
      </div>`;
    },

    _renderControls(tool, run) {
      if (run) return '';
      const runButton = (label = 'Run analysis') => `<button type="button" class="btn btn-primary" data-action="run-tool">${this.e(label)}</button>`;
      switch (tool.id) {
        case 'clear-temp-files':
          return `<div class="maintenance-controls"><label>Minimum age <span class="field-inline"><input id="tempAgeDays" type="number" min="1" max="365" value="7"> days</span></label>${runButton('Analyze temp files')}</div>`;
        case 'large-files-report':
          return `<div class="maintenance-controls maintenance-controls-wrap">
            <label class="path-picker-label">Folder <span id="largePathLabel" class="selected-path" title="${this.e(this._largePath || 'Home folder')}">${this.e(this._largePath || 'Home folder')}</span></label>
            <button type="button" class="btn btn-ghost" data-action="browse-large">Choose folder</button>
            <label>At least <span class="field-inline"><input id="largeThreshold" type="number" min="1" value="${this.e(this._largeThreshold)}"> MB</span></label>${runButton('Find large files')}
          </div>`;
        case 'duplicate-finder':
          return `<div class="maintenance-controls maintenance-controls-wrap">
            <label class="path-picker-label">Folder <span class="selected-path" title="${this.e(this._duplicatePath || 'Choose a folder')}">${this.e(this._duplicatePath || 'Choose a folder')}</span></label>
            <button type="button" class="btn btn-ghost" data-action="browse-duplicate">Choose folder</button>
            <label>Minimum <span class="field-inline"><input id="duplicateMinMB" type="number" min="1" value="${this.e(this._duplicateMinMB)}"> MB</span></label>
            <label>Extensions <input id="duplicateExtensions" type="text" value="${this.e(this._duplicateExtensions)}" placeholder="All files"></label>${runButton('Find duplicates')}
          </div>`;
        case 'file-shredder':
          return `<div class="maintenance-controls maintenance-controls-wrap">
            <span class="selected-path" title="${this.e(this._shredPaths.join(', '))}">${this._shredPaths.length ? `${this._shredPaths.length} file(s) selected` : 'No files selected'}</span>
            <button type="button" class="btn btn-ghost" data-action="browse-shred">Choose files</button>${runButton('Preview shred')}
          </div>`;
        case 'maintenance-safety-vault':
          return `<div class="maintenance-controls"><button type="button" class="btn btn-ghost" data-action="refresh-vault">Refresh Vault</button><span>Items expire seven days after they are staged.</span></div>`;
        case 'persistence-change-monitor':
          return `<div class="maintenance-controls">${runButton('Scan persistence mechanisms')}</div>`;
        case 'scheduled-tasks-report':
          return `<div class="maintenance-controls"><label class="check-label"><input type="checkbox" id="showMicrosoftTasks" ${this._taskShowMicrosoft ? 'checked' : ''}> Show trusted Microsoft tasks</label>${runButton('Analyze scheduled tasks')}<button type="button" class="btn btn-ghost" data-action="open-utility" data-utility="tasks">Open Task Scheduler</button></div>`;
        case 'windows-services-report':
          return `<div class="maintenance-controls"><label>Show <select id="serviceRiskFilter"><option value="all">All services</option><option value="flagged" ${this._serviceRiskFilter === 'flagged' ? 'selected' : ''}>Flagged only</option></select></label>${runButton('Analyze services')}<button type="button" class="btn btn-ghost" data-action="open-utility" data-utility="services">Open Services</button></div>`;
        case 'uninstaller-report':
          return `<div class="maintenance-controls maintenance-controls-wrap"><label>Search <input id="softwareSearch" type="search" value="${this.e(this._softwareSearch)}" placeholder="Name or publisher"></label>${runButton('Refresh installed apps')}<button type="button" class="btn btn-ghost" data-action="open-apps-settings">Windows Apps settings</button><label>Recently uninstalled app <input id="leftoverAppName" type="text" value="${this.e(this._leftoverAppName)}" placeholder="Exact application name"></label><button type="button" class="btn btn-ghost" data-action="scan-leftovers">Scan leftovers</button></div>`;
        default:
          return `<div class="maintenance-controls">${runButton(tool.impact === 'none' ? 'Run check' : 'Run analysis')}</div>`;
      }
    },

    _renderProgress(run) {
      const pct = Number.isFinite(Number(run.pct)) ? Math.max(0, Math.min(100, Number(run.pct))) : null;
      return `<section class="maintenance-progress" aria-live="polite" aria-atomic="true">
        <div class="maintenance-progress-copy"><strong>${this.e(run.phase || 'Running')}</strong><span>${this.e(run.currentActivity || '')}</span></div>
        ${pct !== null ? `<div class="maintenance-progress-track" role="progressbar" aria-label="Tool progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>` : ''}
        <div class="maintenance-progress-meta"><span>${pct !== null ? `${Math.round(pct)}%` : `${Number(run.count) || 0}${run.total ? ` of ${run.total}` : ''}`}</span>
          ${run.cancelable ? `<button type="button" class="btn btn-sm btn-ghost" data-action="cancel-run" data-run-id="${this.e(run.runId)}">Cancel</button>` : ''}
        </div>
      </section>`;
    },

    _renderNoResult(tool, run) {
      return `<div class="maintenance-empty"><span>${this.icon(run ? 'loader-circle' : 'clipboard-check')}</span><h3>${run ? 'Analysis in progress' : 'No results yet'}</h3><p>${run ? 'You can leave this page and return without losing the run.' : `Run ${this.e(tool.name)} to see an explained, actionable report here.`}</p></div>`;
    },

    _renderResult(toolId, result) {
      if (result.__error) return `<div class="maintenance-result-banner result-${this.e(result.__status || 'failed')}"><strong>${this.e(result.__status || 'Run failed')}</strong><span>${this.e(result.__error)}</span></div>`;
      switch (toolId) {
        case 'clear-temp-files': return this._renderTemp(result);
        case 'large-files-report': return this._renderLarge(result);
        case 'browser-cache-report': return this._renderCache(result);
        case 'disk-space-report': return this._renderDisk(result);
        case 'windows-services-report': return this._renderServices(result);
        case 'scheduled-tasks-report': return this._renderTasks(result);
        case 'hosts-file-check': return this._renderHosts(result);
        case 'duplicate-finder': return this._renderDuplicates(result);
        case 'list-startup-items': return this._renderStartup(result);
        case 'uninstaller-report': return this._renderSoftware(result);
        case 'file-shredder': return this._renderShredder(result);
        case 'maintenance-safety-vault': return this._renderVault(result);
        case 'persistence-change-monitor': return this._renderPersistence(result);
        default: return this._renderGenericResult(result);
      }
    },

    _summaryTiles(items) {
      return `<div class="maintenance-summary-grid">${items.map(([label, value, tone]) => `<div class="maintenance-summary-tile ${tone || ''}"><span>${this.e(label)}</span><strong>${this.e(value)}</strong></div>`).join('')}</div>`;
    },

    _renderTemp(result) {
      if (result.mode === 'clean') {
        return `${this._summaryTiles([['Deleted', result.deletedCount || 0, 'ok'], ['Freed', this.bytes(result.freedBytes), 'ok'], ['Skipped', result.skippedCount || 0, result.skippedCount ? 'warn' : '']])}
          ${result.skipped?.length ? this._renderIssueList(result.skipped, 'Skipped items') : '<div class="maintenance-result-banner result-completed">Approved temp files were permanently removed.</div>'}`;
      }
      const candidates = result.candidates || [];
      return `${this._summaryTiles([['Eligible files', result.candidateCount || 0], ['Potential recovery', this.bytes(result.reclaimableBytes), 'ok'], ['Scanned', result.statistics?.scanned || 0]])}
        <div class="maintenance-result-toolbar"><span>Temp/cache cleanup is permanent and does not use the Safety Vault.</span><button type="button" class="btn btn-danger" data-action="clean-temp" ${candidates.length ? '' : 'disabled'}>Permanently clear listed files</button></div>
        ${candidates.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Remove</th><th>Path</th><th>Size</th><th>Modified</th></tr></thead><tbody>
          ${candidates.slice(0, 500).map((item) => `<tr><td><input type="checkbox" class="temp-select" data-path="${this.e(item.path)}" checked aria-label="Remove ${this.e(item.path)}"></td><td class="path-cell" title="${this.e(item.path)}">${this.e(item.path)}</td><td>${this.bytes(item.sizeBytes)}</td><td>${this.e(new Date(item.modifiedAt).toLocaleString())}</td></tr>`).join('')}
        </tbody></table></div>${candidates.length > 500 ? '<p class="maintenance-footnote">Showing the first 500 eligible files. Narrow the age window to review a smaller set.</p>' : ''}` : '<div class="maintenance-empty"><h3>Nothing eligible for cleanup</h3><p>Recent, active, protected, and inaccessible files were left alone.</p></div>'}`;
    },

    _renderLarge(result) {
      const files = result.files || [];
      return `${this._summaryTiles([['Matching files', result.count || 0], ['Combined size', this.bytes(result.totalSizeBytes)], ['Scanned', result.statistics?.scannedFiles || 0]])}
        <div class="maintenance-result-toolbar"><span>Page ${result.page || 1} of ${result.pageCount || 1} · ${this.e(result.root)}</span><button type="button" class="btn btn-primary" data-action="vault-large" ${files.length ? '' : 'disabled'}>Move selected to Safety Vault</button></div>
        ${files.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Stage</th><th>File</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>
          ${files.map((file) => `<tr><td><input type="checkbox" class="large-select" data-path="${this.e(file.path)}" aria-label="Stage ${this.e(file.path)}"></td><td class="path-cell" title="${this.e(file.path)}">${this.e(file.path)}</td><td>${this.bytes(file.sizeBytes)}</td><td>${this.e(new Date(file.modifiedAt).toLocaleDateString())}</td><td><button type="button" class="btn btn-xs btn-ghost" data-action="reveal" data-path="${this.e(file.path)}">Reveal</button></td></tr>`).join('')}
        </tbody></table></div><div class="pagination"><button class="btn btn-sm btn-ghost" data-action="large-page" data-page="${Math.max(1, result.page - 1)}" ${result.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn btn-sm btn-ghost" data-action="large-page" data-page="${Math.min(result.pageCount, result.page + 1)}" ${result.page >= result.pageCount ? 'disabled' : ''}>Next</button></div>`
        : '<div class="maintenance-empty"><h3>No files meet this threshold</h3><p>Choose another folder or lower the minimum file size.</p></div>'}`;
    },

    _renderCache(result) {
      const browsers = result.browsers || [];
      return `${this._summaryTiles([['Cache data', this.bytes(result.totalBytes)], ['Browsers', result.browserCount || browsers.length], ['Running', result.runningBrowsers?.length || 0, result.runningBrowsers?.length ? 'warn' : 'ok']])}
        <div class="maintenance-result-banner result-clean"><strong>Cache-only boundary</strong><span>${this.e(result.privacyGuarantee || 'Passwords, cookies, history, and site storage are excluded.')}</span></div>
        ${browsers.length ? `<div class="maintenance-browser-list">${browsers.map((browser) => `<article class="maintenance-browser-card"><div><strong>${this.e(browser.name)}</strong><span>${browser.profileCount} profile(s) · ${this.bytes(browser.sizeBytes)}</span>${browser.running ? '<span class="maintenance-state warning">Browser is running</span>' : ''}</div><button type="button" class="btn btn-sm" data-action="clear-cache" data-browser="${this.e(browser.id)}">Clear cache</button></article>`).join('')}</div><div class="maintenance-result-toolbar"><span>Close browsers first for the most complete cleanup.</span><button type="button" class="btn btn-danger" data-action="clear-cache" data-browser="all">Clear all cache</button></div>`
        : '<div class="maintenance-empty"><h3>No supported browser cache found</h3><p>Supported browsers include Chrome, Edge, Brave, Firefox, Opera, and Vivaldi.</p></div>'}`;
    },

    _renderDisk(result) {
      const volumes = result.volumes || [];
      return volumes.length ? `<div class="volume-grid">${volumes.map((volume) => `<article class="volume-card status-${this.e(volume.status)}"><header><div><strong>${this.e(volume.label)}</strong><span>${this.e(volume.mount)} · ${this.e(volume.filesystem)} · ${this.e(volume.driveType)}</span></div><span>${this.e(volume.status)}</span></header><div class="volume-meter"><span style="width:${Math.min(100, volume.usePercent)}%"></span></div><div class="volume-stats"><span>${volume.freeGB} GB free</span><span>${volume.usePercent}% used</span></div><div class="volume-actions"><button class="btn btn-sm btn-ghost" data-action="drill-tool" data-tool="large-files-report" data-path="${this.e(volume.mount)}">Large Files</button><button class="btn btn-sm btn-ghost" data-action="drill-tool" data-tool="duplicate-finder" data-path="${this.e(volume.mount)}">Duplicate Finder</button></div></article>`).join('')}</div>` : '<div class="maintenance-empty"><h3>No user-facing volumes found</h3></div>';
    },

    _renderServices(result) {
      const all = result.services || [];
      const services = this._serviceRiskFilter === 'flagged' ? all.filter((service) => service.flagged) : all;
      return `${this._summaryTiles([['Services reviewed', result.serviceCount || all.length], ['Auto-start', result.autoStartCount || 0], ['Flagged', result.flaggedCount || 0, result.flaggedCount ? 'warn' : 'ok']])}
        ${services.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Service</th><th>Publisher</th><th>State / start</th><th>Account</th><th>Risk</th><th></th></tr></thead><tbody>${services.map((service) => `<tr><td><strong>${this.e(service.displayName)}</strong><small>${this.e(service.name)}</small><small class="path-cell" title="${this.e(service.pathName)}">${this.e(service.executablePath || service.pathName)}</small></td><td>${this.e(service.publisher || 'Unknown')}<small>${this.e(service.signature || 'Unknown signature')}</small></td><td>${this.e(service.state)}<small>${this.e(service.startType)}</small></td><td>${this.e(service.account)}</td><td><span class="tag-pill tag-${this.e(service.risk)}">${this.e(service.risk)}</span><small>${this.e(service.flagReason || 'No specific risk signal.')}</small></td><td>${service.executablePath ? `<button class="btn btn-xs btn-ghost" data-action="reveal" data-path="${this.e(service.executablePath)}">File</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="maintenance-empty"><h3>No services match this filter</h3></div>'}`;
    },

    _renderTasks(result) {
      const all = result.tasks || [];
      const tasks = this._taskShowMicrosoft ? all : all.filter((task) => !task.trustedMicrosoft);
      return `${this._summaryTiles([['Tasks reviewed', result.taskCount || all.length], ['Hidden trusted Microsoft', this._taskShowMicrosoft ? 0 : (result.trustedMicrosoftCount || 0)], ['Flagged', result.flaggedCount || 0, result.flaggedCount ? 'warn' : 'ok']])}
        ${tasks.length ? `<div class="maintenance-detail-list">${tasks.map((task) => `<details class="maintenance-detail-row ${task.flagged ? 'flagged' : ''}"><summary><span><strong>${this.e(task.name)}</strong><small>${this.e(task.description || task.purpose || 'Scheduled task')}</small></span><span class="maintenance-task-meta">${this.e(task.state)} · ${this.e(task.risk)}</span></summary><div class="maintenance-detail-grid"><dl><dt>Raw task name</dt><dd>${this.e(task.rawName)}</dd><dt>Task path</dt><dd>${this.e(task.path)}</dd><dt>Publisher</dt><dd>${this.e(task.publisher || 'Unknown')}</dd><dt>Author</dt><dd>${this.e(task.author || 'Unknown')}</dd><dt>Privilege</dt><dd>${this.e(task.runLevel || 'Unknown')}</dd><dt>Last / next run</dt><dd>${this.e(task.lastRunTime || 'Never')} / ${this.e(task.nextRunTime || 'Not scheduled')}</dd><dt>Last result</dt><dd>${this.e(task.lastResult)}</dd><dt>Risk reason</dt><dd>${this.e(task.flagReason || 'No high-confidence risk signal.')}</dd></dl><div><h4>Actions</h4>${(task.actions || []).map((action) => `<div class="action-detail"><strong>${this.e(action.type)}</strong><span class="path-cell" title="${this.e(action.execute || action.classId)}">${this.e(action.execute || action.classId || 'No executable or COM class reported')}</span><small>${this.e(action.arguments || action.data || '')}</small><small>${this.e(action.publisher || '')} · ${this.e(action.signature || 'Unknown signature')}</small>${action.execute ? `<button class="btn btn-xs btn-ghost" data-action="reveal" data-path="${this.e(action.execute)}">File location</button>` : ''}</div>`).join('') || '<p>No task actions were returned.</p>'}<h4>Triggers</h4>${(task.triggers || []).map((trigger) => `<p>${this.e(trigger.Type || trigger.type)} · ${this.e(trigger.StartBoundary || trigger.startBoundary || 'No start time')}</p>`).join('') || '<p>No triggers reported.</p>'}</div></div></details>`).join('')}</div>` : '<div class="maintenance-empty"><h3>No non-Microsoft tasks to review</h3><p>Turn on “Show trusted Microsoft tasks” to see the complete collection.</p></div>'}`;
    },

    _renderHosts(result) {
      const tone = result.status === 'clean' ? 'clean' : (result.status === 'risky' ? 'failed' : 'warning');
      return `<div class="maintenance-result-banner result-${tone}"><strong>${this.e(result.verdict)}</strong><span>${this.e(result.hostsPath)}</span></div>
        ${this._summaryTiles([['Custom entries', result.entryCount || 0], ['Flagged', result.flaggedCount || 0, result.flaggedCount ? 'warn' : 'ok'], ['Lines', result.lineCount || 0], ['Size', this.bytes(result.sizeBytes)]])}
        <dl class="metadata-list"><dt>SHA-256</dt><dd class="path-cell" title="${this.e(result.hash)}">${this.e(result.hash)}</dd><dt>Modified</dt><dd>${this.e(result.modifiedAt)}</dd><dt>ACL safety</dt><dd>${this.e(result.acl?.summary || 'Unknown')}</dd><dt>Baseline</dt><dd>${this.e(result.baselineStatus || 'not-set')}</dd></dl>
        <div class="maintenance-result-toolbar"><span>This diagnostic is read-only.</span><button class="btn btn-sm" data-action="approve-hosts-baseline">Approve current hash as baseline</button></div>
        ${result.entries?.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Line</th><th>Destination</th><th>Host</th><th>Assessment</th></tr></thead><tbody>${result.entries.map((entry) => `<tr><td>${entry.line}</td><td>${this.e(entry.ip)}</td><td>${this.e(entry.host)}</td><td><span class="tag-pill tag-${entry.severity === 'high' ? 'critical' : entry.severity}">${this.e(entry.severity)}</span><small>${this.e(entry.flagReason)}</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="maintenance-empty compact"><h3>No custom hosts entries</h3><p>The file was successfully read and verified; an empty custom-entry list is a clean result.</p></div>'}
        ${result.malformed?.length ? this._renderIssueList(result.malformed, 'Malformed lines') : ''}${result.duplicates?.length ? this._renderIssueList(result.duplicates, 'Duplicate mappings') : ''}${result.diff?.length ? this._renderIssueList(result.diff, 'Changes from baseline') : ''}`;
    },

    _renderDuplicates(result) {
      const groups = result.duplicateGroups || [];
      return `${this._summaryTiles([['Files scanned', result.totalFilesScanned || 0], ['Duplicate groups', groups.length], ['Recoverable', this.bytes(result.totalWastedSpace), groups.length ? 'ok' : '']])}
        ${groups.length ? `<div class="maintenance-result-toolbar"><span>Choose the retained copy in every group. Selected duplicates are staged for seven days.</span><button class="btn btn-primary" data-action="vault-duplicates">Move selected to Safety Vault</button></div><div class="duplicate-workspace">${groups.map((group) => this._renderDuplicateGroup(group)).join('')}</div>` : '<div class="maintenance-empty"><h3>No duplicate files found</h3><p>The scan completed successfully; every eligible file has unique content.</p></div>'}`;
    },

    _renderDuplicateGroup(group) {
      const keep = this._duplicateKeep.get(group.id) || group.files[0]?.path;
      const expanded = this._duplicateExpanded.has(group.id);
      return `<article class="duplicate-result-group ${expanded ? 'expanded' : ''}"><header><button class="duplicate-group-toggle" data-action="toggle-duplicate" data-group-id="${this.e(group.id)}" aria-expanded="${expanded}">${this.icon('chevron-right')}<span><strong>${group.files.length} identical files</strong><small>${this.bytes(group.size)} each · ${this.bytes(group.size * (group.files.length - 1))} recoverable</small></span></button><label>Keep <select class="duplicate-keep" data-group-id="${this.e(group.id)}">${group.files.map((file) => `<option value="${this.e(file.path)}" ${file.path === keep ? 'selected' : ''}>${this.e(file.path)}</option>`).join('')}</select></label><button class="btn btn-xs btn-ghost" data-action="duplicate-per-folder" data-group-id="${this.e(group.id)}">Keep one per folder</button></header>${expanded ? `<div class="duplicate-file-list">${group.files.map((file) => `<label class="duplicate-file-row"><input type="checkbox" class="duplicate-select" data-group-id="${this.e(group.id)}" data-path="${this.e(file.path)}" ${file.path === keep ? 'disabled' : ''} ${this._selectedDuplicates.has(file.path) ? 'checked' : ''}><span class="path-cell" title="${this.e(file.path)}">${this.e(file.path)}</span><small>${this.e(file.parentFolder)}</small><button type="button" class="btn btn-xs btn-ghost" data-action="reveal" data-path="${this.e(file.path)}">Reveal</button></label>`).join('')}</div>` : ''}</article>`;
    },

    _renderStartup(result) {
      const items = result.items || [];
      return `${this._summaryTiles([['Startup items', items.length], ['Registry', items.filter((item) => item.source === 'registry').length], ['Startup folders', items.filter((item) => item.source === 'startup-folder').length], ['Disabled', items.filter((item) => item.enabled === false).length]])}
        ${items.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Application</th><th>Publisher</th><th>Source</th><th>Command</th><th>Risk</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${this.e(item.friendlyName || item.name)}</strong><small>${this.e(item.name)}</small></td><td>${this.e(item.publisher || 'Unknown')}<small>${this.e(item.signature || 'Unknown signature')}</small></td><td>${this.e(item.scope)}<small>${this.e(item.source)} · ${this.e(item.location)}</small></td><td class="path-cell" title="${this.e(item.command)}">${this.e(item.command)}</td><td><span class="tag-pill tag-${this.e(item.risk || 'medium')}">${this.e(item.risk || 'unknown')}</span><small>${this.e(item.riskReason)}</small></td><td><button class="btn btn-sm ${item.enabled === false ? 'btn-primary' : 'btn-ghost'}" data-action="toggle-startup" data-item-id="${this.e(item.id)}" data-enable="${item.enabled === false}">${item.enabled === false ? 'Enable' : 'Disable'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="maintenance-empty"><h3>No startup items found</h3><p>No supported Run, RunOnce, or Startup-folder entries were returned.</p></div>'}`;
    },

    _renderSoftware(result) {
      const query = this._softwareSearch.toLowerCase();
      const apps = (result.apps || []).filter((app) => !query || `${app.name} ${app.publisher}`.toLowerCase().includes(query));
      return `${this._summaryTiles([['Installed apps', result.appCount || 0], ['Desktop', (result.apps || []).filter((app) => app.appType !== 'store').length], ['Store apps', (result.apps || []).filter((app) => app.appType === 'store').length]])}
        ${result.leftoverBlocked ? `<div class="maintenance-result-banner result-warning"><strong>Leftover scan paused</strong><span>${this.e(result.leftoverBlocked)}</span></div>` : ''}
        ${result.leftovers?.length ? this._renderLeftovers(result) : ''}
        ${apps.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Application</th><th>Publisher</th><th>Version</th><th>Installed</th><th>Size</th><th></th></tr></thead><tbody>${apps.map((app) => `<tr><td><strong>${this.e(app.name)}</strong><small>${app.appType === 'store' ? 'Microsoft Store app' : 'Desktop app'}</small></td><td>${this.e(app.publisher || 'Unknown')}</td><td>${this.e(app.version || '—')}</td><td>${this.e(app.installDate || 'Unknown')}</td><td>${app.estimatedSizeMB == null ? 'Unknown' : `${app.estimatedSizeMB} MB`}</td><td>${app.uninstallString ? `<button class="btn btn-sm btn-ghost" data-action="launch-uninstaller" data-app-name="${this.e(app.name)}">Uninstall</button>` : `<button class="btn btn-sm btn-ghost" data-action="open-apps-settings">Manage</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="maintenance-empty"><h3>No applications match</h3><p>Clear the search field or refresh the installed software list.</p></div>'}`;
    },

    _renderLeftovers(result) {
      const folders = result.leftovers.filter((item) => item.kind === 'directory');
      const registry = result.leftovers.filter((item) => item.kind === 'registry');
      return `<section class="leftover-results"><h3>Potential leftovers for ${this.e(result.scannedApp)}</h3><p>Folder suggestions can be staged in the Safety Vault. Registry suggestions are read-only.</p>${folders.map((item) => `<label class="leftover-row"><input type="checkbox" class="leftover-select" data-path="${this.e(item.path)}"><span class="path-cell">${this.e(item.path)}</span><span>${this.bytes(item.sizeBytes)} · ${item.fileCount || 0} files</span></label>`).join('')}${folders.length ? '<button class="btn btn-primary" data-action="vault-leftovers">Stage selected folders</button>' : ''}${registry.map((item) => `<div class="leftover-row"><span class="tag-pill tag-none">Read-only</span><span class="path-cell">${this.e(item.path)}</span></div>`).join('')}</section>`;
    },

    _renderShredder(result) {
      if (result.success === false) return `<div class="maintenance-result-banner result-failed"><strong>Cannot continue</strong><span>${this.e(result.error)}</span></div>`;
      if (result.mode === 'preview') {
        const multiPass = result.multiPassAvailable;
        return `${this._summaryTiles([['Files', result.fileCount || 0], ['File data', this.bytes(result.totalFileBytes)], ['Overwrite data', this.bytes(result.estimatedOverwriteBytes)]])}<div class="maintenance-result-banner result-warning"><strong>Irreversible deletion</strong><span>${this.e(result.warning)}</span></div><div class="maintenance-result-toolbar"><label>Method <select id="shredMethod"><option value="simple">One pass (default)</option>${multiPass ? '<option value="dod">Three passes (HDD)</option><option value="schneier">Seven passes (HDD)</option>' : ''}</select></label><label>Type SHRED <input id="shredConfirmation" autocomplete="off"></label><button class="btn btn-danger" data-action="execute-shred">Shred permanently</button></div>${this._renderPathList(result.files || [])}`;
      }
      return `${this._summaryTiles([['Shredded', result.fileCount || 0, result.errors?.length ? 'warn' : 'ok'], ['Overwrite data', this.bytes(result.estimatedOverwriteBytes)], ['Errors', result.errors?.length || 0, result.errors?.length ? 'warn' : 'ok']])}${result.errors?.length ? this._renderIssueList(result.errors, 'Files or folders retained') : '<div class="maintenance-result-banner result-completed">Selected files were overwritten and removed.</div>'}`;
    },

    _renderVault(result) {
      const items = result.items || [];
      const staged = items.filter((item) => item.status === 'staged');
      return `${this._summaryTiles([['Available to restore', staged.length], ['Staged data', this.bytes(staged.reduce((sum, item) => sum + item.sizeBytes, 0))], ['Actually reclaimed', this.bytes(items.filter((item) => item.status === 'purged').reduce((sum, item) => sum + item.sizeBytes, 0))]])}<div class="maintenance-result-banner result-clean"><strong>Staged is not deleted</strong><span>Files in the Vault still use disk space. Space is reclaimed only after expiry or Purge Now.</span></div>${items.length ? `<div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Original path</th><th>Operation</th><th>Size</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td class="path-cell" title="${this.e(item.originalPath)}">${this.e(item.originalPath)}</td><td>${this.e(item.operation)}</td><td>${this.bytes(item.sizeBytes)}</td><td>${this.e(new Date(item.expiresAt).toLocaleString())}</td><td>${this.e(item.status)}</td><td class="button-cell">${item.status === 'staged' ? `<button class="btn btn-sm btn-primary" data-action="restore-vault" data-vault-id="${this.e(item.id)}">Restore</button><button class="btn btn-sm btn-danger" data-action="purge-vault" data-vault-id="${this.e(item.id)}">Purge Now</button>` : ''}<button class="btn btn-sm btn-ghost" data-action="reveal" data-path="${this.e(item.originalPath)}">Original location</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="maintenance-empty"><h3>The Safety Vault is empty</h3><p>Files staged from Large Files, Duplicate Finder, and leftover cleanup will appear here.</p></div>'}`;
    },

    _renderPersistence(result) {
      const pending = result.pending || (result.items ? result : null);
      const changes = pending?.changes || { added: [], modified: [], removed: [], total: 0 };
      if (!result.baselineExists && !pending) return '<div class="maintenance-empty"><h3>No approved baseline yet</h3><p>Run a scan, review the collected persistence mechanisms, then explicitly approve the first baseline.</p></div>';
      return `${this._summaryTiles([['Baseline items', result.baselineItemCount || pending?.itemCount || 0], ['Added', changes.added?.length || 0, changes.added?.length ? 'warn' : ''], ['Modified', changes.modified?.length || 0, changes.modified?.length ? 'warn' : ''], ['Removed', changes.removed?.length || 0]])}<div class="maintenance-result-banner result-${pending?.needsBaselineApproval ? 'warning' : (changes.total ? 'warning' : 'clean')}"><strong>${pending?.needsBaselineApproval ? 'Baseline approval required' : (changes.total ? 'Persistence changes need review' : 'No persistence changes detected')}</strong><span>Analysis stayed local. External lookups used: no.</span></div>${pending?.needsBaselineApproval ? '<div class="maintenance-result-toolbar"><span>Approving establishes the first trusted state. It will never update automatically.</span><button class="btn btn-primary" data-action="approve-persistence" data-scope="all">Approve reviewed baseline</button></div>' : ''}${this._renderChangeSection('Added', changes.added)}${this._renderChangeSection('Modified', changes.modified)}${this._renderChangeSection('Removed', changes.removed)}${pending?.warnings?.length ? this._renderIssueList(pending.warnings.map((message) => ({ reason: message })), 'Collector warnings') : ''}`;
    },

    _renderChangeSection(label, changes = []) {
      if (!changes.length) return '';
      return `<section class="persistence-changes"><h3>${this.e(label)} (${changes.length})</h3>${changes.map((change) => { const item = change.after || change.before || {}; return `<label class="persistence-change-row"><input type="checkbox" class="persistence-change-select" data-change-id="${this.e(change.id)}"><span><strong>${this.e(item.friendlyName || item.name)}</strong><small>${this.e(item.source)} · ${this.e(item.location)}</small><small class="path-cell">${this.e(item.command || item.path || '')}</small><small>${this.e(item.riskReason || '')}</small></span></label>`; }).join('')}<button class="btn btn-sm" data-action="approve-persistence" data-scope="selected">Approve selected changes</button></section>`;
    },

    _renderGenericResult(result) {
      const primitives = Object.entries(result || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
      return primitives.length ? this._summaryTiles(primitives.map(([key, value]) => [key.replace(/([A-Z])/g, ' $1'), String(value)])) : '<div class="maintenance-result-banner result-completed">The tool completed successfully.</div>';
    },

    _renderIssueList(items, title) {
      return `<section class="maintenance-issues"><h3>${this.e(title)}</h3>${(items || []).slice(0, 200).map((item) => `<div><span class="tag-pill tag-medium">Review</span><span class="path-cell" title="${this.e(item.path || item.line || '')}">${this.e(item.path || item.text || item.line || '')}</span><small>${this.e(item.reason || item.error || item.type || '')}</small></div>`).join('')}</section>`;
    },

    _renderPathList(paths) {
      return `<div class="maintenance-path-list">${paths.map((filePath) => `<div><span class="path-cell" title="${this.e(filePath)}">${this.e(filePath)}</span><button class="btn btn-xs btn-ghost" data-action="reveal" data-path="${this.e(filePath)}">Reveal</button></div>`).join('')}</div>`;
    },

    _renderHistory(toolId) {
      const rows = this._history.filter((item) => item.toolId === toolId).slice(0, 8);
      if (!rows.length) return '';
      return `<section class="maintenance-history"><h3>Run history</h3><div class="maintenance-table-wrap"><table class="maintenance-table"><thead><tr><th>Started</th><th>Source</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${this.e(new Date(row.startedAt).toLocaleString())}</td><td>${this.e(row.source)}</td><td><span class="maintenance-state ${this.e(row.status)}">${this.e(row.status)}</span></td><td>${this.duration(row.durationMs)}</td><td>${this.e(Object.entries(row.summary || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—')}</td></tr>`).join('')}</tbody></table></div></section>`;
    },

    _wire(root) {
      root.onclick = (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        event.preventDefault();
        this._handleAction(target).catch((error) => this._setNotice(error.message || String(error), 'error'));
      };
      root.onchange = (event) => this._handleChange(event.target);
      root.oninput = (event) => {
        if (event.target.id === 'softwareSearch') {
          this._softwareSearch = event.target.value;
          const result = this._container.querySelector('.maintenance-results');
          if (result && this._results['uninstaller-report']) result.innerHTML = this._renderSoftware(this._results['uninstaller-report']);
        } else if (event.target.id === 'leftoverAppName') {
          this._leftoverAppName = event.target.value;
        }
      };
    },

    async _handleAction(target) {
      const action = target.dataset.action;
      if (action === 'open-tool') {
        this._selectedToolId = target.dataset.toolId;
        this._notice = null;
        await this._loadServiceState(this._selectedToolId);
        this._renderView();
        this._workspace()?.focus?.();
        return;
      }
      if (action === 'back-hub') { this._selectedToolId = null; this._notice = null; this._renderView(); return; }
      if (action === 'run-tool') { await this._runSelectedTool(); return; }
      if (action === 'cancel-run') { await Api.cancelTool(target.dataset.runId); return; }
      if (action === 'browse-large') { const folder = await Api.pickFolder(); if (folder) this._largePath = folder; this._renderView(); return; }
      if (action === 'browse-duplicate') { const folder = await Api.pickFolder(); if (folder) this._duplicatePath = folder; this._renderView(); return; }
      if (action === 'browse-shred') { const files = await Api.pickFiles(); if (files?.length) this._shredPaths = files; this._renderView(); return; }
      if (action === 'reveal') { await Api.showItemInFolder(target.dataset.path); return; }
      if (action === 'clean-temp') { await this._cleanTemp(); return; }
      if (action === 'large-page') { await this._runScript('large-files-report', this._largeArgs(Number(target.dataset.page))); return; }
      if (action === 'vault-large') { await this._vaultLarge(); return; }
      if (action === 'clear-cache') { await this._clearCache(target.dataset.browser); return; }
      if (action === 'drill-tool') { this._selectedToolId = target.dataset.tool; if (target.dataset.tool === 'large-files-report') this._largePath = target.dataset.path; else this._duplicatePath = target.dataset.path; this._renderView(); return; }
      if (action === 'toggle-duplicate') { const id = target.dataset.groupId; this._duplicateExpanded.has(id) ? this._duplicateExpanded.delete(id) : this._duplicateExpanded.add(id); this._renderView(); return; }
      if (action === 'duplicate-per-folder') { this._selectDuplicatePerFolder(target.dataset.groupId); this._renderView(); return; }
      if (action === 'vault-duplicates') { await this._vaultDuplicates(); return; }
      if (action === 'approve-hosts-baseline') { await this._approveHostsBaseline(); return; }
      if (action === 'toggle-startup') { await this._toggleStartup(target.dataset.itemId, target.dataset.enable === 'true'); return; }
      if (action === 'launch-uninstaller') { await this._launchUninstaller(target.dataset.appName); return; }
      if (action === 'scan-leftovers') { await this._scanLeftovers(); return; }
      if (action === 'vault-leftovers') { await this._vaultLeftovers(); return; }
      if (action === 'open-apps-settings') { await window.soterios.shell.openExternal('ms-settings:appsfeatures'); return; }
      if (action === 'execute-shred') { await this._executeShred(); return; }
      if (action === 'refresh-vault') { await this._loadServiceState('maintenance-safety-vault'); this._renderView(); return; }
      if (action === 'restore-vault') { await this._restoreVault(target.dataset.vaultId); return; }
      if (action === 'purge-vault') { await this._purgeVault(target.dataset.vaultId); return; }
      if (action === 'approve-persistence') { await this._approvePersistence(target.dataset.scope); return; }
      if (action === 'open-utility') { await window.soterios.shell.openWindowsUtility(target.dataset.utility); return; }
    },

    _handleChange(target) {
      if (target.id === 'showMicrosoftTasks') { this._taskShowMicrosoft = target.checked; this._renderView(); return; }
      if (target.id === 'serviceRiskFilter') { this._serviceRiskFilter = target.value; this._renderView(); return; }
      if (target.classList.contains('large-select')) { target.checked ? this._selectedLarge.add(target.dataset.path) : this._selectedLarge.delete(target.dataset.path); return; }
      if (target.classList.contains('temp-select')) { target.checked ? this._selectedTemp.add(target.dataset.path) : this._selectedTemp.delete(target.dataset.path); return; }
      if (target.classList.contains('duplicate-select')) { target.checked ? this._selectedDuplicates.add(target.dataset.path) : this._selectedDuplicates.delete(target.dataset.path); return; }
      if (target.classList.contains('duplicate-keep')) {
        const previous = this._duplicateKeep.get(target.dataset.groupId);
        this._duplicateKeep.set(target.dataset.groupId, target.value);
        this._selectedDuplicates.delete(target.value);
        if (previous) this._selectedDuplicates.delete(previous);
        this._renderView();
        return;
      }
      if (target.classList.contains('leftover-select')) { target.checked ? this._selectedLeftovers.add(target.dataset.path) : this._selectedLeftovers.delete(target.dataset.path); }
    },

    async _runSelectedTool() {
      const toolId = this._selectedToolId;
      if (toolId === 'maintenance-safety-vault') { await this._loadServiceState(toolId); this._renderView(); return; }
      if (toolId === 'persistence-change-monitor') {
        this._progress[toolId] = { status: 'running', phase: 'starting', pct: 0, cancelable: false };
        this._renderView();
        const response = await window.soterios.persistence.scan();
        if (!response.ok) throw new Error(response.error);
        const status = await window.soterios.persistence.getStatus();
        this._results[toolId] = status.ok ? status.data : response.data;
        delete this._progress[toolId];
        this._renderView();
        return;
      }
      let args = {};
      if (toolId === 'clear-temp-files') args = { mode: 'analyze', minimumAgeDays: Number(this._container.querySelector('#tempAgeDays')?.value || 7) };
      else if (toolId === 'large-files-report') args = this._largeArgs(1);
      else if (toolId === 'duplicate-finder') {
        if (!this._duplicatePath) throw new Error('Choose a folder before scanning for duplicates.');
        const minMB = Math.max(1, Number(this._container.querySelector('#duplicateMinMB')?.value || 1));
        this._duplicateMinMB = minMB;
        this._duplicateExtensions = this._container.querySelector('#duplicateExtensions')?.value || '';
        args = { scanPath: this._duplicatePath, minSize: minMB * 1024 * 1024, extensions: this._duplicateExtensions || null };
        this._selectedDuplicates.clear(); this._duplicateKeep.clear(); this._duplicateExpanded.clear();
      } else if (toolId === 'file-shredder') {
        if (!this._shredPaths.length) throw new Error('Choose at least one file first.');
        args = { targets: this._shredPaths, mode: 'preview', method: 'simple' };
      } else if (toolId === 'hosts-file-check') {
        const baseline = await window.api.invoke('db:getSetting', 'tools.hostsBaseline.v1', null);
        args = baseline ? { baselineHash: baseline.hash, baselineContent: baseline.content } : {};
      }
      await this._runScript(toolId, args);
    },

    _largeArgs(page = 1) {
      return {
        scanPath: this._largePath || undefined,
        thresholdMB: (() => {
          const value = Math.max(1, Number(this._container.querySelector('#largeThreshold')?.value || this._largeThreshold || 100));
          this._largeThreshold = value;
          return value;
        })(),
        page,
        pageSize: 100,
        sortBy: 'size',
        sortDirection: 'desc'
      };
    },

    async _runScript(scriptId, scriptArgs) {
      this._notice = null;
      delete this._results[scriptId];
      const started = await Api.startTool('run-script', { scriptId, scriptArgs }, { source: 'manual' });
      if (!this._results[scriptId]) {
        this._runs[scriptId] = { ...started, status: 'running', phase: 'starting', pct: 0, cancelable: true };
        this._progress[scriptId] = this._runs[scriptId];
      }
      this._renderView();
    },

    async _cleanTemp() {
      const result = this._results['clear-temp-files'];
      const displayed = (result?.candidates || []).slice(0, 500);
      const checked = [...this._container.querySelectorAll('.temp-select:checked')].map((input) => input.dataset.path);
      if (!checked.length) throw new Error('Select at least one temp file.');
      const ok = await this._confirm({ title: 'Permanently clear temp files?', message: `${checked.length} selected files will be deleted immediately and cannot be restored from the Safety Vault.`, confirmLabel: 'Delete permanently', danger: true });
      if (!ok) return;
      const selected = checked.map((filePath) => displayed.find((item) => item.path === filePath)).filter(Boolean);
      await this._runScript('clear-temp-files', { mode: 'clean', minimumAgeDays: result.minimumAgeDays, selectedPaths: selected });
    },

    async _stageVault(items, operation) {
      const response = await window.soterios.vault.stage(items, { operation });
      if (!response.ok) throw new Error(response.error);
      this._setNotice(`${response.data.staged.length} item(s) staged for seven days. No space is reclaimed until they are purged.`, response.data.failed.length ? 'warning' : 'success');
      return response.data;
    },

    async _vaultLarge() {
      const result = this._results['large-files-report'];
      const selectedPaths = [...this._container.querySelectorAll('.large-select:checked')].map((input) => input.dataset.path);
      if (!selectedPaths.length) throw new Error('Select at least one file.');
      const ok = await this._confirm({ title: 'Stage selected large files?', message: 'The files will move to the Safety Vault for seven days. They will still use disk space until purged.', confirmLabel: 'Stage files' });
      if (!ok) return;
      const items = selectedPaths.map((filePath) => result.files.find((file) => file.path === filePath)).filter(Boolean);
      await this._stageVault(items, 'Large Files cleanup');
      this._selectedLarge.clear();
      await this._runScript('large-files-report', this._largeArgs(result.page || 1));
    },

    async _clearCache(browser) {
      const names = browser === 'all' ? [] : [browser];
      const ok = await this._confirm({ title: 'Clear browser cache?', message: 'Only measured cache folders will be cleared. Close running browsers first. This cleanup is permanent.', confirmLabel: 'Clear cache', danger: true });
      if (!ok) return;
      this._setNotice('Clearing browser cache…', 'info');
      const result = await Api.runTool('run-script', { scriptId: 'clear-browser-cache', scriptArgs: { browsers: names } });
      this._setNotice(`Cleared ${this.bytes(result.totalBytes)} of cache; ${result.skippedCount || 0} item(s) were skipped.`, result.skippedCount ? 'warning' : 'success');
      this._results['browser-cache-report'] = await Api.runTool('run-script', { scriptId: 'browser-cache-report', scriptArgs: {} });
      this._renderView();
    },

    _selectDuplicatePerFolder(groupId) {
      const group = this._results['duplicate-finder']?.duplicateGroups?.find((entry) => entry.id === groupId);
      if (!group) return;
      const byFolder = new Map();
      group.files.forEach((file) => {
        const folder = file.parentFolder || file.path.replace(/[\\/][^\\/]+$/, '');
        const current = byFolder.get(folder);
        if (!current || file.path.length < current.path.length) byFolder.set(folder, file);
      });
      const keep = new Set([...byFolder.values()].map((file) => file.path));
      group.files.forEach((file) => keep.has(file.path) ? this._selectedDuplicates.delete(file.path) : this._selectedDuplicates.add(file.path));
      this._duplicateKeep.set(groupId, [...keep][0] || group.files[0].path);
    },

    async _vaultDuplicates() {
      const result = this._results['duplicate-finder'];
      const selected = [...this._selectedDuplicates];
      if (!selected.length) throw new Error('Select at least one duplicate copy.');
      for (const group of result.duplicateGroups || []) {
        const selectedCount = group.files.filter((file) => selected.includes(file.path)).length;
        if (selectedCount >= group.files.length) throw new Error('At least one file must remain in every duplicate group.');
      }
      const ok = await this._confirm({ title: 'Stage selected duplicate copies?', message: `${selected.length} file(s) will move to the Safety Vault for seven days. At least one copy in every group will remain.`, confirmLabel: 'Stage duplicates' });
      if (!ok) return;
      const files = (result.duplicateGroups || []).flatMap((group) => group.files);
      await this._stageVault(selected.map((filePath) => files.find((file) => file.path === filePath)).filter(Boolean), 'Duplicate Finder cleanup');
      this._selectedDuplicates.clear();
      await this._runScript('duplicate-finder', { scanPath: this._duplicatePath, minSize: this._duplicateMinMB * 1024 * 1024, extensions: this._duplicateExtensions || null });
    },

    async _approveHostsBaseline() {
      const candidate = this._results['hosts-file-check']?.baselineCandidate;
      if (!candidate) throw new Error('Run the hosts check before approving a baseline.');
      const ok = await this._confirm({ title: 'Approve current hosts file?', message: 'Future checks will explain additions and removals relative to this exact content. The tool remains read-only.', confirmLabel: 'Approve baseline' });
      if (!ok) return;
      await window.api.invoke('db:setSetting', 'tools.hostsBaseline.v1', { ...candidate, approvedAt: new Date().toISOString() });
      this._setNotice('Hosts baseline approved.', 'success');
    },

    async _toggleStartup(itemId, enable) {
      const item = this._results['list-startup-items']?.items?.find((entry) => entry.id === itemId);
      if (!item) throw new Error('Startup item is no longer available.');
      const ok = await this._confirm({ title: `${enable ? 'Enable' : 'Disable'} startup item?`, message: `${item.friendlyName || item.name}\n${item.command}`, confirmLabel: enable ? 'Enable' : 'Disable' });
      if (!ok) return;
      const response = await window.soterios.startup.toggle(item, enable);
      if (!response.ok) throw new Error(response.error);
      await this._runScript('list-startup-items', {});
    },

    async _launchUninstaller(appName) {
      const app = this._results['uninstaller-report']?.apps?.find((entry) => entry.name === appName);
      if (!app?.uninstallString) throw new Error('No interactive uninstall command is available.');
      const ok = await this._confirm({ title: `Uninstall ${appName}?`, message: 'Soterios will launch the application’s native interactive uninstaller. Finish it there, then refresh this report.', confirmLabel: 'Launch uninstaller' });
      if (!ok) return;
      const result = await Api.runTool('run-script', { scriptId: 'launch-uninstaller', scriptArgs: { uninstallString: app.uninstallString } });
      if (result.ok === false) throw new Error(result.error);
      this._leftoverAppName = appName;
      await this._runScript('uninstaller-report', {});
      this._setNotice('Native uninstaller launched and the installed-app list was refreshed. Finish the native uninstaller, then use Scan leftovers.', 'success');
    },

    async _scanLeftovers() {
      const name = String(this._container.querySelector('#leftoverAppName')?.value || this._leftoverAppName).trim();
      if (!name) throw new Error('Enter the exact name of the recently uninstalled application.');
      this._leftoverAppName = name;
      this._selectedLeftovers.clear();
      await this._runScript('uninstaller-report', { scanLeftoversFor: name });
    },

    async _vaultLeftovers() {
      const result = this._results['uninstaller-report'];
      const selected = [...this._container.querySelectorAll('.leftover-select:checked')].map((input) => input.dataset.path);
      if (!selected.length) throw new Error('Select at least one leftover folder.');
      const ok = await this._confirm({ title: 'Stage leftover folders?', message: 'Selected folders will move to the Safety Vault for seven days. Registry suggestions are never changed.', confirmLabel: 'Stage folders' });
      if (!ok) return;
      const items = selected.map((filePath) => result.leftovers.find((item) => item.path === filePath)).filter(Boolean);
      await this._stageVault(items, `Leftovers for ${result.scannedApp}`);
    },

    async _executeShred() {
      const method = this._container.querySelector('#shredMethod')?.value || 'simple';
      const confirmation = this._container.querySelector('#shredConfirmation')?.value || '';
      if (confirmation !== 'SHRED') throw new Error('Type SHRED exactly to confirm irreversible deletion.');
      const ok = await this._confirm({ title: 'Permanently shred selected files?', message: 'This cannot be undone and does not use the Safety Vault. Backups and shadow copies are not affected.', confirmLabel: 'Shred permanently', danger: true, typed: 'SHRED' });
      if (!ok) return;
      await this._runScript('file-shredder', { targets: this._shredPaths, method, confirmation: 'SHRED', mode: 'shred' });
    },

    async _restoreVault(id) {
      const ok = await this._confirm({ title: 'Restore this item?', message: 'If the original path is occupied, the restored item receives a timestamped name and never overwrites existing data.', confirmLabel: 'Restore' });
      if (!ok) return;
      const response = await window.soterios.vault.restore(id);
      if (!response.ok) throw new Error(response.error);
      this._setNotice(`Restored to ${response.data.restoredPath}.`, 'success');
      await this._loadServiceState('maintenance-safety-vault'); this._renderView();
    },

    async _purgeVault(id) {
      const ok = await this._confirm({ title: 'Purge this Vault item now?', message: 'The staged copy will be permanently deleted and its space reclaimed. This cannot be undone.', confirmLabel: 'Purge permanently', danger: true });
      if (!ok) return;
      const response = await window.soterios.vault.purge(id);
      if (!response.ok) throw new Error(response.error);
      this._setNotice(`Purged ${this.bytes(response.data.reclaimedBytes)}.`, 'success');
      await this._loadServiceState('maintenance-safety-vault'); this._renderView();
    },

    async _approvePersistence(scope) {
      const ids = scope === 'selected' ? [...this._container.querySelectorAll('.persistence-change-select:checked')].map((input) => input.dataset.changeId) : null;
      if (scope === 'selected' && !ids.length) throw new Error('Select at least one reviewed change.');
      const ok = await this._confirm({ title: scope === 'selected' ? 'Approve selected persistence changes?' : 'Approve this baseline?', message: 'Approval records the reviewed local state. The baseline is never changed automatically.', confirmLabel: 'Approve reviewed state' });
      if (!ok) return;
      const response = await window.soterios.persistence.approve(ids ? { ids } : {});
      if (!response.ok) throw new Error(response.error);
      await this._loadServiceState('persistence-change-monitor'); this._setNotice('Reviewed persistence state approved.', 'success'); this._renderView();
    },

    _setNotice(message, type = 'info') {
      this._notice = { message, type };
      this._renderView();
    },

    _showFatal(error) {
      const root = this._workspace();
      if (root) root.innerHTML = `<div class="maintenance-result-banner result-failed"><strong>Tools could not be loaded</strong><span>${this.e(error.message || error)}</span></div>`;
    },

    _confirm({ title, message, confirmLabel = 'Continue', danger = false, typed = null }) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'maintenance-dialog-overlay';
        overlay.innerHTML = `<div class="maintenance-dialog" role="dialog" aria-modal="true" aria-labelledby="maintenanceDialogTitle"><h2 id="maintenanceDialogTitle">${this.e(title)}</h2><p>${this.e(message)}</p>${typed ? `<label>Type ${this.e(typed)} to confirm<input id="maintenanceDialogTyped" autocomplete="off"></label>` : ''}<div><button class="btn btn-ghost" data-dialog="cancel">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-dialog="confirm" ${typed ? 'disabled' : ''}>${this.e(confirmLabel)}</button></div></div>`;
        document.body.appendChild(overlay);
        const confirmButton = overlay.querySelector('[data-dialog="confirm"]');
        const typedInput = overlay.querySelector('#maintenanceDialogTyped');
        typedInput?.addEventListener('input', () => { confirmButton.disabled = typedInput.value !== typed; });
        const finish = (value) => { overlay.remove(); resolve(value); };
        overlay.addEventListener('click', (event) => {
          const action = event.target.closest('[data-dialog]')?.dataset.dialog;
          if (action === 'confirm') finish(true);
          else if (action === 'cancel' || event.target === overlay) finish(false);
        });
        overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(false); });
        (typedInput || overlay.querySelector('[data-dialog="cancel"]'))?.focus();
      });
    }
  };

  window.Pages = window.Pages || {};
  window.Pages.tools = ToolsPage;
})();
