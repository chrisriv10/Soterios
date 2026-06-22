const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw).scripts || [];
}

async function runScript(scriptId, args) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.id === scriptId);
  if (!entry) throw new Error(`Unknown script: ${scriptId}`);

  const scriptPath = path.join(__dirname, entry.file);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const scriptFn = require(scriptPath);
  if (typeof scriptFn !== 'function') {
    throw new Error(`Script "${scriptId}" does not export a runnable function`);
  }
  return scriptFn(args || {});
}

module.exports = { loadRegistry, runScript };
