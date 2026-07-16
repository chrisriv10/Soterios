'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_ENTRY = path.join(__dirname, '../scripts/workerEntry.js');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

class WorkerManager {
  constructor() {
    this._tasks = new Map();
    this._nextTaskId = 1;
  }

  runTask({ scriptPath, args, onProgress, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const taskId = this._nextTaskId++;
    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_ENTRY, {
        workerData: { scriptPath, args: args || {} }
      });
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        this._tasks.delete(taskId);
        fn(value);
      };

      const timer = setTimeout(() => {
        try { worker.terminate(); } catch (_) {}
        finish(reject, new Error('Script timed out'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onAbort = () => {
        try { worker.terminate(); } catch (_) {}
        finish(reject, new Error('Task canceled'));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._tasks.set(taskId, { worker });

      worker.on('message', (msg) => {
        if (!msg) return;
        if (msg.type === 'progress') {
          onProgress?.(msg.payload);
          return;
        }
        if (msg.type === 'done') {
          if (msg.ok) finish(resolve, msg.result);
          else finish(reject, new Error(msg.error || 'Script failed'));
          return;
        }
      });

      worker.on('error', (err) => {
        finish(reject, err);
      });

      worker.on('exit', (code) => {
        if (settled) return;
        finish(reject, new Error(`Worker exited before completing (code ${code})`));
      });
    });
    promise.cancel = () => this.cancel(taskId);
    return promise;
  }

  cancel(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    try { task.worker.terminate(); } catch (_) {}
    this._tasks.delete(taskId);
    return true;
  }
}

module.exports = new WorkerManager();
