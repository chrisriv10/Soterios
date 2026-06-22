window.Pages = window.Pages || {};

window.Pages.scanner = {
  selectedPath: null,
  lastResults: null,

  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">File Scanner</h1>
        <div class="page-subtitle">Hash files and check them against the local signature database, plus run heuristics</div>
      </div>

      <div class="panel" style="margin-bottom:18px;">
        <div class="panel-title">Target Folder</div>
        <div class="path-picker">
          <input type="text" id="scanPath" placeholder="No folder selected" readonly value="${escapeHtml(this.selectedPath || '')}" />
          <button class="btn" id="browseBtn">Browse…</button>
          <button class="btn btn-primary" id="scanBtn" ${this.selectedPath ? '' : 'disabled'}>Run Scan</button>
        </div>
        <div id="scanProgress" style="margin-top:10px; font-size:11.5px; color: var(--text-dim);"></div>
      </div>

      <div class="grid grid-4" id="scanSummaryTiles" style="display:none; margin-bottom:18px;"></div>

      <div class="panel">
        <div class="flex-between" style="margin-bottom:14px;">
          <div class="panel-title" style="margin-bottom:0;">Results</div>
          <div id="quarantineHint" style="font-size:11px; color: var(--text-dim);"></div>
        </div>
        <div class="log-surface" id="scanResults">
          <div class="empty-state">Select a folder and run a scan to see results here.</div>
        </div>
      </div>
    `;

    container.querySelector('#browseBtn').addEventListener('click', () => this.browse(container));
    container.querySelector('#scanBtn').addEventListener('click', () => this.runScan(container));

    if (this.lastResults) {
      this.renderResults(container, this.lastResults);
    }
  },

  async browse(container) {
    const path = await Api.pickFolder();
    if (!path) return;
    this.selectedPath = path;
    container.querySelector('#scanPath').value = path;
    container.querySelector('#scanBtn').disabled = false;
  },

  async runScan(container) {
    const scanBtn = container.querySelector('#scanBtn');
    const progressEl = container.querySelector('#scanProgress');
    const resultsEl = container.querySelector('#scanResults');

    setButtonLoading(scanBtn, true, 'Scanning…');
    resultsEl.innerHTML = '<div class="empty-state">Scanning…</div>';

    const unsubscribe = Api.onToolProgress('file-scanner', (payload) => {
      progressEl.textContent = `Scanned ${payload.scanned}/${payload.total} — ${payload.currentFile}`;
    });

    try {
      const data = await Api.runTool('file-scanner', { path: this.selectedPath });
      this.lastResults = data;
      window.AppState.lastScanSummary = data.summary;
      progressEl.textContent = 'Scan complete.';
      this.renderResults(container, data);
    } catch (err) {
      showToolError(resultsEl, err);
    } finally {
      unsubscribe();
      setButtonLoading(scanBtn, false);
    }
  },

  renderResults(container, data) {
    const { summary, results } = data;
    const tiles = container.querySelector('#scanSummaryTiles');
    tiles.style.display = 'grid';
    tiles.innerHTML = `
      <div class="stat-tile"><div class="stat-label">Scanned</div><div class="stat-value">${summary.totalScanned}</div></div>
      <div class="stat-tile"><div class="stat-label">Clean</div><div class="stat-value ok">${summary.clean}</div></div>
      <div class="stat-tile"><div class="stat-label">Suspicious</div><div class="stat-value warn">${summary.suspicious}</div></div>
      <div class="stat-tile"><div class="stat-label">Matches</div><div class="stat-value danger">${summary.matches}</div></div>
    `;

    const resultsEl = container.querySelector('#scanResults');
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state">No files found in this folder.</div>';
      return;
    }

    // Show flagged items first (matches, then suspicious), then a capped
    // number of clean entries so huge scans don't choke the DOM.
    const matches = results.filter((r) => r.status === 'match');
    const suspicious = results.filter((r) => r.status === 'suspicious');
    const errors = results.filter((r) => r.status === 'error');
    const clean = results.filter((r) => r.status === 'clean').slice(0, 200);

    const rows = [...matches, ...suspicious, ...errors, ...clean]
      .map((r) => this.renderRow(r))
      .join('');

    resultsEl.innerHTML = rows;

    resultsEl.querySelectorAll('[data-quarantine-path]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const path = btn.dataset.quarantinePath;
        btn.disabled = true;
        btn.textContent = 'Quarantining…';
        try {
          await Api.runTool('quarantine-file', { path });
          btn.textContent = 'Quarantined';
        } catch (err) {
          btn.textContent = 'Failed';
        }
      });
    });
  },

  renderRow(r) {
    const tagClass = r.status;
    const tagLabel = r.status.toUpperCase();
    let detail = '';
    if (r.status === 'match') {
      detail = `matched signature "${escapeHtml(r.signatureName)}"`;
    } else if (r.status === 'suspicious') {
      detail = escapeHtml((r.flags || []).join('; '));
    } else if (r.status === 'error') {
      detail = escapeHtml(r.error || r.reason || '');
    }

    const quarantineBtn = (r.status === 'match' || r.status === 'suspicious')
      ? `<button class="btn btn-sm btn-danger" data-quarantine-path="${escapeHtml(r.path)}" style="margin-left:auto; flex-shrink:0;">Quarantine</button>`
      : '';

    return `
      <div class="log-row">
        <span class="log-tag ${tagClass}">${tagLabel}</span>
        <span class="log-path">${escapeHtml(r.path)}${detail ? ' — ' + detail : ''}</span>
        ${quarantineBtn}
      </div>
    `;
  }
};
