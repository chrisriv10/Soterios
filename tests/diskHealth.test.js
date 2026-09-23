'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  normalizeSmartStatus,
  normalizeDisk,
  normalizeDiskLayout,
  collectDiskHealth,
  unavailableSnapshot,
  createDiskHealthSampler,
  SUCCESS_TTL_MS,
  FAILURE_RETRY_MS,
} = require('../src/main/diskHealth');

function layoutResult(disks) {
  return normalizeDiskLayout(disks);
}

describe('SMART status mapping', () => {
  it('maps ok to healthy across casing and whitespace', () => {
    for (const value of ['ok', 'OK', 'Ok', '  ok  ', 'oK']) {
      assert.equal(normalizeSmartStatus(value), 'healthy', JSON.stringify(value));
    }
  });

  it('maps documented failure values to warning', () => {
    for (const value of ['fail', 'FAIL', 'Fail', ' predicted failure ', 'Predicted Failure', 'PREDICTED FAILURE']) {
      assert.equal(normalizeSmartStatus(value), 'warning', JSON.stringify(value));
    }
  });

  it('maps missing and unrecognized values to unknown', () => {
    for (const value of ['unknown', 'Unknown', 'UNKNOWN', '', '   ', null, undefined, 'not supported', 'Degraded', 'degraded', 'good', 'passed', 'healthy', 'okay', 'bad', 'critical']) {
      assert.equal(normalizeSmartStatus(value), 'unknown', JSON.stringify(value));
    }
  });

  it('never classifies booleans, numbers, or objects as healthy', () => {
    for (const value of [true, false, 1, 0, {}, [], NaN]) {
      assert.equal(normalizeSmartStatus(value), 'unknown', JSON.stringify(value));
    }
  });

  it('never interprets raw vendor attributes as health', () => {
    // A disk carrying alarming-looking raw attributes but an ok status is healthy;
    // a disk with benign attributes but no status is unknown.
    const withAttrs = normalizeDisk({ name: 'SSD', smartStatus: 'Ok', smartData: { reallocated_sector_ct: { raw: { value: 99 } }, percentage_used: 12 } }, 0);
    assert.equal(withAttrs.health, 'healthy');
    const noStatus = normalizeDisk({ name: 'SSD', smartData: { reallocated_sector_ct: { raw: { value: 0 } } } }, 0);
    assert.equal(noStatus.health, 'unknown');
  });
});

describe('disk temperature normalization', () => {
  it('retains valid positive finite temperatures', () => {
    assert.equal(normalizeDisk({ name: 'SSD', temperature: 41 }, 0).temperatureC, 41);
    assert.equal(normalizeDisk({ name: 'SSD', temperature: 38.5 }, 0).temperatureC, 38.5);
    assert.equal(normalizeDisk({ name: 'SSD', temperature: '41' }, 0).temperatureC, 41);
  });

  it('treats null, undefined, zero, negative, NaN, and Infinity as unavailable', () => {
    for (const temperature of [null, undefined, 0, -1, NaN, Infinity, -Infinity, 'hot', true]) {
      assert.equal(normalizeDisk({ name: 'SSD', temperature }, 0).temperatureC, null, JSON.stringify(temperature));
    }
  });

  it('never lets temperature influence the health classification', () => {
    assert.equal(normalizeDisk({ name: 'SSD', smartStatus: 'Ok', temperature: 95 }, 0).health, 'healthy');
    assert.equal(normalizeDisk({ name: 'SSD', smartStatus: 'fail', temperature: 25 }, 0).health, 'warning');
    assert.equal(normalizeDisk({ name: 'SSD', temperature: 95 }, 0).health, 'unknown');
  });
});

