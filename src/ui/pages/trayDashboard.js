window.api.on('tray:summary', (summary) => {
  if (!summary) return;

  const scoreEl = document.getElementById('scoreEl');
  const detailEl = document.getElementById('detailEl');
  const rtpDot = document.getElementById('rtpDot');
  const rtpLabel = document.getElementById('rtpLabel');
  const rtpStatus = document.getElementById('rtpStatus');
  const fwDot = document.getElementById('fwDot');
  const fwStatus = document.getElementById('fwStatus');
  const rxRate = document.getElementById('rxRate');
  const txRate = document.getElementById('txRate');
  const lastScan = document.getElementById('lastScan');

  // Score
  if (summary.score != null) {
    scoreEl.textContent = summary.score;
    scoreEl.className = 'score ' + (summary.score >= 80 ? 'pass' : summary.score >= 50 ? 'warn' : 'fail');
  } else {
    scoreEl.textContent = '—';
    scoreEl.className = 'score';
  }
  detailEl.textContent = summary.detail || 'Health summary unavailable.';

  // RTP
  if (summary.rtp) {
    rtpDot.className = 'status-dot ' + (summary.rtp.enabled ? 'active' : 'inactive');
    rtpLabel.textContent = summary.rtp.enabled ? 'RTP Active' : 'RTP Disabled';
    rtpStatus.textContent = summary.rtp.enabled ? 'Monitoring file system' : 'Click to enable';
  } else {
    rtpDot.className = 'status-dot unknown';
    rtpLabel.textContent = 'RTP Unknown';
    rtpStatus.textContent = '—';
  }

  // Firewall
  if (summary.firewall) {
    fwDot.className = 'status-dot ' + (summary.firewall.active ? 'active' : 'inactive');
    fwStatus.textContent = summary.firewall.active ? 'Active' : 'Disabled';
  } else {
    fwDot.className = 'status-dot unknown';
    fwStatus.textContent = '—';
  }

  // Network rates
  if (summary.network) {
    document.getElementById('rxRate').textContent = summary.network.rxKBs || 0;
    document.getElementById('txRate').textContent = summary.network.txKBs || 0;
    drawSparkline(summary.network.history || []);
  }

  // Last scan
  if (summary.lastScan) {
    const scan = summary.lastScan;
    const when = scan.timestamp ? new Date(scan.timestamp).toLocaleString() : 'Unknown';
    document.getElementById('lastScan').textContent =
      `${when} · ${scan.filesScanned || 0} files · ${scan.threatsFound || 0} threats`;
  }
});

async function loadSummary() {
  try {
    const summary = await window.api.invoke('tray:getSummary');
    if (summary) {
      const scoreEl = document.getElementById('scoreEl');
      const detailEl = document.getElementById('detailEl');
      if (summary.score != null) {
        scoreEl.textContent = summary.score;
        scoreEl.className = 'score ' + (summary.score >= 80 ? 'pass' : summary.score >= 50 ? 'warn' : 'fail');
      }
      detailEl.textContent = summary.detail || 'Health summary unavailable.';

      // Update RTP, firewall, network, last scan from summary
      if (summary.rtp) {
        const rtpDot = document.getElementById('rtpDot');
        const rtpLabel = document.getElementById('rtpLabel');
        const rtpStatus = document.getElementById('rtpStatus');
        rtpDot.className = 'status-dot ' + (summary.rtp.enabled ? 'active' : 'inactive');
        rtpLabel.textContent = summary.rtp.enabled ? 'RTP Active' : 'RTP Disabled';
        rtpStatus.textContent = summary.rtp.enabled ? 'Monitoring file system' : 'Click to enable';
      }
      if (summary.firewall) {
        const fwDot = document.getElementById('fwDot');
        const fwStatus = document.getElementById('fwStatus');
        fwDot.className = 'status-dot ' + (summary.firewall.active ? 'active' : 'inactive');
        fwStatus.textContent = summary.firewall.active ? 'Active' : 'Disabled';
      }
      if (summary.network) {
        document.getElementById('rxRate').textContent = summary.network.rxKBs || 0;
        document.getElementById('txRate').textContent = summary.network.txKBs || 0;
        drawSparkline(summary.network.history || []);
      }
      if (summary.lastScan) {
        const scan = summary.lastScan;
        const when = scan.timestamp ? new Date(scan.timestamp).toLocaleString() : 'Unknown';
        document.getElementById('lastScan').textContent =
          `${when} · ${scan.filesScanned || 0} files · ${scan.threatsFound || 0} threats`;
      }
    }
  } catch (e) {
    console.error('Failed to load tray summary:', e);
    document.getElementById('detailEl').textContent = 'Unable to load health summary.';
  }
}

function drawSparkline(history) {
  const canvas = document.getElementById('sparkCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!history.length) return;

  const maxVal = Math.max(...history, 1);
  const minVal = Math.min(...history);
  const range = maxVal - minVal || 1;

  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  history.forEach((val, i) => {
    const x = (i / (history.length - 1 || 1)) * rect.width;
    const y = rect.height - ((val - minVal) / range) * rect.height * 0.85 - rect.height * 0.075;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, rect.height);
  grad.addColorStop(0, 'rgba(88,166,255,0.15)');
  grad.addColorStop(1, 'rgba(88,166,255,0)');
  ctx.fillStyle = grad;
  ctx.lineTo(rect.width, rect.height);
  ctx.lineTo(0, rect.height);
  ctx.closePath();
  ctx.fill();
}

document.getElementById('btnQuickScan').addEventListener('click', async () => {
  const btn = document.getElementById('btnQuickScan');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  try {
    await window.api.invoke('scan:quick');
    btn.textContent = 'Quick Scan';
  } catch (e) {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Quick Scan'; }, 2000);
  }
});

document.getElementById('btnOpen').addEventListener('click', () => {
  window.api.invoke('tray:openMain');
});

loadSummary();
setInterval(loadSummary, 15000); // Refresh every 15s