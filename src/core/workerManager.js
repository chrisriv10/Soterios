'use strict';

/**
 * Manages worker thread execution for maintenance and scan scripts.
 *
 * Provides task lifecycle management including cancellation, timeout,
 * and progress forwarding from worker threads to the main process.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const logger = require('../utils/logger');

const WORKER_ENTRY = path.join(__dirname, '../scripts/workerEntry.js');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @typedef {Object} TaskOptions
 * @property {string} scriptPath - Absolute path to the script to execute.
 * @property {Object} [args] - Arguments passed to the script.
 * @property {Function} [onProgress] - Progress callback receiving payload objects.
 * @property {AbortSignal} [signal] - Optional abort signal for cancellation.
 * @property {number} [timeoutMs] - Timeout in milliseconds.
 */

class WorkerManager {
  /**
   * Creates a new WorkerManager instance.
   */
  constructor() {
    this._tasks = new Map();
    this._nextTaskId = 1;
  }

  /**
   * Starts a worker task and returns a cancellable promise.
   *
   * @param {TaskOptions} opts - Task configuration.
   * @returns {Promise<any> & {cancel: Function}} Task promise with cancel method.
   */
  runTask({ scriptPath, args, onProgress, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const taskId = this._nextTaskId++;
    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_ENTRY, {
        workerData: { scriptPath, args: args || {} }
      });
      let settled = false;

      /**
       * Finalizes the task by clearing timers and resolving/rejecting.
       *
       * @param {'resolve'|'reject'} fn - Resolution function.
       * @param {*} value - Value to pass to the resolution function.
       */
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        this._tasks.delete(taskId);
        fn(value);
      };

      const timer = setTimeout(() => {
        try { worker.terminate(); } catch (e) { logger.debug('worker terminate on timeout failed', { error: e?.message || String(e) }); }
        finish(reject, new Error('Script timed out'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      /**
       * Abort handler that terminates the worker and rejects the task.
       */
      const onAbort = () => {
        try { worker.terminate(); } catch (e) { logger.debug('worker terminate on abort failed', { error: e?.message || String(e) }); }
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

  /**
   * Cancels a running task by ID.
   *
   * @param {number} taskId - Task ID to cancel.
   * @returns {boolean} True if the task was found and terminated.
   */
  cancel(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    try { task.worker.terminate(); } catch (e) { logger.debug('worker terminate on cancel failed', { error: e?.message || String(e) }); }
    this._tasks.delete(taskId);
    return true;
  }
}

module.exports = new WorkerManager();
