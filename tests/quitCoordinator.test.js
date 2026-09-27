'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createQuitCoordinator } = require('../src/main/quitCoordinator');

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
