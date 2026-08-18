'use strict';

// AI-triggered actions. The model emits a marker line like [[action:scan-quick]]
// on its own line; this module parses markers out of the streaming reply and
// executes the requested action. Only safe, non-destructive actions are
// exposed. Long-running actions (scans, duplicate search) report a "started"
// state immediately and deliver the final result through onUpdate later.

const MARKER_PATTERN = /\[\[action:([a-z0-9-]+)(?::([^\]]*))?\]\]/g;

const ACTION_LABELS = {
  'scan-quick': 'Quick scan',
  'scan-full': 'Full scan',
  'health-score': 'Health score',
  'security-overview': 'Security overview',
  'system-monitor': 'System monitor',
  'process-viewer': 'Process viewer',
  'password-generator': 'Password generator',
  'duplicate-file-finder': 'Duplicate file finder',
  'startup-persistence-scan': 'Startup persistence scan',
  'generate-security-report': 'System report',
};

// Actions that can take a long time. They return a "started" result right away
// and their final result is delivered later via the onUpdate callback.
const ASYNC_ACTIONS = new Set(['scan-quick', 'scan-full', 'duplicate-file-finder']);

// Strips [[action:...]] markers from a streamed delta text. Markers may be
// split across tokens, so a small carry buffer holds back any trailing text
// that could be the beginning of a marker until it resolves.
class ActionMarkerStream {
  constructor() {
    this._carry = '';
    this.markers = [];
  }

