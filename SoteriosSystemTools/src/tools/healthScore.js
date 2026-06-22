// Computes the Dashboard's "System Health Score" out of 100 using the
// simple weighted formula from the spec:
//   +40 if no malware matches in the most recent scan
//   +20 if a strong password sample was provided
//   +20 if disk space is healthy (<90% used on all volumes)
//   +20 if the system isn't overloaded (CPU load under threshold)
//
// This tool is stateless — the caller passes in the latest known
// results from the other tools (last scan, disk info, cpu load, password).
// The dashboard UI is responsible for feeding it fresh data.

const si = require('systeminformation');

module.exports = {
  id: 'health-score',
  name: 'System Health Score',
  description: 'Composite score summarizing scan results, disk space, password strength, and load.',
  category: 'Dashboard',
  icon: 'gauge',
  run: async (args = {}) => {
    const breakdown = {};
    let score = 0;

    // 1. Malware matches (40 pts)
    const lastScanMatches = args.lastScanMatches ?? null;
    if (lastScanMatches === null) {
      breakdown.malware = { points: 0, max: 40, reason: 'No scan has been run yet' };
    } else if (lastScanMatches === 0) {
      score += 40;
      breakdown.malware = { points: 40, max: 40, reason: 'No threats found in last scan' };
    } else {
      breakdown.malware = { points: 0, max: 40, reason: `${lastScanMatches} threat match(es) found` };
    }

    // 2. Password strength (20 pts) — based on a sample/representative password score 0-100
    const passwordScore = args.passwordScore ?? null;
    if (passwordScore === null) {
      breakdown.password = { points: 0, max: 20, reason: 'No password checked yet' };
    } else if (passwordScore >= 70) {
      score += 20;
      breakdown.password = { points: 20, max: 20, reason: 'Strong password detected' };
    } else {
      breakdown.password = { points: 0, max: 20, reason: 'Weak/moderate password detected' };
    }

    // 3. Disk space (20 pts)
    const fsSize = await si.fsSize();
    const allHealthy = fsSize.every((d) => d.use < 90);
    if (allHealthy) {
      score += 20;
      breakdown.disk = { points: 20, max: 20, reason: 'All volumes under 90% used' };
    } else {
      const full = fsSize.filter((d) => d.use >= 90).map((d) => d.mount);
      breakdown.disk = { points: 0, max: 20, reason: `Low space on: ${full.join(', ')}` };
    }

    // 4. CPU load (20 pts)
    const load = await si.currentLoad();
    if (load.currentLoad < 85) {
      score += 20;
      breakdown.load = { points: 20, max: 20, reason: `CPU load ${load.currentLoad.toFixed(0)}%` };
    } else {
      breakdown.load = { points: 0, max: 20, reason: `CPU overloaded at ${load.currentLoad.toFixed(0)}%` };
    }

    return { score, breakdown };
  }
};
