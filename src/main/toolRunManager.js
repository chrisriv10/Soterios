'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

function effectiveToolId(registryToolId, args) {
  if (registryToolId === 'run-script' && args && args.scriptId) return String(args.scriptId);
  return String(registryToolId);
}

function resultSummary(result) {
  if (!result || typeof result !== 'object') return {};
  const summary = {};
  const fields = [
    'count', 'totalMB', 'freedMB', 'deletedCount', 'removedCount', 'skippedCount',
    'totalFilesScanned', 'totalDuplicates', 'totalWastedSpace', 'totalSizeBytes',
    'candidateCount', 'volumeCount', 'warningCount', 'browserCount', 'appCount',
    'fileCount', 'groupCount', 'itemCount', 'flaggedCount', 'autoStartCount',
    'status', 'verdict'
  ];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(result, field)) summary[field] = result[field];
  }
  if (Array.isArray(result.duplicateGroups)) summary.groupCount = result.duplicateGroups.length;
  if (Array.isArray(result.entries)) summary.entryCount = result.entries.length;
  if (Array.isArray(result.items)) summary.itemCount = result.items.length;
  if (Array.isArray(result.volumes)) {
    summary.volumeCount = result.volumes.length;
    summary.warningCount = result.lowSpaceWarnings?.length || 0;
  }
  // File shredder specific fields
  if (result.estimatedOverwriteBytes != null) summary.totalMB = Math.round(result.estimatedOverwriteBytes / (1024 * 1024));
  if (result.freedMB != null) summary.freedMB = result.freedMB;
  if (result.deletedCount != null) summary.deletedCount = result.deletedCount;
  if (result.shredded != null) summary.deletedCount = Array.isArray(result.shredded) ? result.shredded.length : result.shredded;
  if (result.errors != null) summary.errors = result.errors;
  if (result.fileCount != null) summary.count = result.fileCount;
  return summary;
}

class ToolRunManager extends EventEmitter {
  constructor({ db, toolRegistry, contextFactory } = {}) {
    super();
    this.db = db;
    this.toolRegistry = toolRegistry;
    this.contextFactory = typeof contextFactory === 'function' ? contextFactory : () => ({});
    this.active = new Map();
    // Set once shutdown begins: no new runs may start afterwards.
    this._shuttingDown = false;
    // Set once the shutdown drain has completed or timed out: persistence
    // after this point would race a closing database, so late completions
    // skip the history write (they still emit and clean up).
    this._persistClosed = false;
  }

