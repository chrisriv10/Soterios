'use strict';

/**
 * Shared health summary for tray popup and IPC handlers.
 * @param {import('../core/database')} db
 * @param {{ run: Function }} toolRegistry
 */
async function getTrayHealthSummary(db, toolRegistry) {
  const latest = db.getLatestScanReport();
  const passwordScore = db.getSetting('feature.lastPasswordScore', null);
  const result = await toolRegistry.run('health-score', {
    lastScanMatches: latest ? latest.threats_found : null,
    lastScanDate: latest ? latest.timestamp : null,
    passwordScore: passwordScore === null ? null : Number(passwordScore)
  }, { db });

  if (!result.ok) {
    return { score: null, detail: result.error || 'Health score unavailable.' };
  }

  const disk = result.data.breakdown?.disk;

  // RTP status
  let rtp = { enabled: false };
  try {
    const { RealTimeWatcher } = require('../security/RealTimeWatcher');
    // Check if RTP is enabled in settings
    const rtpEnabled = db.getSetting('feature.realtimeProtection', false);
    rtp = { enabled: rtpEnabled };
  } catch (_) {}

  // Firewall status
  let firewall = { active: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('netsh', ['advfirewall', 'show', 'allprofiles', 'state'], { timeout: 5000 });
    firewall = { active: /ON|ENABLED/i.test(stdout) };
  } catch (_) {}

  // Network traffic history (last 24h)
  let network = { rxKBs: 0, txKBs: 0, history: [] };
  try {
    const history = db.getNetworkHistory ? db.getNetworkHistory(24 * 60) : []; // last 24h, 1 sample per min
    if (history.length) {
      const latest = history[history.length - 1];
      network.rxKBs = Math.round((latest.rx_bytes || 0) / 1024);
      network.txKBs = Math.round((latest.tx_bytes || 0) / 1024);
      network.history = history.slice(-60).map(h => (h.tx_bytes + h.rx_bytes) / 1024); // last 60 samples for sparkline
    }
  } catch (_) {}

  // Last scan info
  let lastScan = null;
  if (latest) {
    lastScan = {
      timestamp: latest.timestamp,
      filesScanned: latest.files_scanned,
      threatsFound: latest.threats_found
    };
  }

  return {
    score: result.data.score,
    detail: disk?.reason || 'Protection and resource summary ready.',
    rtp,
    firewall,
    network,
    lastScan
  };
}

module.exports = { getTrayHealthSummary };