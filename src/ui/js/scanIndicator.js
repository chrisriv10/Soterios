(function () {
  const el = document.getElementById('scanIndicator');
  const fill = document.getElementById('scanIndicatorFill');
  const pct = document.getElementById('scanIndicatorPct');
  const msg = document.getElementById('scanIndicatorMsg');
  const openTrigger = document.getElementById('scanIndicatorOpen');
  const cancelBtn = document.getElementById('btnScanIndicatorCancel');
  if (!el || !openTrigger || !fill || !pct || !msg) return;
  const label = el.querySelector('.scan-indicator-label');
  const dot = el.querySelector('.scan-indicator-dot');

  const t = (key, vars) => window.I18n?.t(key, vars) ?? key;

  let doneTimer = null;
  let progressTimer = null;
  let currentScanType = null;
  const PROGRESS_THROTTLE_MS = 500;

  function show() {
    el.style.display = 'block';
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-block';
      cancelBtn.disabled = false;
    }
  }

  function hide() {
    el.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  function setProgress(percent, message) {
    if (percent === null) return;
    const p = Math.max(0, Math.min(100, percent || 0));
    fill.style.width = p + '%';
    pct.textContent = p + '%';
    if (message) msg.textContent = message;
  }

  function markDone(status, threatsFound = 0, scanType = null) {
    clearTimeout(doneTimer);
    clearTimeout(progressTimer);
    el.classList.add('scan-indicator--done');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const isDefs = scanType === 'definitions';
    if (status === 'canceled') {
      fill.style.width = pct.textContent;
      label.textContent = t('scanIndicator.canceled');
      msg.textContent = '';
      el.style.borderColor = 'rgba(234,179,8,0.35)';
      el.style.background = 'rgba(234,179,8,0.07)';
      if (dot) dot.style.background = '#eab308';
      if (pct) pct.style.color = '#eab308';
    } else if (status === 'failed') {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = isDefs ? t('scanIndicator.defsUpdateFailed') : t('scanIndicator.failed');
      el.style.borderColor = 'rgba(239,68,68,0.35)';
      el.style.background = 'rgba(239,68,68,0.07)';
      if (dot) dot.style.background = '#ef4444';
    } else if (threatsFound > 0) {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = t('scanIndicator.complete');
      msg.textContent = t('scanIndicator.threatsFound', { count: threatsFound });
      el.style.borderColor = 'rgba(239,68,68,0.35)';
      el.style.background = 'rgba(239,68,68,0.07)';
      if (dot) dot.style.background = '#ef4444';
    } else {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = isDefs ? t('scanIndicator.defsUpdated') : t('scanIndicator.complete');
      msg.textContent = '';
    }
    doneTimer = setTimeout(() => {
      hide();
      el.classList.remove('scan-indicator--done');
      el.style.borderColor = '';
      el.style.background = '';
      if (dot) dot.style.background = '';
      if (pct) pct.style.color = '';
      label.textContent = t('scanIndicator.scanning');
      setProgress(0, '');
    }, 3000);
  }

  window.api.on('scan:progress', (data) => {
    // Folder-watch scans run in the background and must not show the bar.
    if (data && data.scanType === 'folderwatch') return;
    clearTimeout(doneTimer);
    el.classList.remove('scan-indicator--done');
    el.style.borderColor = '';
    el.style.background = '';
    if (dot) dot.style.background = '';
    currentScanType = (data && data.scanType) || null;
    label.textContent = currentScanType === 'definitions'
      ? t('scanIndicator.updatingDefs')
      : t('scanIndicator.scanning');
    show();
    
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      setProgress(data.pct, data.message);
    }, PROGRESS_THROTTLE_MS);
  });

  window.api.on('scan:complete', (data) => {
    // Folder-watch scans run in the background and must not touch the bar.
    if (data && data.scanType === 'folderwatch') return;
    markDone(data && data.status, data && data.threatsFound, data && data.scanType);
  });

  function openScanDetails() {
    if (!window.AppRouter) return;
    if (window.AppState) window.AppState.focusScanProgress = true;
    window.AppRouter.navigate('scanner');
    requestAnimationFrame(() => {
      const panel = document.getElementById('scanStatusCard');
      if (!panel || panel.style.display === 'none') return;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      panel.focus({ preventScroll: true });
      if (window.AppState) window.AppState.focusScanProgress = false;
    });
  }

  openTrigger.addEventListener('click', openScanDetails);
  openTrigger.addEventListener('keydown', (event) => {
    if (event.target !== openTrigger) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openScanDetails();
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      cancelBtn.disabled = true;
      try {
        await window.api.invoke('scan:abort');
        // scan:complete will fire and hide the indicator; no need to act here.
      } catch (_) {
        cancelBtn.disabled = false;
      }
    });
  }
})();
