const fs = require('fs');
const path = require('path');
const workerManager = require('../core/workerManager');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');
const SCRIPT_TIMEOUTS = Object.freeze({ 'large-files-report': 30 * 60 * 1000 });

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw).scripts || [];
}

async function runScriptInWorker(scriptPath, args, onProgress, signal, timeoutMs) {
  return workerManager.runTask({
    scriptPath,
    args: args || {},
    onProgress,
    signal,
    timeoutMs: timeoutMs || 5 * 60 * 1000
  });
}

async function runScript(scriptId, args, onProgress, options = {}) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.id === scriptId);
  if (!entry) throw new Error(`Unknown script: ${scriptId}`);
  if (entry.runner && entry.runner !== 'script') throw new Error(`Tool "${scriptId}" is provided by an application service.`);
  const scriptPath = path.join(__dirname, entry.file);
  return runScriptInWorker(scriptPath, args || {}, onProgress, options.signal, options.timeoutMs || SCRIPT_TIMEOUTS[scriptId]);
}

module.exports = { loadRegistry, runScript, runScriptInWorker };
