'use strict';

// Persistent process lifecycle history (Issue #122).
//
// This is deliberately separate from ProcessService.histories, which is
// short-term high-frequency telemetry: a 15-minute in-memory ring of CPU /
// memory samples backing the live view and trace export. That buffer is
// untouched by this module.
//
// This module instead records process LIFECYCLES (started / observed /
// exited) as bounded SQLite rows keyed by pid + process creation time, so
// history survives app restarts and PID reuse produces separate records.
//
// Write discipline (performance): lifecycle transitions only. New processes
// insert one row; exits update one row; `last_seen` refreshes at most once
// per TOUCH_INTERVAL_MS per process (default 5 minutes). Each sample's batch
// commits in a single transaction. A sample with no transitions and no due
// touches performs zero database writes.

const path = require('path');

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TOUCH_ENTRIES = 5000;
// A pending user-termination attribution expires after this long: taskkill
// reports within seconds, so an exit observed much later was not caused by
// the action. Prevents stale flags from mislabeling natural exits.
const TERMINATED_TTL_MS = 15 * 60 * 1000;

// Same semantics as processKeyString in processService.js (kept local to
// avoid a require cycle between the service and this module). Covered by a
// parity test.
function historyKey(pid, startedAt) {
  return `${Number(pid)}@${startedAt != null ? String(startedAt) : ''}`;
}

function safeString(value, maxLength = 256) {
  if (value == null) return null;
  const text = String(value).slice(0, maxLength);
  return /[\r\n\0]/.test(text) ? null : text;
}

function exeBasenameOf(proc) {
  try {
    if (typeof proc?.path === 'string' && proc.path.trim() !== '') return path.win32.basename(proc.path.trim());
  } catch (_) {}
  return null;
}

function riskOf(proc) {
  const score = Number(proc?.risk?.score);
  return {
    score: Number.isFinite(score) ? Math.round(score) : null,
    level: typeof proc?.risk?.severity === 'string' ? proc.risk.severity : null,
  };
}

class ProcessHistoryRecorder {
  constructor(options = {}) {
    this.db = options.db || null;
    this.touchIntervalMs = Number.isFinite(Number(options.touchIntervalMs)) && Number(options.touchIntervalMs) > 0
      ? Number(options.touchIntervalMs)
      : TOUCH_INTERVAL_MS;
    this.terminatedTtlMs = Number.isFinite(Number(options.terminatedTtlMs)) && Number(options.terminatedTtlMs) > 0
      ? Number(options.terminatedTtlMs)
      : TERMINATED_TTL_MS;
    this._touch = new Map();
    this._terminatedKeys = new Map();
  }

  // Recording is allowed only with a database and Privacy Mode OFF. Existing
  // rows stay readable regardless; this gate covers writes only. Any settings
  // read failure fails closed (no writes).
  recordingEnabled() {
    if (!this.db || typeof this.db.getSetting !== 'function') return false;
    try {
      return this.db.getSetting('feature.privacyMode', false) !== true;
    } catch (_) {
      return false;
    }
  }

  markUserTerminated(processKey) {
    if (typeof processKey !== 'string' || !processKey) return;
    const now = Date.now();
    this._terminatedKeys.set(processKey, now);
    for (const [key, markedAt] of this._terminatedKeys) {
      if (now - markedAt > this.terminatedTtlMs) this._terminatedKeys.delete(key);
    }
    while (this._terminatedKeys.size > 1000) {
      this._terminatedKeys.delete(this._terminatedKeys.keys().next().value);
    }
  }

  // Consumes a pending user-termination attribution. Only a recent mark
  // counts: an exit observed long after the action was not caused by it.
  _consumeTerminated(processKey) {
    const markedAt = this._terminatedKeys.get(processKey);
    this._terminatedKeys.delete(processKey);
    return markedAt != null && Date.now() - markedAt <= this.terminatedTtlMs;
  }

