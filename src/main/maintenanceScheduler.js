'use strict';

const DEFAULT_MAINTENANCE = {
  enabled: false,
  schedulePreset: 'weekly',
  intervalHours: 168,
  minIdleSeconds: 900,
  policies: {
    'clear-temp-files': 'analyze',
    'disk-space-report': 'analyze'
  },
  scriptIds: ['clear-temp-files', 'disk-space-report'],
  notifyOnComplete: true,
  lastRun: null,
  lastAttempt: null,
  lastResult: null
};

const SCHEDULE_PRESETS = {
  daily: { intervalHours: 24, label: 'Daily' },
  weekly: { intervalHours: 168, label: 'Weekly' },
  idle: { intervalHours: 24, label: 'When idle (app running)', minIdleSeconds: 900 },
  custom: { label: 'Custom interval' }
};

const ALLOWED_SCRIPT_IDS = new Set([
  'clear-temp-files', 'disk-space-report', 'large-files-report', 'browser-cache-report'
]);
const AUTO_CLEAN_SCRIPT_IDS = new Set(['clear-temp-files', 'browser-cache-report']);
const POLICY_MODES = new Set(['off', 'analyze', 'auto-clean']);
const MIN_INTERVAL_HOURS = 24;
const MAX_INTERVAL_HOURS = 720;

const DEFAULT_SCRIPT_ARGS = {
  'clear-temp-files': { minimumAgeDays: 7 },
  'large-files-report': { thresholdMB: 100 },
  'browser-cache-report': { browsers: [] }
};

function normalizeScriptArgs(value) {
  const result = {};
  for (const [scriptId, rawArgs] of Object.entries(value || {})) {
    if (!ALLOWED_SCRIPT_IDS.has(scriptId)) continue;
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) continue;
    const args = {};
    if (rawArgs.minimumAgeDays !== undefined) {
      const age = Math.floor(Number(rawArgs.minimumAgeDays));
      if (Number.isFinite(age)) args.minimumAgeDays = Math.max(1, Math.min(365, age));
    }
    if (rawArgs.thresholdMB !== undefined) {
      const mb = Math.floor(Number(rawArgs.thresholdMB));
      if (Number.isFinite(mb)) args.thresholdMB = Math.max(1, Math.min(100000, mb));
    }
    if (Array.isArray(rawArgs.browsers)) {
      args.browsers = rawArgs.browsers.map((value) => String(value).toLowerCase()).filter(Boolean);
    }
    if (Object.keys(args).length) result[scriptId] = args;
  }
  return result;
}

function normalizePolicies(value) {
  const result = {};
  for (const [scriptId, rawMode] of Object.entries(value || {})) {
    if (!ALLOWED_SCRIPT_IDS.has(scriptId)) continue;
    let mode = POLICY_MODES.has(rawMode) ? rawMode : 'off';
    if (mode === 'auto-clean' && !AUTO_CLEAN_SCRIPT_IDS.has(scriptId)) mode = 'analyze';
    if (mode !== 'off') result[scriptId] = mode;
  }
  return result;
}

function scriptArgsFor(scriptId, modeOrDryRun = 'analyze') {
  // Preserve the historical helper contract for legacy callers while the
  // scheduler itself uses explicit policy strings.
  if (typeof modeOrDryRun === 'boolean') {
    if (scriptId === 'clear-temp-files') return { dryRun: !!modeOrDryRun, maxAgeDays: 7 };
    return {};
  }
  if (scriptId === 'clear-temp-files') return { mode: 'analyze', minimumAgeDays: 7 };
  return {};
}

function resolveIntervalHours(config) {
  const preset = config.schedulePreset || 'weekly';
  if (preset === 'custom') {
    return Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Number(config.intervalHours) || DEFAULT_MAINTENANCE.intervalHours));
  }
  return (SCHEDULE_PRESETS[preset] || SCHEDULE_PRESETS.weekly).intervalHours || DEFAULT_MAINTENANCE.intervalHours;
}

function summarizeResult(scriptId, data) {
  if (!data || typeof data !== 'object') return {};
  if (scriptId === 'clear-temp-files') return {
    candidateCount: data.candidateCount || 0,
    reclaimableBytes: data.reclaimableBytes || 0,
    deletedCount: data.deletedCount || 0,
    reclaimedBytes: data.freedBytes || 0,
    skippedCount: data.skippedCount || data.skipped?.length || 0
  };
  if (scriptId === 'browser-cache-report') return { totalBytes: data.totalBytes || 0, browserCount: data.browserCount || 0 };
  if (scriptId === 'disk-space-report') return { volumeCount: data.volumes?.length || 0, warningCount: data.lowSpaceWarnings?.length || 0 };
  if (scriptId === 'large-files-report') return { count: data.count || 0, totalSizeBytes: data.totalSizeBytes || 0 };
  return {};
}

