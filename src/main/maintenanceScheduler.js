'use strict';

const DEFAULT_MAINTENANCE = {
  enabled: false,
  schedulePreset: 'weekly',
  intervalHours: 168,
  minIdleSeconds: 900,
  scriptIds: ['clear-temp-files', 'disk-space-report'],
  notifyOnComplete: true,
  lastRun: null,
  lastAttempt: null
};

const SCHEDULE_PRESETS = {
  daily: { intervalHours: 24, label: 'Daily' },
  weekly: { intervalHours: 168, label: 'Weekly' },
  idle: { intervalHours: 24, label: 'When idle (app running)', minIdleSeconds: 900 },
  custom: { label: 'Custom interval' }
};

const ALLOWED_SCRIPT_IDS = new Set([
  'clear-temp-files',
  'list-startup-items',
  'disk-space-report',
  'large-files-report',
  'browser-cache-report',
  'windows-services-report',
  'network-report'
]);

const MIN_INTERVAL_HOURS = 24;
const MAX_INTERVAL_HOURS = 720;

function scriptArgsFor(scriptId, dryRunCleanup) {
  if (scriptId === 'clear-temp-files') {
    return { dryRun: !!dryRunCleanup, maxAgeDays: 7 };
  }
  return {};
}

function resolveIntervalHours(config) {
  const preset = config.schedulePreset || 'weekly';
  if (preset === 'custom') {
    return Math.min(
      MAX_INTERVAL_HOURS,
      Math.max(MIN_INTERVAL_HOURS, Number(config.intervalHours) || DEFAULT_MAINTENANCE.intervalHours)
    );
  }
  const presetDef = SCHEDULE_PRESETS[preset] || SCHEDULE_PRESETS.weekly;
  return presetDef.intervalHours || DEFAULT_MAINTENANCE.intervalHours;
}