  _buildRecord(proc, key, observedAt) {
    const risk = riskOf(proc);
    return {
      processKey: key,
      pid: Number.isInteger(Number(proc?.pid)) ? Number(proc.pid) : null,
      startedAt: proc?.key?.startedAt ?? proc?.startedAt ?? null,
      processName: safeString(proc?.name, 256) || 'unknown',
      exeBasename: safeString(exeBasenameOf(proc), 256),
      parentPid: proc?.ppid == null ? null : Number(proc.ppid),
      publisher: safeString(proc?.publisher ?? proc?.signature?.publisher, 256),
      signatureStatus: safeString(proc?.signature?.status, 64),
      riskScore: risk.score,
      riskLevel: risk.level,
      firstSeen: observedAt,
      lastSeen: observedAt,
    };
  }

  // Records one normalized sample's lifecycle transitions. Never throws:
  // database failures are reported, never propagated, so live monitoring
  // cannot be killed by history persistence.
  recordSample({ processes, previousByKey, delta, collectedAt } = {}) {
    if (!this.recordingEnabled()) return { started: 0, touched: 0, exited: 0, skipped: true };
    const observedAt = collectedAt || new Date().toISOString();
    const outcome = { started: 0, touched: 0, exited: 0, skipped: false };
    const current = Array.isArray(processes) ? processes : [];
    // An empty current set against a non-empty previous one is a collector
    // glitch, never a mass exit (Windows always has processes): recording
    // exits here would scar every row, so skip the sample entirely.
    if (current.length === 0 && (previousByKey?.size || 0) > 0) {
      outcome.skippedEmpty = true;
      return outcome;
    }
    const batch = () => {
      // Snapshot mutable recorder state: if the transaction below rolls
      // back, in-memory state must roll back with it, otherwise the next
      // sample would skip the lost insert (touch) or lose the attribution
      // (terminated flag) that the database never received.
      const touchSnapshot = new Map(this._touch);
      const terminatedSnapshot = new Map(this._terminatedKeys);
      try {
        this._runBatch({ current, previousByKey, delta, observedAt, outcome });
      } catch (error) {
        this._touch = touchSnapshot;
        this._terminatedKeys = terminatedSnapshot;
        throw error;
      }
    };
    // One transaction per sample batch: hundreds of lifecycle writes commit
    // once instead of once per row. Falls back to direct execution when the
    // database handle does not offer transactions (e.g. test stubs).
    try {
      if (this.db && typeof this.db.runInTransaction === 'function') {
        this.db.runInTransaction(batch);
      } else {
        batch();
      }
    } catch (error) {
      outcome.error = error?.message || String(error);
    }
    return outcome;
  }

  _runBatch({ current, previousByKey, delta, observedAt, outcome }) {
    const seen = new Set();
    for (const proc of current) {
      const key = historyKey(proc?.key?.pid ?? proc?.pid, proc?.key?.startedAt ?? proc?.startedAt);
      seen.add(key);
      const known = this._touch.get(key);
      if (!known) {
        const dbKey = this._resolveDbKey(proc, key, observedAt);
        const record = this._buildRecord(proc, key, observedAt);
        record.processKey = dbKey;
        this.db.upsertProcessHistory(record);
        outcome.started += 1;
        this._rememberTouch(key, proc, dbKey);
        continue;
      }
      const risk = riskOf(proc);
      const riskChanged = risk.score !== known.riskScore || risk.level !== known.riskLevel;
      if (riskChanged || Date.now() - known.at >= this.touchIntervalMs) {
        const record = this._buildRecord(proc, key, observedAt);
        record.processKey = known.dbKey || key;
        this.db.upsertProcessHistory(record);
        outcome.touched += 1;
        this._rememberTouch(key, proc, known.dbKey || key);
      }
    }
    for (const exited of delta?.exited || []) {
      const key = historyKey(exited?.key?.pid ?? exited?.pid, exited?.key?.startedAt);
      const dbKey = this._touch.get(key)?.dbKey || key;
      const prior = previousByKey?.get?.(key);
      const risk = riskOf(prior);
      this.db.markProcessHistoryExit(dbKey, {
        exitTime: exited?.exitedAt || observedAt,
        lastSeen: exited?.exitedAt || observedAt,
        riskScore: risk.score,
        riskLevel: risk.level,
        terminatedByUser: this._consumeTerminated(key),
      });
      this._touch.delete(key);
      outcome.exited += 1;
    }
    // Drop touch state for keys that vanished without an exit event (e.g.
    // missed transitions); their rows keep last_seen honestly.
    for (const key of [...this._touch.keys()]) {
      if (!seen.has(key)) this._touch.delete(key);
    }
    if (this._touch.size > MAX_TOUCH_ENTRIES) {
      for (const key of this._touch.keys()) {
        if (this._touch.size <= MAX_TOUCH_ENTRIES) break;
        this._touch.delete(key);
      }
    }
  }

