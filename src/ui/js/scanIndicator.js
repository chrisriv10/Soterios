(function () {
  const el = document.getElementById('scanIndicator');
  const fill = document.getElementById('scanIndicatorFill');
  const pct = document.getElementById('scanIndicatorPct');
  const msg = document.getElementById('scanIndicatorMsg');
  const label = el.querySelector('.scan-indicator-label');

  let doneTimer = null;

  function show() {
    el.style.display = 'block';
  }

  function hide() {
    el.style.display = 'none';
  }

  function setProgress(percent, message) {
    const p = Math.max(0, Math.min(100, percent || 0));
    fill.style.width = p + '%';
    pct.textContent = p + '%';
    if (message) msg.textContent = message;
  }

  function markDone(status) {
    clearTimeout(doneTimer);
    el.classList.add('scan-indicator--done');
    fill.style.width = '100%';
    pct.textContent = '100%';
    if (status === 'canceled') {
      label.textContent = 'Scan canceled';
      msg.textContent = '';
    } else if (status === 'failed') {
      label.textContent = 'Scan failed';
      el.style.borderColor = 'rgba(239,68,68,0.35)';
      el.style.background = 'rgba(239,68,68,0.07)';
      el.querySelector('.scan-indicator-dot').style.background = '#ef4444';
    } else {
      label.textContent = 'Scan complete';
      msg.textContent = '';
    }
    doneTimer = setTimeout(() => {
      hide();
      el.classList.remove('scan-indicator--done');
      el.style.borderColor = '';
      el.style.background = '';
      el.querySelector('.scan-indicator-dot').style.background = '';
      label.textContent = 'Scanning\u2026';
      setProgress(0, '');
    }, 3000);
  }

  window.api.on('scan:progress', (data) => {
    clearTimeout(doneTimer);
    el.classList.remove('scan-indicator--done');
    el.style.borderColor = '';
    el.style.background = '';
    el.querySelector('.scan-indicator-dot').style.background = '';
    label.textContent = 'Scanning\u2026';
    show();
    setProgress(data.pct, data.message);
  });

  window.api.on('scan:complete', (data) => {
    markDone(data.status);
  });

  el.addEventListener('click', () => {
    if (window.AppRouter) window.AppRouter.navigate('scanner');
  });
})();
