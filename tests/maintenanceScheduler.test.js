'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MaintenanceScheduler, scriptArgsFor, normalizeScriptArgs, DEFAULT_SCRIPT_ARGS } = require('../src/main/maintenanceScheduler');

function createDb() {
  const settings = new Map();
  const maintenanceRuns = [];
  return {
    getSetting(key, fallback) {
      return settings.has(key) ? settings.get(key) : fallback;
    },
    setSetting(key, value) {
      settings.set(key, value);
    },
    addAlert() {},
    addMaintenanceRun(entry) {
      maintenanceRuns.unshift({
        id: maintenanceRuns.length + 1,
        started_at: entry.startedAt,
        ok_count: (entry.results || []).filter((r) => r.ok).length,
        total_count: (entry.results || []).length,
        dry_run: entry.dryRunCleanup ? 1 : 0,
        results: entry.results || []
      });
    },
    getMaintenanceHistory() {
      return maintenanceRuns;
    }
  };
}

describe('MaintenanceScheduler', () => {
  it('skips run when disabled', async () => {
    const db = createDb();
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: { run: async () => ({ ok: true }) }
    });
    const result = await scheduler.runIfDue();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'disabled');
  });

  it('runs configured scripts via run-script and records lastRun', async () => {
    const db = createDb();
    const ran = [];
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async (toolId, args) => {
          ran.push({ toolId, args });
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({ enabled: true, scriptIds: ['large-files-report', 'browser-cache-report'] });
    const result = await scheduler.runNow();
    assert.equal(result.success, true);
    assert.equal(ran.length, 2);
    assert.equal(ran[0].toolId, 'run-script');
    assert.equal(ran[0].args.scriptId, 'large-files-report');
    assert.deepEqual(ran[0].args.scriptArgs, { thresholdMB: 100 });
    assert.equal(ran[1].args.scriptId, 'browser-cache-report');
    assert.ok(scheduler.loadConfig().lastRun);
  });

  it('uses live cleanup for scheduled runs', async () => {
    const db = createDb();
    let capturedArgs = null;
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async (_toolId, args) => {
          capturedArgs = args;
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({ enabled: true, scriptIds: ['clear-temp-files'] });
    await scheduler.runIfDue();
    assert.equal(capturedArgs.scriptId, 'clear-temp-files');
    assert.deepEqual(capturedArgs.scriptArgs, { dryRun: false, maxAgeDays: 7 });
  });

  it('does not run again before interval elapses', async () => {
    const db = createDb();
    let runs = 0;
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async () => {
          runs += 1;
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({ enabled: true, intervalHours: 24, scriptIds: ['browser-cache-report'] });
    await scheduler.runNow();
    const second = await scheduler.runIfDue();
    assert.equal(runs, 1);
    assert.equal(second.skipped, true);
    assert.equal(second.reason, 'not-due');
  });

  it('does not update lastRun when every script fails', async () => {
    const db = createDb();
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: { run: async () => ({ ok: false, error: 'failed' }) }
    });
    scheduler.saveConfig({ enabled: true, scriptIds: ['browser-cache-report'] });
    await scheduler.runNow();
    assert.equal(scheduler.loadConfig().lastRun, null);
    assert.ok(scheduler.loadConfig().lastAttempt);
  });

  it('throttles failed runs using lastAttempt', async () => {
    const db = createDb();
    let runs = 0;
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async () => {
          runs += 1;
          return { ok: false, error: 'failed' };
        }
      }
    });
    scheduler.saveConfig({ enabled: true, intervalHours: 24, scriptIds: ['browser-cache-report'] });
    await scheduler.runNow();
    const second = await scheduler.runIfDue();
    assert.equal(runs, 1);
    assert.equal(second.skipped, true);
    assert.equal(second.reason, 'not-due');
  });

  it('skips idle preset runs while user is active', async () => {
    const db = createDb();
    let runs = 0;
    const scheduler = new MaintenanceScheduler({
      db,
      getIdleTimeSeconds: () => 60,
      toolRegistry: {
        run: async () => {
          runs += 1;
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({
      enabled: true,
      schedulePreset: 'idle',
      minIdleSeconds: 900,
      scriptIds: ['browser-cache-report'],
      lastRun: null
    });
    const result = await scheduler.runIfDue();
    assert.equal(runs, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'user-active');
  });

  it('records maintenance runs for System Audit history', async () => {
    const db = createDb();
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: { run: async () => ({ ok: true }) }
    });
    scheduler.saveConfig({ enabled: true, scriptIds: ['browser-cache-report'] });
    await scheduler.runNow();
    const history = db.getMaintenanceHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].ok_count, 1);
    assert.equal(history[0].total_count, 1);
  });

  it('loads default script args when none are stored', () => {
    const db = createDb();
    const scheduler = new MaintenanceScheduler({ db, toolRegistry: { run: async () => ({ ok: true }) } });
    const config = scheduler.loadConfig();
    assert.deepEqual(config.scriptArgs, DEFAULT_SCRIPT_ARGS);
  });

  it('persists normalized script args through saveConfig', () => {
    const db = createDb();
    const scheduler = new MaintenanceScheduler({ db, toolRegistry: { run: async () => ({ ok: true }) } });
    scheduler.saveConfig({
      scriptArgs: {
        'clear-temp-files': { minimumAgeDays: 30 },
        'large-files-report': { thresholdMB: 500 },
        'browser-cache-report': { browsers: ['CHROME', 'edge'] },
        'unknown-script': { minimumAgeDays: 1 }
      }
    });
    const config = scheduler.loadConfig();
    assert.deepEqual(config.scriptArgs['clear-temp-files'], { minimumAgeDays: 30 });
    assert.deepEqual(config.scriptArgs['large-files-report'], { thresholdMB: 500 });
    assert.deepEqual(config.scriptArgs['browser-cache-report'], { browsers: ['chrome', 'edge'] });
    assert.equal(config.scriptArgs['unknown-script'], undefined);
    assert.deepEqual(config.scriptArgs['disk-space-report'], DEFAULT_SCRIPT_ARGS['disk-space-report']);
  });

  it('uses persisted script args on scheduled runs', async () => {
    const db = createDb();
    const ran = [];
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async (_toolId, args) => {
          ran.push(args);
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({
      enabled: true,
      policies: {
        'clear-temp-files': 'analyze',
        'large-files-report': 'analyze',
        'browser-cache-report': 'auto-clean'
      },
      scriptArgs: {
        'clear-temp-files': { minimumAgeDays: 30 },
        'large-files-report': { thresholdMB: 500 },
        'browser-cache-report': { browsers: ['chrome', 'edge'] }
      }
    });
    await scheduler.runNow();
    assert.equal(ran.length, 4);
    const temp = ran.find((args) => args.scriptId === 'clear-temp-files' && args.scriptArgs.mode === 'analyze');
    assert.equal(temp.scriptArgs.minimumAgeDays, 30);
    const large = ran.find((args) => args.scriptId === 'large-files-report');
    assert.equal(large.scriptArgs.thresholdMB, 500);
    const cleanup = ran.find((args) => args.scriptId === 'clear-browser-cache');
    assert.deepEqual(cleanup.scriptArgs.browsers, ['chrome', 'edge']);
  });

  it('ignores persisted script args on manual runs', async () => {
    const db = createDb();
    const ran = [];
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async (_toolId, args) => {
          ran.push(args);
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({
      enabled: true,
      policies: {
        'clear-temp-files': 'analyze',
        'large-files-report': 'analyze',
        'browser-cache-report': 'auto-clean'
      },
      scriptArgs: {
        'clear-temp-files': { minimumAgeDays: 30 },
        'large-files-report': { thresholdMB: 500 },
        'browser-cache-report': { browsers: ['chrome', 'edge'] }
      }
    });
    await scheduler.runNow({ manual: true });
    const temp = ran.find((args) => args.scriptId === 'clear-temp-files' && args.scriptArgs.mode === 'analyze');
    assert.equal(temp.scriptArgs.minimumAgeDays, 7);
    const large = ran.find((args) => args.scriptId === 'large-files-report');
    assert.equal(large.scriptArgs.thresholdMB, undefined);
    const cleanup = ran.find((args) => args.scriptId === 'clear-browser-cache');
    assert.deepEqual(cleanup.scriptArgs.browsers, []);
  });

  it('manual overrides win over persisted args on scheduled runs', async () => {
    const db = createDb();
    const ran = [];
    const scheduler = new MaintenanceScheduler({
      db,
      toolRegistry: {
        run: async (_toolId, args) => {
          ran.push(args);
          return { ok: true };
        }
      }
    });
    scheduler.saveConfig({
      enabled: true,
      policies: { 'clear-temp-files': 'analyze' },
      scriptArgs: { 'clear-temp-files': { minimumAgeDays: 30 } }
    });
    await scheduler.runNow({
      policyOverrides: { 'clear-temp-files': { mode: 'analyze', args: { minimumAgeDays: 90 } } }
    });
    const temp = ran.find((args) => args.scriptId === 'clear-temp-files' && args.scriptArgs.mode === 'analyze');
    assert.equal(temp.scriptArgs.minimumAgeDays, 90);
  });
});