  start(registryToolId, args = {}, { source = 'manual' } = {}) {
    if (!this.toolRegistry) throw new Error('Tool registry unavailable');
    if (this._shuttingDown) throw new Error('Tool runs are unavailable during shutdown.');
    const runId = crypto.randomUUID();
    const toolId = effectiveToolId(registryToolId, args);
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const state = {
      runId,
      toolId,
      registryToolId,
      source,
      status: 'running',
      startedAt,
      phase: 'starting',
      pct: 0,
      count: 0,
      total: null,
      currentActivity: '',
      cancelable: true,
      controller,
      lastProgress: null,
      promise: null
    };
    this.active.set(runId, state);
    this.db?.startToolRun({ runId, toolId, source, startedAt });

    const onProgress = (payload = {}) => {
      if (!this.active.has(runId) || controller.signal.aborted) return;
      const nextPct = Number.isFinite(Number(payload.pct))
        ? Math.max(state.pct, Math.min(100, Number(payload.pct)))
        : state.pct;
      Object.assign(state, {
        phase: payload.phase || payload.label || state.phase,
        pct: nextPct,
        count: Number.isFinite(Number(payload.count)) ? Number(payload.count) : state.count,
        total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : state.total,
        currentActivity: payload.currentActivity || payload.path || payload.message || payload.label || state.currentActivity,
        cancelable: payload.cancelable !== false,
        lastProgress: payload
      });
      this.emit('progress', this._snapshot(state, payload));
    };

    this.emit('progress', this._snapshot(state));
    const ctx = {
      ...this.contextFactory(),
      db: this.db,
      toolRegistry: this.toolRegistry,
      signal: controller.signal,
      sendProgress: onProgress
    };

    state.promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new Error('Task canceled');
        return this.toolRegistry.run(registryToolId, args || {}, ctx);
      })
      .then((response) => {
        if (controller.signal.aborted) throw new Error('Task canceled');
        if (!response || !response.ok) throw new Error(response?.error || 'Tool failed');
        return this._finish(state, 'completed', response.data, null);
      })
      .catch((error) => {
        const canceled = controller.signal.aborted || /cancel/i.test(error?.message || '');
        return this._finish(state, canceled ? 'canceled' : 'failed', null, error);
      });

    return { runId, toolId, startedAt };
  }

  async wait(runId) {
    const state = this.active.get(runId);
    if (!state || !state.promise) return null;
    return state.promise;
  }

  cancel(runId) {
    const state = this.active.get(runId);
    if (!state || state.status !== 'running' || !state.cancelable) return false;
    state.status = 'canceling';
    state.phase = 'canceling';
    this.emit('progress', this._snapshot(state));
    state.controller.abort();
    return true;
  }

  getActive() {
    return Array.from(this.active.values()).map((state) => this._snapshot(state));
  }

  getHistory(limit = 50, toolId = null) {
    return this.db?.getToolHistory(limit, toolId) || [];
  }

  isBusy() {
    return this.active.size > 0;
  }

  _snapshot(state, raw = state.lastProgress) {
    return {
      runId: state.runId,
      toolId: state.toolId,
      source: state.source,
      status: state.status,
      startedAt: state.startedAt,
      phase: state.phase,
      pct: state.pct,
      count: state.count,
      total: state.total,
      currentActivity: state.currentActivity,
      cancelable: state.cancelable,
      raw: raw || null
    };
  }

  _finish(state, status, result, error) {
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - new Date(state.startedAt).getTime());
    const completion = {
      ...this._snapshot(state),
      status,
      completedAt,
      durationMs,
      pct: status === 'completed' ? 100 : state.pct,
      result,
      error: error ? (error.message || String(error)) : null
    };
    this.active.delete(state.runId);
    // Check if tool run reports should be generated. Skipped outright once
    // shutdown has closed persistence; failures are logged, never thrown.
    try {
      if (!this._persistClosed) {
        const genReports = this.db?.getSetting?.('reports.generateToolRunReports', true);
        if (genReports !== false) {
          this.db?.finishToolRun({
            runId: state.runId,
            status,
            completedAt,
            durationMs,
            summary: resultSummary(result),
            warnings: result?.warnings || [],
            errors: error ? [completion.error] : (result?.errors || [])
          });
        }
      }
    } catch (persistError) {
      // Persistence must never turn a settled run into a rejection (e.g. a
      // closing database during shutdown): log and keep the completion.
      console.error(`[toolRunManager] Failed to persist tool run ${state.runId}:`, persistError?.message || persistError);
    } finally {
      this.emit('complete', completion);
    }
    return completion;
  }

  /**
   * Explicit shutdown: cancel every active run, then wait for settlement up
   * to timeoutMs. Never hangs: always resolves, reporting whether runs are
   * still pending afterwards. Callers must still tolerate late completions,
   * which settle harmlessly through the normal guarded `_finish` path.
   */
  async shutdown(timeoutMs = 5000) {
    // From here on no new runs may start; idempotent across repeated calls.
    this._shuttingDown = true;
    const states = Array.from(this.active.values());
    for (const state of states) {
      try { this.cancel(state.runId); } catch (_) {}
    }
    if (!states.length) {
      this._persistClosed = true;
      return { settled: true, pending: 0 };
    }
    const ms = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000;
    let timer;
    try {
      await Promise.race([
        Promise.allSettled(states.map((state) => state.promise).filter(Boolean)),
        new Promise((resolve) => { timer = setTimeout(resolve, ms); }),
      ]);
    } finally {
      if (timer && typeof timer.unref === 'function') timer.unref();
      clearTimeout(timer);
      // Whatever settles from here on must not touch persistence: the caller
      // proceeds to close the database immediately after this resolves.
      this._persistClosed = true;
    }
    const pending = Array.from(this.active.values()).map((state) => state.runId);
    return { settled: pending.length === 0, pending: pending.length };
  }
}

module.exports = ToolRunManager;
