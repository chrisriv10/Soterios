'use strict';

window.Pages = window.Pages || {};

window.Pages.processes = {
  _container: null,
  _mode: 'simple',
  _processes: new Map(),
  _snapshot: null,
  _unsubscribers: [],
  _selectedKey: null,
  _selectedDetails: null,
  _detailTab: 'overview',
  _query: '',
  _riskFilter: 'all',
  _sortBy: 'tree',
  _paused: false,
  _collapsed: new Set(),
  _visible: [],
  _rowHeight: 58,
  _iconCache: new Map(),
  _renderQueued: false,

  t(key, vars) { return window.I18n?.t(key, vars) ?? key; },
  esc(value) { return window.escapeHtml ? window.escapeHtml(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); },
  keyOf(proc) { return `${Number(proc?.key?.pid ?? proc?.pid)}@${String(proc?.key?.startedAt ?? proc?.startedAt ?? '')}`; },

  formatPercent(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : this.t('processes.notAvailable');
  },

  formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return this.t('processes.notAvailable');
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  },

  formatRate(value) {
    if (value == null) return this.t('processes.notAvailable');
    return `${this.formatBytes(value)}/s`;
  },

  render(container) {
    this._container = container;
    this._processes = new Map();
    this._snapshot = null;
    this._selectedKey = null;
    this._selectedDetails = null;
    this._paused = false;
    try { this._mode = localStorage.getItem('soterios.processMode') || 'simple'; } catch (_) { this._mode = 'simple'; }
    if (!['simple', 'technical'].includes(this._mode)) this._mode = 'simple';
    this._sortBy = this._mode === 'technical' ? 'tree' : 'risk';
    this._rowHeight = this._mode === 'technical' ? 42 : 58;

    container.innerHTML = `
      <section class="process-inspector" aria-labelledby="processInspectorTitle">
        <header class="pi-header">
          <div>
            <h1 class="page-title" id="processInspectorTitle">${this.esc(this.t('processes.title'))}</h1>
            <p class="page-subtitle">${this.esc(this.t('processes.commercialSubtitle'))}</p>
          </div>
          <div class="pi-header-actions">
            <div class="pi-mode-toggle" role="group" aria-label="${this.esc(this.t('processes.viewMode'))}">
              <button class="pi-mode-btn ${this._mode === 'simple' ? 'active' : ''}" data-mode="simple">${this.esc(this.t('processes.simpleMode'))}</button>
              <button class="pi-mode-btn ${this._mode === 'technical' ? 'active' : ''}" data-mode="technical">${this.esc(this.t('processes.technicalMode'))}</button>
            </div>
            <button class="btn btn-sm" id="piRunTask">${this.esc(this.t('processes.runTask'))}</button>
            <button class="btn btn-sm" id="piSaveTrace">${this.esc(this.t('processes.saveTrace'))}</button>
            <button class="btn btn-sm" id="piDiagnostics">${this.esc(this.t('processes.exportDiagnostics'))}</button>
          </div>
        </header>

        <div id="piProviderNotice" class="pi-provider-notice" hidden></div>

        <div class="pi-stats" aria-label="${this.esc(this.t('processes.systemResources'))}">
          ${this._statCard('cpu', this.t('processes.statCpu'))}
          ${this._statCard('memory', this.t('processes.statMemory'))}
          ${this._statCard('disk', this.t('processes.statDisk'))}
          ${this._statCard('network', this.t('processes.statNetwork'))}
          ${this._statCard('gpu', this.t('processes.statGpu'))}
        </div>

        <div class="pi-toolbar">
          <label class="pi-search-wrap">
            <span class="sr-only">${this.esc(this.t('processes.searchLabel'))}</span>
            <input id="piSearch" type="search" autocomplete="off" placeholder="${this.esc(this.t('processes.searchPlaceholder'))}">
          </label>
          <select id="piRiskFilter" class="pi-select" aria-label="${this.esc(this.t('processes.riskFilterAll'))}">
            <option value="all">${this.esc(this.t('processes.riskFilterAll'))}</option>
            <option value="high-concern">${this.esc(this.t('processes.statusHigh'))}</option>
            <option value="review-recommended">${this.esc(this.t('processes.statusReview'))}</option>
            <option value="unverified">${this.esc(this.t('processes.statusUnverified'))}</option>
            <option value="no-concerns">${this.esc(this.t('processes.statusNoConcerns'))}</option>
          </select>
          <select id="piSort" class="pi-select" aria-label="${this.esc(this.t('processes.sortLabel'))}"></select>
          <button class="btn btn-sm" id="piPause" aria-pressed="false">${this.esc(this.t('processes.pause'))}</button>
          <button class="btn btn-sm" id="piRefresh">${this.esc(this.t('processes.refresh'))}</button>
          <span id="piCount" class="pi-count" aria-live="polite"></span>
        </div>

        <div class="pi-workspace">
          <div class="pi-list-panel">
            <div id="piColumnHeader" class="pi-column-header"></div>
            <div id="piViewport" class="pi-viewport" tabindex="0" role="table" aria-label="${this.esc(this.t('processes.title'))}">
              <div id="piSpacer" class="pi-spacer"></div>
              <div id="piRows" class="pi-rows"><div class="empty-state"><span class="spinner"></span>&nbsp;${this.esc(this.t('processes.loading'))}</div></div>
            </div>
          </div>
          <aside id="piDetails" class="pi-details" aria-label="${this.esc(this.t('processes.details'))}" hidden></aside>
        </div>
      </section>`;

    this._bindEvents();
    this._renderSortOptions();
    this._renderColumnHeader();
    this._connect().catch((error) => this._showError(error));
    window.api.invoke('db:getSetting', 'processInspector.mode', this._mode).then((mode) => {
      if (['simple', 'technical'].includes(mode) && mode !== this._mode) this._setMode(mode, false);
    }).catch(() => {});
  },

  _statCard(id, label) {
    return `<article class="pi-stat-card" data-stat="${id}">
      <span>${this.esc(label)}</span><strong id="piStat-${id}">—</strong><div class="pi-stat-track"><i style="width:0%"></i></div>
    </article>`;
  },

  _bindEvents() {
    const container = this._container;
    container.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => this._setMode(button.dataset.mode)));
    const search = container.querySelector('#piSearch');
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { this._query = search.value.trim().toLowerCase(); this._scheduleRender(true); }, 100);
    });
    container.querySelector('#piRiskFilter').addEventListener('change', (event) => { this._riskFilter = event.target.value; this._scheduleRender(true); });
    container.querySelector('#piSort').addEventListener('change', (event) => { this._sortBy = event.target.value; this._scheduleRender(true); });
    container.querySelector('#piPause').addEventListener('click', () => this._togglePause());
    container.querySelector('#piRefresh').addEventListener('click', () => this._refresh());
    container.querySelector('#piSaveTrace').addEventListener('click', () => this._showTraceDialog());
    container.querySelector('#piDiagnostics').addEventListener('click', async () => {
      try {
        const result = await window.soterios.process.saveDiagnostics();
        if (result?.success) alert(this.t('processes.diagnosticsSaved', { path: result.path }));
      } catch (error) { alert(error.message || String(error)); }
    });
    container.querySelector('#piRunTask').addEventListener('click', () => this._showRunTaskDialog());
    const viewport = container.querySelector('#piViewport');
    viewport.addEventListener('scroll', () => this._renderVirtualRows());
    viewport.addEventListener('keydown', (event) => this._handleKeyboard(event));
    viewport.addEventListener('click', (event) => this._handleListClick(event));
  },

  async _connect() {
    const api = window.soterios.process;
    this._unsubscribers.push(api.onFullSnapshot((snapshot) => this._applySnapshot(snapshot)));
    this._unsubscribers.push(api.onDelta((delta) => { if (!this._paused) this._applyDelta(delta); }));
    this._unsubscribers.push(api.onCapabilitiesChanged((capabilities) => {
      this._snapshot = { ...(this._snapshot || {}), capabilities };
      this._renderProviderNotice();
    }));
    await api.startSubscription({ intervalMs: 1000 });
  },

  _applySnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.processes)) return;
    this._snapshot = snapshot;
    this._processes = new Map(snapshot.processes.map((proc) => [this.keyOf(proc), proc]));
    this._renderStats();
    this._renderProviderNotice();
    this._scheduleRender(true);
  },

  _applyDelta(delta) {
    if (!delta) return;
    for (const key of delta.removed || []) this._processes.delete(this.keyOf({ key }));
    for (const proc of delta.upserts || []) this._processes.set(this.keyOf(proc), proc);
    this._snapshot = {
      ...(this._snapshot || {}),
      collectedAt: delta.collectedAt,
      capabilities: delta.capabilities || this._snapshot?.capabilities || {},
      totals: delta.totals || {},
      totalCpu: delta.totalCpu,
      totalMemory: delta.totalMemory,
      totalDiskIO: delta.totalDiskIO,
      totalNetworkIO: delta.totalNetworkIO,
      processes: [...this._processes.values()],
    };
    this._renderStats();
    this._renderProviderNotice();
    this._scheduleRender(false);
    if (this._selectedKey && this._processes.has(this._selectedKey)) this._renderDetails();
    if (this._selectedKey && !this._processes.has(this._selectedKey)) this._closeDetails();
  },

  _renderProviderNotice() {
    const notice = this._container?.querySelector('#piProviderNotice');
    if (!notice) return;
    const caps = this._snapshot?.capabilities || {};
    notice.hidden = !caps.degraded;
    if (caps.degraded) {
      notice.innerHTML = `<strong>${this.esc(this.t('processes.degradedTitle'))}</strong><span>${this.esc(this.t('processes.degradedDetail'))}</span>`;
    }
  },

  _renderStats() {
    const totals = this._snapshot?.totals || {};
    const values = {
      cpu: { text: this.formatPercent(totals.cpuPercent), pct: totals.cpuPercent },
      memory: { text: this.formatPercent(totals.memoryPercent), pct: totals.memoryPercent },
      disk: { text: totals.diskReadBytesPerSec == null || totals.diskWriteBytesPerSec == null ? this.t('processes.notAvailable') : this.formatRate(totals.diskReadBytesPerSec + totals.diskWriteBytesPerSec), pct: null },
      network: { text: totals.networkReceiveBytesPerSec == null || totals.networkSendBytesPerSec == null ? this.t('processes.notAvailable') : this.formatRate(totals.networkReceiveBytesPerSec + totals.networkSendBytesPerSec), pct: null },
      gpu: { text: this.formatPercent(totals.gpuPercent), pct: totals.gpuPercent },
    };
    for (const [id, value] of Object.entries(values)) {
      const card = this._container?.querySelector(`[data-stat="${id}"]`);
      if (!card) continue;
      card.querySelector('strong').textContent = value.text;
      const pct = Number(value.pct);
      card.querySelector('i').style.width = Number.isFinite(pct) ? `${Math.min(100, Math.max(0, pct))}%` : '0%';
      card.classList.toggle('warning', Number.isFinite(pct) && pct >= 70);
      card.classList.toggle('danger', Number.isFinite(pct) && pct >= 90);
    }
  },

  _setMode(mode, persist = true) {
    if (!['simple', 'technical'].includes(mode)) return;
    this._mode = mode;
    this._rowHeight = mode === 'technical' ? 42 : 58;
    this._sortBy = mode === 'technical' ? 'tree' : 'risk';
    this._container?.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    try { localStorage.setItem('soterios.processMode', mode); } catch (_) {}
    if (persist) window.api.invoke('db:setSetting', 'processInspector.mode', mode).catch(() => {});
    this._renderSortOptions();
    this._renderColumnHeader();
    this._scheduleRender(true);
    if (this._selectedKey) this._renderDetails();
  },

  _renderSortOptions() {
    const select = this._container?.querySelector('#piSort');
    if (!select) return;
    const options = this._mode === 'technical'
      ? [['tree', this.t('processes.sortTree')], ['risk', this.t('processes.sortRisk')], ['cpu', this.t('processes.sortCpu')], ['memory', this.t('processes.sortMemory')], ['name', this.t('processes.sortName')]]
      : [['risk', this.t('processes.sortRisk')], ['cpu', this.t('processes.sortCpu')], ['memory', this.t('processes.sortMemory')], ['name', this.t('processes.sortName')]];
    select.innerHTML = options.map(([value, label]) => `<option value="${value}">${this.esc(label)}</option>`).join('');
    select.value = this._sortBy;
  },

  _renderColumnHeader() {
    const header = this._container?.querySelector('#piColumnHeader');
    if (!header) return;
    header.className = `pi-column-header ${this._mode}`;
    header.innerHTML = this._mode === 'technical'
      ? `<span>${this.esc(this.t('processes.columnProcess'))}</span><span>PID</span><span>${this.esc(this.t('processes.columnRisk'))}</span><span>CPU</span><span>${this.esc(this.t('processes.columnMemory'))}</span><span>I/O</span><span>${this.esc(this.t('processes.columnNetwork'))}</span><span>GPU</span>`
      : `<span>${this.esc(this.t('processes.columnApplication'))}</span><span>${this.esc(this.t('processes.columnRisk'))}</span><span>CPU</span><span>${this.esc(this.t('processes.columnMemory'))}</span><span>${this.esc(this.t('processes.columnIo'))}</span><span>${this.esc(this.t('processes.columnActions'))}</span>`;
  },

  _scheduleRender(resetScroll) {
    if (resetScroll) {
      const viewport = this._container?.querySelector('#piViewport');
      if (viewport) viewport.scrollTop = 0;
    }
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this._visible = this._buildVisible();
      const count = this._container?.querySelector('#piCount');
      if (count) count.textContent = this.t('processes.count', { count: this._visible.length });
      const spacer = this._container?.querySelector('#piSpacer');
      if (spacer) spacer.style.height = `${this._visible.length * this._rowHeight}px`;
      this._renderVirtualRows();
    });
  },

  _matches(proc) {
    const severity = proc.risk?.severity || 'no-concerns';
    if (this._riskFilter !== 'all' && severity !== this._riskFilter) return false;
    if (!this._query) return true;
    return `${proc.name || ''} ${proc.path || ''} ${proc.commandLine || ''} ${proc.pid || ''} ${proc.publisher || ''}`.toLowerCase().includes(this._query);
  },

  _compare(a, b) {
    if (this._sortBy === 'cpu') return (b.cpu || 0) - (a.cpu || 0);
    if (this._sortBy === 'memory') return (b.workingSetBytes || 0) - (a.workingSetBytes || 0);
    if (this._sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    return (b.risk?.score || 0) - (a.risk?.score || 0) || (b.cpu || 0) - (a.cpu || 0);
  },

  _buildVisible() {
    const processes = [...this._processes.values()].filter((proc) => this._matches(proc));
    if (this._mode === 'simple') {
      const groups = new Map();
      for (const proc of processes) {
        if (proc.pid === 0) continue;
        const id = `${String(proc.name || '').toLowerCase()}|${String(proc.path || '').toLowerCase()}`;
        const group = groups.get(id) || { ...proc, kind: 'group', members: [], instanceCount: 0, cpu: 0, workingSetBytes: 0, diskIo: 0, networkIo: 0 };
        group.members.push(proc);
        group.instanceCount += 1;
        group.cpu += Number(proc.cpu) || 0;
        group.workingSetBytes += Number(proc.workingSetBytes) || 0;
        if (proc.diskIo != null) group.diskIo += Number(proc.diskIo) || 0; else group.diskIo = group.diskIo || null;
        if (proc.networkIo != null) group.networkIo += Number(proc.networkIo) || 0; else group.networkIo = group.networkIo || null;
        if ((proc.risk?.score || 0) > (group.risk?.score || 0)) group.risk = proc.risk;
        groups.set(id, group);
      }
      return [...groups.values()].sort((a, b) => this._compare(a, b));
    }

    if (this._sortBy !== 'tree') return processes.sort((a, b) => this._compare(a, b)).map((proc) => ({ ...proc, depth: 0, hasChildren: false }));
    const all = [...this._processes.values()].filter((proc) => this._matches(proc));
    const byPid = new Map(all.map((proc) => [proc.pid, proc]));
    const children = new Map();
    for (const proc of all) {
      const bucket = children.get(proc.ppid) || [];
      bucket.push(proc);
      children.set(proc.ppid, bucket);
    }
    for (const bucket of children.values()) bucket.sort((a, b) => this._compare(a, b));
    const roots = all.filter((proc) => !byPid.has(proc.ppid) || proc.pid === proc.ppid).sort((a, b) => this._compare(a, b));
    const output = [];
    const visited = new Set();
    const walk = (proc, depth) => {
      const key = this.keyOf(proc);
      if (visited.has(key)) return;
      visited.add(key);
      const descendants = children.get(proc.pid) || [];
      output.push({ ...proc, depth: Math.min(depth, 12), hasChildren: descendants.length > 0 });
      if (!this._collapsed.has(key)) descendants.forEach((child) => walk(child, depth + 1));
    };
    roots.forEach((root) => walk(root, 0));
    all.forEach((proc) => { if (!visited.has(this.keyOf(proc))) walk(proc, 0); });
    return output;
  },

  _renderVirtualRows() {
    const viewport = this._container?.querySelector('#piViewport');
    const rows = this._container?.querySelector('#piRows');
    if (!viewport || !rows) return;
    if (!this._visible.length) {
      rows.style.transform = 'translateY(0)';
      rows.innerHTML = `<div class="empty-state">${this.esc(this._snapshot ? this.t('processes.noResults') : this.t('processes.loading'))}</div>`;
      return;
    }
    const overscan = 8;
    const start = Math.max(0, Math.floor(viewport.scrollTop / this._rowHeight) - overscan);
    const count = Math.ceil(viewport.clientHeight / this._rowHeight) + overscan * 2;
    const slice = this._visible.slice(start, start + count);
    rows.style.transform = `translateY(${start * this._rowHeight}px)`;
    rows.innerHTML = slice.map((item, offset) => this._mode === 'technical'
      ? this._technicalRow(item, start + offset)
      : this._simpleRow(item, start + offset)).join('');
    this._loadVisibleIcons(rows);
  },

  _riskPill(risk) {
    const severity = risk?.severity || 'no-concerns';
    const label = risk?.statusLabel || this.t('processes.statusNoConcerns');
    return `<span class="pi-risk ${severity}" title="${this.esc(`${risk?.score || 0}/100 · ${risk?.confidence || 'medium'} confidence`)}">${this.esc(label)}</span>`;
  },

  _simpleRow(group, index) {
    const representative = group.members?.find((proc) => proc.pid !== 0) || group.members?.[0] || group;
    const key = this.keyOf(representative);
    return `<div class="pi-row simple ${this._selectedKey === key ? 'selected' : ''}" role="row" data-key="${this.esc(key)}" data-index="${index}" tabindex="-1">
      <div class="pi-process-cell"><img class="pi-icon" data-exe="${this.esc(group.path || '')}" alt=""><span><strong>${this.esc(group.name || 'unknown')}</strong><small>${this.esc(group.instanceCount > 1 ? this.t('processes.instances', { count: group.instanceCount }) : (group.publisher || group.path || this.t('processes.unverifiedPublisher')))}</small></span></div>
      <div>${this._riskPill(group.risk)}</div>
      <div class="pi-metric">${this.esc(this.formatPercent(group.cpu))}</div>
      <div class="pi-metric">${this.esc(this.formatBytes(group.workingSetBytes))}</div>
      <div class="pi-metric">${this.esc(this.formatRate(group.diskIo))}</div>
      <div class="pi-row-actions"><button class="btn btn-xs" data-row-action="restart" data-key="${this.esc(key)}">${this.esc(this.t('processes.restart'))}</button><button class="btn btn-xs danger" data-row-action="terminate" data-key="${this.esc(key)}">${this.esc(this.t('processes.endProcess'))}</button></div>
    </div>`;
  },

  _technicalRow(proc, index) {
    const key = this.keyOf(proc);
    const io = proc.ioReadBytesPerSec == null || proc.ioWriteBytesPerSec == null ? null : proc.ioReadBytesPerSec + proc.ioWriteBytesPerSec;
    const network = proc.networkReceiveBytesPerSec == null || proc.networkSendBytesPerSec == null ? null : proc.networkReceiveBytesPerSec + proc.networkSendBytesPerSec;
    const networkText = network == null
      ? (proc.networkConnectionCount == null ? this.t('processes.notAvailable') : this.t('processes.connectionCount', { count: proc.networkConnectionCount }))
      : this.formatRate(network);
    return `<div class="pi-row technical ${this._selectedKey === key ? 'selected' : ''}" role="row" data-key="${this.esc(key)}" data-index="${index}" tabindex="-1">
      <div class="pi-process-cell technical-name" style="--tree-depth:${Number(proc.depth || 0)}"><button class="pi-tree-toggle" data-collapse="${this.esc(key)}" ${proc.hasChildren ? '' : 'disabled'} aria-label="${this.esc(this.t('processes.toggleTree'))}">${proc.hasChildren ? (this._collapsed.has(key) ? '›' : '⌄') : ''}</button><img class="pi-icon" data-exe="${this.esc(proc.path || '')}" alt=""><span><strong>${this.esc(proc.name || 'unknown')}</strong><small title="${this.esc(proc.path || '')}">${this.esc(proc.path || this.t('processes.notAvailable'))}</small></span></div>
      <div class="pi-metric">${this.esc(proc.pid)}</div><div>${this._riskPill(proc.risk)}</div>
      <div class="pi-metric">${this.esc(this.formatPercent(proc.cpu))}</div><div class="pi-metric">${this.esc(this.formatBytes(proc.workingSetBytes))}</div>
      <div class="pi-metric">${this.esc(this.formatRate(io))}</div><div class="pi-metric">${this.esc(networkText)}</div><div class="pi-metric">${this.esc(this.formatPercent(proc.gpuPercent))}</div>
    </div>`;
  },

  _loadVisibleIcons(rows) {
    const images = [...rows.querySelectorAll('.pi-icon[data-exe]')];
    const missing = [...new Set(images.map((img) => img.dataset.exe).filter((exe) => exe && !this._iconCache.has(exe)))].slice(0, 64);
    const apply = () => images.forEach((img) => {
      const icon = this._iconCache.get(img.dataset.exe);
      if (icon) { img.src = icon; img.hidden = false; } else img.hidden = true;
    });
    if (!missing.length) { apply(); return; }
    window.soterios.process.getIcons(missing).then((result) => {
      missing.forEach((exe) => this._iconCache.set(exe, result?.[exe] || null));
      apply();
    }).catch(() => missing.forEach((exe) => this._iconCache.set(exe, null)));
  },

  _handleListClick(event) {
    const action = event.target.closest('[data-row-action]');
    if (action) { event.stopPropagation(); this._runAction(action.dataset.key, action.dataset.rowAction); return; }
    const collapse = event.target.closest('[data-collapse]');
    if (collapse && !collapse.disabled) {
      event.stopPropagation();
      const key = collapse.dataset.collapse;
      if (this._collapsed.has(key)) this._collapsed.delete(key); else this._collapsed.add(key);
      this._scheduleRender(false);
      return;
    }
    const row = event.target.closest('.pi-row[data-key]');
    if (row) this._openDetails(row.dataset.key);
  },

  _handleKeyboard(event) {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const current = Number(event.target.closest('.pi-row')?.dataset.index ?? -1);
    if (event.key === 'Enter' && current >= 0) { this._openDetails(this.keyOf(this._visible[current])); return; }
    event.preventDefault();
    const next = Math.max(0, Math.min(this._visible.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    const viewport = this._container.querySelector('#piViewport');
    viewport.scrollTop = Math.max(0, next * this._rowHeight - viewport.clientHeight / 2);
    this._renderVirtualRows();
    requestAnimationFrame(() => this._container.querySelector(`.pi-row[data-index="${next}"]`)?.focus());
  },

  async _openDetails(key) {
    const proc = this._processes.get(key);
    if (!proc) return;
    this._selectedKey = key;
    this._selectedDetails = { process: proc, history: [], sections: {}, capabilityErrors: {} };
    this._detailTab = 'overview';
    this._renderDetails();
    this._scheduleRender(false);
    try {
      this._selectedDetails = await window.soterios.process.getDetails(proc.key, ['security', 'network', 'timeline', 'modules', 'threads', 'handles', 'waitChain']);
      if (this._selectedKey === key) this._renderDetails();
    } catch (error) {
      if (this._selectedKey === key) {
        this._selectedDetails.error = error.message || String(error);
        this._renderDetails();
      }
    }
  },

  _renderDetails() {
    const panel = this._container?.querySelector('#piDetails');
    if (!panel || !this._selectedKey) return;
    const proc = this._processes.get(this._selectedKey) || this._selectedDetails?.process;
    if (!proc) { this._closeDetails(); return; }
    const tabs = ['overview', 'performance', 'security', 'network', 'timeline'];
    panel.hidden = false;
    panel.innerHTML = `<div class="pi-detail-header"><div><h2>${this.esc(proc.name)}</h2><span>PID ${this.esc(proc.pid)} · ${this.esc(proc.user || this.t('processes.notAvailable'))}</span></div><button id="piCloseDetails" class="pi-close" aria-label="${this.esc(this.t('common.close'))}">×</button></div>
      <div class="pi-detail-tabs" role="tablist">${tabs.map((tab) => `<button role="tab" aria-selected="${this._detailTab === tab}" data-detail-tab="${tab}">${this.esc(this.t(`processes.tab.${tab}`))}</button>`).join('')}</div>
      <div class="pi-detail-body">${this._detailContent(proc)}</div>
      <div class="pi-detail-actions">${this._detailActions(proc)}</div>`;
    panel.querySelector('#piCloseDetails').addEventListener('click', () => this._closeDetails());
    panel.querySelectorAll('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => { this._detailTab = button.dataset.detailTab; this._renderDetails(); }));
    panel.querySelectorAll('[data-detail-action]').forEach((button) => button.addEventListener('click', () => this._detailAction(button.dataset.detailAction, proc)));
    panel.querySelector('#piPriority')?.addEventListener('change', (event) => this._runAction(this._selectedKey, 'setPriority', { priority: event.target.value }));
  },

  _detailContent(proc) {
    const details = this._selectedDetails || {};
    if (details.error) return `<div class="pi-inline-error">${this.esc(details.error)}</div>`;
    if (this._detailTab === 'overview') {
      return `<dl class="pi-detail-grid">
        ${this._detailPair(this.t('processes.fieldPath'), proc.path)}${this._detailPair(this.t('processes.fieldCommand'), proc.commandLine)}
        ${this._detailPair(this.t('processes.fieldParent'), proc.parentName ? `${proc.parentName} (${proc.ppid})` : proc.ppid)}${this._detailPair(this.t('processes.fieldStarted'), proc.startedAt)}
        ${this._detailPair(this.t('processes.fieldArchitecture'), proc.architecture)}${this._detailPair(this.t('processes.fieldIntegrity'), proc.integrityLevel)}
        ${this._detailPair(this.t('processes.fieldPriority'), proc.priority)}${this._detailPair(this.t('processes.fieldThreads'), proc.threads)}
        ${this._detailPair(this.t('processes.fieldHandles'), proc.handles)}${this._detailPair(this.t('processes.fieldEfficiency'), proc.efficiencyMode == null ? null : String(proc.efficiencyMode))}
      </dl>`;
    }
    if (this._detailTab === 'performance') {
      const history = details.history || [];
      return `<div class="pi-performance-grid">
        ${this._metricTile('CPU', this.formatPercent(proc.cpu))}${this._metricTile(this.t('processes.columnMemory'), this.formatBytes(proc.workingSetBytes))}
        ${this._metricTile('Private', this.formatBytes(proc.privateBytes))}${this._metricTile('Commit', this.formatBytes(proc.commitBytes))}
        ${this._metricTile('I/O read', this.formatRate(proc.ioReadBytesPerSec))}${this._metricTile('I/O write', this.formatRate(proc.ioWriteBytesPerSec))}
        ${this._metricTile('GPU', this.formatPercent(proc.gpuPercent))}
      </div>${this._sparkline(history.map((sample) => sample.cpu), 'CPU')}`;
    }
    if (this._detailTab === 'security') {
      const evidence = proc.risk?.evidence || [];
      return `<div class="pi-security-summary">${this._riskPill(proc.risk)}<strong>${this.esc(`${proc.risk?.score || 0}/100`)}</strong><span>${this.esc(`${proc.risk?.confidence || 'medium'} confidence · rules v${proc.risk?.ruleVersion || '?'}`)}</span></div>
        <dl class="pi-detail-grid">${this._detailPair(this.t('processes.fieldPublisher'), proc.publisher || proc.signature?.publisher)}${this._detailPair(this.t('processes.fieldSignature'), proc.signature?.status)}${this._detailPair('SHA-256', proc.hash)}${this._detailPair(this.t('processes.fieldTrusted'), proc.trusted ? this.t('common.yes') : this.t('common.no'))}${this._detailPair(this.t('processes.reputation'), proc.reputation ? `${proc.reputation.malicious || 0} malicious · ${proc.reputation.suspicious || 0} suspicious` : null)}</dl>
        <button class="btn btn-xs" data-detail-action="reputation">${this.esc(this.t('processes.checkReputation'))}</button>
        <div class="pi-evidence">${evidence.length ? evidence.map((item) => `<article><strong>${this.esc(item.title)}</strong><p>${this.esc(item.detail)}</p><small>${this.esc(`${item.category} · ${item.confidence} confidence${item.trustReduced ? ' · reduced by trust' : ''}`)}</small></article>`).join('') : `<p>${this.esc(this.t('processes.noEvidence'))}</p>`}</div>`;
    }
    if (this._detailTab === 'network') {
      const rows = details.sections?.network || [];
      const error = details.capabilityErrors?.network;
      return `${error ? `<p class="pi-capability-note">${this.esc(error)}</p>` : ''}<div class="pi-connection-list">${rows.length ? rows.map((row) => `<div><strong>${this.esc(`${row.remoteAddress || '*'}:${row.remotePort || '*'}`)}</strong><span>${this.esc(`${row.protocol || ''} · ${row.state || ''}`)}</span><small>${this.esc(`${row.localAddress || '*'}:${row.localPort || '*'}`)}</small></div>`).join('') : `<p>${this.esc(this.t('processes.noConnections'))}</p>`}</div>`;
    }
    const history = details.history || [];
    return `<p class="pi-capability-note">${this.esc(this.t('processes.timelinePrivacy'))}</p><div class="pi-timeline-list">${history.slice().reverse().slice(0, 120).map((sample) => `<div><time>${this.esc(new Date(sample.at).toLocaleTimeString())}</time><span>CPU ${this.esc(this.formatPercent(sample.cpu))}</span><span>${this.esc(this.formatBytes(sample.workingSetBytes))}</span><span>Risk ${this.esc(sample.riskScore)}</span></div>`).join('') || `<p>${this.esc(this.t('processes.timelineEmpty'))}</p>`}</div>`;
  },

  _detailPair(label, value) { return `<dt>${this.esc(label)}</dt><dd title="${this.esc(value ?? '')}">${this.esc(value == null || value === '' ? this.t('processes.notAvailable') : value)}</dd>`; },
  _metricTile(label, value) { return `<article><span>${this.esc(label)}</span><strong>${this.esc(value)}</strong></article>`; },
  _sparkline(values, label) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (valid.length < 2) return `<p class="pi-capability-note">${this.esc(this.t('processes.timelineWarming'))}</p>`;
    const max = Math.max(1, ...valid);
    const points = valid.map((value, index) => `${(index / (valid.length - 1)) * 100},${30 - (value / max) * 28}`).join(' ');
    return `<figure class="pi-spark"><figcaption>${this.esc(`${label} · 15 minute RAM-only history`)}</figcaption><svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></figure>`;
  },

  _detailActions(proc) {
    const technical = this._mode === 'technical';
    return `<button class="btn btn-xs" data-detail-action="properties">${this.esc(this.t('processes.properties'))}</button><button class="btn btn-xs" data-detail-action="location">${this.esc(this.t('processes.openFileLocation'))}</button><button class="btn btn-xs" data-detail-action="search">${this.esc(this.t('processes.searchOnline'))}</button>
      ${technical ? `<select id="piPriority" class="pi-select compact" aria-label="${this.esc(this.t('processes.setPriority'))}"><option value="">${this.esc(this.t('processes.setPriority'))}</option><option>Idle</option><option>BelowNormal</option><option>Normal</option><option>AboveNormal</option><option>High</option></select><button class="btn btn-xs" data-detail-action="affinity">${this.esc(this.t('processes.setAffinity'))}</button><button class="btn btn-xs" data-detail-action="efficiency">${this.esc(proc.efficiencyMode ? this.t('processes.disableEfficiency') : this.t('processes.enableEfficiency'))}</button><button class="btn btn-xs" data-detail-action="suspend">${this.esc(this.t('processes.suspend'))}</button><button class="btn btn-xs" data-detail-action="resume">${this.esc(this.t('processes.resume'))}</button><button class="btn btn-xs" data-detail-action="createDump">${this.esc(this.t('processes.createDump'))}</button>` : ''}
      <button class="btn btn-xs" data-detail-action="restart">${this.esc(this.t('processes.restart'))}</button><button class="btn btn-xs danger" data-detail-action="terminate">${this.esc(this.t('processes.endProcess'))}</button>`;
  },

  async _detailAction(action, proc) {
    if (action === 'reputation') return this._checkReputation(proc);
    if (action === 'properties') return window.soterios.process.showProperties(proc.path).catch((error) => alert(error.message || String(error)));
    if (action === 'location') return proc.path ? window.soterios.shell.showItemInFolder(proc.path) : alert(this.t('processes.pathUnavailable'));
    if (action === 'search') return window.soterios.process.searchOnline(`${proc.name} ${proc.publisher || ''}`).catch((error) => alert(error.message || String(error)));
    if (action === 'affinity') {
      const value = window.prompt(this.t('processes.affinityPrompt'), proc.affinityMask == null ? '' : String(proc.affinityMask));
      if (value == null) return;
      return this._runAction(this._selectedKey, 'setAffinity', { affinityMask: Number(value) });
    }
    if (action === 'efficiency') return this._runAction(this._selectedKey, 'setEfficiencyMode', { enabled: !proc.efficiencyMode });
    return this._runAction(this._selectedKey, action);
  },

  async _checkReputation(proc) {
    try {
      let status = await window.soterios.process.getReputationStatus();
      if (status.privacyMode) throw new Error(this.t('processes.reputationPrivacyDisabled'));
      if (!status.enabled || !status.keyConfigured) {
        if (!window.confirm(this.t('processes.reputationDisclosure'))) return;
        const apiKey = window.prompt(this.t('processes.reputationKeyPrompt'));
        if (!apiKey) return;
        status = await window.soterios.process.configureReputation(apiKey, true);
      }
      const result = await window.soterios.process.checkReputation(proc.key);
      if (!result?.success) throw new Error(result?.requiresConsent ? this.t('processes.reputationConsentRequired') : this.t('common.unknownError'));
      const reputation = result.reputation || {};
      alert(this.t('processes.reputationResult', { malicious: reputation.malicious || 0, suspicious: reputation.suspicious || 0, undetected: reputation.undetected || 0 }));
      await this._refresh();
      if (this._selectedKey) await this._openDetails(this._selectedKey);
    } catch (error) {
      alert(error.message || String(error));
    }
  },

  _closeDetails() {
    this._selectedKey = null;
    this._selectedDetails = null;
    const panel = this._container?.querySelector('#piDetails');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    this._scheduleRender(false);
  },

  async _runAction(key, action, options = {}) {
    const proc = this._processes.get(key);
    if (!proc || !action) return;
    const messages = {
      terminate: this.t('processes.confirmEnd', { name: proc.name, pid: proc.pid }),
      restart: this.t('processes.confirmRestart', { name: proc.name, pid: proc.pid }),
      suspend: this.t('processes.confirmSuspend', { name: proc.name }),
      resume: this.t('processes.confirmResume', { name: proc.name }),
      createDump: this.t('processes.confirmDump', { name: proc.name }),
      setPriority: this.t('processes.confirmPriority', { name: proc.name, priority: options.priority }),
      setAffinity: this.t('processes.confirmAffinity', { name: proc.name }),
      setEfficiencyMode: this.t('processes.confirmEfficiency', { name: proc.name }),
    };
    if (messages[action] && !window.confirm(messages[action])) return;
    try {
      const result = await window.soterios.process.performAction({ processKey: proc.key, action, options });
      if (!result?.success) throw new Error(result?.error || this.t('common.unknownError'));
      if (result.path) alert(this.t('processes.dumpSaved', { path: result.path }));
      if (action === 'terminate' || action === 'restart') this._closeDetails();
    } catch (error) {
      alert(this.t('processes.actionFailed', { error: error.message || String(error) }));
    }
  },

  async _togglePause() {
    this._paused = !this._paused;
    const button = this._container?.querySelector('#piPause');
    if (button) { button.textContent = this.t(this._paused ? 'processes.resumeUpdates' : 'processes.pause'); button.setAttribute('aria-pressed', String(this._paused)); }
    if (!this._paused) await this._refresh();
  },

  async _refresh() {
    const button = this._container?.querySelector('#piRefresh');
    if (button) button.disabled = true;
    try { this._applySnapshot(await window.soterios.process.getSnapshot()); }
    catch (error) { this._showError(error); }
    finally { if (button) button.disabled = false; }
  },

  _showError(error) {
    const rows = this._container?.querySelector('#piRows');
    if (rows) rows.innerHTML = `<div class="empty-state pi-inline-error">${this.esc(error.message || String(error))}</div>`;
  },

  _showTraceDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'pi-modal-backdrop';
    dialog.innerHTML = `<form class="pi-modal" aria-labelledby="piTraceTitle"><h2 id="piTraceTitle">${this.esc(this.t('processes.saveTrace'))}</h2><p>${this.esc(this.t('processes.traceDisclosure'))}</p><label>${this.esc(this.t('processes.traceRedaction'))}<select id="piTraceRedaction" class="pi-select"><option value="standard">${this.esc(this.t('processes.redactionStandard'))}</option><option value="strict">${this.esc(this.t('processes.redactionStrict'))}</option><option value="none">${this.esc(this.t('processes.redactionNone'))}</option></select></label><label>${this.esc(this.t('processes.tracePassphrase'))}<input id="piTracePass" type="password" minlength="10" maxlength="256" autocomplete="new-password"></label><div class="pi-modal-actions"><button type="button" class="btn btn-sm" data-cancel>${this.esc(this.t('common.cancel'))}</button><button type="button" class="btn btn-sm" data-portable>${this.esc(this.t('processes.exportPortable'))}</button><button type="submit" class="btn btn-sm primary">${this.esc(this.t('processes.saveEncrypted'))}</button></div></form>`;
    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    const save = async (mode) => {
      const passphrase = dialog.querySelector('#piTracePass').value;
      if (mode === 'encrypted' && passphrase.length < 10) { alert(this.t('processes.tracePassphraseLength')); return; }
      try {
        const result = await window.soterios.process.saveTrace({ mode, redaction: dialog.querySelector('#piTraceRedaction').value, passphrase });
        if (result?.success) { close(); alert(this.t('processes.traceSaved', { path: result.path })); }
      } catch (error) { alert(error.message || String(error)); }
    };
    dialog.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); save('encrypted'); });
    dialog.querySelector('[data-portable]').addEventListener('click', () => save('portable'));
  },

  _parseArgs(value) {
    const args = [];
    String(value || '').replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g, (_match, quoted, single, bare) => {
      args.push((quoted ?? single ?? bare ?? '').replace(/\\"/g, '"'));
      return '';
    });
    return args;
  },

  _showRunTaskDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'pi-modal-backdrop';
    dialog.innerHTML = `<form class="pi-modal" aria-labelledby="piRunTitle"><h2 id="piRunTitle">${this.esc(this.t('processes.runTaskTitle'))}</h2><p>${this.esc(this.t('processes.runTaskSafety'))}</p><label>${this.esc(this.t('processes.executable'))}<div class="pi-path-input"><input id="piTaskExe" required readonly><button type="button" class="btn btn-sm" data-browse>${this.esc(this.t('processes.runTaskBrowse'))}</button></div></label><label>${this.esc(this.t('processes.arguments'))}<input id="piTaskArgs" autocomplete="off" placeholder="--example value"></label><div class="pi-modal-actions"><button type="button" class="btn btn-sm" data-cancel>${this.esc(this.t('common.cancel'))}</button><button type="submit" class="btn btn-sm primary">${this.esc(this.t('processes.runTaskRun'))}</button></div></form>`;
    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-browse]').addEventListener('click', async () => {
      const files = await window.soterios.dialog.pickFiles();
      if (files?.[0]) dialog.querySelector('#piTaskExe').value = files[0];
    });
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await window.soterios.process.runTask({ executable: dialog.querySelector('#piTaskExe').value, args: this._parseArgs(dialog.querySelector('#piTaskArgs').value), elevate: false });
        close();
      } catch (error) { alert(this.t('processes.runTaskError', { error: error.message || String(error) })); }
    });
  },

  destroy() {
    for (const unsubscribe of this._unsubscribers.splice(0)) { try { unsubscribe(); } catch (_) {} }
    window.soterios?.process?.stopSubscription?.().catch(() => {});
    document.querySelectorAll('.pi-modal-backdrop').forEach((node) => node.remove());
    this._container = null;
    this._processes.clear();
    this._snapshot = null;
    this._selectedKey = null;
    this._selectedDetails = null;
    this._visible = [];
  },
};
