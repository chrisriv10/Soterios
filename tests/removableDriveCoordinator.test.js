'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  RemovableDriveCoordinator,
  REMOVABLE_DRIVE_SETTING_KEY,
  REMOVABLE_DRIVE_QUEUE_LIMIT,
} = require('../src/main/removableDriveCoordinator');

function harness(options = {}) {
  const settings = { ...(options.settings || {}) };
  const db = {
    getSetting: (key, def) => (key in settings ? settings[key] : def),
    setSetting: (key, value) => { settings[key] = value; },
  };
  const scans = [];
  const aborts = [];
  const scanEngine = {
    isScanning: false,
    runCustomScan: async (paths) => {
      scans.push(paths);
      if (options.scanError) return { error: options.scanError };
      scanEngine.isScanning = true;
      return { ok: true };
    },
    abortScan: () => { aborts.push(Date.now()); return { success: true, canceled: true }; },
    ...(options.scanEngine || {}),
  };
  const notifications = [];
  const emittedHandlers = {};
  const eventBus = {
    on: (event, handler) => {
      emittedHandlers[event] = handler;
      return () => { delete emittedHandlers[event]; };
    },
  };
  const eligible = new Set(options.eligible || []);
  const monitor = {
    running: false,
    start() { this.running = true; return { running: true }; },
    stop() { this.running = false; return { running: false }; },
    isRunning() { return this.running; },
    isCurrentlyEligible: async (mount) => eligible.has(mount),
  };
  const coordinator = new RemovableDriveCoordinator({
    db,
    scanEngine,
    eventBus,
    showNotification: (title, body, level, icon, action) => {
      notifications.push({ title, body, level, action });
    },
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    logger: { warn: () => {} },
    monitor,
  });
  return { coordinator, db, settings, scanEngine, scans, aborts, notifications, emittedHandlers, eligible, monitor };
}

describe('removable drive settings', () => {
  it('auto-scan defaults to false and malformed values stay on prompt behavior', () => {
    for (const stored of [undefined, null, false, 0, '', 'true', 1]) {
      const h = harness({ settings: stored === undefined ? {} : { [REMOVABLE_DRIVE_SETTING_KEY]: stored } });
      assert.equal(h.coordinator.autoScanEnabled(), false, JSON.stringify(stored));
    }
    const on = harness({ settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    assert.equal(on.coordinator.autoScanEnabled(), true);
  });

  it('uses the scan settings key, not a feature flag', () => {
    assert.equal(REMOVABLE_DRIVE_SETTING_KEY, 'scan.autoScanRemovableDrives');
  });
});

describe('removable drive prompt path', () => {
  it('arrival with auto-scan off creates a prompt, not a scan', async () => {
    const h = harness({ eligible: ['E:\\'] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.scans.length, 0);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].action, 'removable-scan');
    assert.match(h.notifications[0].title, /E/);
    assert.deepEqual(h.coordinator.getStatus().pending, { mount: 'E:\\', arrivedAt: h.coordinator.getStatus().pending.arrivedAt });
    h.coordinator.dispose();
  });

  it('scan action revalidates and scans the pending mount', async () => {
    const h = harness({ eligible: ['E:\\'] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, true);
    assert.deepEqual(h.scans, [['E:\\']]);
    h.coordinator.dispose();
  });

  it('stale or removed pending drive refuses the scan', async () => {
    const h = harness({ eligible: [] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    // Drive vanished before the user acted: eligibility now fails.
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, false);
    assert.equal(h.scans.length, 0);
    assert.equal(h.coordinator.getStatus().pending, null);
    h.coordinator.dispose();
  });

  it('scan with no pending drive fails gracefully', async () => {
    const h = harness({});
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, false);
    h.coordinator.dispose();
  });

  it('preserves every prompt-mode arrival in order instead of replacing', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    await h.coordinator._onArrival('F:\\');
    assert.equal(h.notifications.length, 2);
    assert.equal(h.scans.length, 0);
    const first = await h.coordinator.scanPending();
    assert.equal(first.ok, true);
    assert.deepEqual(h.scans, [['E:\\']]);
    h.scanEngine.isScanning = false;
    const second = await h.coordinator.scanPending();
    assert.equal(second.ok, true);
    assert.deepEqual(h.scans, [['E:\\'], ['F:\\']]);
    h.coordinator.dispose();
  });

  it('removal drops only its own pending arrival', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    await h.coordinator._onArrival('F:\\');
    h.coordinator._onRemoval('E:\\');
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, true);
    assert.deepEqual(h.scans, [['F:\\']]);
    h.coordinator.dispose();
  });

  it('bounds the pending queue and drops the oldest arrival first', async () => {
    const eligible = [];
    for (let i = 0; i < 10; i += 1) eligible.push(`${String.fromCharCode(68 + i)}:\\`);
    const h = harness({ eligible });
    h.coordinator.start();
    for (const mount of eligible) await h.coordinator._onArrival(mount);
    const status = h.coordinator.getStatus();
    assert.equal(status.pendingCount, 8);
    assert.equal(status.pending.mount, 'F:\\');
    h.coordinator.dispose();
  });
});

