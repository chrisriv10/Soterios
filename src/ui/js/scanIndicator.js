(function () {
  const el = document.getElementById('scanIndicator');
  const fill = document.getElementById('scanIndicatorFill');
  const pct = document.getElementById('scanIndicatorPct');
  const msg = document.getElementById('scanIndicatorMsg');
  if (!el || !fill || !pct || !msg) return;
  const label = el.querySelector('.scan-indicator-label');
  const dot = el.querySelector('.scan-indicator-dot');

  let doneTimer = null;

  function show() {
    el.style.display = 'block';
  }

  function hide() {
    el.style.display = 'none';
  }

  function setProgress(percent, message) {
    if (percent === null) return; // Don't update progress if null (used during cancel)
    const p = Math.max(0, Math.min(100, percent || 0));
    fill.style.width = p + '%';
    pct.textContent = p + '%';
    if (message) msg.textContent = message;
  }

  function markDone(status, threatsFound = 0) {
    clearTimeout(doneTimer);
    el.classList.add('scan-indicator--done');
    if (status === 'canceled') {
      fill.style.width = pct.textContent;
      label.textContent = 'Scan canceled';
      msg.textContent = '';
      el.style.borderColor = 'rgba(234,179,8,0.35)';
      el.style.background = 'rgba(234,179,8,0.07)';
      if (dot) dot.style.background = '#eab308';
      if (pct) pct.style.color = '#eab308';
    } else if (status === 'failed') {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = 'Scan failed';
      el.style.borderColor = 'rgba(239,68,68,0.35)';
      el.style.background = 'rgba(239,68,68,0.07)';
      if (dot) dot.style.background = '#ef4444';
    } else if (threatsFound > 0) {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = 'Scan complete';
      msg.textContent = `${threatsFound} threat(s) found`;
      el.style.borderColor = 'rgba(239,68,68,0.35)';
      el.style.background = 'rgba(239,68,68,0.07)';
      if (dot) dot.style.background = '#ef4444';
    } else {
      fill.style.width = '100%';
      pct.textContent = '100%';
      label.textContent = 'Scan complete';
      msg.textContent = '';
    }
    doneTimer = setTimeout(() => {
      hide();
      el.classList.remove('scan-indicator--done');
      el.style.borderColor = '';
      el.style.background = '';
      if (dot) dot.style.background = '';
      if (pct) pct.style.color = '';
      label.textContent = 'Scanning\u2026';
      setProgress(0, '');
    }, 3000);
  }

  window.api.on('scan:progress', (data) => {
    clearTimeout(doneTimer);
    el.classList.remove('scan-indicator--done');
    el.style.borderColor = '';
    el.style.background = '';
    if (dot) dot.style.background = '';
    label.textContent = 'Scanning\u2026';
    show();
    setProgress(data.pct, data.message);
  });

  window.api.on('scan:complete', (data) => {
    markDone(data && data.status, data && data.threatsFound);
  });

  el.addEventListener('click', () => {
    if (window.AppRouter) window.AppRouter.navigate('scanner');
  });
})();
