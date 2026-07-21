window.Pages = window.Pages || {};
window.Pages.processes = {
  REFRESH_INTERVAL_MS: 3000,
  _all: [],
  _query: '',
  _riskFilter: 'all',
  _sortBy: 'default',
  _rowIndex: null,
  _order: [],
  _delegated: false,
  _refreshTimer: null,
  _compactView: false,

  t(key, vars) {
    return window.I18n?.t(key, vars) ?? key;
  },

  render(container) {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._delegated = false;

    container.innerHTML = `
      <div class="page-header">
        <div class="flex-between">
          <div>
            <h1 class="page-title">${escapeHtml(this.t('processes.title'))}</h1>
            <div class="page-subtitle">${escapeHtml(this.t('processes.subtitle'))}</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn btn-sm" id="compactToggle" title="${escapeHtml(this.t('processes.compactToggle'))}">${escapeHtml(this._compactView ? this.t('processes.expand') : this.t('processes.compact'))}</button>
            <button class="btn" id="refreshBtn">${escapeHtml(this.t('processes.refresh'))}</button>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px;">
          <input type="text" id="processSearch" placeholder="${escapeHtml(this.t('processes.searchPlaceholder'))}"
            style="flex:1; max-width:360px; padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg,rgba(255,255,255,0.05)); color:inherit;">
          <select id="riskFilter" class="btn btn-sm">
            <option value="all">${escapeHtml(this.t('processes.riskFilterAll'))}</option>
            <option value="high">${escapeHtml(this.t('processes.riskFilterHigh'))}</option>
            <option value="normal">${escapeHtml(this.t('processes.riskFilterNormal'))}</option>
          </select>
          <select id="sortBy" class="btn btn-sm">
            <option value="default">${escapeHtml(this.t('processes.sortDefault'))}</option>
            <option value="risk-desc">${escapeHtml(this.t('processes.sortRisk'))}</option>
            <option value="cpu-desc">${escapeHtml(this.t('processes.sortCpu'))}</option>
            <option value="memory-desc">${escapeHtml(this.t('processes.sortMemory'))}</option>
            <option value="name-asc">${escapeHtml(this.t('processes.sortName'))}</option>
          </select>
          <div id="liveStats" style="display:flex; gap:16px; font-size:0.85rem; font-weight:500; white-space:nowrap;">
            <span id="liveCpu">${escapeHtml(this.t('processes.liveCpu', { cpu: '--' }))}</span>
            <span id="liveMemory">${escapeHtml(this.t('processes.liveMemory', { mem: '--' }))}</span>
          </div>
          <span class="page-subtitle" id="processCount" style="font-size:0.85rem; white-space:nowrap; margin-left:auto;"></span>
        </div>
      </div>
      <div class="card" style="padding:0; flex:1; overflow-y:auto; contain:layout style; border:none; background:transparent;"><div id="processList" style="padding-right:8px;"><div class="empty-state"><span class="spinner"></span>&nbsp;${escapeHtml(this.t('processes.loading'))}</div></div></div>`;

    container.querySelector('#refreshBtn').addEventListener('click', () => this.load(container, true));

    const searchInput = container.querySelector('#processSearch');
    searchInput.value = this._query;
    let debounceTimer = null;
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this._query = value;
        this.applyFilter(container);
      }, 120);
    });

    const riskFilter = container.querySelector('#riskFilter');
    riskFilter.value = this._riskFilter;
    riskFilter.addEventListener('change', (e) => {
      this._riskFilter = e.target.value;
      this.applyFilter(container);
    });

    const sortSelect = container.querySelector('#sortBy');
    sortSelect.value = this._sortBy;
    sortSelect.addEventListener('change', (e) => {
      this._sortBy = e.target.value;
      this.sortRows(container);
    });

    const compactBtn = container.querySelector('#compactToggle');
    compactBtn?.addEventListener('click', () => this.toggleCompactView(container));

    this.load(container, true);

    this._refreshTimer = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
        return;
      }
      this.load(container, false);
    }, this.REFRESH_INTERVAL_MS);
  },

  async load(container, isInitial = true) {
    const listEl = container.querySelector('#processList');
    if (!listEl) return;
    const scrollParent = listEl ? listEl.closest('.card') : null;
    const prevScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    if (isInitial) {
      listEl.innerHTML = `<div class="empty-state"><span class="spinner"></span>&nbsp;${escapeHtml(this.t('processes.loading'))}</div>`;
    }
    try {
      const data = await Api.runTool('process-viewer', {});
      if (!document.body.contains(container)) return;
      this._all = data.processes || [];
      this.updateLiveStats(container, data.totalCpu, data.totalMemory);
      this.buildRows(container);
      this.sortRows(container);
      this.applyFilter(container);
      if (prevScrollTop && scrollParent) scrollParent.scrollTop = prevScrollTop;
    } catch (err) {
      if (isInitial) showToolError(listEl, err);
      else console.error('Process refresh failed:', err);
    }
  },

  _cpuHistory: [],

  updateLiveStats(container, totalCpuReading, totalMemoryReading) {
    const cpuEl = container.querySelector('#liveCpu');
    const memEl = container.querySelector('#liveMemory');
    if (!cpuEl || !memEl) return;

    const rawCpu = typeof totalCpuReading === 'number' && !Number.isNaN(totalCpuReading) ? totalCpuReading : 0;
    const normalizedCpu = Math.min(100, Math.max(0, rawCpu));

    this._cpuHistory.push(normalizedCpu);
    if (this._cpuHistory.length > 3) this._cpuHistory.shift();
    const totalCpu = this._cpuHistory.reduce((a, b) => a + b, 0) / this._cpuHistory.length;

    const totalMemory = typeof totalMemoryReading === 'number' && !Number.isNaN(totalMemoryReading)
      ? Math.min(100, Math.max(0, totalMemoryReading))
      : 0;

    const colorFor = (pct) => pct >= 80 ? 'var(--accent-danger)' : pct >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)';

    cpuEl.textContent = this.t('processes.liveCpu', { cpu: totalCpu.toFixed(1) + '%' });
    cpuEl.style.color = colorFor(totalCpu);
    memEl.textContent = this.t('processes.liveMemory', { mem: totalMemory.toFixed(1) + '%' });
    memEl.style.color = colorFor(totalMemory);
  },

  buildRows(container) {
    const listEl = container.querySelector('#processList');
    if (!listEl) return;

    if (!this._listWrapper || !listEl.contains(this._listWrapper)) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
      const noResults = document.createElement('div');
      noResults.className = 'empty-state';
      noResults.style.display = 'none';
      noResults.textContent = this.t('processes.noResults');
      wrapper.appendChild(noResults);
      listEl.innerHTML = '';
      listEl.appendChild(wrapper);
      this._listWrapper = wrapper;
      this._noResultsEl = noResults;
      this._rowIndex = new Map();
      this._order = [];
    }

    const incomingPids = new Set(this._all.map((p) => p.pid));

    this._all.forEach((p) => {
      const existing = this._rowIndex.get(p.pid);
      if (existing) this._applyRowData(existing, p);
      else {
        const entry = this._createRow(p);
        this._rowIndex.set(p.pid, entry);
        this._order.push(p.pid);
        this._listWrapper.insertBefore(entry.el, this._noResultsEl);
      }
    });

    if (this._order.length !== incomingPids.size || this._order.some((pid) => !incomingPids.has(pid))) {
      this._order = this._order.filter((pid) => {
        if (incomingPids.has(pid)) return true;
        const entry = this._rowIndex.get(pid);
        if (entry) entry.el.remove();
        this._rowIndex.delete(pid);
        return false;
      });
    }

    this.loadProcessIcons(container);

    if (!this._delegated) {
      listEl.addEventListener('click', (e) => this.handleEndProcessClick(e, container));
      this._delegated = true;
    }
  },

  loadProcessIcons(container) {
    if (!window.soterios || !window.soterios.process) return;
    const listEl = container.querySelector('#processList');
    if (!listEl) return;
    const iconImgs = listEl.querySelectorAll('.process-icon[data-exe]');
    const exePaths = [...new Set([...iconImgs].map((img) => img.dataset.exe).filter(Boolean))];
    if (!exePaths.length) return;
    window.soterios.process.getIcons(exePaths).then((icons) => {
      iconImgs.forEach((img) => {
        const dataUrl = icons && icons[img.dataset.exe];
        if (dataUrl) { img.src = dataUrl; img.style.display = ''; }
        else img.style.display = 'none';
      });
    }).catch(() => { iconImgs.forEach((img) => img.style.display = 'none'); });
  },

  _reasonHint(p) {
    return (p.locationReasons && p.locationReasons[0])
      || ((p.suspiciousReasons || []).find((r) =>
        /appdata|temporary|recycle bin|writable windows location|double extension/i.test(r || '')
      ))
      || '';
  },

  _createRow(p) {
    const rawPath = p.path || p.cmd || '';
    const shortPath = truncatePath(rawPath || this.t('common.notAvailable'), 56);
    const isDanger = p.risk.score >= 35;
    const locationSuspicious = !!p.suspicious;
    const compact = this._compactView;
    const reasonHint = this._reasonHint(p);

    const row = document.createElement('div');
    row.className = 'list-row';
    const padding = compact ? '8px 12px' : '16px';
    const gap = compact ? '4px' : '8px';
    const fontSize = compact ? '0.8rem' : '1.1rem';

    row.style.cssText = `display:flex; flex-direction:column; gap:${gap}; padding:${padding}; border-left: 4px solid ${isDanger ? 'var(--accent-danger)' : 'var(--accent-success)'}; content-visibility:auto; contain-intrinsic-size: 0 ${compact ? 80 : 160}px;`;

const locationBadge = locationSuspicious
      ? `<span class="location-flag" title="${escapeHtml(reasonHint)}" style="font-size:0.7rem; padding:2px 6px; border-radius:4px; background:rgba(232,179,57,0.18); color:var(--accent-warning); white-space:nowrap;">${escapeHtml(this.t('processes.suspiciousLocation'))}</span>`
      : '';

    if (compact) {
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="min-width:0; display:flex; align-items:center; gap:8px;">
            <img class="process-icon" data-exe="${escapeHtml(rawPath || '')}" src="" alt="" style="width:18px;height:18px;flex-shrink:0;border-radius:3px;display:none;" />
            <div style="font-weight:600; font-size:${fontSize};">${escapeHtml(p.name)} <span class="page-subtitle" style="font-size:0.75rem;">(PID ${escapeHtml(p.pid)})</span></div>
            ${locationBadge}
            <span class="risk-score" style="font-weight:600; font-size:${fontSize}; color:${isDanger ? 'var(--accent-danger)' : 'var(--accent-success)'}">${escapeHtml(p.risk.score)} ${escapeHtml(this.t('processes.riskScoreSuffix'))}</span>
            <span class="risk-level page-subtitle" style="font-size:0.7rem; text-transform:uppercase;">${escapeHtml(p.risk.level)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="cpu-value" style="font-size:0.75rem; font-weight:500;">${p.cpu !== null ? p.cpu + '% CPU' : escapeHtml(this.t('processes.cpuNa'))}</span>
            <span class="memory-value" style="font-size:0.75rem; font-weight:500;">${p.memory !== null ? p.memory + '% RAM' : escapeHtml(this.t('processes.memoryNa'))}</span>
            <button class="btn btn-sm" style="color: var(--accent-danger);" data-end-process="${escapeHtml(p.pid)}" data-process-name="${escapeHtml(p.name)}">${escapeHtml(this.t('processes.endProcess'))}</button>
          </div>
        </div>`;
    } else {
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="min-width:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <img class="process-icon" data-exe="${escapeHtml(rawPath || '')}" src="" alt="" style="width:20px;height:20px;flex-shrink:0;border-radius:3px;display:none;" />
            <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(p.name)} <span class="page-subtitle" style="font-size:0.85rem;">(PID ${escapeHtml(p.pid)})</span></div>
            ${locationBadge}
            <div class="path-chip" title="${escapeHtml(rawPath)}">${escapeHtml(shortPath)}</div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
            <div>
              <div class="risk-score" style="font-weight:600; font-size:1.1rem; color:${isDanger ? 'var(--accent-danger)' : 'var(--accent-success)'}">${escapeHtml(p.risk.score)} ${escapeHtml(this.t('processes.riskScoreSuffix'))}</div>
              <div class="risk-level page-subtitle" style="font-size:0.8rem; text-transform:uppercase;">${escapeHtml(p.risk.level)}</div>
            </div>
            <button class="btn btn-sm" style="color: var(--accent-danger);" data-end-process="${escapeHtml(p.pid)}" data-process-name="${escapeHtml(p.name)}">${escapeHtml(this.t('processes.endProcessFull'))}</button>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:8px; border-top:1px solid var(--glass-border); gap:12px; flex-wrap:wrap;">
          <div class="recommended-action" style="font-size:0.85rem; color:var(--accent-warning); flex:1; min-width:200px;">${escapeHtml(p.recommendedAction)}${reasonHint ? ` — ${escapeHtml(reasonHint)}` : ''}</div>
          <div style="display:flex; gap:16px; font-size:0.85rem; font-weight:500;">
            <span class="cpu-value">${p.cpu !== null ? p.cpu + '% CPU' : escapeHtml(this.t('processes.cpuNa'))}</span>
            <span class="memory-value">${p.memory !== null ? p.memory + '% RAM' : escapeHtml(this.t('processes.memoryNa'))}</span>
          </div>
        </div>`;
    }

    const blob = `${p.name || ''} ${rawPath} ${p.pid}`.toLowerCase();

    return {
      el: row,
      blob,
      score: p.risk.score,
      cpu: p.cpu ?? -1,
      memory: p.memory ?? -1,
      name: (p.name || '').toLowerCase(),
      riskScoreEl: row.querySelector('.risk-score'),
      riskLevelEl: row.querySelector('.risk-level'),
      recommendedEl: row.querySelector('.recommended-action'),
      cpuEl: row.querySelector('.cpu-value'),
      memoryEl: row.querySelector('.memory-value')
    };
  },

  _applyRowData(entry, p) {
    const isDanger = p.risk.score >= 35;
    const color = isDanger ? 'var(--accent-danger)' : 'var(--accent-success)';

    entry.el.style.borderLeftColor = color;
    if (entry.riskScoreEl) {
      entry.riskScoreEl.textContent = `${p.risk.score} ${this.t('processes.riskScoreSuffix')}`;
      entry.riskScoreEl.style.color = color;
    }
    if (entry.riskLevelEl) entry.riskLevelEl.textContent = p.risk.level;
    if (entry.recommendedEl) {
      const reasonHint = this._reasonHint(p);
      entry.recommendedEl.textContent = reasonHint
        ? `${p.recommendedAction} — ${reasonHint}`
        : (p.recommendedAction || '');
    }
    if (entry.cpuEl) entry.cpuEl.textContent = p.cpu !== null ? `${p.cpu}% CPU` : this.t('processes.cpuNa');
    if (entry.memoryEl) entry.memoryEl.textContent = p.memory !== null ? `${p.memory}% RAM` : this.t('processes.memoryNa');

    entry.score = p.risk.score;
    entry.cpu = p.cpu ?? -1;
    entry.memory = p.memory ?? -1;
  },

  sortRows(container) {
    if (!this._rowIndex || !this._listWrapper) return;
    if (!container) return;
    const sortSelect = container.querySelector('#sortBy');
    if (sortSelect) sortSelect.value = this._sortBy;

    let pids = this._order.slice();
    const comparators = {
      'risk-desc': (a, b) => this._rowIndex.get(b).score - this._rowIndex.get(a).score,
      'cpu-desc': (a, b) => this._rowIndex.get(b).cpu - this._rowIndex.get(a).cpu,
      'memory-desc': (a, b) => this._rowIndex.get(b).memory - this._rowIndex.get(a).memory,
      'name-asc': (a, b) => this._rowIndex.get(a).name.localeCompare(this._rowIndex.get(b).name)
    };
    const comparator = comparators[this._sortBy];
    if (comparator) pids.sort(comparator);

    const frag = document.createDocumentFragment();
    pids.forEach((pid) => frag.appendChild(this._rowIndex.get(pid).el));
    this._listWrapper.insertBefore(frag, this._noResultsEl);
  },

  async handleEndProcessClick(e, container) {
    const btn = e.target.closest('[data-end-process]');
    if (!btn) return;
    const pid = Number(btn.dataset.endProcess);
    const name = btn.dataset.processName;
    if (!window.confirm(this.t('processes.confirmEnd', { name, pid }))) return;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = this.t('processes.ending');
    try {
      const res = await window.api.invoke('process:kill', pid);
      if (res && res.success) this.load(container);
      else { alert(this.t('processes.failedEnd', { error: res && res.error ? res.error : this.t('common.unknownError') })); btn.disabled = false; btn.textContent = originalLabel; }
    } catch (err) { alert(this.t('processes.failedEnd', { error: err.message || String(err) })); btn.disabled = false; btn.textContent = originalLabel; }
  },

  applyFilter(container) {
    const listEl = container.querySelector('#processList');
    if (!listEl) return;
    const countEl = container.querySelector('#processCount');
    if (!this._rowIndex) return;
    const riskFilterEl = container.querySelector('#riskFilter');
    if (riskFilterEl) riskFilterEl.value = this._riskFilter;

    const query = this._query.trim().toLowerCase();
    let totalMatches = 0;

    this._rowIndex.forEach(({ el, blob, score }) => {
      const matchesQuery = !query || blob.includes(query);
      const matchesRisk = this._riskFilter === 'high' ? score >= 35 : this._riskFilter === 'normal' ? score < 35 : true;
      const matches = matchesQuery && matchesRisk;
      el.style.display = matches ? '' : 'none';
      if (matches) totalMatches += 1;
    });

    if (this._noResultsEl) this._noResultsEl.style.display = (this._all.length > 0 && totalMatches === 0) ? '' : 'none';

    if (this._all.length === 0) listEl.innerHTML = `<div class="empty-state">${escapeHtml(this.t('processes.noProcesses'))}</div>`;
    else if (totalMatches === 0) countEl.textContent = this.t('processes.countNoMatch', { query: this._query });
    else countEl.textContent = this.t('processes.count', { count: totalMatches });
  },

  toggleCompactView(container) {
    this._compactView = !this._compactView;
    const btn = container.querySelector('#compactToggle');
    if (btn) btn.textContent = this._compactView ? this.t('processes.expand') : this.t('processes.compact');
    this._rowIndex = new Map();
    this._order = [];
    this._listWrapper = null;
    this.buildRows(container);
    this.sortRows(container);
    this.applyFilter(container);
  },

  destroy() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    this._all = []; this._query = ''; this._riskFilter = 'all'; this._sortBy = 'default';
    this._rowIndex = null; this._order = []; this._delegated = false;
    this._listWrapper = null; this._noResultsEl = null; this._cpuHistory = [];
  }
};