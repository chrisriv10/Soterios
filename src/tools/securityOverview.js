const si = require('systeminformation');
const { getDefenderStatus, getFirewallStatus, getUpdateStatus } = require('../security/windowsChecks');

/**
 * Append an issue object to the issues array.
 *
 * @param {Array} issues
 * @param {string} id
 * @param {string} level
 * @param {string} title
 * @param {string} detail
 * @param {number} points
 * @param {string} actionPage
 */
function addIssue(issues, id, level, title, detail, points, actionPage) {
  issues.push({ id, level, title, detail, points, actionPage });
}

/**
 * Convert a numeric health score into a display level.
 *
 * @param {number} score
 * @returns {'ok'|'warn'|'danger'}
 */
function levelForScore(score) {
  if (score >= 80) return 'ok';
  if (score >= 60) return 'warn';
  return 'danger';
}

/**
 * Build the security overview payload.
 *
 * Aggregates Defender, firewall, Windows Update, disk, CPU/memory, scan,
 * and quarantine state into a scored overview.
 *
 * @param {Object} ctx
 * @param {object} [ctx.db]
 * @returns {Promise<Object>}
 */
async function buildSecurityOverview(ctx) {
  const ignored = ctx.db && typeof ctx.db.getIgnoredWarnings === 'function'
    ? ctx.db.getIgnoredWarnings().map((w) => w.id)
    : [];
  const [defender, firewall, updates, fsSize, load, mem] = await Promise.all([
    getDefenderStatus(), getFirewallStatus(), getUpdateStatus(),
    si.fsSize(), si.currentLoad(), si.mem()
  ]);

  const issues = [];
  let score = 100;

  // Defender — only penalise/warn when we have a real reading and something is wrong.
  // If all three fallback strategies couldn't reach Defender, skip silently (not the user's fault).
  if (defender.available) {
    if (!defender.antivirusEnabled) {
      addIssue(issues, 'defender-antivirus-disabled', 'danger', 'Microsoft Defender antivirus is disabled', 'Enable antivirus protection in Windows Security.', 24, 'dashboard');
      score -= 24;
    }
    if (!defender.realTimeProtectionEnabled) {
      addIssue(issues, 'defender-rtp-disabled', 'danger', 'Real-time protection is disabled', 'Turn on real-time protection to block threats as they appear.', 24, 'dashboard');
      score -= 24;
    }
    if (Number(defender.signaturesAge) > 7) {
      addIssue(issues, 'defender-signatures-stale', 'warn', 'Defender signatures are stale', `Signature age is ${defender.signaturesAge} day(s). Open Windows Security to update.`, 10, 'dashboard');
      score -= 10;
    }
  }
  // If defender.available is false we leave score alone and show nothing in recommendations.
  // The dashboard tiles will still display "Unavailable" in the status grid.

  // Firewall
  const disabledProfiles = firewall.filter((p) => !p.enabled);
  if (disabledProfiles.length) {
    addIssue(issues, 'firewall-disabled', 'danger', 'Windows Firewall is disabled', `${disabledProfiles.map((p) => p.name).join(', ')} profile(s) are off.`, 18, 'dashboard');
    score -= 18;
  }

  // Updates — only surface actionable info; never add a warning just because we couldn't query
  if (updates.pendingCount !== null && updates.pendingCount !== undefined) {
    if (updates.pendingCount > 0) {
      const label = updates.lastUpdateTitle || `${updates.pendingCount} update(s) waiting to install`;
      addIssue(issues, 'windows-updates-pending', 'warn', 'Windows updates are pending', label, Math.min(15, 5 + updates.pendingCount), 'settings');
      score -= Math.min(15, 5 + updates.pendingCount);
    }
  }
  // pendingCount === null means we couldn't query — silently skip, no score penalty

  // Scan history
  const latestScan = ctx.db && typeof ctx.db.getLatestScanReport === 'function' ? ctx.db.getLatestScanReport() : null;
  if (!latestScan) {
    addIssue(issues, 'scan-missing', 'warn', 'No baseline file scan has been run', 'Run a scan to establish local file risk history.', 8, 'scanner');
    score -= 8;
  } else if (latestScan.threats_found > 0) {
    const flagged = latestScan.threats_found;
    addIssue(issues, 'scan-threats-found', flagged > 3 ? 'danger' : 'warn', 'Recent scan found flagged files', `${flagged} file(s) were flagged.`, Math.min(24, flagged * 6), 'scanner');
    score -= Math.min(24, flagged * 6);
  }

  // Quarantine
  const activeQuarantine = ctx.db && typeof ctx.db.getQuarantineList === 'function' ? ctx.db.getQuarantineList() : [];
  if (activeQuarantine.length) {
    addIssue(issues, 'quarantine-review', 'warn', 'Quarantine needs review', `${activeQuarantine.length} quarantined item(s) awaiting decision.`, Math.min(8, activeQuarantine.length * 2), 'quarantine');
    score -= Math.min(8, activeQuarantine.length * 2);
  }

  // Disk
  const disk = fsSize[0] || null;
  if (disk && disk.use >= 90) { addIssue(issues, 'disk-critical', 'danger', 'Primary disk space is critically low', `${disk.mount} is ${disk.use.toFixed(1)}% used.`, 14, 'tools'); score -= 14; }
  else if (disk && disk.use >= 80) { addIssue(issues, 'disk-low', 'warn', 'Primary disk space is getting low', `${disk.mount} is ${disk.use.toFixed(1)}% used.`, 6, 'tools'); score -= 6; }

  // CPU/Memory
  const memoryUse = ((mem.total - mem.available) / mem.total) * 100;
  if (load.currentLoad >= 90 || memoryUse >= 92) {
    addIssue(issues, 'system-pressure-high', 'warn', 'System pressure is high', `CPU ${load.currentLoad.toFixed(1)}%, memory ${memoryUse.toFixed(1)}%.`, 6, 'processes');
    score -= 6;
  }

  const visibleIssues = issues.filter((i) => !ignored.includes(i.id));
  const ignoredIssues = issues.filter((i) => ignored.includes(i.id));
  const ignoredPoints = ignoredIssues.reduce((sum, i) => sum + (i.points || 0), 0);
  score = Math.min(100, score + ignoredPoints);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const recommendations = visibleIssues.length
    ? visibleIssues.map((i) => ({ id: i.id, level: i.level, title: i.title, detail: i.detail, actionPage: i.actionPage }))
    : [{ level: 'ok', title: 'No urgent security actions', detail: 'Core Windows protections and recent checks look healthy.', actionPage: 'dashboard' }];

  return {
    generatedAt: new Date().toISOString(), score, level: levelForScore(score),
    defender, firewall, updates, suspiciousProcesses: 0,
    disk: disk ? { mount: disk.mount, usePercent: +disk.use.toFixed(1), size: disk.size, used: disk.used } : null,
    system: { cpuLoad: +load.currentLoad.toFixed(1), memoryUse: +memoryUse.toFixed(1) },
    issues: visibleIssues, ignoredIssues, recommendations
  };
}

module.exports = {
  id: 'security-overview', name: 'Security Overview',
  description: 'Calculate the Windows security score from Defender, firewall, update, scan, and system health checks.',
  category: 'Security', icon: 'shield-check',
  run: async (args, ctx) => buildSecurityOverview(ctx || {})
};