describe('disk normalization', () => {
  it('normalizes one valid physical disk', () => {
    const disk = normalizeDisk({
      device: '\\\\.\\PHYSICALDRIVE0', type: 'SSD', name: 'SDBPTPZ-512G', vendor: 'Western Digital',
      size: 512105932800, smartStatus: 'Ok', temperature: null,
    }, 0);
    assert.equal(disk.id, 'disk-0');
    assert.equal(disk.name, 'SDBPTPZ-512G');
    assert.equal(disk.type, 'SSD');
    assert.equal(disk.sizeBytes, 512105932800);
    assert.equal(disk.smartStatusRaw, 'Ok');
    assert.equal(disk.health, 'healthy');
    assert.equal(disk.temperatureC, null);
    assert.equal(disk.smartData, null);
  });

  it('keeps multiple disks independent', () => {
    const snapshot = layoutResult([
      { name: 'SSD-A', type: 'SSD', size: 512105932800, smartStatus: 'Ok', temperature: 41 },
      { name: 'HDD-B', type: 'HDD', size: 1000204886016, smartStatus: 'Predicted Failure', temperature: null },
    ]);
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.disks.length, 2);
    assert.equal(snapshot.disks[0].health, 'healthy');
    assert.equal(snapshot.disks[1].health, 'warning');
    assert.ok(typeof snapshot.sampledAt === 'string');
  });

  it('skips malformed siblings without losing valid disks', () => {
    const snapshot = layoutResult([null, 'nope', 42, [], { name: 'Good', smartStatus: 'Ok' }]);
    assert.equal(snapshot.disks.length, 1);
    assert.equal(snapshot.disks[0].name, 'Good');
  });

  it('handles missing name, type, and size gracefully', () => {
    const disk = normalizeDisk({ smartStatus: 'Ok' }, 3);
    assert.equal(disk.id, 'disk-3');
    assert.equal(typeof disk.name, 'string');
    assert.ok(disk.name.length > 0);
    assert.equal(disk.type, null);
    assert.equal(disk.sizeBytes, null);
    assert.equal(normalizeDisk({ size: -5 }, 0).sizeBytes, null);
    assert.equal(normalizeDisk({ size: 'huge' }, 0).sizeBytes, null);
  });

  it('preserves raw smartData objects untouched', () => {
    const smartData = { temperature: { current: 41 }, smart_status: { passed: true } };
    const disk = normalizeDisk({ name: 'SSD', smartStatus: 'Ok', smartData }, 0);
    assert.deepEqual(disk.smartData, smartData);
    assert.equal(normalizeDisk({ name: 'SSD' }, 0).smartData, null);
    assert.equal(normalizeDisk({ name: 'SSD', smartData: 'a string' }, 0).smartData, null);
    assert.equal(normalizeDisk({ name: 'SSD', smartData: [1, 2] }, 0).smartData, null);
  });

  it('never stores serials, GUIDs, or device paths in normalized fields', () => {
    const disk = normalizeDisk({
      device: '\\\\.\\PHYSICALDRIVE0', name: 'SSD', serialNum: 'SECRET123',
      uuid: 'guid-here', smartStatus: 'Ok',
    }, 0);
    const exposed = JSON.stringify({ id: disk.id, name: disk.name, type: disk.type, size: disk.sizeBytes });
    assert.ok(!exposed.includes('SECRET123'));
    assert.ok(!exposed.includes('PHYSICALDRIVE'));
    assert.ok(!exposed.includes('guid-here'));
  });
});

describe('collection behavior', () => {
  function fakeSi(layout, error = null) {
    return { diskLayout: async () => { if (error) throw error; return layout; } };
  }

  it('snapshots a successful diskLayout call', async () => {
    const snapshot = await collectDiskHealth(fakeSi([{ name: 'SSD', smartStatus: 'Ok' }]));
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.disks.length, 1);
  });

  it('propagates diskLayout failures to the sampler, not as healthy data', async () => {
    const sampler = createDiskHealthSampler({
      collect: () => fakeSi(null, new Error('WMI down')).diskLayout(),
      logger: { warn: () => {}, info: () => {} },
      now: () => 1000,
    });
    const snapshot = await sampler();
    assert.equal(snapshot.available, false);
    assert.deepEqual(snapshot.disks, []);
  });

  it('treats non-array and empty results as available-but-empty, not failed', async () => {
    for (const layout of [null, undefined, {}, 'x', []]) {
      const snapshot = await collectDiskHealth(fakeSi(layout));
      assert.equal(snapshot.available, true, JSON.stringify(layout));
      assert.deepEqual(snapshot.disks, []);
    }
  });
});

