'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createQuitCoordinator, stopLifecycleServices } = require('../src/main/quitCoordinator');

function fakeEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

function harness(drainBehavior) {
  const events = [];
  const app = { quits: 0, quit() { this.quits += 1; } };
  const coordinator = createQuitCoordinator({
    app,
    stopSyncServices: () => { events.push('stops'); },
    drainToolRuns: async () => { events.push('drain-start'); await drainBehavior(); events.push('drain-end'); },
    closeDatabase: () => { events.push('close'); },
    drainTimeoutMs: 200,
  });
  return { app, events, coordinator };
}

async function waitFor(fn, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('quitCoordinator ordered shutdown', () => {
  it('stops services, drains tools, closes the database, then quits — in order', async () => {
    const { app, events, coordinator } = harness(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const first = coordinator.handleBeforeQuit(fakeEvent());
    assert.equal(first.held, true);
    await waitFor(() => app.quits === 1);
    assert.deepEqual(events, ['stops', 'drain-start', 'drain-end', 'close']);
    assert.equal(coordinator.getPhase(), 2);
  });

  it('closes and quits on time when the drain never settles', async () => {
    const { app, events, coordinator } = harness(() => new Promise(() => {}));
    const before = Date.now();
    coordinator.handleBeforeQuit(fakeEvent());
    await waitFor(() => app.quits === 1);
    const elapsed = Date.now() - before;
    assert.ok(elapsed < 5000, `ordered shutdown took ${elapsed}ms`);
    assert.deepEqual(events, ['stops', 'drain-start', 'close']);
    assert.equal(coordinator.getPhase(), 2);
  });

  it('holds re-entrant quits without duplicate work and closes exactly once', async () => {
    let drains = 0;
    const { app, events, coordinator } = harness(async () => {
      drains += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const first = coordinator.handleBeforeQuit(fakeEvent());
    const second = coordinator.handleBeforeQuit(fakeEvent());
    assert.equal(first.held, true);
    assert.equal(second.held, true);
    await waitFor(() => app.quits === 1);
    assert.equal(drains, 1);
    assert.equal(events.filter((name) => name === 'close').length, 1);
    // Post-completion quit proceeds without holding and without re-closing.
    const third = coordinator.handleBeforeQuit(fakeEvent());
    assert.equal(third.held, false);
    assert.equal(events.filter((name) => name === 'close').length, 1);
    assert.equal(app.quits, 1);
  });

  it('still closes and quits when phases throw', async () => {
    const app = { quits: 0, quit() { this.quits += 1; } };
    const coordinator = createQuitCoordinator({
      app,
      stopSyncServices: () => { throw new Error('stop failed'); },
      drainToolRuns: async () => { throw new Error('drain failed'); },
      closeDatabase: () => {},
      drainTimeoutMs: 50,
    });
    coordinator.handleBeforeQuit(fakeEvent());
    await waitFor(() => app.quits === 1);
    assert.equal(coordinator.getPhase(), 2);
  });

  it('requires an app with quit()', () => {
    assert.throws(() => createQuitCoordinator({}), /quit/);
  });
});

describe('stopLifecycleServices production shutdown order', () => {
  function recordingRefs(order, { throwOn = null } = {}) {
    const maybeThrow = (name, fn) => () => {
      if (throwOn === name) throw new Error(`${name} failed`);
      return fn();
    };
    return {
      folderWatcher: { stop: maybeThrow('folderWatcher', () => { order.push('folderWatcher.stop'); }) },
      networkAlertMonitor: { stop: maybeThrow('networkAlertMonitor', () => { order.push('networkAlertMonitor.stop'); }) },
      clamEngine: { abortCurrentScan: maybeThrow('clamEngine', () => { order.push('clamEngine.abort'); return true; }) },
      maintenanceScheduler: { stop: () => { order.push('maintenanceScheduler.stop'); } },
      maintenanceSafetyVault: { stop: () => { order.push('maintenanceSafetyVault.stop'); } },
      persistenceMonitor: { stop: () => { order.push('persistenceMonitor.stop'); } },
      extensionBridge: { stop: () => { order.push('extensionBridge.stop'); } },
      removableDriveCoordinator: { dispose: () => { order.push('removableDriveCoordinator.dispose'); } },
      processService: { stop: () => { order.push('processService.stop'); return Promise.resolve(); } },
      trayController: { dispose: () => { order.push('trayController.dispose'); } },
      networkStatsTimer: 101,
      pruneTimer: 202,
    };
  }

  it('stops security background work first, then existing teardown in order', () => {
    const order = [];
    const cleared = [];
    stopLifecycleServices(recordingRefs(order), (id) => { cleared.push(id); });
    assert.deepEqual(order, [
      'folderWatcher.stop',
      'networkAlertMonitor.stop',
      'clamEngine.abort',
      'maintenanceScheduler.stop',
      'maintenanceSafetyVault.stop',
      'persistenceMonitor.stop',
      'extensionBridge.stop',
      'removableDriveCoordinator.dispose',
      'processService.stop',
      'trayController.dispose',
    ]);
    assert.deepEqual(cleared, [101, 202]);
  });

  it('one throwing stop does not block remaining teardown', () => {
    const order = [];
    stopLifecycleServices(recordingRefs(order, { throwOn: 'folderWatcher' }), () => {});
    assert.deepEqual(order, [
      'networkAlertMonitor.stop',
      'clamEngine.abort',
      'maintenanceScheduler.stop',
      'maintenanceSafetyVault.stop',
      'persistenceMonitor.stop',
      'extensionBridge.stop',
      'removableDriveCoordinator.dispose',
      'processService.stop',
      'trayController.dispose',
    ]);
  });

  it('tolerates missing refs and null timers', () => {
    stopLifecycleServices({}, () => { throw new Error('must not be called'); });
    stopLifecycleServices({ folderWatcher: null, networkStatsTimer: null, pruneTimer: null }, () => {});
  });

  it('runs security stops before database close through the real coordinator', async () => {
    const order = [];
    const app = { quits: 0, quit() { this.quits += 1; } };
    const coordinator = createQuitCoordinator({
      app,
      stopSyncServices: () => stopLifecycleServices(recordingRefs(order), () => {}),
      drainToolRuns: async () => { order.push('drain'); },
      closeDatabase: () => { order.push('close'); },
      drainTimeoutMs: 200,
    });
    coordinator.handleBeforeQuit(fakeEvent());
    await waitFor(() => app.quits === 1);
    const closeIndex = order.indexOf('close');
    assert.ok(closeIndex > 0);
    for (const name of ['folderWatcher.stop', 'networkAlertMonitor.stop', 'clamEngine.abort']) {
      assert.ok(order.includes(name), `${name} ran`);
      assert.ok(order.indexOf(name) < closeIndex, `${name} runs before database close`);
    }
    assert.ok(order.indexOf('drain') < closeIndex);
    assert.equal(order.filter((name) => name === 'close').length, 1);
  });
});
