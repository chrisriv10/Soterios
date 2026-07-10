const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw).scripts || [];
}

function runScriptInChild(scriptPath, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'childRunner.js'), [scriptPath, JSON.stringify(args || {})], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_) {}
      reject(new Error('Script timed out'));
    }, 5 * 60 * 1000); // 5 minutes timeout

    child.on('message', (msg) => {
      if (!msg) return;

      // Progress updates never settle the promise -- only a 'done' message
      // does. This distinction matters: without it, the first progress
      // update sent during a long-running script would be mistaken for the
      // final result and resolve early, before the script actually finished.
      if (msg.type === 'progress') {
        onProgress?.(msg.payload);
        return;
      }

      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (msg.type === 'done') {
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error || 'Script failed'));
        return;
      }

      // Unrecognized message shape -- fail conservatively rather than
      // silently resolving with something unexpected.
      reject(new Error('Unexpected message from script process'));
    });

    child.on('error', (err) => {
      if (settled) return; settled = true; clearTimeout(timeout); reject(err);
    });

    child.on('exit', (code) => {
      if (settled) return; settled = true; clearTimeout(timeout); if (code === 0) resolve(null); else reject(new Error('Script process exited with code ' + code));
    });
  });
}

async function runScript(scriptId, args, onProgress) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.id === scriptId);
  if (!entry) throw new Error(`Unknown script: ${scriptId}`);
  const scriptPath = path.join(__dirname, entry.file);
  // Run script in a child process to avoid blocking the main thread
  return runScriptInChild(scriptPath, args || {}, onProgress);
}

module.exports = { loadRegistry, runScript };