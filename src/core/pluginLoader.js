const fs = require('fs');
const path = require('path');
const toolRegistry = require('./toolRegistry');

function loadPlugins() {
  const toolsPath = path.join(__dirname, '../tools');

  if (!fs.existsSync(toolsPath)) {
    return [];
  }

  const loadedTools = [];

  for (const file of fs.readdirSync(toolsPath).filter((name) => name.endsWith('.js'))) {
    try {
      const plugin = require(path.join(toolsPath, file));
      const tools = Array.isArray(plugin) ? plugin : [plugin];
      for (const tool of tools) {
        if (tool && tool.id && typeof tool.run === 'function') {
          toolRegistry.register(tool);
          loadedTools.push(tool);
        }
      }
    } catch (err) {
      console.error(`[pluginLoader] Failed to load tool module "${file}":`, err);
    }
  }

  console.log(`[pluginLoader] Loaded ${loadedTools.length} tool(s)`);
  return loadedTools;
}

module.exports = {
  loadPlugins,
  loadAll: loadPlugins
};