describe('normalizeScriptArgs', () => {
  it('clamps minimumAgeDays to 1-365 and thresholdMB to 1-100000', () => {
    assert.deepEqual(normalizeScriptArgs({ 'clear-temp-files': { minimumAgeDays: 0 } }), { 'clear-temp-files': { minimumAgeDays: 1 } });
    assert.deepEqual(normalizeScriptArgs({ 'clear-temp-files': { minimumAgeDays: 999 } }), { 'clear-temp-files': { minimumAgeDays: 365 } });
    assert.deepEqual(normalizeScriptArgs({ 'large-files-report': { thresholdMB: -5 } }), { 'large-files-report': { thresholdMB: 1 } });
    assert.deepEqual(normalizeScriptArgs({ 'large-files-report': { thresholdMB: 999999 } }), { 'large-files-report': { thresholdMB: 100000 } });
  });

  it('normalizes browser ids and drops unknown scripts and keys', () => {
    const result = normalizeScriptArgs({
      'browser-cache-report': { browsers: ['Chrome', 'EDGE', '', 42], unknownArg: true },
      'nope': { minimumAgeDays: 5 },
      'clear-temp-files': { unknownArg: true }
    });
    assert.deepEqual(result['browser-cache-report'], { browsers: ['chrome', 'edge', '42'] });
    assert.equal(result.nope, undefined);
    assert.equal(result['clear-temp-files'], undefined);
  });

  it('returns defaults for every scheduled script', () => {
    assert.deepEqual(DEFAULT_SCRIPT_ARGS['clear-temp-files'], { minimumAgeDays: 7 });
    assert.deepEqual(DEFAULT_SCRIPT_ARGS['large-files-report'], { thresholdMB: 100 });
    assert.deepEqual(DEFAULT_SCRIPT_ARGS['browser-cache-report'], { browsers: [] });
  });
});

describe('scriptArgsFor', () => {
  it('returns dry-run args for clear-temp-files when requested', () => {
    assert.deepEqual(scriptArgsFor('large-files-report', true), {});
    assert.deepEqual(scriptArgsFor('large-files-report', false), {});
    assert.deepEqual(scriptArgsFor('browser-cache-report', true), {});
  });
});
