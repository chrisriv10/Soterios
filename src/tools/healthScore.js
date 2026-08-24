const si = require('systeminformation');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const MIN_USER_VOLUME_BYTES = 1024 ** 3;

const execFileAsync = promisify(execFile);

/**
 * Ignore tiny recovery/EFI/OEM partitions that are legitimately full but not
 * user-facing storage when scoring disk health. Also ignore read-only optical
 * drives (CD/DVD) which always report 100% usage.
 */
function isUserFacingVolume(entry) {
  if (!entry || typeof entry.size !== 'number' || entry.size < MIN_USER_VOLUME_BYTES) {
    return false;
  }
  // Skip read-only drives (optical media, etc.)
  if (entry.rw === false) {
    return false;
  }
  // Skip optical filesystems
  const fs = String(entry.fs || '').toUpperCase();
  if (fs === 'CDFS' || fs === 'UDF') {
    return false;
  }
  const mount = String(entry.mount || '');
  if (process.platform === 'win32') {
    return /^[A-Z]:/i.test(mount);
  }
  return mount.length > 0 && !mount.includes('\\?\\Volume{');
}

function worstUsageFromVolumes(volumes) {
  const relevant = (volumes || []).filter(isUserFacingVolume);
  if (!relevant.length) {
    return { worstUse: 0, fullVolumes: [], hasRelevant: false };
  }
  const worstUse = Math.max(...relevant.map((d) => d.use));
  const fullVolumes = relevant.filter((d) => d.use >= 85).map((d) => d.mount);
  return { worstUse, fullVolumes, hasRelevant: true };
}

// Human-readable labels for each scoring category, used by the dashboard's
// health score detail view.
const LABELS = {
  malware: 'Malware Scan Results',
  scanRecency: 'Scan Recency',
  disk: 'Disk Space',
  pendingReboot: 'Pending Reboot',
  windowsUpdate: 'Windows Update',
  uptime: 'System Uptime',
  rtp: 'Real-Time Protection',
  firewall: 'Firewall'
};

/**
 * Check if a reboot is pending (Windows Update or pending file operations).
 * Returns true if reboot required, false otherwise.
 */
async function checkPendingReboot() {
  if (process.platform !== 'win32') return false;
  try {
    // Check Windows Update reboot required flag
    const { stdout: wuOut } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      'try { $key = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired"; if (Test-Path $key) { exit 1 } else { exit 0 } } catch { exit 0 }'
    ], { timeout: 5000 });
    if (wuOut.trim() === '1') return true;

    // Check pending file rename operations (often indicates pending reboot)
    const { stdout: pfoOut } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      'try { $key = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager"; $val = Get-ItemProperty -Path $key -Name "PendingFileRenameOperations" -ErrorAction SilentlyContinue; if ($val.PendingFileRenameOperations) { exit 1 } else { exit 0 } } catch { exit 0 }'
    ], { timeout: 5000 });
    if (pfoOut.trim() === '1') return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Get days since last successful Windows Update install.
 * Returns number of days (float), or null if unavailable.
 */
