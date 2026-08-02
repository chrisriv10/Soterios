const fs = require('fs');
const path = require('path');
const toolRegistry = require('./toolRegistry');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

/**
 * Load all tool modules from the tools directory into the tool registry.
 * @returns {Promise<void>}
 */
async function loadAll() {
  const files = fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(TOOLS_DIR, file);
    try {
      const mod = require(fullPath);
      const toolDefs = Array.isArray(mod) ? mod : [mod];
      for (const def of toolDefs) {
        toolRegistry.register(def);
      }
    } catch (err) {
      console.error(`[pluginLoader] Failed to load tool module "${file}":`, err);
    }
  }

  console.log(`[pluginLoader] Loaded ${toolRegistry.list().length} tool(s)`);
}

module.exports = { loadAll, loadPlugins: loadAll };
