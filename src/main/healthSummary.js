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
  return {
    score: result.data.score,
    detail: disk?.reason || 'Protection and resource summary ready.'
  };
}

module.exports = { getTrayHealthSummary };
