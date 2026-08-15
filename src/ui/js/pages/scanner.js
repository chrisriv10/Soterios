window.Pages = window.Pages || {};
window.Pages['scanner'] = {
  cleanups: [],
  destroy() {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
  },
  render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.innerHTML = `
      <div class="scanner-page" id="scannerPage">
      <header class="page-header" id="scannerPageHeader">
        <h1 class="page-title">${escapeHtml(t('scanner.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('scanner.subtitle'))}</p>
      </header>

      <section class="card scan-progress-panel" id="scanStatusCard" style="display:none;" aria-labelledby="scanProgressTitle" data-view="progress">
        <div class="scan-progress-header">
          <div class="status-icon info" id="scanIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div class="scan-progress-heading">
            <div class="scan-progress-kicker" id="scanTypeText">${escapeHtml(t('scanner.progressScan'))}</div>
            <div id="scanProgressTitle" class="scan-progress-title">${escapeHtml(t('scanner.statusReady'))}</div>
          </div>
          <span class="scan-phase-badge" id="scanPhaseBadge">${escapeHtml(t('scanner.phaseReady'))}</span>
          <div class="scan-progress-percent" id="scanProgressPct">0%</div>
          <button class="scan-progress-expand" id="btnExpandScanProgress" type="button" aria-expanded="false" aria-controls="scanExpandedDetails">
            <span id="scanExpandLabel">${escapeHtml(t('scanner.expandDetails'))}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>

        <div class="scan-progress-overview">
          <div class="scan-progress-label-row">
            <span>${escapeHtml(t('scanner.overallProgress'))}</span>
            <span class="scan-progress-estimate" id="scanProgressEstimate" style="display:none;">${escapeHtml(t('scanner.estimatedProgress'))}</span>
          </div>
          <div class="stat-bar-track scan-progress-track" id="progressTrack" role="progressbar" aria-label="${escapeHtml(t('scanner.overallProgress'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="stat-bar-fill" id="scanProgressFill" style="width:0%;"></div>
          </div>
        </div>

        <div class="scan-activity" aria-live="polite" aria-atomic="true">
          <div class="scan-activity-label" id="scanStatus">${escapeHtml(t('scanner.currentActivity'))}</div>
          <div class="scan-activity-value" id="scanDetail">${escapeHtml(t('scanner.detailWait'))}</div>
          <div class="scan-target-path" id="scanProgressTarget" style="display:none;"></div>
        </div>

        <div class="scan-progress-metrics" id="scanProgressMetrics">
          <div class="scan-progress-metric"><span>${escapeHtml(t('scanner.filesScanned'))}</span><strong id="scanFilesMetric">0</strong></div>
          <div class="scan-progress-metric"><span>${escapeHtml(t('scanner.threatsFoundLabel'))}</span><strong id="scanThreatsMetric">0</strong></div>
          <div class="scan-progress-metric"><span>${escapeHtml(t('scanner.elapsedTime'))}</span><strong id="scanElapsedMetric">0:00</strong></div>
          <div class="scan-progress-metric"><span>${escapeHtml(t('scanner.scanTargets'))}</span><strong id="scanTargetsMetric">—</strong></div>
        </div>

        <div class="scan-expanded-details" id="scanExpandedDetails" hidden>
          <div class="scan-result-timeline">
            <div><span>${escapeHtml(t('scanner.startedAt'))}</span><strong id="scanStartedAt">—</strong></div>
            <div><span>${escapeHtml(t('scanner.completedAt'))}</span><strong id="scanCompletedAt">—</strong></div>
          </div>
          <section class="scan-detail-section" id="scanTargetsSection">
            <h3>${escapeHtml(t('scanner.scannedTargets'))}</h3>
            <ul class="scan-detail-list scan-detail-list--paths" id="scanTargetsList"></ul>
          </section>
          <section class="scan-detail-section" id="scanDetectionsSection">
            <h3>${escapeHtml(t('scanner.detections'))}</h3>
            <div class="scan-detail-list" id="scanDetectionsList"></div>
          </section>
          <section class="scan-detail-section" id="scanIssuesSection">
            <h3>${escapeHtml(t('scanner.notesAndErrors'))}</h3>
            <ul class="scan-detail-list" id="scanIssuesList"></ul>
          </section>
        </div>

        <div class="scan-progress-actions">
          <button class="btn btn-sm" id="btnCancelScan" disabled>${escapeHtml(t('scanner.cancelScan'))}</button>
          <button class="btn btn-sm" id="btnOpenScanReports">${escapeHtml(t('scanner.viewReports'))}</button>
          <button class="btn btn-sm" id="btnDismissScanResult">${escapeHtml(t('common.close'))}</button>
        </div>
      </section>

      <div class="scanner-grid" id="scanChoiceGrid">
        <div class="card">
          <h3>${escapeHtml(t('scanner.quickScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.quickDesc'))}</p>
          <div style="display:flex; align-items:center; gap:8px; margin-top:12px;">
            <button class="btn btn-primary" id="btnScannerQuick">${escapeHtml(t('scanner.quickStart'))}</button>
            <button class="btn btn-sm" id="btnCancelQuick" style="display:none;">${escapeHtml(t('scanner.cancelScan'))}</button>
          </div>
        </div>
        <div class="card">
          <h3>${escapeHtml(t('scanner.fullScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.fullDesc'))}</p>
          <div style="display:flex; align-items:center; gap:8px; margin-top:12px;">
            <button class="btn" id="btnScannerFull">${escapeHtml(t('scanner.fullStart'))}</button>
            <button class="btn btn-sm" id="btnCancelFull" style="display:none;">${escapeHtml(t('scanner.cancelScan'))}</button>
          </div>
        </div>
        <div class="card">
          <h3>${escapeHtml(t('scanner.customScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.customDesc'))}</p>
          <div style="display:flex; align-items:center; gap:8px; margin-top:12px;">
            <button class="btn" id="btnScannerCustom">${escapeHtml(t('scanner.customSelect'))}</button>
            <button class="btn btn-sm" id="btnCancelCustom" style="display:none;">${escapeHtml(t('scanner.cancelScan'))}</button>
          </div>
        </div>
      </div>

      <div class="card scanner-bottom-card" id="scheduleCard">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0;">${escapeHtml(t('scanner.scheduledScans'))}</h3>
            <p class="page-subtitle" id="scheduleStatusText" style="margin:4px 0 0;">${escapeHtml(t('scanner.scheduleStatusLoading'))}</p>
          </div>
          <button class="btn" id="btnScheduleToggle">${escapeHtml(t('scanner.scheduleEnable'))}</button>
        </div>
        <div id="scheduleOptions" style="margin-top:16px; display:none; flex-direction:column; gap:12px;">
          <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center;">
            <label style="font-size:0.85rem; color:var(--text-dim); display:flex; align-items:center; gap:8px;">
              ${escapeHtml(t('scanner.scheduleType'))}
              <select id="scheduleScanType" class="btn btn-sm">
                <option value="quick">${escapeHtml(t('scanner.scheduleTypeQuick'))}</option>
                <option value="full">${escapeHtml(t('scanner.scheduleTypeFull'))}</option>
                <option value="custom">${escapeHtml(t('scanner.scheduleTypeCustom'))}</option>
              </select>
            </label>
            <label style="font-size:0.85rem; color:var(--text-dim); display:flex; align-items:center; gap:8px;">
              ${escapeHtml(t('scanner.scheduleFrequency'))}
              <select id="scheduleInterval" class="btn btn-sm">
                <option value="6">${escapeHtml(t('scanner.scheduleFreq6'))}</option>
                <option value="12">${escapeHtml(t('scanner.scheduleFreq12'))}</option>
                <option value="24">${escapeHtml(t('scanner.scheduleFreq24'))}</option>
                <option value="72">${escapeHtml(t('scanner.scheduleFreq72'))}</option>
                <option value="168">${escapeHtml(t('scanner.scheduleFreq168'))}</option>
              </select>
            </label>
          </div>
          <div id="scheduleCustomRow" style="display:none; align-items:center; gap:10px;">
            <button class="btn btn-sm" id="btnScheduleFolder">${escapeHtml(t('scanner.scheduleChooseFolder'))}</button>
            <span class="page-subtitle" id="scheduleFolderLabel" style="font-size:0.8rem;">${escapeHtml(t('scanner.scheduleNoFolder'))}</span>
          </div>
        </div>
      </div>

      <div class="card scanner-bottom-card" id="clamStatusCard">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
          <div>
            <h3 style="margin:0;">${escapeHtml(t('scanner.clamavEngine'))}</h3>
            <p class="page-subtitle" id="clamStatusText" style="margin:4px 0 0;">${escapeHtml(t('scanner.checkingStatus'))}</p>
          </div>
          <button class="btn" id="btnUpdateDefinitions">${escapeHtml(t('scanner.updateDefinitions'))}</button>
        </div>
      </div>
      </div>`;

    const progressFill = document.getElementById('scanProgressFill');
    const progressTrack = document.getElementById('progressTrack');
    const progressPct = document.getElementById('scanProgressPct');
    const progressEstimate = document.getElementById('scanProgressEstimate');
    const scanStatus = document.getElementById('scanStatus');
    const scanDetail = document.getElementById('scanDetail');
    const scanTarget = document.getElementById('scanProgressTarget');
    const scanProgressTitle = document.getElementById('scanProgressTitle');
    const scanTypeText = document.getElementById('scanTypeText');
    const scanPhaseBadge = document.getElementById('scanPhaseBadge');
    const scanFilesMetric = document.getElementById('scanFilesMetric');
    const scanThreatsMetric = document.getElementById('scanThreatsMetric');
    const scanElapsedMetric = document.getElementById('scanElapsedMetric');
    const scanTargetsMetric = document.getElementById('scanTargetsMetric');
    const scanProgressMetrics = document.getElementById('scanProgressMetrics');
    const scanCard = document.getElementById('scanStatusCard');
    const scannerPage = document.getElementById('scannerPage');
    const scanChoiceGrid = document.getElementById('scanChoiceGrid');
    const scheduleCard = document.getElementById('scheduleCard');
    const clamStatusCard = document.getElementById('clamStatusCard');
    const expandButton = document.getElementById('btnExpandScanProgress');
    const expandLabel = document.getElementById('scanExpandLabel');
    const expandedDetails = document.getElementById('scanExpandedDetails');
    const scanStartedAt = document.getElementById('scanStartedAt');
    const scanCompletedAt = document.getElementById('scanCompletedAt');
    const scanTargetsSection = document.getElementById('scanTargetsSection');
    const scanTargetsList = document.getElementById('scanTargetsList');
    const scanDetectionsSection = document.getElementById('scanDetectionsSection');
    const scanDetectionsList = document.getElementById('scanDetectionsList');
    const scanIssuesSection = document.getElementById('scanIssuesSection');
    const scanIssuesList = document.getElementById('scanIssuesList');
    const scanIcon = document.getElementById('scanIcon');
    const clamStatusText = document.getElementById('clamStatusText');
    const updateDefinitionsButton = document.getElementById('btnUpdateDefinitions');
    const scheduleStatusText = document.getElementById('scheduleStatusText');
    const scheduleToggleBtn = document.getElementById('btnScheduleToggle');
    const scheduleOptions = document.getElementById('scheduleOptions');
    const scheduleScanType = document.getElementById('scheduleScanType');
    const scheduleInterval = document.getElementById('scheduleInterval');
    const scheduleCustomRow = document.getElementById('scheduleCustomRow');
    const btnScheduleFolder = document.getElementById('btnScheduleFolder');
    const scheduleFolderLabel = document.getElementById('scheduleFolderLabel');
    const cancelButton = document.getElementById('btnCancelScan');
    const reportButton = document.getElementById('btnOpenScanReports');
    const dismissResultButton = document.getElementById('btnDismissScanResult');
    const scanButtons = Array.from(document.querySelectorAll('#btnScannerQuick, #btnScannerFull, #btnScannerCustom'));
    const perCardCancelButtons = Array.from(document.querySelectorAll('#btnCancelQuick, #btnCancelFull, #btnCancelCustom'));
    const scanButtonOriginalLabels = {};
    scanButtons.forEach((btn) => { scanButtonOriginalLabels[btn.id] = btn.textContent; });
    let isScanRunning = false;
    let activeAction = null;
    let showReportButton = false;
    let scanHistoryEnabled = true;
    let alive = true;
    let activeStartedAt = null;
    let completedDurationMs = null;
    let activeProgress = 0;
    let elapsedTimer = null;
    let isExpanded = false;
    let hasResult = false;
    let activeSnapshot = null;
    let currentResult = null;
    this.cleanups.push(() => {
      alive = false;
      if (elapsedTimer) clearInterval(elapsedTimer);
      if (window.ScannerProgressView?.owner === container) delete window.ScannerProgressView;
    });

    function updateFooterButtons() {
      if (!cancelButton || !reportButton || !dismissResultButton) return;
      const showCancel = activeAction === 'virus' && isScanRunning;
      const showReports = activeAction === 'virus' && showReportButton;
      cancelButton.style.display = showCancel ? 'inline-block' : 'none';
      reportButton.style.display = showReports ? 'inline-block' : 'none';
      dismissResultButton.style.display = hasResult ? 'inline-block' : 'none';
      cancelButton.disabled = !showCancel;
      reportButton.disabled = !showReports;
      perCardCancelButtons.forEach((btn) => {
        btn.style.display = showCancel ? 'inline-block' : 'none';
        btn.disabled = !showCancel;
      });
    }

    function hasView() {
      return alive && document.body.contains(container);
    }

    function formatTimestamp(value, fallback = '—') {
      if (!value) return fallback;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
    }

    function replaceList(list, items, emptyLabel, renderer) {
      if (!list) return;
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'scan-detail-empty';
        empty.textContent = emptyLabel;
        list.appendChild(empty);
        return;
      }
      items.forEach((item) => list.appendChild(renderer(item)));
    }

    function renderExpandedData(data, resultMode) {
      if (!data) return;
      const scanType = data.scanType || data.currentScan?.scanType;
      const isDefinitions = scanType === 'definitions';
      if (scanStartedAt) scanStartedAt.textContent = formatTimestamp(data.startedAt || data.currentScan?.startedAt);
      if (scanCompletedAt) {
        scanCompletedAt.textContent = resultMode
          ? formatTimestamp(data.completedAt)
          : t('scanner.inProgress');
      }

      const paths = Array.isArray(data.targetPaths)
        ? data.targetPaths
        : Array.isArray(data.currentScan?.targetPaths)
          ? data.currentScan.targetPaths
          : Array.isArray(data.currentScan?.paths)
            ? data.currentScan.paths
            : data.currentTarget ? [data.currentTarget] : [];
      const completedTargets = Array.isArray(data.completedTargets)
        ? data.completedTargets
        : resultMode && data.status === 'completed'
          ? paths
          : [];
      const completedTargetSet = new Set(completedTargets.map((targetPath) => String(targetPath)));
      if (scanTargetsSection) scanTargetsSection.style.display = isDefinitions ? 'none' : '';
      replaceList(scanTargetsList, paths, t('scanner.noTargets'), (targetPath) => {
        const row = document.createElement('li');
        row.className = 'scan-detail-path';
        row.title = targetPath;
        const pathLabel = document.createElement('span');
        pathLabel.className = 'scan-detail-path-label';
        pathLabel.textContent = targetPath;
        row.appendChild(pathLabel);
        if (completedTargetSet.has(String(targetPath))) {
          row.classList.add('scan-detail-path--complete');
          row.setAttribute('aria-label', `${targetPath} — ${t('scanner.phaseCompleted')}`);
          const checkmark = document.createElement('span');
          checkmark.className = 'scan-detail-path-check';
          checkmark.setAttribute('aria-hidden', 'true');
          checkmark.textContent = '✓';
          row.appendChild(checkmark);
        }
        return row;
      });

      const threats = resultMode
        ? (Array.isArray(data.threats) ? data.threats : Array.isArray(data.report?.threats) ? data.report.threats : [])
        : [];
      if (scanDetectionsSection) scanDetectionsSection.style.display = resultMode && !isDefinitions ? '' : 'none';
      if (scanDetectionsList) {
        scanDetectionsList.replaceChildren();
        if (!threats.length) {
          const empty = document.createElement('div');
          empty.className = 'scan-detail-empty';
          empty.textContent = t('scanner.noDetections');
          scanDetectionsList.appendChild(empty);
        } else {
          threats.forEach((threat) => {
            const row = document.createElement('div');
            row.className = 'scan-detection-row';
            const name = document.createElement('strong');
            name.textContent = threat.name || t('scanner.unknownThreat');
            const threatPath = document.createElement('span');
            threatPath.textContent = threat.path || '';
            threatPath.title = threat.path || '';
            row.append(name, threatPath);
            scanDetectionsList.appendChild(row);
          });
        }
      }

      const issues = [];
      if (data.note) issues.push(data.note);
      if (Array.isArray(data.errors)) issues.push(...data.errors.filter(Boolean));
      if (scanIssuesSection) scanIssuesSection.style.display = resultMode && issues.length ? '' : 'none';
      replaceList(scanIssuesList, issues, '', (issue) => {
        const row = document.createElement('li');
        row.textContent = issue;
        return row;
      });
    }

    function applyPageState() {
      const mode = hasResult ? 'result' : isScanRunning ? 'scanning' : 'idle';
      const focusMode = isExpanded && mode !== 'idle';
      if (scannerPage) {
        scannerPage.dataset.state = mode;
        scannerPage.classList.toggle('scanner-page--expanded', focusMode);
      }
      if (scanChoiceGrid) scanChoiceGrid.style.display = isScanRunning || focusMode ? 'none' : 'grid';
      if (clamStatusCard) clamStatusCard.style.display = isScanRunning || focusMode ? 'none' : 'block';
      if (scheduleCard) scheduleCard.style.display = focusMode ? 'none' : 'block';
      if (scanCard) {
        scanCard.classList.toggle('scan-progress-panel--expanded', focusMode);
        scanCard.classList.toggle('scan-progress-panel--result', hasResult);
        scanCard.dataset.view = hasResult ? 'result' : 'progress';
      }
      if (expandedDetails) expandedDetails.hidden = !focusMode;
      if (expandButton) expandButton.setAttribute('aria-expanded', String(focusMode));
      if (expandLabel) expandLabel.textContent = focusMode ? t('scanner.collapseDetails') : t('scanner.expandDetails');
      renderExpandedData(hasResult ? currentResult : activeSnapshot, hasResult);
    }

    function setExpanded(expanded) {
      if ((!isScanRunning && !hasResult) || !scanCard || scanCard.style.display === 'none') return false;
      isExpanded = !!expanded;
      applyPageState();
      if (isExpanded) scanCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }

    function focusProgressPanelIfRequested() {
      if (!window.AppState?.focusScanProgress || !scanCard || scanCard.style.display === 'none') return;
      requestAnimationFrame(() => {
        if (!hasView()) return;
        scanCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (expandButton) expandButton.focus({ preventScroll: true });
        window.AppState.focusScanProgress = false;
      });
    }

    function setProgress(pct) {
      if (!hasView() || !progressFill) return;
      const value = Math.min(100, Math.max(0, Number(pct) || 0));
      activeProgress = value;
      progressFill.style.width = value + '%';
      if (progressPct) progressPct.textContent = Math.round(value) + '%';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(value)));
    }

    function formatDuration(durationMs) {
      const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function scanTypeLabel(scanType) {
      const labels = {
        quick: 'scanner.quickScan',
        full: 'scanner.fullScan',
        custom: 'scanner.customScan',
        definitions: 'scanner.definitionUpdate'
      };
      return t(labels[scanType] || 'scanner.progressScan');
    }

    function phaseLabel(phase) {
      const labels = {
        preparing: 'scanner.phasePreparing',
        scanning: 'scanner.phaseScanning',
        'updating-definitions': 'scanner.phaseUpdatingDefinitions',
        quarantining: 'scanner.phaseQuarantining',
        canceling: 'scanner.phaseCanceling',
        completed: 'scanner.phaseCompleted',
        failed: 'scanner.phaseFailed',
        canceled: 'scanner.phaseCanceled'
      };
      return t(labels[phase] || 'scanner.phaseReady');
    }

    function updateElapsed() {
      if (!hasView() || !scanElapsedMetric) return;
      const duration = completedDurationMs != null
        ? completedDurationMs
        : activeStartedAt ? Date.now() - new Date(activeStartedAt).getTime() : 0;
      scanElapsedMetric.textContent = formatDuration(duration);
    }

    elapsedTimer = setInterval(updateElapsed, 1000);

    function setDefinitionMetrics(isDefinitions) {
      if (!scanProgressMetrics) return;
      scanProgressMetrics.classList.toggle('scan-progress-metrics--definitions', isDefinitions);
      const metrics = Array.from(scanProgressMetrics.children);
      metrics.forEach((metric, index) => {
        metric.style.display = isDefinitions && index !== 2 ? 'none' : '';
      });
    }

    function renderLiveSnapshot(snapshot) {
      if (!hasView() || !snapshot) return;
      const scanType = snapshot.scanType || snapshot.currentScan?.scanType || 'quick';
      const isDefinitions = scanType === 'definitions';
      const startingNewView = !isScanRunning;
      if (startingNewView) {
        hasResult = false;
        currentResult = null;
        if (scanCard) delete scanCard.dataset.result;
        isExpanded = !!window.AppState?.expandScanProgress;
        if (window.AppState) window.AppState.expandScanProgress = false;
      }
      activeSnapshot = { ...(activeSnapshot || {}), ...snapshot };
      activeAction = isDefinitions ? 'definitions' : 'virus';
      activeStartedAt = snapshot.startedAt || snapshot.currentScan?.startedAt || activeStartedAt || new Date().toISOString();
      completedDurationMs = null;
      setScanning(true);
      if (scanTypeText) scanTypeText.textContent = scanTypeLabel(scanType);
      if (scanProgressTitle) scanProgressTitle.textContent = isDefinitions ? t('scanner.updatingDefs') : t('scanner.statusScanning');
      if (scanPhaseBadge) {
        scanPhaseBadge.textContent = phaseLabel(snapshot.phase);
        scanPhaseBadge.dataset.phase = snapshot.phase || 'scanning';
      }
      if (scanStatus) scanStatus.textContent = phaseLabel(snapshot.phase || 'scanning');
      if (scanDetail) scanDetail.textContent = snapshot.message || t('scanner.detailWait');
      if (scanTarget) {
        const target = snapshot.currentTarget || '';
        scanTarget.textContent = target;
        scanTarget.title = target;
        scanTarget.style.display = target ? 'block' : 'none';
      }
      if (scanFilesMetric) scanFilesMetric.textContent = Number(snapshot.filesScanned || 0).toLocaleString();
      if (scanThreatsMetric) scanThreatsMetric.textContent = Number(snapshot.threatsFound || 0).toLocaleString();
      if (scanTargetsMetric) {
        scanTargetsMetric.textContent = snapshot.targetCount > 0
          ? t('scanner.targetProgress', { current: snapshot.targetIndex || 1, total: snapshot.targetCount })
          : '—';
      }
      if (progressEstimate) progressEstimate.style.display = snapshot.progressEstimated ? 'inline-flex' : 'none';
      setDefinitionMetrics(isDefinitions);
      const nextProgress = snapshot.pct == null
        ? (snapshot.progress == null ? activeProgress : snapshot.progress)
        : snapshot.pct;
      setProgress(nextProgress);
      updateElapsed();
      applyPageState();
    }

    function setScanning(active) {
      if (!hasView()) return;
      isScanRunning = active;
      if (active) {
        if (scanCard) scanCard.style.display = 'block';
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanning');
        if (scanDetail) scanDetail.textContent = t('scanner.detailWait');
        if (scanIcon) {
          scanIcon.className = 'status-icon info';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        }
        scanButtons.forEach((b) => {
          b.disabled = true;
          b.textContent = t('scanner.statusScanning');
        });
        if (updateDefinitionsButton) updateDefinitionsButton.disabled = true;
      } else {
        scanButtons.forEach((b) => {
          b.disabled = false;
          b.textContent = scanButtonOriginalLabels[b.id] || b.textContent;
        });
        if (updateDefinitionsButton) updateDefinitionsButton.disabled = false;
      }
      updateFooterButtons();
      applyPageState();
    }

    function setComplete(success, filesScanned, threatsFound, note, canceled, historyEnabled = true) {
      if (!hasView()) return;
      const baseResult = (typeof success === 'object' && success) || {
        scanType: activeAction === 'definitions' ? 'definitions' : 'quick',
        status: canceled ? 'canceled' : success ? 'completed' : 'failed',
        filesScanned,
        threatsFound,
        note,
        durationMs: completedDurationMs || 0,
        progress: canceled ? activeProgress : 100
      };
      const result = {
        ...baseResult,
        startedAt: baseResult.startedAt || baseResult.report?.startedAt,
        completedAt: baseResult.completedAt || baseResult.report?.completedAt,
        targetPaths: baseResult.targetPaths || baseResult.report?.targetPaths || [],
        completedTargets: baseResult.completedTargets || baseResult.report?.completedTargets || [],
        threats: baseResult.threats || baseResult.report?.threats || [],
        errors: baseResult.errors || baseResult.report?.errors || []
      };
      const isDefinitions = result.scanType === 'definitions';
      activeAction = isDefinitions ? 'definitions' : 'virus';
      const wasCanceled = result.status === 'canceled';
      const wasSuccessful = result.status === 'completed';
      const resultFiles = Number(result.filesScanned || 0);
      const resultThreats = Number(result.threatsFound || 0);
      hasResult = true;
      currentResult = result;
      activeSnapshot = null;
      if (!isDefinitions) {
        showReportButton = historyEnabled && (wasCanceled || wasSuccessful);
      } else {
        showReportButton = false;
      }
      setScanning(false);
      if (scanCard) scanCard.style.display = 'block';
      activeStartedAt = result.startedAt || null;
      completedDurationMs = Number(result.durationMs || 0);
      if (scanTypeText) scanTypeText.textContent = scanTypeLabel(result.scanType);
      if (scanPhaseBadge) {
        scanPhaseBadge.textContent = phaseLabel(result.status);
        scanPhaseBadge.dataset.phase = result.status;
      }
      if (scanCard) {
        const resultKind = isDefinitions
          ? (wasSuccessful ? 'definitions' : 'failed')
          : wasCanceled ? 'canceled'
          : !wasSuccessful ? 'failed'
          : resultThreats > 0 ? 'threats'
          : 'clean';
        scanCard.dataset.result = resultKind;
      }
      if (progressEstimate) progressEstimate.style.display = result.scanType === 'full' ? 'inline-flex' : 'none';
      if (scanFilesMetric) scanFilesMetric.textContent = resultFiles.toLocaleString();
      if (scanThreatsMetric) scanThreatsMetric.textContent = resultThreats.toLocaleString();
      if (scanTargetsMetric) scanTargetsMetric.textContent = Array.isArray(result.targetPaths) && result.targetPaths.length
        ? String(result.targetPaths.length)
        : '—';
      if (scanTarget) scanTarget.style.display = 'none';
      setDefinitionMetrics(isDefinitions);
      setProgress(result.progress ?? result.pct ?? (wasSuccessful ? 100 : activeProgress));
      updateElapsed();

      if (isDefinitions) {
        if (scanProgressTitle) scanProgressTitle.textContent = wasSuccessful ? t('scanner.defsUpdated') : t('scanner.defsUpdateFailed');
        if (scanStatus) scanStatus.textContent = wasSuccessful ? t('scanner.defsUpdated') : t('scanner.defsUpdateFailed');
        if (scanDetail) scanDetail.textContent = result.note || (wasSuccessful ? t('scanner.defsReady') : t('scanner.defsUpdateFailed'));
        if (scanIcon) {
          scanIcon.className = 'status-icon ' + (wasSuccessful ? 'safe' : 'danger');
          scanIcon.innerHTML = wasSuccessful
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        }
        updateFooterButtons();
        applyPageState();
        return;
      }

      if (wasCanceled) {
        if (scanProgressTitle) scanProgressTitle.textContent = t('scanner.statusScanCanceled');
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanCanceled');
        if (scanDetail) scanDetail.textContent = t('scanner.detailCanceled', { count: resultFiles }) + (historyEnabled ? ' ' + t('common.scanReportSaved') : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon warning';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/></svg>';
        }
        updateFooterButtons();
        applyPageState();
        return;
      }
      if (wasSuccessful) {
        if (scanProgressTitle) scanProgressTitle.textContent = resultThreats > 0
          ? t('scanner.resultThreats', { count: resultThreats })
          : t('scanner.resultClean');
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanComplete');
        if (scanDetail) scanDetail.textContent = t('scanner.detailComplete', { count: resultFiles, threats: resultThreats }) + (result.note ? ' ' + result.note : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon ' + (resultThreats > 0 ? 'danger' : 'safe');
          scanIcon.innerHTML = resultThreats > 0
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.3 18.3l-2.1-2.1"/><path d="M18.3 5.6l-2.1 2.1"/><path d="M5.6 18.3l2.1-2.1"/><circle cx="10" cy="10" r=".5"/><circle cx="14.5" cy="10.5" r=".5"/><circle cx="13" cy="14.5" r=".5"/><circle cx="9.5" cy="14" r=".5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        }
      } else {
        if (scanProgressTitle) scanProgressTitle.textContent = t('scanner.statusScanFailed');
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanFailed');
        if (scanDetail) scanDetail.textContent = result.note || result.error || (result.errors && result.errors[0]) || t('scanner.statusScanFailed');
        if (scanIcon) {
          scanIcon.className = 'status-icon danger';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        }
      }
      updateFooterButtons();
      applyPageState();
    }

    async function refreshStatus() {
      try {
        const status = await window.api.invoke('scan:status');
        if (!hasView()) return;
        if (status.scan && status.scan.isScanning) {
          renderLiveSnapshot(status.scan);
        } else if (status.scan && status.scan.lastResult) {
          setComplete(status.scan.lastResult, undefined, undefined, undefined, undefined, scanHistoryEnabled);
        } else {
          hasResult = false;
          currentResult = null;
          activeSnapshot = null;
          isExpanded = false;
          setScanning(false);
          if (scanCard) scanCard.style.display = 'none';
          applyPageState();
        }
        focusProgressPanelIfRequested();
        const engine = status.engine || status;
        if (!engine.ready) {
          if (clamStatusText) clamStatusText.textContent = t('scanner.engineNotReady');
        } else if (!engine.hasDefinitions) {
          if (clamStatusText) clamStatusText.textContent = t('scanner.defsMissing');
        } else {
          if (clamStatusText) clamStatusText.textContent = t('scanner.defsReady');
        }
      } catch (e) {
        if (hasView() && clamStatusText) clamStatusText.textContent = e.message || t('scanner.statusError');
      }
    }

    // -- Scheduled Scans --
    let scheduleConfig = { enabled: false, scanType: 'quick', customPath: null, intervalHours: 24, lastRun: null };

    function scheduleIntervalLabel(hours) {
      const map = { 6: t('scanner.scheduleFreq6'), 12: t('scanner.scheduleFreq12'), 24: t('scanner.scheduleFreq24'), 72: t('scanner.scheduleFreq72'), 168: t('scanner.scheduleFreq168') };
      return map[hours] || t('scanner.scheduleFreqCustom', { hours });
    }

    function formatScheduleTimestamp(ts) {
      if (!ts) return t('common.never');
      try { return new Date(ts).toLocaleString(); } catch (_) { return t('common.never'); }
    }

    function renderScheduleUI() {
      if (!hasView()) return;
      scheduleToggleBtn.textContent = scheduleConfig.enabled ? t('scanner.scheduleDisable') : t('scanner.scheduleEnable');
      scheduleToggleBtn.className = scheduleConfig.enabled ? 'btn btn-primary' : 'btn';
      scheduleOptions.style.display = scheduleConfig.enabled ? 'flex' : 'none';
      scheduleScanType.value = scheduleConfig.scanType || 'quick';
      scheduleInterval.value = String(scheduleConfig.intervalHours || 24);
      scheduleCustomRow.style.display = scheduleConfig.scanType === 'custom' ? 'flex' : 'none';
      scheduleFolderLabel.textContent = scheduleConfig.customPath || t('scanner.scheduleNoFolder');

      if (scheduleConfig.enabled) {
        const typeLabel = scheduleConfig.scanType === 'full' ? t('scanner.scheduleTypeFull')
          : scheduleConfig.scanType === 'custom' ? t('scanner.scheduleTypeCustom')
          : t('scanner.scheduleTypeQuick');
        scheduleStatusText.textContent =
          t('scanner.scheduleRunning', { type: typeLabel, freq: scheduleIntervalLabel(scheduleConfig.intervalHours), last: formatScheduleTimestamp(scheduleConfig.lastRun) });
      } else {
        scheduleStatusText.textContent = t('scanner.scheduleEnabled');
      }
    }

    async function loadSchedule() {
      try {
        const config = await window.api.invoke('schedule:get');
        if (!hasView()) return;
        scheduleConfig = Object.assign(
          { enabled: false, scanType: 'quick', customPath: null, intervalHours: 24, lastRun: null },
          config || {}
        );
        renderScheduleUI();
      } catch (e) {
        if (hasView()) scheduleStatusText.textContent = e.message || t('scanner.scheduleLoadError');
      }
    }

    async function saveSchedule() {
      try {
        const saved = await window.api.invoke('schedule:set', scheduleConfig);
        if (!hasView()) return;
        scheduleConfig = Object.assign({}, scheduleConfig, saved || {});
        renderScheduleUI();
      } catch (e) {
        if (hasView()) scheduleStatusText.textContent = e.message || t('scanner.scheduleSaveError');
      }
    }

    scheduleToggleBtn.addEventListener('click', () => {
      if (!scheduleToggleBtn) return;
      const enabling = !scheduleConfig.enabled;
      if (enabling && scheduleConfig.scanType === 'custom' && !scheduleConfig.customPath) {
        scheduleStatusText.textContent = t('scanner.scheduleChooseFolderFirst');
        return;
      }
      scheduleConfig.enabled = enabling;
      renderScheduleUI();
      saveSchedule();
    });

    scheduleScanType.addEventListener('change', () => {
      scheduleConfig.scanType = scheduleScanType.value;
      renderScheduleUI();
      saveSchedule();
    });

    scheduleInterval.addEventListener('change', () => {
      scheduleConfig.intervalHours = Number(scheduleInterval.value);
      saveSchedule();
    });

    btnScheduleFolder.addEventListener('click', async () => {
      const folder = await window.api.invoke('dialog:pickFolder');
      if (!folder) return;
      scheduleConfig.customPath = folder;
      renderScheduleUI();
      saveSchedule();
    });

    function setError(msg) {
      if (!hasView()) return;
      const errorResult = {
        scanType: activeAction === 'definitions' ? 'definitions' : activeSnapshot?.scanType || 'quick',
        status: 'failed',
        startedAt: activeStartedAt,
        completedAt: new Date().toISOString(),
        durationMs: activeStartedAt ? Date.now() - new Date(activeStartedAt).getTime() : 0,
        filesScanned: Number(activeSnapshot?.filesScanned || 0),
        threatsFound: Number(activeSnapshot?.threatsFound || 0),
        targetPaths: activeSnapshot?.targetPaths || [],
        completedTargets: activeSnapshot?.completedTargets || [],
        threats: [],
        errors: [msg],
        progress: activeProgress
      };
      hasResult = true;
      currentResult = errorResult;
      activeSnapshot = null;
      if (scanCard) scanCard.style.display = 'block';
      if (scanCard) scanCard.dataset.result = 'failed';
      if (scanProgressTitle) scanProgressTitle.textContent = t('scanner.statusScanFailed');
      if (scanPhaseBadge) {
        scanPhaseBadge.textContent = phaseLabel('failed');
        scanPhaseBadge.dataset.phase = 'failed';
      }
      if (scanStatus) scanStatus.textContent = t('scanner.statusError');
      if (scanDetail) scanDetail.textContent = msg;
      if (scanIcon) {
        scanIcon.className = 'status-icon danger';
        scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      }
      scanButtons.forEach((b) => {
        b.disabled = false;
        b.textContent = scanButtonOriginalLabels[b.id] || b.textContent;
      });
      isScanRunning = false;
      showReportButton = false;
      updateFooterButtons();
      applyPageState();
    }

    function isInteractiveTarget(target) {
      return !!target?.closest?.('button, a, input, select, textarea, label');
    }

    scanCard.addEventListener('click', (event) => {
      if (isInteractiveTarget(event.target)) return;
      setExpanded(!isExpanded);
    });
    expandButton.addEventListener('click', (event) => {
      event.stopPropagation();
      setExpanded(!isExpanded);
    });
    window.ScannerProgressView = {
      owner: container,
      expand() {
        const expanded = setExpanded(true);
        if (expanded && window.AppState) window.AppState.expandScanProgress = false;
        return expanded;
      },
      collapse() { setExpanded(false); },
      isExpanded() { return isExpanded; }
    };

    // Subscribe to scan progress events from main process
    this.cleanups.push(window.api.on('scan:progress', (data) => {
      if (!hasView()) return;
      if (data?.scanType === 'folderwatch') return;
      if (data) renderLiveSnapshot(data);
    }));

    this.cleanups.push(window.api.on('scan:complete', async (data) => {
      if (!data) return;
      if (data.scanType === 'folderwatch') return;
      if (window.AppRouter && window.AppRouter.current && window.AppRouter.current() !== 'scanner') return;

      if (data.scanType !== 'definitions') {
        try {
          const settings = await Api.getSettings();
          scanHistoryEnabled = !!settings.features.scanHistory;
        } catch (_) {
          scanHistoryEnabled = true;
        }
      }
      setComplete({ ...data, progress: data.pct ?? (data.status === 'completed' ? 100 : activeProgress) }, undefined, undefined, undefined, undefined, scanHistoryEnabled);
      loadSchedule();
    }));

    updateDefinitionsButton.addEventListener('click', async () => {
      if (isScanRunning) {
        setError(t('scanner.scanAlreadyRunning'));
        return;
      }
      activeAction = 'definitions';
      showReportButton = false;
      renderLiveSnapshot({
        scanType: 'definitions',
        pct: 10,
        phase: 'updating-definitions',
        startedAt: new Date().toISOString(),
        message: t('scanner.downloadingDefs')
      });
      updateDefinitionsButton.disabled = true;
      try {
        const res = await window.api.invoke('scan:updateDefinitions');
        if (!hasView()) return;
        if (!res.success) throw new Error(res.error || t('scanner.defsUpdateFailed'));
        await refreshStatus();
      } catch (e) {
        await refreshStatus();
        if (hasView() && (!scanCard || scanCard.style.display === 'none')) setError(e.message);
      } finally {
        if (hasView() && updateDefinitionsButton) updateDefinitionsButton.disabled = false;
      }
    });

    async function requestCancelScan(trigger) {
      if (!isScanRunning || activeAction !== 'virus') return;
      cancelButton.disabled = true;
      perCardCancelButtons.forEach((btn) => { btn.disabled = true; });
      scanStatus.textContent = t('scanner.statusCanceling');
      scanDetail.textContent = t('scanner.detailCanceling');
      try {
        await window.api.invoke('scan:abort');
      } catch (e) {
        cancelButton.disabled = false;
        perCardCancelButtons.forEach((btn) => { btn.disabled = false; });
        setError(e.message);
      }
    }

    cancelButton.addEventListener('click', () => requestCancelScan(cancelButton));
    perCardCancelButtons.forEach((btn) => btn.addEventListener('click', () => requestCancelScan(btn)));

    reportButton.addEventListener('click', () => window.AppRouter.navigate('reports'));

    dismissResultButton.addEventListener('click', async () => {
      if (!hasResult) return;
      try {
        await window.api.invoke('scan:dismissResult');
      } catch (_) {
        return;
      }
      hasResult = false;
      currentResult = null;
      activeSnapshot = null;
      activeAction = null;
      showReportButton = false;
      isExpanded = false;
      activeStartedAt = null;
      completedDurationMs = null;
      if (scanCard) {
        scanCard.style.display = 'none';
        delete scanCard.dataset.result;
      }
      window.ScanIndicatorView?.dismiss();
      updateFooterButtons();
      applyPageState();
    });

    async function startScan(scanType, runner, beforeStart) {
      if (isScanRunning) {
        setError(t('scanner.scanAlreadyRunning'));
        return;
      }
      activeAction = 'virus';
      showReportButton = false;
      renderLiveSnapshot({
        scanType,
        pct: 0,
        phase: 'preparing',
        startedAt: new Date().toISOString(),
        filesScanned: 0,
        threatsFound: 0,
        progressEstimated: scanType === 'full',
        message: t('scanner.phasePreparing')
      });
      if (beforeStart) beforeStart();
      try {
        const res = await runner();
        if (!hasView()) return;
        await refreshStatus();
        if (!isScanRunning && scanCard && scanCard.style.display === 'none') {
          setComplete(!!res.success, res.filesScanned || 0, res.threatsFound || 0, res.note || res.error, !!res.canceled);
        }
      } catch (e) {
        setError(e.message);
      }
    }

    document.getElementById('btnScannerQuick').addEventListener('click', async () => {
      startScan('quick', () => window.api.invoke('scan:quick'));
    });

    document.getElementById('btnScannerFull').addEventListener('click', async () => {
      startScan('full', () => window.api.invoke('scan:full'));
    });

    document.getElementById('btnScannerCustom').addEventListener('click', async () => {
      const folder = await window.api.invoke('dialog:pickFolder');
      if (!folder) return;
      startScan('custom', () => window.api.invoke('scan:custom', [folder]), () => {
        scanDetail.textContent = t('scanner.detailCustom', { folder });
      });
    });

    updateFooterButtons();
    (async () => {
      try {
        const settings = await Api.getSettings();
        scanHistoryEnabled = !!settings.features.scanHistory;
      } catch (_) {
        scanHistoryEnabled = true;
      }
      await refreshStatus();
    })();
    loadSchedule();
  }
};
