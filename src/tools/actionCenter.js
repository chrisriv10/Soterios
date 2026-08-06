/**
 * Action Center tool.
 *
 * Generates prioritized security and maintenance recommendations
 * based on scan history, quarantine state, and system metrics.
 */

const si = require('systeminformation');

/**
 * Build a recommendation object.
 * @param {string} id
 * @param {'danger'|'warn'|'ok'} level
 * @param {string} title
 * @param {string} detail
 * @param {string} actionPage
 * @returns {Object}
 */
function recommendation(id, level, title, detail, actionPage) {
  return { id, level, title, detail, actionPage };
}

module.exports = [
  {
    id: 'action-center', name: 'Action Center',
    description: 'Generate prioritized security and maintenance recommendations.',
    category: 'Dashboard', icon: 'list-checks',
    run: async (args, ctx) => {
      const store = ctx.appStore ? ctx.appStore.getSnapshot() : { history: {}, quarantine: [] };
      const recentScan = store.history.scans && store.history.scans[0];
      const activeQuarantine = (store.quarantine || []).filter((item) => item.status === 'quarantined');
      const [fsSize, load, mem] = await Promise.all([si.fsSize(), si.currentLoad(), si.mem()]);
      const items = [];

      if (!recentScan) {
        items.push(recommendation('scan-missing', 'warn', 'Run a baseline file scan', 'No scan history exists yet.', 'scanner'));
      } else {
        const summary = recentScan.summary || {};
        const ageDays = (Date.now() - new Date(summary.completedAt || recentScan.createdAt).getTime()) / 86400000;
        if (summary.matches > 0) items.push(recommendation('scan-matches', 'danger', `${summary.matches} signature match(es) need review`, 'Matched files should be quarantined or inspected.', 'scanner'));
        if (summary.suspicious > 0) items.push(recommendation('scan-suspicious', 'warn', `${summary.suspicious} suspicious file(s) found`, 'Review risk flags and quarantine anything unrecognized.', 'scanner'));
        if (ageDays > 7) items.push(recommendation('scan-stale', 'warn', 'Scan history is more than a week old', `Last scan: ${new Date(summary.completedAt || recentScan.createdAt).toLocaleString()}.`, 'scanner'));
      }

      const fullDisks = fsSize.filter((d) => d.use >= 90);
      if (fullDisks.length > 0) items.push(recommendation('disk-low', 'danger', 'Low disk space detected', fullDisks.map((d) => `${d.mount} is ${d.use.toFixed(1)}% used`).join('; '), 'tools'));
      else if (fsSize.some((d) => d.use >= 80)) items.push(recommendation('disk-watch', 'warn', 'Disk usage is getting high', 'Run the disk space and large files reports.', 'tools'));

      const memUse = ((mem.total - mem.available) / mem.total) * 100;
      if (memUse >= 88) items.push(recommendation('memory-high', 'warn', 'Memory pressure is high', `${memUse.toFixed(1)}% of memory in use.`, 'processes'));
      if (load.currentLoad >= 85) items.push(recommendation('cpu-high', 'warn', 'CPU load is high', `Current load is ${load.currentLoad.toFixed(1)}%.`, 'processes'));
      if (activeQuarantine.length > 0) items.push(recommendation('quarantine-review', 'warn', `${activeQuarantine.length} quarantined item(s) awaiting review`, 'Restore or permanently delete.', 'quarantine'));

      if (items.length === 0) items.push(recommendation('all-clear', 'ok', 'No urgent actions', 'No urgent maintenance items found.', 'dashboard'));

      return { generatedAt: new Date().toISOString(), items, counts: { danger: items.filter((i) => i.level === 'danger').length, warn: items.filter((i) => i.level === 'warn').length, ok: items.filter((i) => i.level === 'ok').length } };
    }
  },
  {
    id: 'system-timeline-sample', name: 'System Timeline Sample',
    description: 'Capture a point-in-time resource sample for dashboard history.',
    category: 'System', icon: 'activity',
    run: async (args, ctx) => {
      const [load, mem, fsSize] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
      const primaryDisk = fsSize[0];
      const sample = { cpu: +load.currentLoad.toFixed(1), memory: +(((mem.total - mem.available) / mem.total) * 100).toFixed(1), disk: primaryDisk ? +primaryDisk.use.toFixed(1) : null };
      if (ctx.appStore) ctx.appStore.addHistory('health', sample, 120);
      return sample;
    }
  }
];
