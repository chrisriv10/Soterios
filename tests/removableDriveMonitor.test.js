'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  RemovableDriveMonitor,
  canonicalMountRoot,
  eligibleMount,
  eligibleSet,
  DEFAULT_POLL_INTERVAL_MS,
} = require('../src/main/removableDriveMonitor');

function fixed(mount, overrides = {}) {
  return { name: mount, mount, removable: false, device: '\\\\.\\PHYSICALDRIVE0', ...overrides };
}

function removable(mount, overrides = {}) {
  return { name: mount, mount, removable: true, device: '\\\\.\\PHYSICALDRIVE1', fsType: 'exfat', ...overrides };
}

function tracker() {
  const events = { arrived: [], removed: [], warnings: 0 };
  const monitor = new RemovableDriveMonitor({
    getBlockDevices: async () => tracker.devices,
    pollIntervalMs: 60000,
    onArrival: (mount) => { events.arrived.push(mount); },
    onRemoval: (mount) => { events.removed.push(mount); },
    logger: { warn: () => { events.warnings += 1; } },
  });
  tracker.devices = [];
  tracker.events = events;
  tracker.monitor = monitor;
  return tracker;
}

describe('removable drive mount canonicalization', () => {
  it('normalizes drive roots to upper-case X:\\ form', () => {
    assert.equal(canonicalMountRoot('E:'), 'E:\\');
    assert.equal(canonicalMountRoot('e:\\'), 'E:\\');
    assert.equal(canonicalMountRoot('  F:  '), 'F:\\');
  });

  it('rejects non-root, network, raw-device, and malformed mounts', () => {
    for (const bad of [null, undefined, 42, '', 'E:\\folder', '\\\\server\\share', '\\\\.\\PHYSICALDRIVE1', 'E', ':', 'E::', 'EZ:\\x', 'C:\\Windows']) {
      assert.equal(canonicalMountRoot(bad), null, JSON.stringify(bad));
    }
  });

  it('admits only strict removable volumes with valid mounts', () => {
    assert.equal(eligibleMount(removable('E:')), 'E:\\');
    for (const bad of [
      fixed('C:'), removable('E:', { removable: false }), removable('E:', { removable: 1 }),
      removable('E:', { removable: 'yes' }), { mount: 'E:' }, null, 'E:', [],
      removable('', {}), { removable: true, mount: '\\\\server\\share' },
      { removable: true, mount: '\\\\.\\PHYSICALDRIVE1' }, { removable: true },
    ]) {
      assert.equal(eligibleMount(bad), null, JSON.stringify(bad));
    }
  });

  it('deduplicates mounts across repeated rows', () => {
    const set = eligibleSet([removable('E:'), removable('E:\\'), fixed('C:'), removable('F:')]);
    assert.deepEqual([...set].sort(), ['E:\\', 'F:\\']);
  });

  it('clamps the polling interval to the 5-10 second band', () => {
    assert.equal(new RemovableDriveMonitor({ pollIntervalMs: 1000 }).pollIntervalMs, 5000);
    assert.equal(new RemovableDriveMonitor({ pollIntervalMs: 60000 }).pollIntervalMs, 10000);
    assert.equal(new RemovableDriveMonitor({}).pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    assert.ok(DEFAULT_POLL_INTERVAL_MS >= 5000 && DEFAULT_POLL_INTERVAL_MS <= 10000);
  });
});

describe('RemovableDriveMonitor lifecycle', () => {
  it('seeds already-mounted drives without emitting arrivals', async () => {
    const t = tracker();
    t.devices = [fixed('C:'), removable('E:')];
    t.monitor.start();
    await t.monitor.pollNow();
    assert.deepEqual(t.events.arrived, []);
    assert.deepEqual(t.monitor.getKnownMounts(), ['E:\\']);
    t.monitor.stop();
  });

  it('late first enumeration still seeds instead of faking arrivals', async () => {
    let resolveFirst = null;
    const gate = new Promise((resolve) => { resolveFirst = resolve; });
    const events = { arrived: [], removed: [] };
    const monitor = new RemovableDriveMonitor({
      getBlockDevices: () => gate.then(() => [fixed('C:'), removable('E:')]),
      pollIntervalMs: 60000,
      onArrival: (mount) => { events.arrived.push(mount); },
      onRemoval: (mount) => { events.removed.push(mount); },
      logger: { warn: () => {} },
    });
    monitor.start();
    // A poll racing the slow seed resolves nothing yet; arrivals must wait.
    resolveFirst();
    await monitor.pollNow();
    await monitor.pollNow();
    assert.deepEqual(events.arrived, []);
    assert.deepEqual(monitor.getKnownMounts(), ['E:\\']);
    monitor.stop();
  });

  it('emits exactly one arrival for a new drive and stays silent after', async () => {
    const t = tracker();
    t.devices = [fixed('C:')];
    t.monitor.start();
    await t.monitor.pollNow();
    t.devices = [fixed('C:'), removable('E:')];
    const first = await t.monitor.pollNow();
    assert.deepEqual(first.arrived, ['E:\\']);
    const second = await t.monitor.pollNow();
    assert.deepEqual(second.arrived, []);
    assert.deepEqual(t.events.arrived, ['E:\\']);
    t.monitor.stop();
  });

  it('emits one arrival per drive when several appear at once, regardless of order', async () => {
    const t = tracker();
    t.devices = [fixed('C:')];
    t.monitor.start();
    await t.monitor.pollNow();
    t.devices = [removable('F:'), fixed('C:'), removable('E:'), removable('E:\\')];
    const result = await t.monitor.pollNow();
    assert.deepEqual([...result.arrived].sort(), ['E:\\', 'F:\\']);
    t.monitor.stop();
  });

  it('tracks removal and allows genuine reconnect arrivals', async () => {
    const t = tracker();
    t.devices = [fixed('C:'), removable('E:')];
    t.monitor.start();
    await t.monitor.pollNow();
    t.devices = [fixed('C:')];
    const removed = await t.monitor.pollNow();
    assert.deepEqual(removed.removed, ['E:\\']);
    assert.deepEqual(t.monitor.getKnownMounts(), []);
    t.devices = [fixed('C:'), removable('E:')];
    const reconnected = await t.monitor.pollNow();
    assert.deepEqual(reconnected.arrived, ['E:\\']);
    t.monitor.stop();
  });

  it('preserves the snapshot across enumeration failures without fake events', async () => {
    let fail = false;
    const events = { arrived: [], removed: [], warnings: 0 };
    const monitor = new RemovableDriveMonitor({
      getBlockDevices: async () => {
        if (fail) throw new Error('subsystem unavailable');
        return [fixed('C:'), removable('E:')];
      },
      pollIntervalMs: 60000,
      onArrival: (mount) => { events.arrived.push(mount); },
      onRemoval: (mount) => { events.removed.push(mount); },
      logger: { warn: () => { events.warnings += 1; } },
    });
    monitor.start();
    await monitor.pollNow();
    fail = true;
    const failed = await monitor.pollNow();
    assert.equal(failed.failed, true);
    assert.equal(events.warnings, 1);
    assert.deepEqual(monitor.getKnownMounts(), ['E:\\']);
    fail = false;
    const recovered = await monitor.pollNow();
    assert.deepEqual(recovered.arrived, []);
    assert.deepEqual(recovered.removed, []);
    assert.deepEqual(events.arrived, []);
    monitor.stop();
  });

  it('rate-limits repeated failure warnings', async () => {
    const events = { warnings: 0 };
    const monitor = new RemovableDriveMonitor({
      getBlockDevices: async () => { throw new Error('down'); },
      pollIntervalMs: 60000,
      logger: { warn: () => { events.warnings += 1; } },
    });
    monitor.start();
    for (let i = 0; i < 25; i += 1) await monitor.pollNow();
    assert.ok(events.warnings <= 4, `warnings: ${events.warnings}`);
    monitor.stop();
  });

  it('stop clears the interval and suppresses later events', async () => {
    const t = tracker();
    t.devices = [fixed('C:')];
    t.monitor.start();
    assert.equal(t.monitor.isRunning(), true);
    await t.monitor.pollNow();
    t.monitor.stop();
    assert.equal(t.monitor.isRunning(), false);
    t.devices = [fixed('C:'), removable('E:')];
    const after = await t.monitor.pollNow();
    assert.equal(after.stopped, true);
    assert.deepEqual(t.events.arrived, []);
  });

  it('answers eligibility checks without throwing', async () => {
    const t = tracker();
    t.devices = [fixed('C:'), removable('E:')];
    assert.equal(await t.monitor.isCurrentlyEligible('E:'), true);
    assert.equal(await t.monitor.isCurrentlyEligible('C:'), false);
    assert.equal(await t.monitor.isCurrentlyEligible('\\\\.\\PHYSICALDRIVE1'), false);
    t.monitor.getBlockDevices = async () => { throw new Error('down'); };
    assert.equal(await t.monitor.isCurrentlyEligible('E:'), false);
  });
});