describe('sampler caching, dedupe, and backoff', () => {
  function clock(start = 1000000) {
    let now = start;
    return { now: () => now, advance: (ms) => { now += ms; } };
  }

  it('reuses cached success inside TTL without re-querying', async () => {
    let calls = 0;
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => { calls += 1; return { disks: [], available: true, sampledAt: 't' }; },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 60000,
    });
    await sampler();
    await sampler();
    time.advance(599999);
    await sampler();
    assert.equal(calls, 1);
  });

  it('refreshes after TTL expiry', async () => {
    let calls = 0;
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => { calls += 1; return { disks: [], available: true, sampledAt: 't' }; },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 60000,
    });
    await sampler();
    time.advance(600001);
    await sampler();
    assert.equal(calls, 2);
  });

  it('deduplicates concurrent calls into one underlying query', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const sampler = createDiskHealthSampler({
      collect: async () => { calls += 1; await gate; return { disks: [], available: true, sampledAt: 't' }; },
      now: () => 1000,
    });
    const pending = [sampler(), sampler(), sampler()];
    release();
    const results = await Promise.all(pending);
    assert.equal(calls, 1);
    assert.ok(results.every((snapshot) => snapshot.available));
  });

  it('backs off after failure instead of retrying every render', async () => {
    let calls = 0;
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => { calls += 1; throw new Error('WMI down'); },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 60000,
      logger: { warn: () => {}, info: () => {} },
    });
    await sampler();
    await sampler();
    time.advance(59999);
    await sampler();
    assert.equal(calls, 1);
  });

  it('retries after the failure backoff expires and recovers honestly', async () => {
    let fail = true;
    const logs = { warn: 0, info: 0 };
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => {
        if (fail) throw new Error('WMI down');
        return { disks: [{ id: 'disk-0' }], available: true, sampledAt: 't' };
      },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 60000,
      logger: { warn: () => { logs.warn += 1; }, info: () => { logs.info += 1; } },
    });
    const failed = await sampler();
    assert.equal(failed.available, false);
    fail = false;
    time.advance(1000);
    const stillCached = await sampler();
    assert.equal(stillCached.available, false);
    time.advance(60000);
    const recovered = await sampler();
    assert.equal(recovered.available, true);
    assert.equal(recovered.disks.length, 1);
    assert.equal(logs.info, 1);
  });

  it('rate-limits repeated failure logging', async () => {
    let warnings = 0;
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => { throw new Error('down'); },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 1,
      logger: { warn: () => { warnings += 1; }, info: () => {} },
    });
    for (let i = 0; i < 25; i += 1) {
      time.advance(2);
      await sampler();
    }
    // First failure + every 10th: bounded regardless of poll count.
    assert.ok(warnings <= 4, `warnings: ${warnings}`);
  });

  it('never permanently poisons the cache after failures', async () => {
    let calls = 0;
    const time = clock();
    const sampler = createDiskHealthSampler({
      collect: async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return { disks: [], available: true, sampledAt: 't' };
      },
      now: time.now,
      successTtlMs: 600000,
      failureRetryMs: 1000,
      logger: { warn: () => {}, info: () => {} },
    });
    await sampler();
    time.advance(1001);
    await sampler();
    time.advance(1001);
    const recovered = await sampler();
    assert.equal(recovered.available, true);
    assert.equal(calls, 3);
  });
});

