'use strict';

const { parentPort, workerData } = require('worker_threads');
const childProcess = require('child_process');

// Track subprocesses started by safe scripts so cancellation terminates the
// PowerShell/process tree instead of only stopping the JavaScript worker.
const childProcesses = new Set();
const originalExecFile = childProcess.execFile.bind(childProcess);
const originalSpawn = childProcess.spawn.bind(childProcess);
childProcess.execFile = (...args) => {
  const child = originalExecFile(...args);
  childProcesses.add(child);
  child.once('exit', () => childProcesses.delete(child));
  return child;
};
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  childProcesses.add(child);
  child.once('exit', () => childProcesses.delete(child));
  return child;
};

let canceled = false;
let portClosed = false;
let cleanupStarted = false;
function safePost(message) {
  if (portClosed) return false;
  try { parentPort.postMessage(message); return true; } catch (_) { return false; }
}
function closePort() {
  if (portClosed) return;
  portClosed = true;
  try { parentPort.close(); } catch (_) {}
}
function cleanupChildProcesses() {
  if (cleanupStarted) return Promise.resolve();
  cleanupStarted = true;
  const pending = [];
  canceled = true;
  for (const child of childProcesses) {
    try {
      if (process.platform === 'win32' && child.pid) {
        pending.push(new Promise((resolve) => {
          let settled = false;
          const complete = () => { if (settled) return; settled = true; resolve(); };
          const killer = originalExecFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, complete);
          const timer = setTimeout(() => {
            try { killer.kill(); } catch (_) {}
            complete();
          }, 400);
          if (typeof timer.unref === 'function') timer.unref();
        }));
      } else {
        child.kill('SIGTERM');
      }
    } catch (_) {}
  }
  return Promise.race([
    Promise.all(pending),
    new Promise((resolve) => setTimeout(resolve, 450))
  ]);
}
parentPort.on('message', async (message) => {
  if (message?.type !== 'cancel' || canceled) return;
  await cleanupChildProcesses();
  safePost({ type: 'done', ok: false, error: 'Task canceled' });
  closePort();
});

(async () => {
  try {
    const { scriptPath, args } = workerData || {};
    if (!scriptPath) throw new Error('No script path provided');
    const scriptFn = require(scriptPath);
    if (typeof scriptFn !== 'function') throw new Error('Script does not export a function');

    const onProgress = (payload) => {
      if (!canceled) safePost({ type: 'progress', payload });
    };

    const result = await scriptFn(args || {}, onProgress);
    if (canceled) return;
    safePost({ type: 'done', ok: true, result });
    closePort();
  } catch (err) {
    if (canceled) return;
    safePost({
      type: 'done',
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
    closePort();
  }
})();
