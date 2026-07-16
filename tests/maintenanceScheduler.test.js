'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MaintenanceScheduler, scriptArgsFor } = require('../src/main/maintenanceScheduler');

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
    scheduler.saveConfig({ enabled: true, scriptIds: ['clear-temp-files', 'disk-space-report'] });
    const result = await scheduler.runNow();
    assert.equal(result.success, true);
    assert.equal(ran.length, 2);
    assert.equal(ran[0].toolId, 'run-script');
    assert.equal(ran[0].args.scriptId, 'clear-temp-files');
    assert.equal(ran[0].args.scriptArgs.dryRun, false);
    assert.equal(ran[1].args.scriptId, 'disk-space-report');
    assert.ok(scheduler.loadConfig().lastRun);
  });

  it('uses dry-run cleanup for scheduled runs', async () => {
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
    await scheduler.runNow({ dryRunCleanup: true });
    assert.equal(capturedArgs.scriptArgs.dryRun, true);
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
    scheduler.saveConfig({ enabled: true, intervalHours: 24, scriptIds: ['disk-space-report'] });
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
    scheduler.saveConfig({ enabled: true, scriptIds: ['disk-space-report'] });
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
    scheduler.saveConfig({ enabled: true, intervalHours: 24, scriptIds: ['disk-space-report'] });
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
      scriptIds: ['disk-space-report'],
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
    scheduler.saveConfig({ enabled: true, scriptIds: ['disk-space-report'] });
    await scheduler.runNow();
    const history = db.getMaintenanceHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].ok_count, 1);
    assert.equal(history[0].total_count, 1);
  });
});

describe('scriptArgsFor', () => {
  it('returns dry-run args for clear-temp-files when requested', () => {
    assert.deepEqual(scriptArgsFor('clear-temp-files', true), { dryRun: true, maxAgeDays: 7 });
    assert.deepEqual(scriptArgsFor('clear-temp-files', false), { dryRun: false, maxAgeDays: 7 });
    assert.deepEqual(scriptArgsFor('disk-space-report', true), {});
  });
});
