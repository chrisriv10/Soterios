const { loadRegistry, runScript } = require('../scripts/scriptRunner');

module.exports = [
  {
    id: 'list-scripts',
    name: 'List Maintenance Scripts',
    description: 'Returns the registry of available safe maintenance scripts.',
    category: 'Maintenance',
    icon: 'list-checks',
    run: async () => {
      return loadRegistry().map(({ id, name, description }) => ({ id, name, description }));
    }
  },
  {
    id: 'run-script',
    name: 'Run Maintenance Script',
    description: 'Execute a script from the maintenance registry by id.',
    category: 'Maintenance',
    icon: 'terminal',
    run: async (args) => {
      const scriptId = args && args.scriptId;
      if (!scriptId) throw new Error('scriptId is required');
      return runScript(scriptId, args.scriptArgs || {});
    }
  }
];