  // Resolves the database row a fresh observation belongs to. Precise
  // identities use their stable key (reopening a transiently recorded exit
  // first). Imprecise identities (`pid@` with no creation time) continue the
  // still-open row for that pid when one exists; a new lifecycle colliding
  // with a closed row gets a synthetic unique key instead of overwriting
  // another process's history.
  _resolveDbKey(proc, key, observedAt) {
    const identityStartedAt = proc?.key?.startedAt ?? proc?.startedAt;
    if (identityStartedAt != null && String(identityStartedAt) !== '') {
      if (typeof this.db.reopenProcessHistory === 'function') {
        this.db.reopenProcessHistory(key, observedAt);
      }
      return key;
    }
    try {
      if (typeof this.db.findOpenImpreciseProcessRow === 'function') {
        const open = this.db.findOpenImpreciseProcessRow(Number(proc?.key?.pid ?? proc?.pid));
        if (open?.process_key) return open.process_key;
      }
      const existing = typeof this.db.getProcessHistoryRow === 'function'
        ? this.db.getProcessHistoryRow(key)
        : null;
      if (existing && existing.exit_time != null) {
        return `${Number(proc?.key?.pid ?? proc?.pid)}@unknown-${observedAt}`;
      }
    } catch (_) {}
    return key;
  }

  _rememberTouch(key, proc, dbKey = null) {
    const risk = riskOf(proc);
    this._touch.set(key, {
      at: Date.now(),
      riskScore: risk.score,
      riskLevel: risk.level,
      dbKey: dbKey || key,
    });
  }

  // Enrichment observed outside sampling (e.g. the security section of
  // getDetails): publisher/signature filled in after the fact. Resolves
  // synthetic rows through the touch map when available.
  recordEnrichment(processKey, { publisher, signatureStatus, riskScore, riskLevel } = {}) {
    if (!this.recordingEnabled()) return { skipped: true };
    const dbKey = this._touch.get(processKey)?.dbKey || processKey;
    try {
      this.db.updateProcessHistoryEnrichment(dbKey, {
        publisher: safeString(publisher, 256),
        signatureStatus: safeString(signatureStatus, 64),
        riskScore: Number.isFinite(Number(riskScore)) ? Math.round(Number(riskScore)) : null,
        riskLevel: typeof riskLevel === 'string' ? riskLevel : null,
        lastSeen: new Date().toISOString(),
      });
      return { skipped: false };
    } catch (error) {
      return { skipped: false, error: error?.message || String(error) };
    }
  }

  query(filters) {
    if (!this.db) throw new Error('Process history is unavailable.');
    return this.db.queryProcessHistory(filters);
  }

  getRetentionDays() {
    if (!this.db) throw new Error('Process history is unavailable.');
    return this.db.getProcessHistoryRetentionDays();
  }

  setRetentionDays(days) {
    if (!this.db) throw new Error('Process history is unavailable.');
    return this.db.setProcessHistoryRetentionDays(days);
  }

  clear() {
    if (!this.db) throw new Error('Process history is unavailable.');
    return this.db.clearProcessHistory();
  }

  // Retention cleanup: expired rows first, then the hard row-count bound.
  // Never throws; failures are reported so scheduled cleanup cannot crash
  // the caller.
  runCleanup() {
    if (!this.db) return { skipped: true };
    try {
      return { skipped: false, ...this.db.pruneProcessHistory() };
    } catch (error) {
      return { skipped: false, error: error?.message || String(error) };
    }
  }
}

module.exports = {
  ProcessHistoryRecorder,
  historyKey,
  TOUCH_INTERVAL_MS,
};
