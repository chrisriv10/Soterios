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
      <div style="overflow-y: auto; max-height: calc(100vh - 80px); padding-right: 8px;">
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('scanner.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('scanner.subtitle'))}</p>
      </header>
      <div class="card" id="clamStatusCard" style="margin-bottom:24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
          <div>
            <h3 style="margin:0;">${escapeHtml(t('scanner.clamavEngine'))}</h3>
            <p class="page-subtitle" id="clamStatusText" style="margin:4px 0 0;">${escapeHtml(t('scanner.checkingStatus'))}</p>
          </div>
          <button class="btn" id="btnUpdateDefinitions">${escapeHtml(t('scanner.updateDefinitions'))}</button>
        </div>
      </div>
      <div class="scanner-grid">
        <div class="card">
          <h3>${escapeHtml(t('scanner.quickScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.quickDesc'))}</p>
          <button class="btn btn-primary" style="margin-top:12px;" id="btnScannerQuick">${escapeHtml(t('scanner.quickStart'))}</button>
        </div>
        <div class="card">
          <h3>${escapeHtml(t('scanner.fullScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.fullDesc'))}</p>
          <button class="btn" style="margin-top:12px;" id="btnScannerFull">${escapeHtml(t('scanner.fullStart'))}</button>
        </div>
        <div class="card">
          <h3>${escapeHtml(t('scanner.customScan'))}</h3>
          <p class="page-subtitle">${escapeHtml(t('scanner.customDesc'))}</p>
          <button class="btn" style="margin-top:12px;" id="btnScannerCustom">${escapeHtml(t('scanner.customSelect'))}</button>
        </div>
      </div>
      <div class="card" id="scheduleCard" style="margin-top:24px;">
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
      <div class="card" id="scanStatusCard" style="margin-top:24px; display:none;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="status-icon info" id="scanIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div style="flex:1;">
            <div id="scanStatus" style="font-weight:600;">${escapeHtml(t('scanner.statusReady'))}</div>
            <div id="scanDetail" class="page-subtitle" style="font-size:0.85rem;"></div>
          </div>
        </div>
        <div style="margin-top:12px; display:flex; gap:10px;">
          <button class="btn btn-sm" id="btnCancelScan" disabled>${escapeHtml(t('scanner.cancelScan'))}</button>
          <button class="btn btn-sm" id="btnOpenScanReports">${escapeHtml(t('scanner.viewReports'))}</button>
        </div>
        <div class="stat-bar-track" id="progressTrack" style="margin-top:12px; height:6px; border-radius:3px; overflow:hidden;">
          <div class="stat-bar-fill" id="scanProgressFill" style="width:0%; height:100%; background:var(--accent-primary); transition: width 0.3s ease;"></div>
        </div>
      </div>
      </div>`;

    const progressFill = document.getElementById('scanProgressFill');
    const scanStatus = document.getElementById('scanStatus');
    const scanDetail = document.getElementById('scanDetail');
    const scanCard = document.getElementById('scanStatusCard');
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
    const scanButtons = Array.from(document.querySelectorAll('#btnScannerQuick, #btnScannerFull, #btnScannerCustom'));
    const scanButtonOriginalLabels = {};
    scanButtons.forEach((btn) => { scanButtonOriginalLabels[btn.id] = btn.textContent; });
    let isScanRunning = false;
    let activeAction = null;
    let showReportButton = false;
    let scanHistoryEnabled = true;
    let alive = true;
    this.cleanups.push(() => { alive = false; });

    function updateFooterButtons() {
      if (!cancelButton || !reportButton) return;
      const showCancel = activeAction === 'virus' && isScanRunning;
      const showReports = activeAction === 'virus' && showReportButton;
      cancelButton.style.display = showCancel ? 'inline-block' : 'none';
      reportButton.style.display = showReports ? 'inline-block' : 'none';
      cancelButton.disabled = !showCancel;
      reportButton.disabled = !showReports;
    }

    function hasView() {
      return alive && document.body.contains(container);
    }

    function setProgress(pct) {
      if (!hasView() || !progressFill) return;
      progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
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
        setProgress(30);
        scanButtons.forEach((b) => {
          b.disabled = true;
          b.textContent = t('scanner.statusScanning');
        });
      } else {
        if (scanCard) scanCard.style.display = 'none';
        scanButtons.forEach((b) => {
          b.disabled = false;
          b.textContent = scanButtonOriginalLabels[b.id] || b.textContent;
        });
      }
      updateFooterButtons();
    }

    function setComplete(success, filesScanned, threatsFound, note, canceled, historyEnabled = true) {
      if (!hasView()) return;
      if (activeAction === 'virus') {
        showReportButton = historyEnabled && (canceled || success);
      } else {
        showReportButton = false;
      }
      setScanning(false);
      if (canceled) {
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanCanceled');
        if (scanDetail) scanDetail.textContent = t('scanner.detailCanceled', { count: filesScanned }) + (historyEnabled ? ' ' + t('common.scanReportSaved') : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon warning';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/></svg>';
        }
        updateFooterButtons();
        return;
      }
      setProgress(100);
      if (success) {
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanComplete');
        if (scanDetail) scanDetail.textContent = t('scanner.detailComplete', { count: filesScanned, threats: threatsFound }) + (note ? ' ' + note : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon ' + (threatsFound > 0 ? 'danger' : 'safe');
          scanIcon.innerHTML = threatsFound > 0
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><circle cx="12" cy="12" r="5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.3 18.3l-2.1-2.1"/><path d="M18.3 5.6l-2.1 2.1"/><path d="M5.6 18.3l2.1-2.1"/><circle cx="10" cy="10" r=".5"/><circle cx="14.5" cy="10.5" r=".5"/><circle cx="13" cy="14.5" r=".5"/><circle cx="9.5" cy="14" r=".5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        }
      } else {
        if (scanStatus) scanStatus.textContent = t('scanner.statusScanFailed');
        if (scanDetail) scanDetail.textContent = note || t('scanner.statusScanFailed');
        if (scanIcon) {
          scanIcon.className = 'status-icon danger';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        }
      }
      updateFooterButtons();
    }

    async function refreshStatus() {
      try {
        const status = await window.api.invoke('scan:status');
        if (!hasView()) return;
        if (status.scan && status.scan.isScanning) {
          activeAction = status.scan.currentScan && status.scan.currentScan.scanType === 'definitions' ? 'definitions' : 'virus';
          setScanning(true);
          // Restore progress if available
          if (status.scan.progress !== undefined) {
            setProgress(status.scan.progress);
          }
          if (status.scan.filesScanned !== undefined && scanDetail) {
            scanDetail.textContent = t('scan.progress', { files: status.scan.filesScanned, pct: status.scan.progress || 0 });
          }
          // Force scan card to be visible
          if (scanCard) scanCard.style.display = 'block';
        } else {
          setScanning(false);
        }
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
      if (scanCard) scanCard.style.display = 'block';
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
    }

    // Subscribe to scan progress events from main process
    this.cleanups.push(window.api.on('scan:progress', (data) => {
      if (!hasView()) return;
      if (data?.scanType === 'folderwatch') return;
      if (data && data.pct !== undefined) {
        if (data.scanType) {
          activeAction = data.scanType === 'definitions' ? 'definitions' : 'virus';
        }
        if (scanCard) scanCard.style.display = 'block';
        setProgress(data.pct);
        if (scanDetail) scanDetail.textContent = data.message || t('scanner.statusScanning');
      }
    }));

    this.cleanups.push(window.api.on('scan:complete', async (data) => {
      if (!data) return;
      if (data.scanType === 'folderwatch') return;
      if (window.AppRouter && window.AppRouter.current && window.AppRouter.current() !== 'scanner') return;

      const canceled = data.status === 'canceled';

      // ✅ Handle definition updates separately (prevents "0 threats found")
      if (data.scanType === 'definitions') {
        scanStatus.textContent = data.status === 'failed'
          ? t('scanner.defsUpdateFailed')
          : t('scanner.defsUpdated');

        scanDetail.textContent = data.status === 'failed'
          ? (data.note || data.error || t('scanner.defsUpdateFailed'))
          : (data.note || t('scanner.defsReady'));

        setProgress(100);
        isScanRunning = false;
        activeAction = null;
        showReportButton = false;
        updateFooterButtons();
        return;
      }

      // normal virus scan flow
      if (data.scanType) activeAction = 'virus';

      try {
        const settings = await Api.getSettings();
        scanHistoryEnabled = !!settings.features.scanHistory;
      } catch (_) {
        scanHistoryEnabled = true;
      }

      setComplete(
        !canceled && data.status !== 'failed',
        data.filesScanned || 0,
        data.threatsFound || 0,
        data.note || data.error || '',
        canceled,
        scanHistoryEnabled
      );
      loadSchedule();
    }));

    updateDefinitionsButton.addEventListener('click', async () => {
      if (isScanRunning) {
        setError(t('scanner.scanAlreadyRunning'));
        return;
      }
      activeAction = 'definitions';
      isScanRunning = true;
      showReportButton = false;
      updateFooterButtons();
      scanCard.style.display = 'block';
      scanStatus.textContent = t('scanner.updatingDefs');
      scanDetail.textContent = t('scanner.downloadingDefs');
      setProgress(10);
      updateDefinitionsButton.disabled = true;
      try {
        const res = await window.api.invoke('scan:updateDefinitions');
        if (!hasView()) return;
        if (!res.success) throw new Error(res.error || t('scanner.defsUpdateFailed'));
        scanStatus.textContent = t('scanner.defsUpdated');
        scanDetail.textContent = t('scanner.defsReady');
        setProgress(100);
        await refreshStatus();
      } catch (e) {
        setError(e.message);
      } finally {
        isScanRunning = false;
        activeAction = null;
        showReportButton = false;
        updateFooterButtons();
        if (hasView() && updateDefinitionsButton) updateDefinitionsButton.disabled = false;
      }
    });

    cancelButton.addEventListener('click', async () => {
      if (!isScanRunning || activeAction !== 'virus') return;
      cancelButton.disabled = true;
      scanStatus.textContent = t('scanner.statusCanceling');
      scanDetail.textContent = t('scanner.detailCanceling');
      try {
        await window.api.invoke('scan:abort');
        if (!hasView()) return;
        setComplete(false, 0, 0, '', true);
      } catch (e) {
        setError(e.message);
      }
    });

    reportButton.addEventListener('click', () => window.AppRouter.navigate('reports'));

    async function startScan(runner, beforeStart) {
      if (isScanRunning) {
        setError(t('scanner.scanAlreadyRunning'));
        return;
      }
      activeAction = 'virus';
      showReportButton = false;
      setScanning(true);
      if (beforeStart) beforeStart();
      try {
        const res = await runner();
        if (!hasView()) return;
        setComplete(!!res.success, res.filesScanned || 0, res.threatsFound || 0, res.note || res.error, !!res.canceled);
        await refreshStatus();
      } catch (e) {
        setError(e.message);
      }
    }

    document.getElementById('btnScannerQuick').addEventListener('click', async () => {
      startScan(() => window.api.invoke('scan:quick'));
    });

    document.getElementById('btnScannerFull').addEventListener('click', async () => {
      startScan(() => window.api.invoke('scan:full'));
    });

    document.getElementById('btnScannerCustom').addEventListener('click', async () => {
      const folder = await window.api.invoke('dialog:pickFolder');
      if (!folder) return;
      startScan(() => window.api.invoke('scan:custom', [folder]), () => {
        scanDetail.textContent = t('scanner.detailCustom', { folder });
      });
    });

    updateFooterButtons();
    refreshStatus();
    loadSchedule();
  }
};