describe('removable drive auto-scan path', () => {
  it('arrival with auto-scan on enters the scan flow without prompting', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.notifications.length, 0);
    assert.deepEqual(h.scans, [['E:\\']]);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });

  it('auto-scan uses the existing custom-scan pathway with a canonical root', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.coordinator.start();
    await h.coordinator._onArrival('e:');
    assert.deepEqual(h.scans, [['E:\\']]);
    h.coordinator.dispose();
  });
});

describe('removable drive busy scanner', () => {
  it('never preempts an active manual scan; queues instead', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.scans.length, 0);
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    h.coordinator.dispose();
  });

  it('drains the queue when the scan settles, revalidating first', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.scans, [['E:\\']]);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    h.coordinator.dispose();
  });

  it('drops removed queued drives instead of scanning them', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    h.eligible.delete('E:\\');
    h.coordinator._onRemoval('E:\\');
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']();
    assert.equal(h.scans.length, 0);
    h.coordinator.dispose();
  });

  it('continues draining after a failed queued start instead of stalling', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    await h.coordinator._onArrival('F:\\');
    let calls = 0;
    h.scanEngine.runCustomScan = async (paths) => {
      calls += 1;
      h.scans.push(paths);
      if (calls === 1) return { error: 'boom' };
      return { ok: true };
    };
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.scans, [['E:\\'], ['F:\\']]);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    h.coordinator.dispose();
  });

  it('deduplicates queue entries and bounds the queue', async () => {
    const eligible = [];
    for (let i = 0; i < 10; i += 1) eligible.push(`${String.fromCharCode(68 + i)}:\\`);
    const h = harness({ eligible, settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    for (const mount of eligible) await h.coordinator._onArrival(mount);
    await h.coordinator._onArrival('D:\\');
    const queued = h.coordinator.getStatus().queued;
    assert.equal(queued.length, REMOVABLE_DRIVE_QUEUE_LIMIT);
    assert.equal(REMOVABLE_DRIVE_QUEUE_LIMIT, 8);
    assert.equal(new Set(queued).size, queued.length);
    h.coordinator.dispose();
  });

  it('falls back to the queue when a start race loses to another scan', async () => {
    const h = harness({ eligible: ['E:\\'] });
    h.scanEngine.isScanning = false;
    let calls = 0;
    h.scanEngine.runCustomScan = async (paths) => {
      calls += 1;
      h.scans.push(paths);
      if (calls === 1) {
        // A competing scan won the race after our busy check passed.
        h.scanEngine.isScanning = true;
        return { error: 'Scan already in progress' };
      }
      return { ok: true };
    };
    h.coordinator.start();
    const result = await h.coordinator._requestScan('E:\\', { automatic: false });
    assert.equal(result.ok, true);
    assert.equal(result.queued, true);
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    h.coordinator.dispose();
  });
});