async function getWindowsUpdateFreshness() {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      'try { $session = New-Object -ComObject Microsoft.Update.Session; $searcher = $session.CreateUpdateSearcher(); $history = $searcher.QueryHistory(0, 1); if ($history.Count -gt 0) { $last = $history.Item(0); if ($last.ResultCode -eq 2) { $date = $last.Date; $diff = (Get-Date) - $date; [math]::Round($diff.TotalDays, 1) } else { exit 1 } } else { exit 1 } } catch { exit 1 }'
    ], { timeout: 10000 });
    const trimmed = stdout.trim();
    if (trimmed && !isNaN(Number(trimmed))) {
      return Number(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

// bands: array of [threshold, points] sorted ascending by threshold.
// Returns the points for the first threshold the value falls under, or 0
// if it exceeds every threshold. Used to turn a raw metric (percent used,
// days elapsed, etc.) into a graduated score instead of a single pass/fail
// cutoff.
function bandedPoints(value, bands) {
  for (const [threshold, points] of bands) {
    if (value < threshold) return points;
  }
  return 0;
}

module.exports = {
  isUserFacingVolume,
  id: 'health-score', name: 'System Health Score',
  description: 'Composite score summarizing scan results, resource health, and protection status.',
  category: 'Dashboard', icon: 'gauge',
  run: async (args = {}) => {
    const breakdown = {};

    // --- Malware scan results: graduated instead of strict pass/fail, so a
    // single stale match doesn't score identically to an active infection. ---
    const lastScanMatches = args.lastScanMatches ?? null;
    if (lastScanMatches === null) {
      breakdown.malware = { label: LABELS.malware, points: 0, max: 30, reason: 'No scan has been run yet.' };
    } else if (lastScanMatches === 0) {
      breakdown.malware = { label: LABELS.malware, points: 30, max: 30, reason: 'No threats found in the most recent scan.' };
    } else if (lastScanMatches <= 2) {
      breakdown.malware = { label: LABELS.malware, points: 10, max: 30, reason: `${lastScanMatches} threat match(es) found in the most recent scan.` };
    } else {
      breakdown.malware = { label: LABELS.malware, points: 0, max: 30, reason: `${lastScanMatches} threat matches found in the most recent scan.` };
    }

    // --- Scan recency: only scored if the caller supplies a last-scan date.
    // A clean scan from two months ago is worth less than a clean scan from
    // this morning, which the original version had no way to express. ---
    if (args.lastScanDate) {
      const scanDate = new Date(args.lastScanDate);
      if (!Number.isNaN(scanDate.getTime())) {
        const daysAgo = (Date.now() - scanDate.getTime()) / 86400000;
        const points = bandedPoints(daysAgo, [[1, 10], [7, 7], [30, 3]]);
        breakdown.scanRecency = {
          label: LABELS.scanRecency, points, max: 10,
          reason: daysAgo < 1 ? 'Last scan ran within the last day.' : `Last scan ran ${Math.floor(daysAgo)} day(s) ago.`
        };
      }
    }

    // --- Disk space: graduated bands instead of a single 90% cliff. ---
    const fsSize = await si.fsSize();
    const { worstUse, fullVolumes, hasRelevant } = worstUsageFromVolumes(fsSize);
    breakdown.disk = {
      label: LABELS.disk, points: bandedPoints(worstUse, [[70, 15], [85, 10], [95, 5]]), max: 15,
      reason: fullVolumes.length
        ? `Low space on: ${fullVolumes.join(', ')} (${worstUse.toFixed(0)}% used).`
        : !hasRelevant
          ? 'No user-facing volumes found for disk scoring.'
          : `All volumes healthy (highest usage ${worstUse.toFixed(0)}%).`
    };

    // --- Pending reboot: binary signal — reboot required = 0 pts, not required = 10 pts. ---
    const rebootPending = await checkPendingReboot();
    breakdown.pendingReboot = {
      label: LABELS.pendingReboot, points: rebootPending ? 0 : 10, max: 10,
      reason: rebootPending ? 'A restart is required to complete Windows updates.' : 'No pending restart required.'
    };

    // --- Windows Update freshness: graduated bands by days since last successful install. ---
    const wuDays = await getWindowsUpdateFreshness();
    if (wuDays !== null) {
      const points = bandedPoints(wuDays, [[1, 10], [7, 7], [30, 3]]);
      breakdown.windowsUpdate = {
        label: LABELS.windowsUpdate, points, max: 10,
        reason: wuDays < 1 ? 'Windows updated within the last day.' : `Last successful update ${Math.floor(wuDays)} day(s) ago.`
      };
    } else {
      breakdown.windowsUpdate = {
        label: LABELS.windowsUpdate, points: 0, max: 10,
        reason: 'Unable to determine Windows Update status.'
      };
    }

    // --- System uptime: new signal. A machine that hasn't restarted in
    // weeks is a common sign that pending security updates are stuck
    // waiting on a reboot, which the original version never surfaced. ---
    const uptimeDays = os.uptime() / 86400;
    const uptimePoints = bandedPoints(uptimeDays, [[7, 5], [30, 3]]);
    let uptimeReason;
    if (uptimeDays < 1) {
      uptimeReason = 'Rebooted within the last day.';
    } else if (uptimePoints === 5) {
      uptimeReason = `Restarted ${Math.floor(uptimeDays)} day(s) ago — within normal range.`;
    } else if (uptimePoints === 3) {
      uptimeReason = `Running ${Math.floor(uptimeDays)} days without a restart — consider rebooting soon to apply any pending updates.`;
    } else {
      uptimeReason = `Running ${Math.floor(uptimeDays)} days without a restart — a reboot is recommended to apply pending updates.`;
    }
    breakdown.uptime = { label: LABELS.uptime, points: uptimePoints, max: 5, reason: uptimeReason };

    // --- Real-time protection: only scored if the caller supplies it, so
    // this stays backward compatible with callers that don't pass it yet. ---
    if (typeof args.rtpActive === 'boolean') {
      breakdown.rtp = {
        label: LABELS.rtp, points: args.rtpActive ? 15 : 0, max: 15,
        reason: args.rtpActive ? 'Real-time protection is active.' : 'Real-time protection is disabled.'
      };
    }

    // --- Firewall: same pattern as RTP above. ---
    if (typeof args.firewallActive === 'boolean') {
      breakdown.firewall = {
        label: LABELS.firewall, points: args.firewallActive ? 15 : 0, max: 15,
        reason: args.firewallActive ? 'Windows Firewall is active.' : 'Windows Firewall is disabled.'
      };
    }

    // Normalize to 0-100 across whichever categories actually got scored.
    // This keeps the score on a consistent 0-100 scale even as more optional
    // signals (RTP, firewall, scan recency) get wired in by callers over
    // time, rather than baking in a fixed denominator that assumes every
    // signal is always present.
    const totals = Object.values(breakdown).reduce(
      (acc, c) => ({ points: acc.points + c.points, max: acc.max + c.max }),
      { points: 0, max: 0 }
    );
    const score = totals.max > 0 ? Math.round((totals.points / totals.max) * 100) : 0;

    return { score, breakdown, generatedAt: new Date().toISOString() };
  },
  isUserFacingVolume,
  worstUsageFromVolumes,
  MIN_USER_VOLUME_BYTES,
  checkPendingReboot,
  getWindowsUpdateFreshness
};