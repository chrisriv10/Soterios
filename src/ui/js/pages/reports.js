window.Pages = window.Pages || {};

function parseUtcTimestamp(value) {
  if (!value) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }
  return new Date(value);
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSnapshotPrimitive(value) {
  if (value === null || value === undefined || value === '') return '<span class="page-subtitle">Not available</span>';
  if (typeof value === 'boolean') {
    return `<span class="log-tag ${value ? 'clean' : 'match'}">${value ? 'Yes' : 'No'}</span>`;
  }
  return escapeHtml(String(value));
}

function renderSnapshotValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="page-subtitle">None</span>';
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return `<ul style="margin:4px 0 0 18px; padding:0;">${value.map((v) => `<li>${formatSnapshotPrimitive(v)}</li>`).join('')}</ul>`;
    }
    return value.map((v) => `<div style="margin-top:6px; padding:8px; background:var(--bg-surface); border-radius:6px;">${renderSnapshotObject(v)}</div>`).join('');
  }
  if (value !== null && typeof value === 'object') {
    return renderSnapshotObject(value);
  }
  return formatSnapshotPrimitive(value);
}

function renderSnapshotObject(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '<span class="page-subtitle">No data.</span>';
  return `<div style="display:flex; flex-direction:column; gap:6px;">
    ${entries.map(([key, value]) => `
      <div style="display:flex; justify-content:space-between; gap:12px; font-size:0.85rem;">
        <span class="page-subtitle" style="flex-shrink:0;">${escapeHtml(humanizeKey(key))}</span>
        <span style="text-align:right;">${renderSnapshotValue(value)}</span>
      </div>`).join('')}
  </div>`;
}

function renderSystemSnapshot(system) {
  const entries = Object.entries(system || {});
  if (!entries.length) return '<div class="empty-state compact-empty">No system information recorded.</div>';
  return `<div class="report-stats" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));">
    ${entries.map(([key, value]) => `
      <div class="stat-tile" style="text-align:left;">
        <div class="stat-label">${escapeHtml(humanizeKey(key))}</div>
        <div style="margin-top:8px;">${renderSnapshotValue(value)}</div>
      </div>`).join('')}
  </div>`;
}