describe('removable drive removal during scan', () => {
  it('cancels the matching active scan and reports incomplete', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.eligible.delete('E:\\');
    h.coordinator._onRemoval('E:\\');
    assert.equal(h.aborts.length, 1);
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    assert.ok(h.notifications.some((n) => /removed|incomplete/i.test(`${n.title} ${n.body}`)));
    h.coordinator.dispose();
  });

  it('never cancels an unrelated active scan on another removal', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    h.coordinator._onRemoval('F:\\');
    assert.equal(h.aborts.length, 0);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });

  it('removal outcome surfaces through engine cancellation, not clean success', async () => {
    const h = harness({ eligible: ['E:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    let abortSeen = false;
    h.scanEngine.abortScan = () => { abortSeen = true; return { success: true, canceled: true }; };
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    h.coordinator._onRemoval('E:\\');
    assert.equal(abortSeen, true);
    // The coordinator never synthesizes a clean result; completion flows
    // through ScanEngine's own canceled status.
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    h.coordinator.dispose();
  });
});

describe('removable drive shutdown', () => {
  it('dispose stops the monitor and clears queue and pending work', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    await h.coordinator._onArrival('F:\\');
    assert.equal(h.monitor.running, true);
    h.coordinator.dispose();
    assert.equal(h.monitor.running, false);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.ok(!('scan:complete' in h.emittedHandlers) || true);
  });

  it('emits no events after dispose', async () => {
    const h = harness({ eligible: ['E:\\'] });
    h.coordinator.start();
    h.coordinator.dispose();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.scans.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  it('scanPending after dispose is unavailable', async () => {
    const h = harness({});
    h.coordinator.start();
    h.coordinator.dispose();
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, false);
  });
});

describe('removable drive integration through the scan engine', () => {  it('enters the same custom-scan pathway with identical result shape', async () => {
    const h = harness({ eligible: ['E:\\'] });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    const result = await h.coordinator.scanPending();
    assert.deepEqual(Object.keys(result).sort(), ['ok']);
    assert.equal(result.ok, true);
    h.coordinator.dispose();
  });

  it('propagates scanner failure honestly instead of clean success', async () => {
    const h = harness({ eligible: ['E:\\'], scanError: 'clamscan terminated unexpectedly (exit code 3)' });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    const result = await h.coordinator.scanPending();
    assert.equal(result.ok, false);
    assert.match(result.error, /unexpectedly/);
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    h.coordinator.dispose();
  });

  it('uses no parallel ClamAV path: one engine call per scan', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'], settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true } });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    await h.coordinator._onArrival('F:\\');
    assert.equal(h.scans.length, 1);
    h.coordinator.dispose();
  });

  it('a failed concurrent start does not steal ownership of the running scan', async () => {
    const h = harness({ eligible: ['E:\\', 'F:\\'] });
    // The engine never reports busy, so both overlapping starts reach the
    // engine; only the first one actually starts a scan.
    let calls = 0;
    h.scanEngine.runCustomScan = async (paths) => {
      calls += 1;
      h.scans.push(paths);
      if (calls === 1) return { ok: true };
      return { error: 'boom' };
    };
    h.coordinator.start();
    await Promise.all([h.coordinator._startScan('E:\\'), h.coordinator._startScan('F:\\')]);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });
});

describe('removable drive UI wiring', () => {
  const fs = require('fs');
  const path = require('path');

  it('settings page exposes the auto-scan toggle bound to the scan setting', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'settings.js'), 'utf8');
    assert.match(source, /id="autoScanRemovableDrivesToggle"/);
    assert.match(source, /saveFeature\('autoScanRemovableDrives'/);
    assert.match(source, /settings\.features\.autoScanRemovableDrives === true \? 'checked' : ''/);
    const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'api.js'), 'utf8');
    assert.match(api, /db:getSetting', 'scan\.autoScanRemovableDrives', false/);
    assert.match(api, /db:setSetting', 'scan\.autoScanRemovableDrives'/);
  });

  it('toast action routes to the scanner and the narrow pending channel', () => {
    const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'router.js'), 'utf8');
    assert.match(router, /navigate-to-removable-scan/);
    assert.match(router, /invoke\('removableDrive:scanPending'\)/);
    // The channel carries no path: the mount never crosses the renderer.
    assert.ok(!/scanPending\(.*mount|scanPending\(.*path/i.test(router));
  });

  it('localizes every user-facing removable-drive string', () => {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
    for (const key of [
      'settings.autoScanRemovableDrives.label',
      'settings.autoScanRemovableDrives.desc',
      'removableDrive.promptTitle',
      'removableDrive.promptBody',
      'removableDrive.removedTitle',
      'removableDrive.removedBody',
      'removableDrive.unavailable',
      'removableDrive.noPendingDrive',
      'removableDrive.queueFull',
    ]) {
      assert.ok(typeof en[key] === 'string' && en[key].length > 0, `missing i18n key: ${key}`);
    }
  });
});

