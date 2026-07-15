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
});