  push(delta) {
    const pending = this._carry + String(delta == null ? '' : delta);
    this._carry = '';
    let markers = [];
    const stripped = pending.replace(MARKER_PATTERN, (match) => {
      markers.push(match);
      return '';
    });
    if (markers.length > 0) {
      this.markers.push(...markers);
    }

    let hold = 0;
    const fullTail = stripped.match(/\[\[action:[a-z0-9-]*(?::[^\]]*)?$/i);
    if (fullTail) {
      hold = fullTail[0].length;
    } else {
      const lb = stripped.lastIndexOf('[[');
      if (lb !== -1) {
        const tail = stripped.slice(lb);
        if (tail === '[[' || '[[action:'.startsWith(tail) || /^\[\[action:[a-z0-9-]*$/i.test(tail)) {
          hold = tail.length;
        }
      }
    }

    const text = hold > 0 ? stripped.slice(0, stripped.length - hold) : stripped;
    this._carry = hold > 0 ? stripped.slice(stripped.length - hold) : '';
    return { text, markers };
  }

  flush() {
    const rest = this._carry;
    this._carry = '';
    return rest;
  }
}

function extractActionMarkers(text) {
  const markers = [];
  const clean = String(text || '').replace(MARKER_PATTERN, (match) => {
    markers.push(match);
    return '';
  });
  return { markers, text: clean };
}

function summarizeScanResult(actionId, result) {
  if (!result) return 'Scan returned no result';
  if (result.error && !result.success) return String(result.error);
  const type = actionId === 'scan-full' ? 'Full' : 'Quick';
  const status = result.canceled ? 'cancelled' : (result.status || (result.success ? 'completed' : 'failed'));
  const files = Number(result.filesScanned) || 0;
  const threats = Number(result.threatsFound) || 0;
  const durationMs = Number(result.durationMs) || 0;
  const duration = durationMs > 0
    ? `${Math.round(durationMs / 1000)}s`
    : '';
  const base = `${type} scan ${status}: ${files.toLocaleString()} files scanned, ${threats} threat${threats === 1 ? '' : 's'} found${duration ? ` in ${duration}` : ''}`;
  if (threats > 0 && Array.isArray(result.threats) && result.threats.length > 0) {
    const names = result.threats.slice(0, 3).map((t) => t && t.name ? t.name : 'unknown').join(', ');
    return `${base}. Threats: ${names}${result.threats.length > 3 ? ` +${result.threats.length - 3} more` : ''}. They were moved to quarantine.`;
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    return `${base}. Errors: ${result.errors.slice(0, 2).join('; ')}`;
  }
  return base;
}

function summarizeToolResult(actionId, data) {
  if (data == null) return 'Completed with no data';
  if (typeof data === 'string') return data.slice(0, 400);
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  const summary = data.summary || data.message || data.result || null;
  if (typeof summary === 'string' && summary.trim()) return summary.slice(0, 400);
  const top = {};
  try {
    for (const key of Object.keys(data).slice(0, 6)) {
      const value = data[key];
      if (Array.isArray(value)) {
        top[key] = `${value.length} item${value.length === 1 ? '' : 's'}`;
      } else if (value && typeof value === 'object') {
        top[key] = '(details)';
      } else {
        top[key] = value;
      }
    }
  } catch (_) {}
  const text = JSON.stringify(top);
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

async function runTool(ctx, toolId) {
  const result = await ctx.toolRegistry.run(toolId, {}, ctx);
  if (!result) return { ok: false, error: 'Tool returned no result' };
  if (!result.ok) {
    return { ok: false, error: result.error || `Tool ${toolId} failed` };
  }
  return { ok: true, data: result.data };
}

function buildContext(ctx) {
  return {
    db: ctx.db,
    toolRegistry: ctx.toolRegistry,
    log: typeof ctx.log === 'function' ? ctx.log : () => {},
    sendProgress: () => {},
  };
}

// Executes one action. Returns { ok, label, data?, error?, summary?, started? }.
// For async actions, started=true means the action is running in the background
// and ctx.onUpdate will be called with the final result.
async function executeAction(actionId, ctx) {
  const label = ACTION_LABELS[actionId] || actionId;
  const toolCtx = buildContext(ctx);
  const onUpdate = ctx.onUpdate;

  if (actionId === 'scan-quick' || actionId === 'scan-full') {
    const scanEngine = ctx.scanEngine;
    if (!scanEngine || typeof scanEngine.runQuickScan !== 'function') {
      return { ok: false, label, error: 'Scan engine is not available' };
    }
    // Scans can take minutes and runQuickScan blocks until done, so the scan
    // runs in the background and the final result arrives via onUpdate.
    const promise = actionId === 'scan-full'
      ? scanEngine.runFullScan()
      : scanEngine.runQuickScan();
    if (typeof onUpdate === 'function') {
      promise.then((result) => {
        if (result && result.error && result.success === undefined) {
          onUpdate(ctx, { ok: false, label, error: String(result.error), summary: String(result.error), completed: true });
          return;
        }
        onUpdate(ctx, {
          ok: !!(result && result.success),
          label,
          error: result && result.error && !result.success ? String(result.error) : '',
          summary: summarizeScanResult(actionId, result),
          completed: true,
        });
      }).catch((err) => {
        onUpdate(ctx, {
          ok: false,
          label,
          error: err && err.message ? err.message : String(err),
          summary: err && err.message ? err.message : String(err),
          completed: true,
        });
      });
    }
    return { ok: true, label, started: true, summary: `${label} started` };
  }

  if (actionId === 'duplicate-file-finder') {
    const promise = ctx.toolRegistry.run('duplicate-file-finder', {}, toolCtx);
    if (typeof onUpdate === 'function') {
      promise.then((result) => {
        const data = result && result.ok ? (result.data || {}) : null;
        const duplicates = data && Array.isArray(data.duplicates) ? data.duplicates.length : null;
        const summary = !result || !result.ok
          ? (result && result.error ? String(result.error) : 'Duplicate search failed')
          : duplicates != null
            ? `Duplicate search finished: ${duplicates} duplicate group${duplicates === 1 ? '' : 's'} found`
            : summarizeToolResult(actionId, data);
        onUpdate(ctx, {
          ok: !!(result && result.ok),
          label,
          error: result && result.error ? String(result.error) : '',
          summary,
          completed: true,
        });
      });
    }
    return { ok: true, label, started: true, summary: `${label} started` };
  }

  const result = await runTool(ctx, actionId);
  if (!result.ok) {
    return { ok: false, label, error: result.error };
  }
  return {
    ok: true,
    label,
    data: result.data,
    summary: summarizeToolResult(actionId, result.data),
  };
}

function actionListText() {
  return Object.keys(ACTION_LABELS)
    .map((id) => `- [[action:${id}]] — ${ACTION_LABELS[id]}`)
    .join('\n');
}

module.exports = {
  ACTION_LABELS,
  ASYNC_ACTIONS,
  MARKER_PATTERN,
  ActionMarkerStream,
  actionListText,
  executeAction,
  extractActionMarkers,
  summarizeScanResult,
  summarizeToolResult,
};
