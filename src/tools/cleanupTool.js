const { loadRegistry, runScript } = require('../scripts/scriptRunner');

function summarizeScriptResult(result) {
  if (!result || typeof result !== 'object') return {};
  if (Array.isArray(result.log)) return { deletedCount: result.deletedCount, freedMB: result.freedMB, dryRun: result.dryRun };
  if (Array.isArray(result.files)) return { count: result.count, largestMB: result.files[0] && result.files[0].sizeMB };
  if (Array.isArray(result.browsers)) return { totalMB: result.totalMB };
  if (Array.isArray(result.interfaces)) return { interfaces: result.interfaces.length, establishedConnectionCount: result.establishedConnectionCount };
  if (Array.isArray(result.services)) return { autoStartCount: result.autoStartCount, flaggedCount: result.flaggedCount };
  if (Array.isArray(result.apps)) return { appCount: result.appCount, leftoverCount: (result.leftovers || []).length };
  if (Array.isArray(result.leftovers)) return { leftoverCount: result.leftovers.length, dryRun: result.dryRun };
  return {};
}

module.exports = [
  {
    id: 'list-scripts', name: 'List Maintenance Scripts',
    description: 'Returns the registry of available safe maintenance scripts.',
    category: 'Maintenance', icon: 'list-checks',
    run: async () => loadRegistry().map(({ id, name, description }) => ({ id, name, description }))
  },
  {
    id: 'run-script', name: 'Run Maintenance Script',
    description: 'Execute a script from the maintenance registry by id.',
    category: 'Maintenance', icon: 'terminal',
    run: async (args, ctx) => {
      const scriptId = args && args.scriptId;
      if (!scriptId) throw new Error('scriptId is required');
      const result = await runScript(scriptId, args.scriptArgs || {}, ctx && ctx.sendProgress);
      if (ctx.appStore) {
        ctx.appStore.addHistory('scripts', { scriptId, resultSummary: summarizeScriptResult(result) });
        ctx.appStore.addHistory('actions', { type: 'script', title: 'Maintenance script ran', detail: scriptId, level: 'ok' });
      }
      return result;
    }
  }
];