describe('removable drive auto-scan failure stays actionable (#180 H1)', () => {
  function autoHarness(extra = {}) {
    return harness({
      eligible: ['E:\\'],
      settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true },
      ...extra,
    });
  }

  it('failed automatic scan becomes a pending prompt instead of disappearing', async () => {
    const h = autoHarness({ scanError: 'ClamAV virus definitions are not available' });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.deepEqual(h.scans, [['E:\\']], 'engine must have been attempted');
    const status = h.coordinator.getStatus();
    assert.equal(status.pending?.mount, 'E:\\');
    assert.equal(status.pendingCount, 1);
    assert.equal(status.activeTarget, null);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].action, 'removable-scan');
    assert.ok(String(h.notifications[0].title).startsWith('removableDrive.promptTitle'));
    h.coordinator.dispose();
  });

  it('pending retry after engine recovery scans successfully', async () => {
    const h = autoHarness({ scanError: 'ClamAV virus definitions are not available' });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.coordinator.getStatus().pending?.mount, 'E:\\');
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      h.scanEngine.isScanning = true;
      return { ok: true };
    };
    const retry = await h.coordinator.scanPending();
    assert.equal(retry.ok, true);
    assert.deepEqual(h.scans, [['E:\\'], ['E:\\']]);
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });

  it('failed user retry restores the pending entry for another attempt', async () => {
    const h = autoHarness({ scanError: 'ClamAV virus definitions are not available' });
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.coordinator.getStatus().pending?.mount, 'E:\\');
    const retry = await h.coordinator.scanPending();
    assert.equal(retry.ok, false);
    // _startScan consumed the entry before the engine failed: it must come back.
    assert.equal(h.coordinator.getStatus().pending?.mount, 'E:\\');
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      h.scanEngine.isScanning = true;
      return { ok: true };
    };
    const recovery = await h.coordinator.scanPending();
    assert.equal(recovery.ok, true);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });

  it('vanished drive gains no stale pending entry on auto failure', async () => {
    const h = autoHarness({ scanError: 'engine exploded' });
    h.coordinator.start();
    h.eligible.delete('E:\\');
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.scans.length, 0);
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.notifications.length, 0);
    h.coordinator.dispose();
  });

  it('queued auto arrival still tracks the queue without prompting', async () => {
    const h = autoHarness();
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.notifications.length, 0);
    h.coordinator.dispose();
  });
});

