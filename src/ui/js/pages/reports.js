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
          <div class="panel-title report-section-toggle report-section-toggle--single-action" data-collapse-target="scanReportHistory" role="button" tabindex="0" aria-expanded="true">
            <span class="report-section-label">${escapeHtml(t('reports.scanReports'))}</span>
            <span class="report-section-clear-slot"><button class="btn btn-xs btn-ghost report-clear-button hidden" id="clearAllScanReports">${escapeHtml(t('reports.clearAllScanReports'))}</button></span>
            <span class="report-section-extra-slot" aria-hidden="true"></span>
            <span class="report-section-chevron" aria-hidden="true"></span>
          </div>
          <div id="scanReportHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingScanReports'))}</div></div>

          <div class="panel-title report-section-toggle report-section-toggle--spaced" data-collapse-target="reportHistory" role="button" tabindex="0" aria-expanded="true">
            <span class="report-section-label">${escapeHtml(t('reports.savedReports'))}</span>
            <span class="report-section-clear-slot"><button class="btn btn-xs btn-ghost report-clear-button hidden" id="clearAllSavedReports">${escapeHtml(t('reports.clearAllSavedReports'))}</button></span>
            <span class="report-section-extra-slot"><button class="btn btn-primary btn-sm report-generate-button" id="generateReport">${escapeHtml(t('reports.generateReport'))}</button></span>
            <span class="report-section-chevron" aria-hidden="true"></span>
          </div>
          <div id="reportHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingSavedReports'))}</div></div>

          <div class="panel-title report-section-toggle report-section-toggle--spaced report-section-toggle--single-action" data-collapse-target="maintenanceHistory" role="button" tabindex="0" aria-expanded="true">
            <span class="report-section-label">${escapeHtml(t('reports.maintenanceHistory'))}</span>
            <span class="report-section-clear-slot"><button class="btn btn-xs btn-ghost report-clear-button hidden" id="clearAllManualMaintenance">${escapeHtml(t('reports.clearAllMaintenance'))}</button></span>
            <span class="report-section-extra-slot" aria-hidden="true"></span>
            <span class="report-section-chevron" aria-hidden="true"></span>
          </div>
          <div id="maintenanceHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingMaintenance'))}</div></div>

          <div class="panel-title report-section-toggle report-section-toggle--spaced report-section-toggle--single-action" data-collapse-target="scheduledMaintenanceHistory" role="button" tabindex="0" aria-expanded="true">
            <span class="report-section-label">${escapeHtml(t('reports.scheduledMaintenanceHistory'))}</span>
            <span class="report-section-clear-slot"><button class="btn btn-xs btn-ghost report-clear-button hidden" id="clearAllScheduledMaintenance">${escapeHtml(t('reports.clearAllScheduledMaintenance'))}</button></span>
            <span class="report-section-extra-slot" aria-hidden="true"></span>
            <span class="report-section-chevron" aria-hidden="true"></span>
          </div>
          <div id="scheduledMaintenanceHistory" class="history-list"><div class="empty-state">${escapeHtml(t('reports.loadingMaintenance'))}</div></div>
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

    // Clear All buttons
    const clearAllScanBtn = container.querySelector('#clearAllScanReports');
    if (clearAllScanBtn) {
      clearAllScanBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleClearAll(container, 'scanReports:deleteAll', 'reports.clearAllScanReportsConfirm', () => this.listScanReports(container));
      });
    }
    const clearAllSavedBtn = container.querySelector('#clearAllSavedReports');
    if (clearAllSavedBtn) {
      clearAllSavedBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleClearAll(container, 'reports:deleteAll', 'reports.clearAllSavedReportsConfirm', () => this.listReports(container));
      });
    }
    const clearAllManualBtn = container.querySelector('#clearAllManualMaintenance');
    if (clearAllManualBtn) {
      clearAllManualBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleClearAll(container, 'maintenance:deleteAllManual', 'reports.clearAllMaintenanceConfirm', () => this.listManualMaintenanceHistory(container));
      });
    }
    const clearAllScheduledBtn = container.querySelector('#clearAllScheduledMaintenance');
    if (clearAllScheduledBtn) {
      clearAllScheduledBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleClearAll(container, 'maintenance:deleteAllScheduled', 'reports.clearAllScheduledMaintenanceConfirm', () => this.listScheduledMaintenanceHistory(container));
      });
    }

    container.querySelectorAll('.report-section-toggle').forEach((heading) => {
      const toggle = () => {
        const content = container.querySelector(`#${heading.dataset.collapseTarget}`);
        if (!content) return;
        const expanded = heading.getAttribute('aria-expanded') === 'true';
        content.hidden = expanded;
        heading.setAttribute('aria-expanded', String(!expanded));
      };
      heading.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        toggle();
      });
      heading.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
    });
    this.listScanReports(container);
    this.listReports(container);
    this.listManualMaintenanceHistory(container);
    this.listScheduledMaintenanceHistory(container);
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

  async handleClearAll(container, ipcChannel, confirmKey, refreshFn) {
    const t = tFactory();
    const skipConfirm = await window.api.invoke('db:getSetting', 'reports.skipDeleteConfirm', false);
    if (!skipConfirm && !window.confirm(t(confirmKey))) return;
    try {
      const result = await window.api.invoke(ipcChannel);
      if (!result.success) {
        alert(t('reports.failedDelete'));
        return;
      }
      await refreshFn();
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      alert(t('reports.errorPrefix', { error: errMsg }));
      return;
    }

    const listMap = {
      'scanReports:deleteAll': '#scanReportHistory',
      'reports:deleteAll': '#reportHistory',
      'maintenance:deleteAllManual': '#maintenanceHistory',
      'maintenance:deleteAllScheduled': '#scheduledMaintenanceHistory',
    };
    const btnMap = {
      'scanReports:deleteAll': '#clearAllScanReports',
      'reports:deleteAll': '#clearAllSavedReports',
      'maintenance:deleteAllManual': '#clearAllManualMaintenance',
      'maintenance:deleteAllScheduled': '#clearAllScheduledMaintenance',
    };
    const listEl = container.querySelector(listMap[ipcChannel]);
    const clearBtn = container.querySelector(btnMap[ipcChannel]);
    if (clearBtn && listEl) {
      const hasItems = listEl.children.length > 0;
      clearBtn.classList.toggle('hidden', !hasItems);
    }
  },

  setScanReportViewer(container, report) {
    this._currentScanReportId = report.id;
    this._currentSecurityReportPath = null;
    this._lastExportPath = null;
    container.querySelector('#exportReportPdf').style.display = 'inline-flex';
    container.querySelector('#exportReportCsv').style.display = 'inline-flex';
    container.querySelector('#exportReportToast').style.display = 'none';
    const scanType = report.scan_type ? report.scan_type.charAt(0).toUpperCase() + report.scan_type.slice(1) : 'Scan';
    this.showViewer(
      container,
      `${scanType} scan - ${parseUtcTimestamp(report.timestamp).toLocaleString()}`,
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
        const scanType = r.scan_type ? r.scan_type.charAt(0).toUpperCase() + r.scan_type.slice(1) : 'Scan';
        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(scanType)} scan <span class="log-tag ${statusClass}">${escapeHtml(r.status)}</span></div>
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
          const skipConfirm = await window.api.invoke('db:getSetting', 'reports.skipDeleteConfirm', false);
          if (!skipConfirm && !window.confirm(tFactory()('reports.confirmDelete'))) return;
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
          const skipConfirm = await window.api.invoke('db:getSetting', 'reports.skipDeleteConfirm', false);
          if (!skipConfirm && !window.confirm(tFactory()('reports.confirmDelete'))) return;
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
    const clearBtn = container.querySelector('#clearAllSavedReports');
    if (clearBtn) clearBtn.classList.toggle('hidden', !groups.length);
  },

  formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(k)), 0), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  formatResultDetail(r, t) {
    const summary = r.summary || {};
    const scriptId = r.scriptId;
    let detail = '';

    if (scriptId === 'clear-temp-files') {
      const parts = [];
      if (summary.reclaimedBytes !== undefined) parts.push(`${t('reports.reclaimed', { size: this.formatBytes(summary.reclaimedBytes) })}`);
      if (summary.deletedCount !== undefined) parts.push(`${summary.deletedCount} ${t('reports.files')}`);
      if (summary.skippedCount !== undefined) parts.push(`${summary.skippedCount} ${t('reports.skipped')}`);
      if (summary.candidateCount !== undefined) parts.push(`${summary.candidateCount} ${t('reports.candidates')}`);
      detail = parts.join(', ');
    } else if (scriptId === 'browser-cache-report') {
      const parts = [];
      if (summary.reclaimedBytes !== undefined) {
        parts.push(`${t('reports.reclaimed', { size: this.formatBytes(summary.reclaimedBytes) })}`);
      } else if (summary.totalBytes !== undefined) {
        // An analysis measures cache data; it does not delete anything.
        parts.push(`${t('reports.totalSize', { size: this.formatBytes(summary.totalBytes) })}`);
      }
      if (summary.browserCount !== undefined) parts.push(`${summary.browserCount} ${t('reports.browsers')}`);
      detail = parts.join(', ');
    } else if (scriptId === 'disk-space-report') {
      const parts = [];
      if (summary.volumeCount !== undefined) parts.push(`${summary.volumeCount} ${t('reports.volumes')}`);
      if (summary.warningCount !== undefined) parts.push(`${summary.warningCount} ${t('reports.warnings')}`);
      detail = parts.join(', ');
    } else if (scriptId === 'large-files-report') {
      const parts = [];
      if (summary.count !== undefined && summary.count !== null) parts.push(`${summary.count} ${t('reports.files')}`);
      if (summary.totalSizeBytes !== undefined) parts.push(`${t('reports.totalSize', { size: this.formatBytes(summary.totalSizeBytes) })}`);
      if (summary.totalFilesScanned !== undefined) parts.push(`${summary.totalFilesScanned} ${t('reports.filesScanned')}`);
      detail = parts.join(', ');
    } else if (scriptId === 'duplicate-finder') {
      const parts = [];
      if (summary.totalFilesScanned !== undefined) parts.push(`${summary.totalFilesScanned} ${t('reports.filesScanned')}`);
      if (summary.groupCount !== undefined) parts.push(`${summary.groupCount} groups`);
      if (summary.totalWastedSpace !== undefined) parts.push(`${t('reports.totalSize', { size: this.formatBytes(summary.totalWastedSpace) })}`);
      detail = parts.join(', ');
    }

    if (!detail) {
      detail = r.ok ? t('common.ok') : (r.error || t('common.failed'));
    }

    if (r.skippedReason) {
      detail += ` — ${t('reports.skippedReason', { reason: r.skippedReason })}`;
    }
    if (r.error) {
      detail += ` — ${t('reports.error', { error: r.error })}`;
    }

    return `${t('reports.script.' + scriptId) || r.scriptId}: ${detail}`;
  },

  formatManualResultDetail(summary, scriptId, t) {
    const bytes = (mb) => mb * 1024 * 1024;
    const summaryWithBytes = { ...summary };
    if (summary.freedMB) summaryWithBytes.reclaimedBytes = bytes(summary.freedMB);
    if (summary.totalMB) summaryWithBytes.totalBytes = bytes(summary.totalMB);
    const fakeResult = { scriptId, ok: true, summary: summaryWithBytes, skippedReason: summary.skippedReason, error: summary.error };
    return this.formatResultDetail(fakeResult, t);
  },

  async listManualMaintenanceHistory(container) {
    const el = container.querySelector('#maintenanceHistory');
    try {
      const response = await window.api.invoke('maintenance:getManualHistory').catch(() => ({ ok: false, data: [] }));
      const rows = response?.data || [];
      if (!rows.length) {
        el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.noMaintenance'))}</div>`;
        return;
      }
      const t = tFactory();
      const items = rows.map((row, index) => {
        const when = row.startedAt || row.started_at || row.timestamp;
        const whenLabel = when ? new Date(when).toLocaleString() : t('common.unknown');
        const summary = row.summary || {};
        const detail = this.formatManualResultDetail(summary, row.toolId, t);
        const status = row.status === 'completed' ? 'clean' : row.status === 'canceled' ? 'warn' : 'match';
        const toolLabel = t('reports.script.' + row.toolId) || row.toolId || t('common.unknown');
        const statusLabel = row.status === 'completed' ? t('reports.completed') : String(row.status || t('common.unknown')).replace(/^./, (c) => c.toUpperCase());
        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(toolLabel)} <span class="log-tag ${status}">${escapeHtml(statusLabel)}</span></div>
              <div class="history-meta">${escapeHtml(whenLabel)}${detail ? ` — ${escapeHtml(detail)}` : ''}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
              <button class="btn btn-sm view-maintenance" data-index="${index}" data-source="manual">${escapeHtml(t('reports.viewDetails'))}</button>
              <button class="btn btn-sm delete-maintenance" data-index="${index}" data-source="manual" title="${escapeHtml(t('reports.deleteMaintenance'))}">${escapeHtml(t('reports.deleteMaintenance'))}</button>
            </div>
          </div>`;
      }).join('');
      el.innerHTML = `<div class="history-list">${items}</div>`;

      el.querySelectorAll('.view-maintenance').forEach((btn) => {
        btn.addEventListener('click', () => {
          const index = parseInt(btn.dataset.index, 10);
          const row = rows[index];
          if (row) {
            this.showManualMaintenanceDetails(container, row);
          }
        });
      });
      el.querySelectorAll('.delete-maintenance').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const index = parseInt(btn.dataset.index, 10);
          const row = rows[index];
          if (!row) return;
          const skipConfirm = await window.api.invoke('db:getSetting', 'reports.skipDeleteConfirm', false);
          if (!skipConfirm && !window.confirm(t('reports.deleteMaintenanceConfirm'))) return;
          try {
            const response = await window.api.invoke('maintenance:deleteToolRun', row.runId);
            if (!response?.ok) {
              window.alert(response?.error || t('reports.failedDeleteMaintenance'));
              return;
            }
            this.listManualMaintenanceHistory(container);
          } catch (err) {
            window.alert(t('reports.failedDeleteMaintenance'));
          }
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.errorPrefix', { error: err.message }))}</div>`;
    }
    const clearBtn = container.querySelector('#clearAllManualMaintenance');
    if (clearBtn) clearBtn.classList.toggle('hidden', !rows.length);
  },

  async listScheduledMaintenanceHistory(container) {
    const el = container.querySelector('#scheduledMaintenanceHistory');
    try {
      const response = await window.api.invoke('maintenance:getScheduledHistory').catch(() => ({ ok: false, data: [] }));
      const rows = response?.data || [];
      if (!rows.length) {
        el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.noMaintenance'))}</div>`;
        return;
      }
      const t = tFactory();
      const items = rows.map((row, index) => {
        const when = row.startedAt || row.started_at || row.timestamp;
        const whenLabel = when ? new Date(when).toLocaleString() : t('common.unknown');
        const detail = (row.results || []).map((r) => this.formatResultDetail(r, t)).join('; ');
        const statusLabel = row.ok_count === row.total_count
          ? t('reports.completed')
          : row.ok_count > 0 ? 'Partial' : 'Failed';
        const status = row.ok_count === row.total_count ? 'clean' : row.ok_count > 0 ? 'warn' : 'match';
        return `
          <div class="history-item">
            <div style="min-width:0;">
              <div class="history-title">${escapeHtml(t('reports.scheduledMaintenanceHistory'))} <span class="log-tag ${status}">${escapeHtml(statusLabel)}</span></div>
              <div class="history-meta">${escapeHtml(whenLabel)}${detail ? ` — ${escapeHtml(detail)}` : ''}</div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
              <button class="btn btn-sm view-maintenance" data-index="${index}" data-source="scheduled">${escapeHtml(t('reports.viewDetails'))}</button>
              <button class="btn btn-sm delete-maintenance" data-index="${index}" data-source="scheduled" title="${escapeHtml(t('reports.deleteMaintenance'))}">${escapeHtml(t('reports.deleteMaintenance'))}</button>
            </div>
          </div>`;
      }).join('');
      el.innerHTML = `<div class="history-list">${items}</div>`;

      el.querySelectorAll('.view-maintenance').forEach((btn) => {
        btn.addEventListener('click', () => {
          const index = parseInt(btn.dataset.index, 10);
          const row = rows[index];
          if (row) {
            this.showMaintenanceDetails(container, row);
          }
        });
      });
      el.querySelectorAll('.delete-maintenance').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const index = parseInt(btn.dataset.index, 10);
          const row = rows[index];
          if (!row) return;
          const skipConfirm = await window.api.invoke('db:getSetting', 'reports.skipDeleteConfirm', false);
          if (!skipConfirm && !window.confirm(t('reports.deleteMaintenanceConfirm'))) return;
          try {
            const response = await window.api.invoke('maintenance:deleteRun', row.id);
            if (!response?.ok) {
              window.alert(response?.error || t('reports.failedDeleteMaintenance'));
              return;
            }
            this.listScheduledMaintenanceHistory(container);
          } catch (err) {
            window.alert(t('reports.failedDeleteMaintenance'));
          }
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(tFactory()('reports.errorPrefix', { error: err.message }))}</div>`;
    }
    const clearBtn = container.querySelector('#clearAllScheduledMaintenance');
    if (clearBtn) clearBtn.classList.toggle('hidden', !rows.length);
  },

  showManualMaintenanceDetails(container, row) {
    const t = tFactory();
    const when = row.startedAt || row.started_at || row.timestamp;
    const whenLabel = when ? new Date(when).toLocaleString() : t('common.unknown');
    const summary = row.summary || {};
    const scriptId = row.toolId;
    const toolLabel = t('reports.script.' + scriptId) || scriptId || t('common.unknown');

    const detailHtml = this.formatManualResultDetail(summary, scriptId, t);

    const html = `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.duration'))}</div><div class="stat-value">${escapeHtml(whenLabel)}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.completed'))}</div><div class="stat-value">${escapeHtml(1)}/${escapeHtml(1)}</div></div>
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.results'))}</div>
        ${detailHtml || `<div class="empty-state compact-empty">${escapeHtml(t('reports.noResults'))}</div>`}
      </div>
    `;

    this.showViewer(container, `${toolLabel} - ${whenLabel}`, html);
  },

  showMaintenanceDetails(container, row) {
    const t = tFactory();
    const when = row.startedAt || row.started_at || row.timestamp;
    const whenLabel = when ? new Date(when).toLocaleString() : t('common.unknown');

    const resultsHtml = (row.results || []).map((r) => `
      <div class="log-row">
        <span class="log-tag ${r.ok ? 'clean' : 'match'}">${escapeHtml(t('reports.script.' + r.scriptId) || r.scriptId)}</span>
        <span class="log-path">${escapeHtml(this.formatResultDetail(r, t))}</span>
      </div>`).join('');

    const html = `
      <div class="report-stats">
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.scheduledMaintenanceHistory'))}</div><div class="stat-value">${escapeHtml(whenLabel)}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(t('reports.completed'))}</div><div class="stat-value">${escapeHtml(row.ok_count || 0)}/${escapeHtml(row.total_count || 0)}</div></div>
      </div>
      <div class="report-section"><div class="panel-title">${escapeHtml(t('reports.results'))}</div>
        ${resultsHtml || `<div class="empty-state compact-empty">${escapeHtml(t('reports.noResults'))}</div>`}
      </div>
    `;

    this.showViewer(container, `${t('reports.scheduledMaintenanceHistory')} - ${whenLabel}`, html);
  }
};
