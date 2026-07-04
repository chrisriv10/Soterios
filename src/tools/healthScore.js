const si = require('systeminformation');

module.exports = {
  id: 'health-score', name: 'System Health Score',
  description: 'Composite score summarizing scan results, disk space, and load.',
  category: 'Dashboard', icon: 'gauge',
  run: async (args = {}) => {
    const breakdown = {};
    let score = 0;
    const lastScanMatches = args.lastScanMatches ?? null;
    if (lastScanMatches === null) breakdown.malware = { points: 0, max: 40, reason: 'No scan has been run yet' };
    else if (lastScanMatches === 0) { score += 40; breakdown.malware = { points: 40, max: 40, reason: 'No threats found in last scan' }; }
    else breakdown.malware = { points: 0, max: 40, reason: `${lastScanMatches} threat match(es) found` };

    const fsSize = await si.fsSize();
    if (fsSize.every((d) => d.use < 90)) { score += 20; breakdown.disk = { points: 20, max: 20, reason: 'All volumes under 90% used' }; }
    else breakdown.disk = { points: 0, max: 20, reason: `Low space on: ${fsSize.filter((d) => d.use >= 90).map((d) => d.mount).join(', ')}` };

    const load = await si.currentLoad();
    if (load.currentLoad < 85) { score += 20; breakdown.load = { points: 20, max: 20, reason: `CPU load ${load.currentLoad.toFixed(0)}%` }; }
    else breakdown.load = { points: 0, max: 20, reason: `CPU overloaded at ${load.currentLoad.toFixed(0)}%` };

    return { score, breakdown };
  }
};