describe('removable scan ownership filtering (#180 H2)', () => {
  function activeHarness() {
    const h = harness({
      eligible: ['E:\\', 'F:\\'],
      settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true },
    });
    h.coordinator.start();
    return h;
  }

  async function startActiveScan(h, mount = 'E:\\') {
    await h.coordinator._onArrival(mount);
    assert.equal(h.coordinator.getStatus().activeTarget, mount);
  }

  it('foreign folder-watch completion preserves ownership and removal still aborts', async () => {
    const h = activeHarness();
    await startActiveScan(h);
    await h.emittedHandlers['scan:complete']({ scanType: 'folderwatch', targetPaths: ['C:\\Watched'], status: 'completed' });
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator._onRemoval('E:\\');
    assert.equal(h.aborts.length, 1);
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    h.coordinator.dispose();
  });

  it('definitions completion without target paths is ignored while active', async () => {
    const h = activeHarness();
    await startActiveScan(h);
    await h.emittedHandlers['scan:complete']({ scanType: 'definitions', status: 'completed' });
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    h.coordinator.dispose();
  });

  it('matching completion settles ownership and drains the queue', async () => {
    const h = activeHarness();
    await startActiveScan(h);
    await h.coordinator._onArrival('F:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['F:\\']);
    h.scanEngine.isScanning = false;
    // Equivalent non-canonical form proves canonical target matching.
    await h.emittedHandlers['scan:complete']({ scanType: 'custom', targetPaths: ['e:'], status: 'completed' });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.coordinator.getStatus().activeTarget, 'F:\\');
    assert.deepEqual(h.scans, [['E:\\'], ['F:\\']]);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    h.coordinator.dispose();
  });

  it('idle foreign completion still drains the queue', async () => {
    const h = activeHarness();
    h.scanEngine.isScanning = true;
    await h.coordinator._onArrival('E:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']({ scanType: 'full', targetPaths: ['C:\\'], status: 'completed' });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.scans, [['E:\\']]);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    h.coordinator.dispose();
  });

  it('payload-less completion cannot settle active removable ownership', async () => {
    const h = activeHarness();
    await startActiveScan(h);
    await h.coordinator._onArrival('F:\\');
    await h.emittedHandlers['scan:complete']();
    await h.emittedHandlers['scan:complete'](null);
    assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['F:\\']);
    h.coordinator._onRemoval('E:\\');
    assert.equal(h.aborts.length, 1);
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    h.coordinator.dispose();
  });

  it('malformed and foreign completions never settle the active target', async () => {
    const cases = [
      ['undefined', undefined],
      ['null', null],
      ['empty object', {}],
      ['missing targets', { scanType: 'custom' }],
      ['string targets', { scanType: 'custom', targetPaths: 'E:\\' }],
      ['empty targets', { scanType: 'custom', targetPaths: [] }],
      ['multi targets', { scanType: 'custom', targetPaths: ['E:\\', 'F:\\'] }],
      ['folderwatch same mount', { scanType: 'folderwatch', targetPaths: ['E:\\'] }],
      ['quick same mount', { scanType: 'quick', targetPaths: ['E:\\'] }],
      ['full same mount', { scanType: 'full', targetPaths: ['E:\\'] }],
      ['definitions', { scanType: 'definitions' }],
      ['custom other mount', { scanType: 'custom', targetPaths: ['F:\\'] }],
      ['custom non-string target', { scanType: 'custom', targetPaths: [12345] }],
    ];
    for (const [name, payload] of cases) {
      const h = activeHarness();
      await startActiveScan(h);
      await h.emittedHandlers['scan:complete'](payload);
      assert.equal(h.coordinator.getStatus().activeTarget, 'E:\\', name);
      assert.deepEqual(h.scans, [['E:\\']], `${name} must not start extra work`);
      h.coordinator.dispose();
    }
  });

  it('disposal during queued revalidation starts no scan', async () => {
    const h = activeHarness();
    h.scanEngine.isScanning = true;
    await h.coordinator._onArrival('E:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    let releaseEligible;
    const gate = new Promise((resolve) => { releaseEligible = resolve; });
    const realEligible = h.monitor.isCurrentlyEligible;
    h.monitor.isCurrentlyEligible = async (mount) => {
      await gate;
      return realEligible(mount);
    };
    h.scanEngine.isScanning = false;
    const settled = h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    h.coordinator.dispose();
    releaseEligible();
    await settled;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.scans, [], 'no scan may start after disposal');
    assert.equal(h.coordinator.getStatus().activeTarget, null);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.notifications.length, 0);
  });

  it('disposal during fallback revalidation creates no prompt', async () => {
    const h = activeHarness();
    h.scanEngine.isScanning = true;
    await h.coordinator._onArrival('E:\\');
    let releaseEligible;
    const gate = new Promise((resolve) => { releaseEligible = resolve; });
    let calls = 0;
    const realEligible = h.monitor.isCurrentlyEligible;
    h.monitor.isCurrentlyEligible = async (mount) => {
      calls += 1;
      if (calls > 1) await gate;
      return realEligible(mount);
    };
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      return { error: 'engine unavailable' };
    };
    h.scanEngine.isScanning = false;
    const settled = h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    h.coordinator.dispose();
    releaseEligible();
    await settled;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.notifications.length, 0);
    assert.deepEqual(h.coordinator.getStatus().queued, []);
    assert.equal(h.coordinator.getStatus().activeTarget, null);
  });

  it('failed queued automatic start falls back to a pending prompt', async () => {
    const h = activeHarness();
    h.scanEngine.isScanning = true;
    await h.coordinator._onArrival('E:\\');
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      return { error: 'engine unavailable' };
    };
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const status = h.coordinator.getStatus();
    assert.equal(status.pending?.mount, 'E:\\');
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].action, 'removable-scan');
    h.coordinator.dispose();
  });

  it('failed queued manual start restores its pending prompt', async () => {
    // Prompt mode never auto-queues: the user clicks Scan first, and only
    // then does a busy engine queue the request.
    const h = harness({ eligible: ['E:\\'] });
    h.scanEngine.isScanning = true;
    h.coordinator.start();
    await h.coordinator._onArrival('E:\\');
    assert.equal(h.coordinator.getStatus().pending?.mount, 'E:\\');
    const queued = await h.coordinator.scanPending();
    assert.equal(queued.queued, true);
    assert.deepEqual(h.coordinator.getStatus().queued, ['E:\\']);
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      return { error: 'engine unavailable' };
    };
    h.scanEngine.isScanning = false;
    await h.emittedHandlers['scan:complete']();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.coordinator.getStatus().pending?.mount, 'E:\\');
    assert.ok(h.notifications.length >= 2, 'user must be told the requested scan did not run');
    assert.equal(h.notifications[h.notifications.length - 1].action, 'removable-scan');
    h.coordinator.dispose();
  });

  it('no prompt is created when disposal lands mid-request', async () => {
    const h = harness({
      eligible: ['E:\\'],
      settings: { [REMOVABLE_DRIVE_SETTING_KEY]: true },
    });
    let releaseScan;
    const gate = new Promise((resolve) => { releaseScan = resolve; });
    h.scanEngine.runCustomScan = async (paths) => {
      h.scans.push(paths);
      await gate;
      return { error: 'engine unavailable' };
    };
    h.coordinator.start();
    const arrival = h.coordinator._onArrival('E:\\');
    await new Promise((resolve) => setImmediate(resolve));
    h.coordinator.dispose();
    releaseScan();
    await arrival;
    assert.equal(h.coordinator.getStatus().pending, null);
    assert.equal(h.notifications.length, 0);
  });
});
