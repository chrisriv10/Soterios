'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const NetworkAlertMonitor = require('../src/security/NetworkAlertMonitor');

describe('NetworkAlertMonitor', () => {
  let alerts;
  let notifications;
  let monitor;

  beforeEach(() => {
    alerts = [];
    notifications = [];
    monitor = new NetworkAlertMonitor({
      pollMs: 60_000,
      cooldownMs: 60_000,
      networkMonitor: {
        async getConnections() {
          return [
            { RemoteAddress: '203.0.113.9', RemotePort: 443, OwningProcess: 4242, State: 'Established' },
            { RemoteAddress: '8.8.8.8', RemotePort: 53, OwningProcess: 100, State: 'Established' }
          ];
        }
      },
      blocklistService: {
        isListed(ip) { return ip === '203.0.113.9'; }
      },
      db: {
        addAlert(severity, message) { alerts.push({ severity, message }); }
      },
      notify(title, body, level) { notifications.push({ title, body, level }); },
      processInspector: {
        async killProcess(pid) { return { success: true, pid }; }
      }
    });
  });

  it('alerts once for a blocklisted remote IP', async () => {
    const hits = await monitor.poll();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].remoteAddress, '203.0.113.9');
    assert.equal(alerts.length, 1);
    assert.equal(notifications.length, 1);
    // Debounced — second poll should not re-alert within cooldown
    const again = await monitor.poll();
    assert.equal(again.length, 0);
  });

  it('honors ignore keys', async () => {
    await monitor.poll();
    monitor._lastAlerted.clear();
    monitor.ignore('4242|203.0.113.9|443');
    const hits = await monitor.poll();
    assert.equal(hits.length, 0);
  });

  it('kill delegates to ProcessInspector', async () => {
    const res = await monitor.kill(4242);
    assert.equal(res.success, true);
  });

  it('start/stop manage running state and exactly one timer', () => {
    assert.equal(monitor.getStatus().running, false);
    monitor.start();
    assert.equal(monitor.getStatus().running, true);
    const firstTimer = monitor._timer;
    assert.ok(firstTimer);
    const generation = monitor._lifecycleGeneration;
    monitor.start();
    assert.equal(monitor._timer, firstTimer, 'repeated start is idempotent');
    assert.equal(monitor._lifecycleGeneration, generation, 'no new generation while running');
    monitor.stop();
    assert.equal(monitor.getStatus().running, false);
    assert.equal(monitor._timer, null);
  });

  it('stop during an in-flight lifecycle poll prevents alert writes', async () => {
    let releaseConnections;
    const gate = new Promise((resolve) => { releaseConnections = resolve; });
    monitor.networkMonitor.getConnections = async () => {
      await gate;
      return [{ RemoteAddress: '203.0.113.9', RemotePort: 443, OwningProcess: 4242, State: 'Established' }];
    };
    monitor.start();
    const generation = monitor._lifecycleGeneration;
    const pollPromise = monitor.poll(generation);
    monitor.stop();
    assert.equal(monitor.getStatus().running, false);
    assert.equal(monitor._timer, null);
    releaseConnections();
    const hits = await pollPromise;
    assert.deepEqual(hits, []);
    assert.equal(alerts.length, 0);
    assert.equal(notifications.length, 0);
    assert.equal(monitor._lastHits.length, 0);
    assert.equal(monitor._lastAlerted.size, 0);
  });

  it('fast stop/start invalidates the old poll but the new generation works', async () => {
    let releaseConnections;
    const gate = new Promise((resolve) => { releaseConnections = resolve; });
    monitor.networkMonitor.getConnections = async () => {
      await gate;
      return [{ RemoteAddress: '203.0.113.9', RemotePort: 443, OwningProcess: 4242, State: 'Established' }];
    };
    monitor.start();
    const oldGeneration = monitor._lifecycleGeneration;
    // An explicit generation-A poll alongside start's internal immediate poll.
    const oldPoll = monitor.poll(oldGeneration);
    monitor.stop();
    monitor.start();
    assert.equal(monitor.getStatus().running, true);
    assert.notEqual(monitor._lifecycleGeneration, oldGeneration);
    releaseConnections();
    const oldHits = await oldPoll;
    assert.deepEqual(oldHits, [], 'generation-A poll is discarded');
    // Generation B's own lifecycle poll (start's immediate poll) proceeds
    // normally: exactly one alert, no generation-A pollution.
    const deadline = Date.now() + 5000;
    while (alerts.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(alerts.length, 1);
    assert.equal(notifications.length, 1);
    assert.equal(monitor._lastHits.length, 1);
    monitor.stop();
  });

  it('direct manual poll keeps working without a lifecycle', async () => {
    // Never started: no generation carried, today's behavior preserved.
    const hits = await monitor.poll();
    assert.equal(hits.length, 1);
    assert.equal(alerts.length, 1);
  });
});
