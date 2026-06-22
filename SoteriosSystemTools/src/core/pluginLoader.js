// Discovers every tool module in src/tools and registers it with the
// toolRegistry. Each file in src/tools must export the tool shape described
// in toolRegistry.js (via module.exports = { id, name, ... }).
//
// This is intentionally simple (no hot-reload, no external plugin dirs yet)
// but is the seam where "load 3rd-party tools from a user plugins folder"
// would slot in later.

const fs = require('fs');
const path = require('path');
const toolRegistry = require('./toolRegistry');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

async function loadAll() {
  const files = fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(TOOLS_DIR, file);
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
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

module.exports = { loadAll };
