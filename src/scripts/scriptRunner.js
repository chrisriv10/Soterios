const fs = require('fs');
const path = require('path');
const workerManager = require('../core/workerManager');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

/**
 * Load the maintenance script registry from disk.
 *
 * @returns {Array<Object>} Script registry entries.
 */
function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw).scripts || [];
}

/**
 * Execute a maintenance script inside a worker thread.
 *
 * @param {string} scriptPath - Absolute path to the script module.
 * @param {Object} [args={}] - Arguments forwarded to the script.
 * @param {Function} [onProgress] - Progress callback invoked by the script.
 * @param {AbortSignal} [signal] - Optional abort signal to cancel execution.
 * @returns {Promise<Object>} Result object from the script execution.
 */
async function runScriptInWorker(scriptPath, args, onProgress, signal) {
  return workerManager.runTask({
    scriptPath,
    args: args || {},
    onProgress,
    signal,
    timeoutMs: 5 * 60 * 1000
  });
}

/**
 * Execute a maintenance script by its registry id.
 *
 * @param {string} scriptId
 * @param {Object} [args={}]
 * @param {Function} [onProgress]
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Object>}
 */
async function runScript(scriptId, args, onProgress, options = {}) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.id === scriptId);
  if (!entry) throw new Error(`Unknown script: ${scriptId}`);
  const scriptPath = path.join(__dirname, entry.file);
  return runScriptInWorker(scriptPath, args || {}, onProgress, options.signal);
}

module.exports = { loadRegistry, runScript, runScriptInWorker };
