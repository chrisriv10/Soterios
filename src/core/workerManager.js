'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_ENTRY = path.join(__dirname, '../scripts/workerEntry.js');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CANCELLATION_GRACE_MS = 500;

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
      let cancellationReason = null;
      let cancellationTimer = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancellationTimer) clearTimeout(cancellationTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
        this._tasks.delete(taskId);
        fn(value);
      };

      const cancellationError = () => new Error(cancellationReason === 'timeout' ? 'Script timed out' : 'Task canceled');
      const settleCancellation = () => {
        // The worker may still be awaiting a script promise after it has
        // acknowledged cancellation. Stop that JavaScript work once cleanup
        // has completed so it cannot keep the process alive.
        try { worker.terminate(); } catch (_) {}
        finish(reject, cancellationError());
      };
      const requestCancellation = (reason) => {
        if (settled || cancellationReason) return;
        cancellationReason = reason;
        try { worker.postMessage({ type: 'cancel' }); } catch (_) {}
        cancellationTimer = setTimeout(() => {
          try { worker.terminate(); } catch (_) {}
          finish(reject, cancellationError());
        }, CANCELLATION_GRACE_MS);
      };

      const timer = setTimeout(() => requestCancellation('timeout'), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onAbort = () => {
        requestCancellation('canceled');
      };

      this._tasks.set(taskId, { worker, cancel: () => requestCancellation('canceled') });

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      worker.on('message', (msg) => {
        if (!msg) return;
        if (msg.type === 'progress') {
          onProgress?.(msg.payload);
          return;
        }
        if (msg.type === 'done') {
          if (cancellationReason) settleCancellation();
          else if (msg.ok) finish(resolve, msg.result);
          else finish(reject, new Error(msg.error || 'Script failed'));
          return;
        }
      });

      worker.on('error', (err) => {
        finish(reject, cancellationReason ? cancellationError() : err);
      });

      worker.on('exit', (code) => {
        if (settled) return;
        finish(reject, cancellationReason ? cancellationError() : new Error(`Worker exited before completing (code ${code})`));
      });
    });
    promise.cancel = () => this.cancel(taskId);
    return promise;
  }

  cancel(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    task.cancel();
    return true;
  }
}

module.exports = new WorkerManager();
