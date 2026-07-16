const fs = require('fs');
const path = require('path');
const workerManager = require('../core/workerManager');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw).scripts || [];
}

async function runScriptInWorker(scriptPath, args, onProgress, signal) {
  return workerManager.runTask({
    scriptPath,
    args: args || {},
    onProgress,
    signal,
    timeoutMs: 5 * 60 * 1000
  });
}

async function runScript(scriptId, args, onProgress, options = {}) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.id === scriptId);
  if (!entry) throw new Error(`Unknown script: ${scriptId}`);
  const scriptPath = path.join(__dirname, entry.file);
  return runScriptInWorker(scriptPath, args || {}, onProgress, options.signal);
}

module.exports = { loadRegistry, runScript, runScriptInWorker };