class MaintenanceScheduler {
  constructor(options) {
    this.db = options.db;
    this.toolRegistry = options.toolRegistry;
    this.toolRunManager = options.toolRunManager || null;
    this.isScanActive = options.isScanActive || (() => false);
    this.getIdleTimeSeconds = options.getIdleTimeSeconds || (() => 0);
    this.notify = options.notify || (() => {});
    this.log = options.log || (() => {});
    this.settingKey = 'maintenance.schedule';
    this._running = false;
    this._activeRunId = null;
    this._cancelRequested = false;
    this._timer = null;
    this._startupTimer = null;
  }

  loadConfig() {
    const stored = this.db.getSetting(this.settingKey, null);
    const merged = { ...DEFAULT_MAINTENANCE, ...(stored || {}) };
    if (stored?.policies) {
      merged.policies = normalizePolicies(stored.policies);
    } else if (stored?.scriptIds) {
      // Safety migration: historical selections become analysis-only until
      // the user explicitly opts into auto-clean in Settings.
      merged.policies = Object.fromEntries(stored.scriptIds.filter((id) => ALLOWED_SCRIPT_IDS.has(id)).map((id) => [id, 'analyze']));
    } else {
      merged.policies = { ...DEFAULT_MAINTENANCE.policies };
    }
    if (!Object.keys(merged.policies).length) merged.policies = { ...DEFAULT_MAINTENANCE.policies };
    merged.scriptIds = Object.keys(merged.policies);
    if (!SCHEDULE_PRESETS[merged.schedulePreset]) merged.schedulePreset = DEFAULT_MAINTENANCE.schedulePreset;
    merged.intervalHours = resolveIntervalHours(merged);
    merged.minIdleSeconds = Math.max(60, Number(merged.minIdleSeconds) || DEFAULT_MAINTENANCE.minIdleSeconds);
    merged.scriptArgs = { ...DEFAULT_SCRIPT_ARGS, ...normalizeScriptArgs(merged.scriptArgs) };
    const anchor = merged.lastAttempt || merged.lastRun;
    merged.nextEligibleRun = anchor
      ? new Date(new Date(anchor).getTime() + merged.intervalHours * 60 * 60 * 1000).toISOString()
      : null;
    return merged;
  }

