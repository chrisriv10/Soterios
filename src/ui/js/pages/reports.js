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

function tFactory() {
  return (key, vars) => window.I18n?.t(key, vars) ?? key;
}

window.Pages.reports = {
  _currentScanReportId: null,
  _currentSecurityReportPath: null,
  _lastExportPath: null,

  render(container) {
    const t = tFactory();
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${escapeHtml(t('reports.title'))}</h1>
          <div class="page-subtitle">${escapeHtml(t('reports.subtitle'))}</div>
        </div>
      </div>

      <div class="reports-layout">
        <section class="panel report-browser">
          <div class="panel-title">${escapeHtml(t('reports.scanReports'))}</div>
          <div id="scanReportHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingScanReports'))}</div></div>

          <div class="panel-title" style="margin-top:18px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
            ${escapeHtml(t('reports.savedReports'))}
            <button class="btn btn-primary btn-sm" id="generateReport">${escapeHtml(t('reports.generateReport'))}</button>
          </div>
          <div id="reportHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingSavedReports'))}</div></div>
        </section>

        <section class="panel report-viewer">
          <div class="flex-between">
            <div>
              <div class="panel-title">${escapeHtml(t('reports.reportViewer'))}</div>
              <div id="reportViewerTitle" class="history-title">${escapeHtml(t('reports.selectReport'))}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="btn btn-sm" id="exportReportPdf" style="display:none;">${escapeHtml(t('reports.exportPdf'))}</button>
              <button class="btn btn-sm" id="exportReportCsv" style="display:none;">${escapeHtml(t('reports.exportCsv'))}</button>
              <button class="btn btn-sm" id="closeReportViewer" style="display:none;">${escapeHtml(t('reports.close'))}</button>
            </div>
          </div>
          <div id="exportReportToast" style="display:none; margin:10px 0; padding:10px 12px; border-radius:8px; background:var(--bg-surface); border:1px solid var(--glass-border); font-size:0.85rem;"></div>
          <div id="reportResult" class="empty-state">${escapeHtml(t('reports.chooseReport'))}</div>
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
    this._currentSecurityReportPath = null;
    this._lastExportPath = null;
    container.querySelector('#reportViewerTitle').textContent = tFactory()('reports.selectReport');
    container.querySelector('#closeReportViewer').style.display = 'none';
    container.querySelector('#exportReportPdf').style.display = 'none';
    container.querySelector('#exportReportCsv').style.display = 'none';
    container.querySelector('#exportReportToast').style.display = 'none';
    container.querySelector('#reportResult').className = 'empty-state';
    container.querySelector('#reportResult').innerHTML = tFactory()('reports.chooseReport');
  },

  setScanReportViewer(container, report) {
    this._currentScanReportId = report.id;
    this._currentSecurityReportPath = null;
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

  setSecurityReportViewer(container, filePath, report) {
    this._currentScanReportId = null;
    this._currentSecurityReportPath = filePath;
    this._lastExportPath = null;
    container.querySelector('#exportReportPdf').style.display = 'inline-flex';
    container.querySelector('#exportReportCsv').style.display = 'inline-flex';
    container.querySelector('#exportReportToast').style.display = 'none';
    const t = tFactory();
    const title = (report && report.title) || t('reports.securityReport');
    this.showViewer(container, title, this.renderSecurityReport(report));
  },

  showExportToast(container, message, filePath) {
    this._lastExportPath = filePath;
    const toast = container.querySelector('#exportReportToast');
    const t = tFactory();
    toast.style.display = 'block';
    toast.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;">
        <span>${escapeHtml(message)}</span>
        <button class="btn btn-sm btn-primary" id="openExportedReport">${escapeHtml(t('common.open'))}</button>
      </div>`;
    toast.querySelector('#openExportedReport').addEventListener('click', async () => {
      const res = await Api.openPath(filePath);
      if (!res.success) alert(res.error || t('common.failed'));
    });
  },

  async exportCurrentReport(container, format) {
    const isSecurityReport = this._currentSecurityReportPath !== null;
    const reportId = isSecurityReport ? this._currentSecurityReportPath : this._currentScanReportId;
    if (!reportId) return;

    const btn = container.querySelector(format === 'pdf' ? '#exportReportPdf' : '#exportReportCsv');
    setButtonLoading(btn, true, tFactory()('common.exporting'));
    try {
      const channel = format === 'pdf' ? 'report:exportPDF' : 'report:exportCSV';
      const res = await window.api.invoke(channel, reportId, isSecurityReport ? 'security' : 'scan');
      if (!res.success) {
        alert(res.error || t('common.failed'));
        return;
      }
      const label = format === 'pdf' ? 'PDF' : 'CSV';
      this.showExportToast(container, `${label} ${t('reports.exportSuccess')}`, res.path);
    } finally {
      setButtonLoading(btn, false);
    }
  },

  showViewer(container, title, html) {
    container.querySelector('#reportViewerTitle').textContent = title;
    container.querySelector('#closeReportViewer').style.display = 'inline-flex';
    // Show export buttons if there's a current report (scan or security)
    if (this._currentScanReportId || this._currentSecurityReportPath) {
      container.querySelector('#exportReportPdf').style.display = 'inline-flex';
      container.querySelector('#exportReportCsv').style.display = 'inline-flex';
    } else {
      container.querySelector('#exportReportPdf').style.display = 'none';
      container.querySelector('#exportReportCsv').style.display = 'none';
      container.querySelector('#exportReportToast').style.display = 'none';
    }
    const result = container.querySelector('#reportResult');
    result.className = 'report-content';
    result.innerHTML = html;
  },

  renderScanReport(r) {
    const t = tFactory();
    const details = r.details || {};
    const threats = details.threats || [];
    const errors = details.errors || [];
    const targets = Array.isArray(r.target_paths) ? r.target_paths : [];
    return `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.scanStatus'))}</div><div class="stat-value ${r.status === 'completed' ? 'ok' : r.status === 'canceled' ? 'warn' : 'danger'}">${escapeHtml(r.status)}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.filesScanned'))}</div><div class="stat-value">${escapeHtml(r.files_scanned)}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.threatsFound'))}</div><div class="stat-value ${r.threats_found ? 'danger' : 'ok'}">${escapeHtml(r.threats_found)}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.duration'))}</div><div class="stat-value">${Math.round((r.duration_ms || 0) / 1000)}s</div></div>
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.targets'))}</div><pre>${escapeHtml(targets.join('\n') || t('reports.noTargets'))}</pre></div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.threatDetails'))}</div>
        ${threats.length ? threats.map((th) => `<div class="log-row"><span class="log-tag match">${escapeHtml(t('common.threat'))}</span><span class="log-path">${escapeHtml(th.name || t('common.threat'))} - ${escapeHtml(th.path || '')}</span></div>`).join('') : `<div class="empty-state compact-empty">${escapeHtml(t('reports.noThreats'))}</div>`}
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.errorsNotes'))}</div>
        ${errors.length ? errors.map((e) => `<div class="log-row"><span class="log-tag warn">${escapeHtml(t('common.note'))}</span><span class="log-path">${escapeHtml(e)}</span></div>`).join('') : `<div class="empty-state compact-empty">${escapeHtml(t('reports.noErrors'))}</div>`}
      </div>`;
  },

  renderSecurityReport(report) {
    const t = tFactory();
    const overview = report.overview || {};
    const recommendations = report.recommendations || overview.recommendations || [];
    return `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.app'))}</div><div class="stat-value">${escapeHtml((report.app && report.app.name) || 'Soterios')}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.version'))}</div><div class="stat-value">${escapeHtml((report.app && report.app.version) || '')}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.score'))}</div><div class="stat-value ${escapeHtml(overview.level || '')}">${escapeHtml(overview.score ?? 'N/A')}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.generated'))}</div><div class="stat-value small">${escapeHtml(report.generatedAt ? new Date(report.generatedAt).toLocaleString() : '')}</div></div>
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.recommendations'))}</div>
        ${recommendations.length ? recommendations.map((i) => `<div class="log-row"><span class="log-tag ${i.level === 'danger' ? 'match' : i.level === 'warn' ? 'warn' : 'clean'}">${escapeHtml(i.level)}</span><span class="log-path"><strong>${escapeHtml(i.title)}</strong><br>${escapeHtml(i.detail || '')}</span></div>`).join('') : `<div class="empty-state compact-empty">${escapeHtml(t('reports.noRecommendations'))}</div>`}
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.systemSnapshot'))}</div>${renderSystemSnapshot(report.system)}</div>`;
  },

  async generate(container) {
    this._currentScanReportId = null;
    this._currentSecurityReportPath = null;
    const btn = container.querySelector('#generateReport');
    setButtonLoading(btn, true, tFactory()('reports.generating'));
    try {
      const appInfo = await Api.getAppInfo();
      const data = await Api.runTool('generate-security-report', { version: appInfo.version });
      const reportPath = data.path;
      this.setSecurityReportViewer(container, reportPath, data.report);
      this.listReports(container);
    } catch (err) {
      const t = tFactory();
      this.showViewer(container, t('reports.reportError'), `<div class="empty-state">${escapeHtml(t('reports.errorPrefix', { error: err.message }))}</div>`);
    } finally {
      setButtonLoading(btn, false);
    }
  },

  async listScanReports(container) {
    const el = container.querySelector('#scanReportHistory');
    try {
      const reports = await window.api.invoke('scanReports:list', 25);
      if (!reports.length) {
        el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.noScanReports'))}</div>`;
        return;
      }
      el.innerHTML = reports.map((r) => {
        const statusClass = r.status === 'completed' ? 'clean' : r.status === 'canceled' ? 'warn' : 'match';
        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(r.scan_type)} scan <span class="log-tag ${statusClass}">${escapeHtml(r.status)}</span></div>
              <div class="history-meta">${escapeHtml(parseUtcTimestamp(r.timestamp).toLocaleString())} | ${r.files_scanned} ${escapeHtml(tFactory()('common.files'))}, ${r.threats_found} ${escapeHtml(tFactory()('common.threats'))}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm open-scan-report" data-id="${escapeHtml(r.id)}">${escapeHtml(tFactory()('reports.view'))}</button>
              <button class="btn btn-sm delete-scan-report" data-id="${escapeHtml(r.id)}">${escapeHtml(tFactory()('reports.delete'))}</button>
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
          if (!res.success) alert(res.error || tFactory()('reports.failedDelete'));
          this.listScanReports(container);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.errorPrefix', { error: err.message }))}</div>`;
    }
  },

  groupReportFiles(files) {
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
      if (new Date(f.mtime) > new Date(group.mtime)) group.mtime = f.mtime;
    });

    return Array.from(groups.values()).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  },

  formatReportTitle(mtime) {
    const t = tFactory();
    const date = new Date(mtime);
    if (Number.isNaN(date.getTime())) return t('reports.securityReport');
    const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${t('reports.securityReport')} · ${datePart} at ${timePart}`;
  },

  async listReports(container) {
    const el = container.querySelector('#reportHistory');
    try {
      const files = await window.api.invoke('reports:list');
      if (!files.length) {
        el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.noSavedReports'))}</div>`;
        return;
      }
      const groups = this.groupReportFiles(files);

      el.innerHTML = groups.map((g) => {
        const jsonFile = g.files.json;
        const htmlFile = g.files.html;
        const viewButtons = [
          jsonFile ? `<button class="btn btn-sm open-report" data-path="${escapeHtml(jsonFile.path)}">${escapeHtml(tFactory()('reports.view'))}</button>` : '',
          htmlFile ? `<button class="btn btn-sm open-report-html" data-path="${escapeHtml(htmlFile.path)}">${escapeHtml(tFactory()('reports.openHtml'))}</button>` : ''
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
              <button class="btn btn-sm delete-report" data-paths="${escapeHtml(deletePaths)}">${escapeHtml(tFactory()('reports.delete'))}</button>
            </div>
          </div>`;
      }).join('');

      el.querySelectorAll('.open-report').forEach(btn => {
        btn.addEventListener('click', async () => {
          this._currentScanReportId = null;
          this._currentSecurityReportPath = btn.dataset.path;
          const res = await window.api.invoke('reports:read', btn.dataset.path);
          if (!res.success) { alert(res.error || tFactory()('reports.failedRead')); return; }
          const entry = groups.find((g) => g.files.json && g.files.json.path === btn.dataset.path);
          const title = entry ? this.formatReportTitle(entry.mtime) : btn.dataset.path.split('\\').pop();
          if (res.type === 'json') this.showViewer(container, title, this.renderSecurityReport(res.data));
          else this.showViewer(container, title, `<div class="report-section"><pre>${escapeHtml(res.text || tFactory()('reports.noReadableContent'))}</pre></div>`);
        });
      });
      el.querySelectorAll('.open-report-html').forEach(btn => {
        btn.addEventListener('click', async () => {
          this._currentScanReportId = null;
          const res = await window.api.invoke('reports:read', btn.dataset.path);
          if (!res.success) { alert(res.error || tFactory()('reports.failedRead')); return; }
          const entry = groups.find((g) => g.files.html && g.files.html.path === btn.dataset.path);
          const title = entry ? this.formatReportTitle(entry.mtime) : btn.dataset.path.split('\\').pop();
          this.showViewer(container, title, `<div class="report-section"><pre>${escapeHtml(res.text || tFactory()('reports.noReadableContent'))}</pre></div>`);
        });
      });
      el.querySelectorAll('.delete-report').forEach(btn => {
        btn.addEventListener('click', async () => {
          const paths = btn.dataset.paths.split('|').filter(Boolean);
          for (const p of paths) {
            const res = await window.api.invoke('reports:delete', p);
            if (!res.success) { alert(res.error || tFactory()('reports.failedDeleteReport')); break; }
          }
          this.listReports(container);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.errorPrefix', { error: err.message }))}</div>`;
    }
  }
};