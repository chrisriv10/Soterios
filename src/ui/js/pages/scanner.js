window.Pages = window.Pages || {};
window.Pages['scanner'] = {
  cleanups: [],
  destroy() {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
  },
  render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Virus Scan</h1>
        <p class="page-subtitle">Scan your system for threats using the ClamAV engine</p>
      </header>
      <div class="card" id="clamStatusCard" style="margin-bottom:24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
          <div>
            <h3 style="margin:0;">ClamAV Engine</h3>
            <p class="page-subtitle" id="clamStatusText" style="margin:4px 0 0;">Checking engine status...</p>
          </div>
          <button class="btn" id="btnUpdateDefinitions">Update Definitions</button>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="card">
          <h3>Quick Scan</h3>
          <p class="page-subtitle">Scans common startup locations and temp folders.</p>
          <button class="btn btn-primary" style="margin-top:12px;" id="btnScannerQuick">Start Quick Scan</button>
        </div>
        <div class="card">
          <h3>Full Scan</h3>
          <p class="page-subtitle">Scans entire C: drive (may take a while).</p>
          <button class="btn" style="margin-top:12px;" id="btnScannerFull">Start Full Scan</button>
        </div>
        <div class="card">
          <h3>Custom Scan</h3>
          <p class="page-subtitle">Choose a specific folder to scan.</p>
          <button class="btn" style="margin-top:12px;" id="btnScannerCustom">Select Folder\u2026</button>
        </div>
      </div>
      <div class="card" id="scanStatusCard" style="margin-top:24px; display:none;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="status-icon info" id="scanIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <div style="flex:1;">
            <div id="scanStatus" style="font-weight:600;">Ready</div>
            <div id="scanDetail" class="page-subtitle" style="font-size:0.85rem;"></div>
          </div>
        </div>
        <div style="margin-top:12px; display:flex; gap:10px;">
          <button class="btn btn-sm" id="btnCancelScan" disabled>Cancel Scan</button>
          <button class="btn btn-sm" id="btnOpenScanReports">View Scan Reports</button>
        </div>
        <div class="stat-bar-track" id="progressTrack" style="margin-top:12px; height:6px; border-radius:3px; overflow:hidden;">
          <div class="stat-bar-fill" id="scanProgressFill" style="width:0%; height:100%; background:var(--accent-primary); transition: width 0.3s ease;"></div>
        </div>
      </div>`;

    const progressFill = document.getElementById('scanProgressFill');
    const scanStatus = document.getElementById('scanStatus');
    const scanDetail = document.getElementById('scanDetail');
    const scanCard = document.getElementById('scanStatusCard');
    const scanIcon = document.getElementById('scanIcon');
    const clamStatusText = document.getElementById('clamStatusText');
    const updateDefinitionsButton = document.getElementById('btnUpdateDefinitions');
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
        if (scanStatus) scanStatus.textContent = 'Scanning\u2026';
        if (scanDetail) scanDetail.textContent = 'Please wait while files are checked.';
        if (scanIcon) {
          scanIcon.className = 'status-icon info';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        }
        setProgress(30);
        scanButtons.forEach((b) => {
          b.disabled = true;
          b.textContent = 'Scanning...';
        });
      } else {
        scanButtons.forEach((b) => {
          b.disabled = false;
          b.textContent = scanButtonOriginalLabels[b.id] || b.textContent;
        });
      }
      updateFooterButtons();
    }

    function setComplete(success, filesScanned, threatsFound, note, canceled, historyEnabled = true) {
      if (!hasView()) return;
      setProgress(100);
      if (activeAction === 'virus') {
        showReportButton = historyEnabled && (canceled || success);
      } else {
        showReportButton = false;
      }
      setScanning(false);
      if (canceled) {
        if (scanStatus) scanStatus.textContent = 'Scan Canceled';
        if (scanDetail) scanDetail.textContent = `${filesScanned} file(s) scanned before cancellation.` + (historyEnabled ? ' A scan report was saved.' : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon warning';
          scanIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        }
        updateFooterButtons();
        return;
      }
      if (success) {
        if (scanStatus) scanStatus.textContent = 'Scan Complete';
        if (scanDetail) scanDetail.textContent = `${filesScanned} file(s) scanned, ${threatsFound} threat(s) found.` + (note ? ' ' + note : '');
        if (scanIcon) {
          scanIcon.className = 'status-icon ' + (threatsFound > 0 ? 'danger' : 'safe');
          scanIcon.innerHTML = threatsFound > 0
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        }
      } else {
        if (scanStatus) scanStatus.textContent = 'Scan Failed';
        if (scanDetail) scanDetail.textContent = note || 'An error occurred during the scan.';
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
        }
        const engine = status.engine || status;
        if (!engine.ready) {
          if (clamStatusText) clamStatusText.textContent = 'ClamAV is not ready. The bundled scanner could not be found.';
        } else if (!engine.hasDefinitions) {
          if (clamStatusText) clamStatusText.textContent = 'Definitions are missing. They will be downloaded automatically before scanning.';
        } else {
          if (clamStatusText) clamStatusText.textContent = 'Ready with local ClamAV definitions.';
        }
      } catch (e) {
        if (hasView() && clamStatusText) clamStatusText.textContent = e.message || 'Unable to read ClamAV status.';
      }
    }

    function setError(msg) {
      if (!hasView()) return;
      if (scanCard) scanCard.style.display = 'block';
      if (scanStatus) scanStatus.textContent = 'Error';
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
      if (data && data.pct !== undefined) {
        if (data.scanType) {
          activeAction = data.scanType === 'definitions' ? 'definitions' : 'virus';
        }
        if (scanCard) scanCard.style.display = 'block';
        setProgress(data.pct);
        if (scanDetail) scanDetail.textContent = data.message || 'Scanning…';
      }
    }));

    this.cleanups.push(window.api.on('scan:complete', async (data) => {
      if (!data) return;
      if (window.AppRouter && window.AppRouter.current && window.AppRouter.current() !== 'scanner') return;

      const canceled = data.status === 'canceled';

      // ✅ Handle definition updates separately (prevents "0 threats found")
      if (data.scanType === 'definitions') {
        scanStatus.textContent = data.status === 'failed'
          ? 'Definition Update Failed'
          : 'Definitions Updated';

        scanDetail.textContent = data.status === 'failed'
          ? (data.note || data.error || 'Update failed.')
          : (data.note || 'ClamAV signatures are ready.');

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
    }));

    updateDefinitionsButton.addEventListener('click', async () => {
      if (isScanRunning) {
        setError('A scan is already in progress. Cancel it or wait for it to complete before updating definitions.');
        return;
      }
      activeAction = 'definitions';
      isScanRunning = true;
      showReportButton = false;
      updateFooterButtons();
      scanCard.style.display = 'block';
      scanStatus.textContent = 'Updating Definitions';
      scanDetail.textContent = 'Downloading the latest ClamAV signatures...';
      setProgress(10);
      updateDefinitionsButton.disabled = true;
      try {
        const res = await window.api.invoke('scan:updateDefinitions');
        if (!hasView()) return;
        if (!res.success) throw new Error(res.error || 'Definition update failed.');
        scanStatus.textContent = 'Definitions Updated';
        scanDetail.textContent = 'ClamAV signatures are ready.';
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
      scanStatus.textContent = 'Canceling Scan';
      scanDetail.textContent = 'Stopping the active scanner process...';
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
        setError('A scan is already in progress. Cancel it or wait for it to complete before starting another scan.');
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
        scanDetail.textContent = 'Scanning ' + folder + '\u2026';
      });
    });

    updateFooterButtons();
    refreshStatus();
  }
};