  saveConfig(partial) {
    const current = this.loadConfig();
    const merged = { ...current, ...(partial || {}) };
    if (partial?.policies) {
      merged.policies = normalizePolicies(partial.policies);
      merged.legacyLiveCleanup = false;
    } else if (partial && Object.prototype.hasOwnProperty.call(partial, 'scriptIds')) {
      // Legacy programmatic callers used scriptIds to request actual temp
      // cleanup. The current Settings UI always sends policies.
      merged.policies = Object.fromEntries((partial.scriptIds || [])
        .filter((id) => ALLOWED_SCRIPT_IDS.has(id))
        .map((id) => [id, id === 'clear-temp-files' ? 'auto-clean' : 'analyze']));
      merged.legacyLiveCleanup = true;
    }
    if (!Object.keys(merged.policies || {}).length) merged.policies = { ...DEFAULT_MAINTENANCE.policies };
    merged.scriptIds = Object.keys(merged.policies);
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'intervalHours')) {
      merged.intervalHours = Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Number(partial.intervalHours) || DEFAULT_MAINTENANCE.intervalHours));
    }
    if (partial?.schedulePreset) merged.schedulePreset = SCHEDULE_PRESETS[partial.schedulePreset] ? partial.schedulePreset : merged.schedulePreset;
    merged.intervalHours = resolveIntervalHours(merged);
    merged.scriptArgs = { ...DEFAULT_SCRIPT_ARGS, ...normalizeScriptArgs(merged.scriptArgs) };
    delete merged.nextEligibleRun;
    this.db.setSetting(this.settingKey, merged);
    return this.loadConfig();
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.runIfDue().catch((error) => this.log('warn', 'Scheduled maintenance check failed', { message: error.message })), 60 * 1000);
    this._timer.unref?.();
    this._startupTimer = setTimeout(() => this.runIfDue().catch((error) => this.log('warn', 'Scheduled maintenance startup check failed', { message: error.message })), 20 * 1000);
    this._startupTimer.unref?.();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._startupTimer) clearTimeout(this._startupTimer);
    this.cancel();
    this._timer = null;
    this._startupTimer = null;
  }

  shouldSkipForIdle(config) {
    return config.schedulePreset === 'idle' && this.getIdleTimeSeconds() < config.minIdleSeconds;
  }

  _busyReason() {
    if (this.isScanActive()) return 'active-scan';
    if (this.toolRunManager?.isBusy()) return 'another-tool-running';
    return null;
  }

  async runIfDue() {
    if (this._running) return { ok: false, skipped: true, reason: 'already-running' };
    const config = this.loadConfig();
    if (!config.enabled) return { ok: false, skipped: true, reason: 'disabled' };
    if (this.shouldSkipForIdle(config)) return { ok: false, skipped: true, reason: 'user-active' };
    const busy = this._busyReason();
    if (busy) return { ok: false, skipped: true, reason: busy };
    const lastAttemptMs = config.lastAttempt ? new Date(config.lastAttempt).getTime() : 0;
    if (Date.now() - lastAttemptMs < config.intervalHours * 60 * 60 * 1000) return { ok: false, skipped: true, reason: 'not-due' };
    return this.runNow({ manual: false });
  }

  cancel() {
    this._cancelRequested = true;
    if (this._activeRunId && this.toolRunManager) this.toolRunManager.cancel(this._activeRunId);
    return this._running;
  }

  async _executeScript(scriptId, scriptArgs, source = 'scheduled') {
    if (this.toolRunManager) {
      const started = this.toolRunManager.start('run-script', { scriptId, scriptArgs }, { source });
      this._activeRunId = started.runId;
      const completion = await this.toolRunManager.wait(started.runId);
      this._activeRunId = null;
      if (completion?.status !== 'completed') return { ok: false, error: completion?.error || completion?.status || 'failed' };
      return { ok: true, data: completion.result };
    }
    return this.toolRegistry.run('run-script', { scriptId, scriptArgs }, { toolRegistry: this.toolRegistry, db: this.db, log: this.log });
  }

  _normalizeOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = {};
    for (const [scriptId, entry] of Object.entries(value)) {
      if (!ALLOWED_SCRIPT_IDS.has(scriptId)) continue;
      const raw = entry && typeof entry === 'object' ? entry : { mode: entry };
      let mode = POLICY_MODES.has(raw.mode) ? raw.mode : 'off';
      if (mode === 'auto-clean' && !AUTO_CLEAN_SCRIPT_IDS.has(scriptId)) mode = 'analyze';
      if (mode === 'off') continue;
      const args = {};
      if (raw.args && typeof raw.args === 'object') {
        if (raw.args.minimumAgeDays !== undefined) {
          const age = Math.floor(Number(raw.args.minimumAgeDays));
          if (Number.isFinite(age)) args.minimumAgeDays = Math.max(1, Math.min(365, age));
        }
        if (Array.isArray(raw.args.browsers)) {
          args.browsers = raw.args.browsers.map((value) => String(value).toLowerCase()).filter(Boolean);
        }
      }
      result[scriptId] = { mode, args };
    }
    return Object.keys(result).length ? result : null;
  }

  async _runPolicy(scriptId, mode, source, legacyLiveCleanup = false, argsOverride = {}) {
    if (legacyLiveCleanup && scriptId === 'clear-temp-files' && mode === 'auto-clean') {
      const cleanup = await this._executeScript(scriptId, scriptArgsFor(scriptId, false), source);
      return { ...cleanup, policy: mode, summary: summarizeResult(scriptId, cleanup.data) };
    }
    const analysisArgs = scriptArgsFor(scriptId, 'analyze');
    if (argsOverride.minimumAgeDays && Number.isFinite(Number(argsOverride.minimumAgeDays))) {
      analysisArgs.minimumAgeDays = Math.max(1, Math.min(365, Math.floor(Number(argsOverride.minimumAgeDays))));
    }
    if (scriptId === 'large-files-report' && argsOverride.thresholdMB && Number.isFinite(Number(argsOverride.thresholdMB))) {
      analysisArgs.thresholdMB = Math.max(1, Math.min(100000, Math.floor(Number(argsOverride.thresholdMB))));
    }
    const analysis = await this._executeScript(scriptId, analysisArgs, source);
    if (!analysis.ok || mode !== 'auto-clean') return { ...analysis, policy: mode, summary: summarizeResult(scriptId, analysis.data) };
    if (scriptId === 'clear-temp-files') {
      const candidates = analysis.data?.candidates || [];
      if (!candidates.length) return { ok: true, policy: mode, summary: summarizeResult(scriptId, analysis.data), skippedReason: 'nothing-eligible' };
      const cleanup = await this._executeScript(scriptId, { mode: 'clean', minimumAgeDays: analysisArgs.minimumAgeDays, selectedPaths: candidates }, source);
      return { ...cleanup, policy: mode, summary: summarizeResult(scriptId, cleanup.data), analysisSummary: summarizeResult(scriptId, analysis.data) };
    }
    if (scriptId === 'browser-cache-report') {
      const cleanup = await this._executeScript('clear-browser-cache', { browsers: Array.isArray(argsOverride.browsers) ? argsOverride.browsers : [] }, source);
      return {
        ...cleanup,
        policy: mode,
        summary: {
          ...summarizeResult(scriptId, analysis.data),
          reclaimedBytes: cleanup.data?.totalBytes || 0,
          skippedCount: cleanup.data?.skippedCount || 0
        }
      };
    }
    return { ok: false, policy: mode, error: 'This tool cannot auto-clean unattended.' };
  }

  async runNow(options = {}) {
    if (this._running) return { ok: false, skipped: true, reason: 'already-running' };
    const busy = this._busyReason();
    if (busy) return { ok: false, skipped: true, reason: busy };
    const config = this.loadConfig();
    const effectivePolicies = this._normalizeOverrides(options.policyOverrides) || config.policies;
    this._running = true;
    this._cancelRequested = false;
    const startedAt = new Date().toISOString();
    this.saveConfig({ lastAttempt: startedAt });
    const results = [];
    try {
      for (const [scriptId, policyEntry] of Object.entries(effectivePolicies)) {
        const mode = typeof policyEntry === 'string' ? policyEntry : (policyEntry?.mode || 'off');
        const overrideArgs = policyEntry && typeof policyEntry === 'object' && policyEntry.args && typeof policyEntry.args === 'object' ? policyEntry.args : {};
        const persistedArgs = options.manual ? {} : ((config.scriptArgs || {})[scriptId] || {});
        const argsOverride = { ...persistedArgs, ...overrideArgs };
        if (this._cancelRequested) {
          results.push({ scriptId, policy: mode, ok: false, skipped: true, error: 'Canceled before start.' });
          continue;
        }
        try {
          const outcome = await this._runPolicy(scriptId, mode, options.manual ? 'manual-scheduled' : 'scheduled', !!config.legacyLiveCleanup && !options.policyOverrides, argsOverride);
          results.push({
            scriptId,
            policy: mode,
            ok: !!outcome.ok,
            status: outcome.ok ? 'completed' : (/cancel/i.test(outcome.error || '') ? 'canceled' : 'failed'),
            summary: outcome.summary || {},
            skippedReason: outcome.skippedReason || null,
            warnings: outcome.data?.warnings || [],
            error: outcome.error || null
          });
        } catch (error) {
          results.push({ scriptId, policy: mode, ok: false, status: 'failed', summary: {}, warnings: [], error: error.message });
        }
      }
      const okCount = results.filter((result) => result.ok).length;
      const reclaimedBytes = results.reduce((sum, result) => sum + Number(result.summary?.reclaimedBytes || 0), 0);
      const summary = `Maintenance completed (${okCount}/${results.length} tasks OK).`;
      const dryRun = options.dryRunCleanup !== undefined
        ? options.dryRunCleanup
        : !Object.values(effectivePolicies).map((entry) => typeof entry === 'string' ? entry : (entry?.mode || 'off')).includes('auto-clean');
      this.db.addMaintenanceRun({ startedAt, results, dryRunCleanup: dryRun, source: options.manual ? 'manual-scheduled' : 'scheduled' });
      this.db.addAlert(okCount === results.length ? 'info' : 'warning', `[Maintenance] ${summary}`);
      const lastResult = { startedAt, okCount, totalCount: results.length, reclaimedBytes, results };
      if (okCount > 0) this.saveConfig({ lastRun: startedAt, lastResult });
      else this.saveConfig({ lastResult });
      if (config.notifyOnComplete && this.db.getSetting('feature.notificationsEnabled', true)) {
        this.notify(options.manual ? 'Maintenance' : 'Scheduled maintenance', summary, okCount === results.length ? 'info' : (okCount ? 'warn' : 'danger'));
      }
      return {
        ok: okCount === results.length,
        success: okCount === results.length,
        partialSuccess: okCount > 0 && okCount < results.length,
        startedAt,
        results,
        reclaimedBytes,
        policies: effectivePolicies,
        schedulePreset: config.schedulePreset
      };
    } finally {
      this._running = false;
      this._activeRunId = null;
    }
  }
}

module.exports = {
  MaintenanceScheduler,
  DEFAULT_MAINTENANCE,
  ALLOWED_SCRIPT_IDS,
  AUTO_CLEAN_SCRIPT_IDS,
  POLICY_MODES,
  SCHEDULE_PRESETS,
  MIN_INTERVAL_HOURS,
  MAX_INTERVAL_HOURS,
  DEFAULT_SCRIPT_ARGS,
  scriptArgsFor,
  resolveIntervalHours,
  normalizePolicies,
  normalizeScriptArgs
};