window.Pages.reports = {
  _currentScanReportId: null,
  _lastExportPath: null,

  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Reports</h1>
          <div class="page-subtitle">Browse scan and security reports</div>
        </div>
      </div>

      <div class="reports-layout">
        <section class="panel report-browser">
          <div class="panel-title">Scan Reports</div>
          <div id="scanReportHistory" class="history-list"><div class="empty-state">Loading scan reports...</div></div>

          <div class="panel-title" style="margin-top:18px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
            Saved Security Reports
            <button class="btn btn-primary btn-sm" id="generateReport">Generate Security Report</button>
          </div>
          <div id="reportHistory" class="history-list"><div class="empty-state">Loading saved reports...</div></div>
        </section>

        <section class="panel report-viewer">
          <div class="flex-between">
            <div>
              <div class="panel-title">Report Viewer</div>
              <div id="reportViewerTitle" class="history-title">Select a report</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="btn btn-sm" id="exportReportPdf" style="display:none;">Export as PDF</button>
              <button class="btn btn-sm" id="exportReportCsv" style="display:none;">Export as CSV</button>
              <button class="btn btn-sm" id="closeReportViewer" style="display:none;">Close</button>
            </div>
          </div>
          <div id="exportReportToast" style="display:none; margin:10px 0; padding:10px 12px; border-radius:8px; background:var(--bg-surface); border:1px solid var(--glass-border); font-size:0.85rem;"></div>
          <div id="reportResult" class="empty-state">Choose a report from the list to view its details.</div>
        </section>
      </div>
    `;

    container.querySelector('#generateReport').addEventListener('click', () => this.generate(container));
    container.querySelector('#closeReportViewer').addEventListener('click', () => this.clearViewer(container));
    container.querySelector('#exportReportPdf').addEventListener('click', () => this.exportCurrentReport(container, 'pdf'));
    container.querySelector('#exportReportCsv').addEventListener('click', () => this.exportCurrentReport(container, 'csv'));
    this.listScanReports(container);
    this.listReports(container);
  },

  clearViewer(container) {
    this._currentScanReportId = null;
    this._lastExportPath = null;
    container.querySelector('#reportViewerTitle').textContent = 'Select a report';
    container.querySelector('#closeReportViewer').style.display = 'none';
    container.querySelector('#exportReportPdf').style.display = 'none';
    container.querySelector('#exportReportCsv').style.display = 'none';
    container.querySelector('#exportReportToast').style.display = 'none';
    container.querySelector('#reportResult').className = 'empty-state';
    container.querySelector('#reportResult').innerHTML = 'Choose a report from the list to view its details without leaving the app.';
  },

  setScanReportViewer(container, report) {
    this._currentScanReportId = report.id;
    this._lastExportPath = null;
    container.querySelector('#exportReportPdf').style.display = 'inline-flex';
    container.querySelector('#exportReportCsv').style.display = 'inline-flex';
    container.querySelector('#exportReportToast').style.display = 'none';
    this.showViewer(
      container,
      `${report.scan_type} scan - ${parseUtcTimestamp(report.timestamp).toLocaleString()}`,
      this.renderScanReport(report)
    );
  },

  showExportToast(container, message, filePath) {
    this._lastExportPath = filePath;
    const toast = container.querySelector('#exportReportToast');
    toast.style.display = 'block';
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;">
        <span>${escapeHtml(message)}</span>
        <button class="btn btn-sm btn-primary" id="openExportedReport">Open file</button>
      </div>`;
    toast.querySelector('#openExportedReport').addEventListener('click', async () => {
      const res = await Api.openPath(filePath);
      if (!res.success) alert(res.error || 'Unable to open file.');
    });
  },

  async exportCurrentReport(container, format) {
    if (!this._currentScanReportId) return;
    const btn = container.querySelector(format === 'pdf' ? '#exportReportPdf' : '#exportReportCsv');
    setButtonLoading(btn, true, 'Exporting...');
    try {
      const channel = format === 'pdf' ? 'report:exportPDF' : 'report:exportCSV';
      const res = await window.api.invoke(channel, this._currentScanReportId);
      if (!res.success) {
        alert(res.error || 'Export failed.');
        return;
      }
      const label = format === 'pdf' ? 'PDF' : 'CSV';
      this.showExportToast(container, `${label} export saved successfully.`, res.path);
    } finally {
      setButtonLoading(btn, false);
    }
  },

  showViewer(container, title, html) {
    container.querySelector('#reportViewerTitle').textContent = title;
    container.querySelector('#closeReportViewer').style.display = 'inline-flex';
    if (!this._currentScanReportId) {
      container.querySelector('#exportReportPdf').style.display = 'none';
      container.querySelector('#exportReportCsv').style.display = 'none';
      container.querySelector('#exportReportToast').style.display = 'none';
    }
    const result = container.querySelector('#reportResult');
    result.className = 'report-content';
    result.innerHTML = html;
  },

  renderScanReport(r) {
    const details = r.details || {};
    const threats = details.threats || [];
    const errors = details.errors || [];
    const targets = Array.isArray(r.target_paths) ? r.target_paths : [];
    return `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">Status</div><div class="stat-value ${r.status === 'completed' ? 'ok' : r.status === 'canceled' ? 'warn' : 'danger'}">${escapeHtml(r.status)}</div></div>
        <div class="stat-tile"><div class="stat-label">Files</div><div class="stat-value">${escapeHtml(r.files_scanned)}</div></div>
        <div class="stat-tile"><div class="stat-label">Threats</div><div class="stat-value ${r.threats_found ? 'danger' : 'ok'}">${escapeHtml(r.threats_found)}</div></div>
        <div class="stat-tile"><div class="stat-label">Duration</div><div class="stat-value">${Math.round((r.duration_ms || 0) / 1000)}s</div></div>
      </div>
      <div class="report-section"><div class="panel-title">Targets</div><pre>${escapeHtml(targets.join('\n') || 'No targets recorded.')}</pre></div>
      <div class="report-section"><div class="panel-title">Threat Details</div>
        ${threats.length ? threats.map((t) => `<div class="log-row"><span class="log-tag match">threat</span><span class="log-path">${escapeHtml(t.name || 'Threat')} - ${escapeHtml(t.path || '')}</span></div>`).join('') : '<div class="empty-state compact-empty">No threats found.</div>'}
      </div>
      <div class="report-section"><div class="panel-title">Errors and Notes</div>
        ${errors.length ? errors.map((e) => `<div class="log-row"><span class="log-tag warn">note</span><span class="log-path">${escapeHtml(e)}</span></div>`).join('') : '<div class="empty-state compact-empty">No scan errors recorded.</div>'}
      </div>`;
  },

  renderSecurityReport(report) {
    const overview = report.overview || {};
    const recommendations = report.recommendations || overview.recommendations || [];
    return `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">App</div><div class="stat-value">${escapeHtml((report.app && report.app.name) || 'Soterios')}</div></div>
        <div class="stat-tile"><div class="stat-label">Version</div><div class="stat-value">${escapeHtml((report.app && report.app.version) || '')}</div></div>
        <div class="stat-tile"><div class="stat-label">Score</div><div class="stat-value ${escapeHtml(overview.level || '')}">${escapeHtml(overview.score ?? 'N/A')}</div></div>
        <div class="stat-tile"><div class="stat-label">Generated</div><div class="stat-value small">${escapeHtml(report.generatedAt ? new Date(report.generatedAt).toLocaleString() : '')}</div></div>
      </div>
      <div class="report-section"><div class="panel-title">Recommendations</div>
        ${recommendations.length ? recommendations.map((i) => `<div class="log-row"><span class="log-tag ${i.level === 'danger' ? 'match' : i.level === 'warn' ? 'warn' : 'clean'}">${escapeHtml(i.level)}</span><span class="log-path"><strong>${escapeHtml(i.title)}</strong><br>${escapeHtml(i.detail || '')}</span></div>`).join('') : '<div class="empty-state compact-empty">No recommendations recorded.</div>'}
      </div>
      <div class="report-section"><div class="panel-title">System Snapshot</div>${renderSystemSnapshot(report.system)}</div>`;
  },

  async generate(container) {
    this._currentScanReportId = null;
    const btn = container.querySelector('#generateReport');
    setButtonLoading(btn, true, 'Generating...');
    try {
      const appInfo = await Api.getAppInfo();
      const data = await Api.runTool('generate-security-report', { version: appInfo.version });
      const title = (data.report && data.report.title) || 'Generated security report';
      this.showViewer(container, title, this.renderSecurityReport(data.report));
      this.listReports(container);
    } catch (err) {
      this.showViewer(container, 'Report error', `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`);
    } finally {
      setButtonLoading(btn, false);
    }
  },

  async listScanReports(container) {
    const el = container.querySelector('#scanReportHistory');
    try {
      const reports = await window.api.invoke('scanReports:list', 25);
      if (!reports.length) {
        el.innerHTML = '<div class="empty-state">No scan reports saved yet.</div>';
        return;
      }
      el.innerHTML = reports.map((r) => {
        const statusClass = r.status === 'completed' ? 'clean' : r.status === 'canceled' ? 'warn' : 'match';
        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(r.scan_type)} scan <span class="log-tag ${statusClass}">${escapeHtml(r.status)}</span></div>
              <div class="history-meta">${escapeHtml(parseUtcTimestamp(r.timestamp).toLocaleString())} | ${r.files_scanned} file(s), ${r.threats_found} threat(s)</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm open-scan-report" data-id="${escapeHtml(r.id)}">View</button>
              <button class="btn btn-sm delete-scan-report" data-id="${escapeHtml(r.id)}">Delete</button>
            </div>
          </div>`;
      }).join('');
      el.querySelectorAll('.open-scan-report').forEach((btn) => {
        btn.addEventListener('click', () => {
          const report = reports.find((r) => String(r.id) === String(btn.dataset.id));
          if (report) this.setScanReportViewer(container, report);
        });
      });
      el.querySelectorAll('.delete-scan-report').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await window.api.invoke('scanReports:delete', Number(btn.dataset.id));
          if (!res.success) alert(res.error || 'Unable to delete report.');
          this.listScanReports(container);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
    }
  },

  groupReportFiles(files) {
    // Files are written in pairs like soterios-report-<stamp>.json / .html.
    // Group them by stamp so each "report" shows as one friendly entry.
    const groups = new Map();

    files.forEach((f) => {
      const match = f.name.match(/soterios-report-(.+)\.(json|html)$/i);
      const key = match ? match[1] : f.name;
      const ext = match ? match[2].toLowerCase() : (f.name.split('.').pop() || '').toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { key, mtime: f.mtime, files: {} });
      }
      const group = groups.get(key);
      group.files[ext] = f;
      // Use the newest mtime among the pair for sorting/display.
      if (new Date(f.mtime) > new Date(group.mtime)) group.mtime = f.mtime;
    });

    return Array.from(groups.values()).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  },

  formatReportTitle(mtime) {
    const date = new Date(mtime);
    if (Number.isNaN(date.getTime())) return 'Security Report';
    const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `Security Report · ${datePart} at ${timePart}`;
  },

  async listReports(container) {
    const el = container.querySelector('#reportHistory');
    try {
      const files = await window.api.invoke('reports:list');
      if (!files.length) {
        el.innerHTML = '<div class="empty-state">No saved reports found.</div>';
        return;
      }
      const groups = this.groupReportFiles(files);

      el.innerHTML = groups.map((g) => {
        const jsonFile = g.files.json;
        const htmlFile = g.files.html;
        const viewButtons = [
          jsonFile ? `<button class="btn btn-sm open-report" data-path="${escapeHtml(jsonFile.path)}">View</button>` : '',
          htmlFile ? `<button class="btn btn-sm open-report-html" data-path="${escapeHtml(htmlFile.path)}">Open HTML</button>` : ''
        ].filter(Boolean).join('');
        const deletePaths = [jsonFile, htmlFile].filter(Boolean).map((f) => f.path).join('|');
        const rawNames = [jsonFile, htmlFile].filter(Boolean).map((f) => f.name).join(', ');

        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(this.formatReportTitle(g.mtime))}</div>
              <div class="history-meta">${escapeHtml(rawNames)}</div>
            </div>
            <div style="display:flex; gap:6px;">
              ${viewButtons}
              <button class="btn btn-sm delete-report" data-paths="${escapeHtml(deletePaths)}">Delete</button>
            </div>
          </div>`;
      }).join('');

      el.querySelectorAll('.open-report').forEach(btn => {
        btn.addEventListener('click', async () => {
          this._currentScanReportId = null;
          const res = await window.api.invoke('reports:read', btn.dataset.path);
          if (!res.success) { alert(res.error || 'Unable to read report.'); return; }
          const entry = groups.find((g) => g.files.json && g.files.json.path === btn.dataset.path);
          const title = entry ? this.formatReportTitle(entry.mtime) : btn.dataset.path.split('\\').pop();
          if (res.type === 'json') this.showViewer(container, title, this.renderSecurityReport(res.data));
          else this.showViewer(container, title, `<div class="report-section"><pre>${escapeHtml(res.text || 'No readable content.')}</pre></div>`);
        });
      });
      el.querySelectorAll('.open-report-html').forEach(btn => {
        btn.addEventListener('click', async () => {
          this._currentScanReportId = null;
          const res = await window.api.invoke('reports:read', btn.dataset.path);
          if (!res.success) { alert(res.error || 'Unable to read report.'); return; }
          const entry = groups.find((g) => g.files.html && g.files.html.path === btn.dataset.path);
          const title = entry ? this.formatReportTitle(entry.mtime) : btn.dataset.path.split('\\').pop();
          this.showViewer(container, title, `<div class="report-section"><pre>${escapeHtml(res.text || 'No readable content.')}</pre></div>`);
        });
      });
      el.querySelectorAll('.delete-report').forEach(btn => {
        btn.addEventListener('click', async () => {
          const paths = btn.dataset.paths.split('|').filter(Boolean);
          for (const p of paths) {
            const res = await window.api.invoke('reports:delete', p);
            if (!res.success) { alert(res.error || 'Unable to delete report.'); break; }
          }
          this.listReports(container);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
    }
  }
};