class MaintenanceScheduler {
  /**
   * @param {object} options
   * @param {import('../core/database')} options.db
   * @param {{ run: Function }} options.toolRegistry
   * @param {() => number} [options.getIdleTimeSeconds]
   * @param {(title: string, body: string, level?: string) => void} [options.notify]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options) {
    this.db = options.db;
    this.toolRegistry = options.toolRegistry;
    this.getIdleTimeSeconds = options.getIdleTimeSeconds || (() => 0);
    this.notify = options.notify || (() => {});
    this.log = options.log || (() => {});
    this.settingKey = 'maintenance.schedule';
    this._running = false;
    this._timer = null;
    this._startupTimer = null;
  }

  loadConfig() {
    const stored = this.db.getSetting(this.settingKey, null);
    const merged = { ...DEFAULT_MAINTENANCE, ...(stored || {}) };
    merged.scriptIds = (merged.scriptIds || []).filter((id) => ALLOWED_SCRIPT_IDS.has(id));
    if (!merged.scriptIds.length) merged.scriptIds = [...DEFAULT_MAINTENANCE.scriptIds];
    if (!SCHEDULE_PRESETS[merged.schedulePreset]) merged.schedulePreset = DEFAULT_MAINTENANCE.schedulePreset;
    merged.intervalHours = resolveIntervalHours(merged);
    merged.minIdleSeconds = Math.max(60, Number(merged.minIdleSeconds) || DEFAULT_MAINTENANCE.minIdleSeconds);
    return merged;
  }

  saveConfig(partial) {
    const merged = { ...this.loadConfig(), ...(partial || {}) };
    merged.scriptIds = (merged.scriptIds || []).filter((id) => ALLOWED_SCRIPT_IDS.has(id));
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'intervalHours')) {
      merged.intervalHours = Math.min(
        MAX_INTERVAL_HOURS,
        Math.max(MIN_INTERVAL_HOURS, Number(partial.intervalHours) || DEFAULT_MAINTENANCE.intervalHours)
      );
    }
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'schedulePreset')) {
      merged.schedulePreset = SCHEDULE_PRESETS[partial.schedulePreset] ? partial.schedulePreset : merged.schedulePreset;
    }
    merged.intervalHours = resolveIntervalHours(merged);
    this.db.setSetting(this.settingKey, merged);
    return merged;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.runIfDue().catch((err) => {
        this.log('warn', 'Scheduled maintenance check failed', {
          message: err && err.message ? err.message : String(err)
        });
      });
    }, 60 * 1000);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    this._startupTimer = setTimeout(() => {
      this.runIfDue().catch((err) => {
        this.log('warn', 'Scheduled maintenance startup check failed', {
          message: err && err.message ? err.message : String(err)
        });
      });
    }, 20 * 1000);
    if (typeof this._startupTimer.unref === 'function') this._startupTimer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._startupTimer) clearTimeout(this._startupTimer);
    this._timer = null;
    this._startupTimer = null;
  }

  shouldSkipForIdle(config) {
    if (config.schedulePreset !== 'idle') return false;
    const idleSec = this.getIdleTimeSeconds();
    return idleSec < config.minIdleSeconds;
  }

  async runIfDue() {
    if (this._running) return { ok: false, skipped: true, reason: 'already-running' };
    const config = this.loadConfig();
    if (!config.enabled) return { ok: false, skipped: true, reason: 'disabled' };
    if (this.shouldSkipForIdle(config)) {
      return { ok: false, skipped: true, reason: 'user-active' };
    }

    const intervalMs = config.intervalHours * 60 * 60 * 1000;
    const lastAttemptMs = config.lastAttempt ? new Date(config.lastAttempt).getTime() : 0;
    if (Date.now() - lastAttemptMs < intervalMs) {
      return { ok: false, skipped: true, reason: 'not-due' };
    }

    return this.runNow({ dryRunCleanup: true });
  }

  async runNow(options = {}) {
    if (this._running) return { ok: false, skipped: true, reason: 'already-running' };
    const dryRunCleanup = options.dryRunCleanup !== false
      ? !!options.dryRunCleanup
      : false;
    const config = this.loadConfig();
    this._running = true;
    const startedAt = new Date().toISOString();
    this.saveConfig({ lastAttempt: startedAt });
    const results = [];

    try {
      for (const scriptId of config.scriptIds) {
        try {
          const result = await this.toolRegistry.run('run-script', {
            scriptId,
            scriptArgs: scriptArgsFor(scriptId, dryRunCleanup)
          }, {
            toolRegistry: this.toolRegistry,
            db: this.db,
            log: this.log
          });
          results.push({ scriptId, ok: !!result.ok, error: result.error || null });
        } catch (err) {
          results.push({ scriptId, ok: false, error: err.message || String(err) });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const summary = `Maintenance completed (${okCount}/${results.length} tasks OK).`;
      const auditDetail = results.map((r) => `${r.scriptId}: ${r.ok ? 'OK' : (r.error || 'failed')}`).join('; ');

      this.db.addMaintenanceRun({ startedAt, results, dryRunCleanup });
      this.db.addAlert('info', `[Maintenance] ${summary} ${auditDetail}`);

      if (okCount > 0) {
        this.saveConfig({ lastRun: startedAt });
      }

      if (config.notifyOnComplete && this.db.getSetting('feature.notificationsEnabled', true)) {
        const level = okCount === results.length ? 'info' : okCount > 0 ? 'warn' : 'danger';
        const notifyTitle = options.manual ? 'Maintenance' : 'Scheduled maintenance';
        this.notify(notifyTitle, summary, level);
      }

      return { ok: true, success: true, startedAt, results, dryRunCleanup, schedulePreset: config.schedulePreset };
    } finally {
      this._running = false;
    }
  }
}

module.exports = {
  MaintenanceScheduler,
  DEFAULT_MAINTENANCE,
  ALLOWED_SCRIPT_IDS,
  SCHEDULE_PRESETS,
  MIN_INTERVAL_HOURS,
  MAX_INTERVAL_HOURS,
  scriptArgsFor,
  resolveIntervalHours
};
