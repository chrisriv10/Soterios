// Thin convenience wrapper around the window.soterios bridge exposed by
// preload.js. Pages call these instead of touching window.soterios directly
// so error handling stays consistent.

const Api = {
  async listTools() {
    return window.soterios.tools.list();
  },

  async runTool(toolId, args) {
    const result = await window.soterios.tools.run(toolId, args);
    if (!result.ok) {
      throw new Error(result.error || `Tool "${toolId}" failed`);
    }
    return result.data;
  },

  onToolProgress(toolId, callback) {
    return window.soterios.tools.onProgress(toolId, callback);
  },

  async pickFolder() {
    return window.soterios.dialog.pickFolder();
  },

  async pickFiles() {
    return window.soterios.dialog.pickFiles();
  },

  async showItemInFolder(filePath) {
    return window.soterios.shell.showItemInFolder(filePath);
  }
};
