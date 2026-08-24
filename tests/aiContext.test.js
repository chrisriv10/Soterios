'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildContextSnapshot, MAX_SNAPSHOT_CHARS } = require('../src/main/aiContext');

function makeDb(overrides = {}) {
  return {
    getSetting: () => undefined,
    getScanHistory: () => [
      { scan_type: 'full', files_scanned: 12345, threats_found: 0, duration_ms: 120000, timestamp: '2026-08-09 10:00:00' },
      { scan_type: 'quick', files_scanned: 300, threats_found: 1, duration_ms: 5000, timestamp: '2026-08-08 09:00:00' }
    ],
    getQuarantineList: () => [
      { threat_name: 'EICAR-Test', original_path: 'C:\\Users\\x\\Downloads\\eicar.exe', reason: 'Test signature', date_quarantined: '2026-08-08' }
    ],
    getUnreadAlerts: () => [
      { severity: 'high', message: 'Threat detected and quarantined' }
    ],
    ...overrides
  };
}

function makeServices(overrides = {}) {
  return {
    db: makeDb(),
    toolRegistry: {
      run: async () => ({
        ok: true,
        data: {
          score: 88,
          breakdown: {
            disk: { label: 'Disk', points: 25, max: 25, reason: 'Disk looks fine.' },
            memory: { label: 'Memory', points: 20, max: 20, reason: 'Memory usage is healthy.' },
            malware: { label: 'Malware', points: 30, max: 30, reason: 'No threats found in the most recent scan.' }
          }
        }
      })
    },
    firewallManager: {
      getStatus: async () => [
        { Name: 'Domain', Enabled: true },
        { Name: 'Private', Enabled: true },
        { Name: 'Public', Enabled: false }
      ]
    },
    processInspector: {
      getProcesses: async () => [
        { name: 'explorer.exe', suspicious: false },
        { name: 'random.exe', suspicious: true }
      ]
    },
    ...overrides
  };
}

describe('aiContext buildContextSnapshot', () => {
  it('includes scans, quarantine, alerts, health, firewall, and processes', async () => {
    const text = await buildContextSnapshot(makeServices());
    assert.match(text, /Recent scans:/);
    assert.match(text, /full scan on 2026-08-09 10:00:00: 12345 files, 0 threat\(s\), 120s/);
    assert.match(text, /Quarantine \(1 item\(s\)\):/);
    assert.match(text, /EICAR-Test/);
    assert.match(text, /Unread alerts \(1\):/);
    assert.match(text, /Threat detected and quarantined/);
    assert.match(text, /Health score: 88\/100/);
    assert.match(text, /Disk looks fine/);
    assert.match(text, /Firewall profiles: Domain: enabled, Private: enabled, Public: disabled/);
    assert.match(text, /Processes: 2 running, 1 flagged suspicious/);
    assert.match(text, /Features on:/);
  });

  it('reports empty sections when there is no data', async () => {
    const services = makeServices({
      db: makeDb({
        getScanHistory: () => [],
        getQuarantineList: () => [],
        getUnreadAlerts: () => []
      })
    });
    const text = await buildContextSnapshot(services);
    assert.match(text, /Recent scans: none on record/);
    assert.match(text, /Quarantine: empty/);
    assert.match(text, /Unread alerts: none/);
  });

  it('survives a throwing process source', async () => {
    const services = makeServices({
      processInspector: { getProcesses: async () => { throw new Error('boom'); } }
    });
    const text = await buildContextSnapshot(services);
    assert.match(text, /Health score: 88\/100/);
    assert.match(text, /Recent scans:/);
    assert.doesNotMatch(text, /Processes:/);
  });

  it('survives a rejecting health tool and firewall', async () => {
    const services = makeServices({
      toolRegistry: { run: async () => { throw new Error('tool down'); } },
      firewallManager: { getStatus: async () => { throw new Error('denied'); } }
    });
    const text = await buildContextSnapshot(services);
    assert.match(text, /Recent scans:/);
    assert.match(text, /Processes: 2 running, 1 flagged suspicious/);
    assert.doesNotMatch(text, /Health score:/);
    assert.doesNotMatch(text, /Firewall/);
  });

  it('resolves without any services', async () => {
    const text = await buildContextSnapshot({});
    assert.equal(typeof text, 'string');
    assert.equal(text, '');
  });

  it('truncates oversized snapshots to the char cap', async () => {
    const services = makeServices({
      db: makeDb({
        getUnreadAlerts: () => Array.from({ length: 20 }, (_, i) => ({ severity: 'info', message: `alert number ${i} `.repeat(300) }))
      })
    });
    const text = await buildContextSnapshot(services);
    assert.ok(text.length <= MAX_SNAPSHOT_CHARS);
  });
});
