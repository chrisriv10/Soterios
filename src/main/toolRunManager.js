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
    'totalFilesScanned', 'totalDuplicates', 'totalWastedSpace', 'appCount',
    'flaggedCount', 'autoStartCount', 'status', 'verdict'
  ];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(result, field)) summary[field] = result[field];
  }
  if (Array.isArray(result.duplicateGroups)) summary.groupCount = result.duplicateGroups.length;
  if (Array.isArray(result.entries)) summary.entryCount = result.entries.length;
  if (Array.isArray(result.items)) summary.itemCount = result.items.length;
  return summary;
}

class ToolRunManager extends EventEmitter {
  constructor({ db, toolRegistry, contextFactory } = {}) {
    super();
    this.db = db;
    this.toolRegistry = toolRegistry;
    this.contextFactory = typeof contextFactory === 'function' ? contextFactory : () => ({});
    this.active = new Map();
  }

  start(registryToolId, args = {}, { source = 'manual' } = {}) {
    if (!this.toolRegistry) throw new Error('Tool registry unavailable');
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
    this.db?.finishToolRun({
      runId: state.runId,
      status,
      completedAt,
      durationMs,
      summary: resultSummary(result),
      warnings: result?.warnings || [],
      errors: error ? [completion.error] : (result?.errors || [])
    });
    this.emit('complete', completion);
    return completion;
  }
}

module.exports = ToolRunManager;