describe('disk health dashboard UI', () => {
  const dashboardPath = path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'dashboard.js');
  const ui = fs.readFileSync(dashboardPath, 'utf8');

  it('renders a disk health card with summary and rows targets', () => {
    assert.match(ui, /id="diskHealthCard"/);
    assert.match(ui, /id="diskHealthSummary"/);
    assert.match(ui, /id="diskHealthRows"/);
    assert.match(ui, /diskHealth\.title/);
  });

  it('reads the snapshot through the narrow IPC channel', () => {
    assert.match(ui, /invoke\('system:diskHealthSnapshot'\)/);
  });

  it('writes disk content with textContent, never raw HTML interpolation', () => {
    const start = ui.indexOf('function renderDiskHealth');
    const end = ui.indexOf('async function refreshDiskHealth', start);
    const diskFn = ui.slice(start, end === -1 ? undefined : end);
    assert.ok(!/\.innerHTML\s*=(?!=)/.test(diskFn), 'disk rows must not use innerHTML');
    assert.match(diskFn, /textContent/);
  });

  it('refreshes on a slow non-overlapping loop cleaned up on navigation', () => {
    assert.match(ui, /DISK_HEALTH_REFRESH_MS = 10 \* 60 \* 1000/);
    assert.match(ui, /diskTimer = setTimeout\(refreshDiskHealth, DISK_HEALTH_REFRESH_MS\)/);
    assert.match(ui, /clearTimeout\(diskTimer\)/);
  });

  it('maps health states to factual labels without thresholds', () => {
    assert.match(ui, /diskHealth\.healthy/);
    assert.match(ui, /diskHealth\.warning/);
    assert.match(ui, /diskHealth\.unknown/);
    assert.match(ui, /diskHealth\.warningDetail/);
    const start = ui.indexOf('function renderDiskHealth');
    const end = ui.indexOf('async function refreshDiskHealth', start);
    const diskFn = ui.slice(start, end === -1 ? undefined : end);
    assert.ok(!/critical|imminent|replace immediately|failing soon|health score|healthScore/i.test(diskFn));
  });

  it('shows raw SMART data only on demand with safe text and a cap notice', () => {
    assert.match(ui, /diskHealth\.rawData/);
    assert.match(ui, /diskHealth\.rawTruncated/);
    assert.match(ui, /DISK_HEALTH_RAW_LIMIT/);
    // Raw JSON serialization sits inside error handling so an
    // unserializable payload degrades to a notice instead of breaking render.
    const toggleAt = ui.indexOf('JSON.stringify(disk.smartData');
    assert.ok(toggleAt >= 0);
    assert.ok(ui.lastIndexOf('try {', toggleAt) > toggleAt - 400);
  });

  it('registers the read-only disk health IPC channel', () => {
    const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'system.js'), 'utf8');
    assert.match(ipc, /ipcMain\.handle\('system:diskHealthSnapshot'/);
  });
});

describe('disk health i18n', () => {
  it('provides every disk health string in all locales', () => {
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'i18n', 'locales')).filter((f) => f.endsWith('.json'))) {
      const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', file), 'utf8'));
      for (const key of [
        'diskHealth.title', 'diskHealth.smart', 'diskHealth.healthy', 'diskHealth.warning',
        'diskHealth.warningDetail', 'diskHealth.unknown', 'diskHealth.temperature',
        'diskHealth.unavailable', 'diskHealth.rawData', 'diskHealth.rawTruncated',
        'diskHealth.rawUnavailable', 'diskHealth.queryUnavailable', 'diskHealth.noDisks',
        'diskHealth.unknownDisk', 'diskHealth.diskCount',
      ]) {
        assert.ok(typeof strings[key] === 'string' && strings[key].length > 0, `${file} missing ${key}`);
      }
    }
  });
});

describe('disk health security and privacy', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'diskHealth.js'), 'utf8');

  it('adds no shell, elevation, network, or persistence paths', () => {
    assert.ok(!/child_process|execFile|spawn|powershell|cmd\.exe/i.test(mainSource));
    assert.ok(!/https?\.request|fetch\(|axios/i.test(mainSource));
    assert.ok(!/INSERT INTO|UPDATE |DELETE FROM|writeFile/i.test(mainSource));
  });

  it('classifies only the normalized status, never vendor attributes', () => {
    assert.match(mainSource, /normalizeSmartStatus\(raw\.smartStatus\)/);
    assert.ok(!/reallocated|read.error.rate|wear|percentage.used|power.on.hours|attribute.id/i.test(mainSource));
  });

  it('never logs hardware identifiers from the module', () => {
    assert.ok(!/serial|guid|wwn|hardware.?id/i.test(mainSource));
  });
});
