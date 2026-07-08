window.Pages = window.Pages || {};
window.Pages.processes = {
  REFRESH_INTERVAL_MS: 3000,
  _all: [],           // full dataset from last fetch
  _query: '',         // current search text (persists across refresh)
  _riskFilter: 'all', // 'all' | 'high' | 'normal'
  _sortBy: 'default', // 'default' | 'risk-desc' | 'cpu-desc' | 'memory-desc' | 'name-asc'
  _rowIndex: null,    // Map<pid, { el, blob, score, cpu, memory, name }>
  _order: [],         // pids in original fetch order
  _delegated: false,  // whether the click-delegation listener has been attached
  _refreshTimer: null,

  render(container) {
    // Clear any previous auto-refresh timer (e.g. if this page is re-rendered)
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }

    // render() rebuilds the page from scratch on every visit, which means
    // #processList is a brand-new DOM node each time. _delegated must be
    // reset here too, or buildRows() will skip re-attaching the click
    // listener to that new node (since the flag was already true from a
    // prior visit) and "End Process" buttons will silently stop working
    // after the first navigation away from and back to this page.
    this._delegated = false;

    container.innerHTML = `
      <div class="page-header"><div class="flex-between">
        <div><h1 class="page-title">Processes</h1><div class="page-subtitle">Running processes with risk scoring</div></div>
        <button class="btn" id="refreshBtn">Refresh</button></div></div>
        <div style="margin-top:12px; display:flex; align-items:center; gap:10px;">
          <input type="text" id="processSearch" placeholder="Search by name, path, or PID..."
            style="flex:1; max-width:360px; padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg,rgba(255,255,255,0.05)); color:inherit;">
          <select id="riskFilter" class="btn btn-sm">
            <option value="all">All Risk Levels</option>
            <option value="high">High Risk (&ge;35)</option>
            <option value="normal">Normal Risk (&lt;35)</option>
          </select>
          <select id="sortBy" class="btn btn-sm">
            <option value="default">Sort: Default</option>
            <option value="risk-desc">Risk (High to Low)</option>
            <option value="cpu-desc">CPU (High to Low)</option>
            <option value="memory-desc">Memory (High to Low)</option>
            <option value="name-asc">Name (A-Z)</option>
          </select>
          <div id="liveStats" style="display:flex; gap:16px; font-size:0.85rem; font-weight:500; white-space:nowrap;">
            <span>CPU: <strong id="liveCpu" style="color:var(--accent-success);">--</strong></span>
            <span>Memory: <strong id="liveMemory" style="color:var(--accent-success);">--</strong></span>
          </div>
          <span class="page-subtitle" id="processCount" style="font-size:0.85rem; white-space:nowrap; margin-left:auto;"></span>
        </div>
      </div>
      <div class="card" style="padding:0; flex:1; overflow-y:auto; contain:layout style; border:none; background:transparent;"><div id="processList" style="padding-right:8px;"><div class="empty-state"><span class="spinner"></span>&nbsp;Loading processes...</div></div></div>`;

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

    this.load(container, true);

    // Auto-refresh process list + CPU/memory totals in real time. Stops
    // itself if the page has been navigated away from (container removed).
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
    const scrollParent = listEl ? listEl.closest('.card') : null;
    const prevScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    // Only show the loading spinner on the very first load (or an explicit
    // manual refresh). Background refreshes update silently so the list
    // doesn't flicker every few seconds.
    if (isInitial) {
      listEl.innerHTML = '<div class="empty-state"><span class="spinner"></span>&nbsp;Loading processes...</div>';
    }
    try {
      const data = await Api.runTool('process-viewer', {});
      this._all = data.processes || [];
      this.updateLiveStats(container, data.totalCpu, this._all);
      this.buildRows(container);
      this.sortRows(container);
      this.applyFilter(container);

      // Restore scroll position so a background refresh doesn't yank the
      // user back to the top of a long process list.
      if (prevScrollTop && scrollParent) scrollParent.scrollTop = prevScrollTop;
    } catch (err) {
      if (isInitial) {
        showToolError(listEl, err);
      } else {
        console.error('Process refresh failed:', err);
      }
    }
  },

  _cpuHistory: [], // rolling window of recent CPU readings, for smoothing

  // Live CPU comes straight from systeminformation's si.currentLoad()
  // (the real system-wide figure, matching Task Manager), passed in from
  // processViewer.js as totalCpu -- NOT summed from the per-process list.
  // Per-process `cpu` values from si.processes() aren't guaranteed to add
  // up to true total utilization, which is why the live indicator used to
  // read 90-100% almost constantly regardless of actual load.
  //
  // Memory doesn't have this problem: RSS-as-%-of-total-RAM per process is
  // already a system-wide fraction, so summing it across processes still
  // reads accurately.
  updateLiveStats(container, totalCpuReading, processes) {
    const cpuEl = container.querySelector('#liveCpu');
    const memEl = container.querySelector('#liveMemory');
    if (!cpuEl || !memEl) return;

    const rawCpu = typeof totalCpuReading === 'number' && !Number.isNaN(totalCpuReading) ? totalCpuReading : 0;
    const normalizedCpu = Math.min(100, Math.max(0, rawCpu));

    this._cpuHistory.push(normalizedCpu);
    if (this._cpuHistory.length > 3) this._cpuHistory.shift();
    const totalCpu = this._cpuHistory.reduce((a, b) => a + b, 0) / this._cpuHistory.length;

    const totalMemory = Math.min(100, processes.reduce((sum, p) => sum + (typeof p.memory === 'number' ? p.memory : 0), 0));

    const colorFor = (pct) => pct >= 80 ? 'var(--accent-danger)' : pct >= 50 ? 'var(--accent-warning)' : 'var(--accent-success)';

    cpuEl.textContent = `${totalCpu.toFixed(1)}%`;
    cpuEl.style.color = colorFor(totalCpu);
    memEl.textContent = `${totalMemory.toFixed(1)}%`;
    memEl.style.color = colorFor(totalMemory);
  },

  // Builds/updates every row as a real DOM node (not innerHTML strings), so
  // that searching/filtering afterwards is just a show/hide toggle instead
  // of a full re-render + re-parse of HTML.
  //
  // Just as important: this DIFFS against the previous state instead of
  // tearing down and recreating the whole list every refresh. Rebuilding
  // 150+ fresh DOM nodes (with innerHTML re-parses and new content-visibility
  // containment boxes) every 3 seconds was the main remaining source of
  // scroll jank — any refresh tick landing mid-scroll caused a visible
  // stutter. Now an existing row's text is just updated in place; only
  // genuinely new processes get a new element, and only genuinely exited
  // ones get removed.
  buildRows(container) {
    const listEl = container.querySelector('#processList');

    // First-time setup (or if something else wiped out #processList, e.g.
    // an error state) — create the wrapper + "no results" placeholder once.
    if (!this._listWrapper || !listEl.contains(this._listWrapper)) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
      const noResults = document.createElement('div');
      noResults.className = 'empty-state';
      noResults.style.display = 'none';
      noResults.textContent = 'No processes match your search.';
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
      if (existing) {
        this._applyRowData(existing, p);
      } else {
        const entry = this._createRow(p);
        this._rowIndex.set(p.pid, entry);
        this._order.push(p.pid);
        this._listWrapper.insertBefore(entry.el, this._noResultsEl);
      }
    });

    // Remove rows for processes that have exited since the last refresh.
    if (this._order.length !== incomingPids.size || this._order.some((pid) => !incomingPids.has(pid))) {
      this._order = this._order.filter((pid) => {
        if (incomingPids.has(pid)) return true;
        const entry = this._rowIndex.get(pid);
        if (entry) entry.el.remove();
        this._rowIndex.delete(pid);
        return false;
      });
    }

    // One delegated listener for all "End Process" buttons, instead of
    // attaching a fresh listener per row on every load/refresh.
    if (!this._delegated) {
      listEl.addEventListener('click', (e) => this.handleEndProcessClick(e, container));
      this._delegated = true;
    }
  },

  // Creates a brand-new row for a process we haven't seen before. Keeps
  // references to the few pieces of text/color that change on refresh
  // (risk score/level, CPU%, memory%, recommended action, border color) so
  // later refreshes can update them directly via _applyRowData instead of
  // rebuilding the row.
  _createRow(p) {
    const rawPath = p.path || p.cmd || '';
    const shortPath = truncatePath(rawPath || 'Path unavailable', 56);
    const isDanger = p.risk.score >= 35;

    const row = document.createElement('div');
    row.className = 'list-row';
    row.style.cssText = `display:flex; flex-direction:column; gap:8px; padding:16px; border-left: 4px solid ${isDanger ? 'var(--accent-danger)' : 'var(--accent-success)'}; content-visibility:auto; contain-intrinsic-size: 0 160px;`;
    row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(p.name)} <span class="page-subtitle" style="font-size:0.85rem;">(PID ${escapeHtml(p.pid)})</span></div>
            <div class="path-chip" title="${escapeHtml(rawPath)}">${escapeHtml(shortPath)}</div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
            <div>
              <div class="risk-score" style="font-weight:600; font-size:1.1rem; color:${isDanger ? 'var(--accent-danger)' : 'var(--accent-success)'}">${escapeHtml(p.risk.score)} Risk</div>
              <div class="risk-level page-subtitle" style="font-size:0.8rem; text-transform:uppercase;">${escapeHtml(p.risk.level)}</div>
            </div>
            <button class="btn btn-sm" style="color: var(--accent-danger);" data-end-process="${escapeHtml(p.pid)}" data-process-name="${escapeHtml(p.name)}">End Process</button>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:8px; border-top:1px solid var(--glass-border);">
          <div class="recommended-action" style="font-size:0.85rem; color:var(--accent-warning);">${escapeHtml(p.recommendedAction)}</div>
          <div style="display:flex; gap:16px; font-size:0.85rem; font-weight:500;">
            <span class="cpu-value">${p.cpu !== null ? p.cpu + '% CPU' : 'CPU n/a'}</span>
            <span class="memory-value">${p.memory !== null ? p.memory + '% RAM' : 'RAM n/a'}</span>
          </div>
        </div>`;

    // Precompute a lowercase search blob once, instead of on every keystroke.
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

  // Updates an existing row's changing bits (risk score/level, CPU%,
  // memory%, recommended action, border color) in place via textContent —
  // no innerHTML, no re-parsing, no layout thrash beyond what these few
  // text/color changes actually require.
  _applyRowData(entry, p) {
    const isDanger = p.risk.score >= 35;
    const color = isDanger ? 'var(--accent-danger)' : 'var(--accent-success)';

    entry.el.style.borderLeftColor = color;
    if (entry.riskScoreEl) {
      entry.riskScoreEl.textContent = `${p.risk.score} Risk`;
      entry.riskScoreEl.style.color = color;
    }
    if (entry.riskLevelEl) entry.riskLevelEl.textContent = p.risk.level;
    if (entry.recommendedEl) entry.recommendedEl.textContent = p.recommendedAction;
    if (entry.cpuEl) entry.cpuEl.textContent = p.cpu !== null ? `${p.cpu}% CPU` : 'CPU n/a';
    if (entry.memoryEl) entry.memoryEl.textContent = p.memory !== null ? `${p.memory}% RAM` : 'RAM n/a';

    entry.score = p.risk.score;
    entry.cpu = p.cpu ?? -1;
    entry.memory = p.memory ?? -1;
    // name/path/pid are treated as immutable for a given pid's lifetime, so
    // entry.blob/entry.name (used by search) don't need updating here.
  },

  // Reorders the existing row elements in place (appendChild moves nodes,
  // it doesn't clone/re-render them), so switching sort order is cheap.
  sortRows(container) {
    if (!this._rowIndex || !this._listWrapper) return;
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
    if (!window.confirm(`End process "${name}" (PID ${pid})? Unsaved work in this process will be lost, and ending the wrong process can cause instability.`)) return;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Ending...';
    try {
      const res = await window.api.invoke('process:kill', pid);
      if (res && res.success) {
        this.load(container);
      } else {
        alert('Failed to end process: ' + (res && res.error ? res.error : 'Unknown error.'));
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    } catch (err) {
      alert('Failed to end process: ' + (err.message || String(err)));
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  },

  // Show/hide pre-built rows based on the current search query and risk
  // filter. No HTML is rebuilt or re-parsed here, which is what keeps this
  // fast while typing.
  applyFilter(container) {
    const listEl = container.querySelector('#processList');
    const countEl = container.querySelector('#processCount');
    if (!this._rowIndex) return;

    const riskFilterEl = container.querySelector('#riskFilter');
    if (riskFilterEl) riskFilterEl.value = this._riskFilter;

    const query = this._query.trim().toLowerCase();
    let totalMatches = 0;

    this._rowIndex.forEach(({ el, blob, score }) => {
      const matchesQuery = !query || blob.includes(query);
      const matchesRisk =
        this._riskFilter === 'high' ? score >= 35 :
        this._riskFilter === 'normal' ? score < 35 :
        true;
      const matches = matchesQuery && matchesRisk;
      el.style.display = matches ? '' : 'none';
      if (matches) totalMatches += 1;
    });

    if (this._noResultsEl) {
      this._noResultsEl.style.display = (this._all.length > 0 && totalMatches === 0) ? '' : 'none';
    }

    if (this._all.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No processes returned.</div>';
    } else if (totalMatches === 0) {
      countEl.textContent = `No matches for "${this._query}"`;
    } else {
      countEl.textContent = `${totalMatches} process${totalMatches === 1 ? '' : 'es'}`;
    }
  }
};