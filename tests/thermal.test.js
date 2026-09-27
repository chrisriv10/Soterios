'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  validTempC,
  normalizeCpuTemperature,
  normalizeGpus,
  collectThermal,
  unavailableSnapshot,
  createThermalSampler,
} = require('../src/main/thermal');

describe('thermal value validation', () => {
  it('accepts finite positive numbers only', () => {
    assert.equal(validTempC(47), 47);
    assert.equal(validTempC(47.5), 47.5);
    assert.equal(validTempC('47'), 47);
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, 0, -5, 'hot', {}, [], true, false, '']) {
      assert.equal(validTempC(bad), null, JSON.stringify(bad));
    }
  });
});

describe('CPU normalization', () => {
  it('renders a valid main reading with max and cores preserved', () => {
    const cpu = normalizeCpuTemperature({ main: 52.5, max: 61, cores: [50, 52.5, 49], socket: [], chipset: null });
    assert.equal(cpu.available, true);
    assert.equal(cpu.mainC, 52.5);
    assert.equal(cpu.maxC, 61);
    assert.deepEqual(cpu.coresC, [50, 52.5, 49]);
  });

  it('falls back to the hottest valid core when main is missing', () => {
    const cpu = normalizeCpuTemperature({ main: null, max: null, cores: [44, null, 51, 0, NaN] });
    assert.equal(cpu.available, true);
    assert.equal(cpu.mainC, 51);
    assert.deepEqual(cpu.coresC, [44, 51]);
  });

  it('reports unavailable for empty, null, and malformed results', () => {
    for (const raw of [null, undefined, {}, { main: null, cores: [] }, { cores: [0, null, NaN] }, [], 'hot']) {
      const cpu = normalizeCpuTemperature(raw);
      assert.equal(cpu.available, false, JSON.stringify(raw));
      assert.equal(cpu.mainC, null);
    }
  });

  it('treats 0, negative, NaN, and infinite readings as unavailable', () => {
    assert.equal(normalizeCpuTemperature({ main: 0, cores: [] }).available, false);
    assert.equal(normalizeCpuTemperature({ main: -3, cores: [] }).available, false);
    assert.equal(normalizeCpuTemperature({ main: NaN, cores: [] }).available, false);
    assert.equal(normalizeCpuTemperature({ main: Infinity, cores: [] }).available, false);
  });
});

describe('GPU normalization', () => {
  it('keeps one valid GPU with its model name', () => {
    const [gpu] = normalizeGpus({ controllers: [{ vendor: 'NVIDIA', model: 'GeForce RTX 4060', temperatureGpu: 47 }] });
    assert.equal(gpu.available, true);
    assert.equal(gpu.temperatureC, 47);
    assert.equal(gpu.name, 'GeForce RTX 4060');
  });

  it('handles multiple GPUs independently without collapsing them', () => {
    const gpus = normalizeGpus({ controllers: [
      { vendor: 'NVIDIA', model: 'GeForce RTX 4060', temperatureGpu: 47 },
      { vendor: 'Intel', model: 'UHD Graphics', temperatureGpu: null },
    ] });
    assert.equal(gpus.length, 2);
    assert.equal(gpus[0].available, true);
    assert.equal(gpus[0].temperatureC, 47);
    assert.equal(gpus[1].available, false);
    assert.equal(gpus[1].temperatureC, null);
    assert.equal(gpus[1].name, 'UHD Graphics');
  });

  it('marks missing, null, zero, and NaN temperatures unavailable', () => {
    const gpus = normalizeGpus({ controllers: [
      { model: 'A' }, { model: 'B', temperatureGpu: null },
      { model: 'C', temperatureGpu: 0 }, { model: 'D', temperatureGpu: NaN },
      { model: 'E', temperatureGpu: -2 }, { model: 'F', temperatureGpu: Infinity },
    ] });
    assert.equal(gpus.length, 6);
    for (const gpu of gpus) {
      assert.equal(gpu.available, false, gpu.name);
      assert.equal(gpu.temperatureC, null, gpu.name);
    }
  });

  it('survives empty, missing, and malformed controller data', () => {
    assert.deepEqual(normalizeGpus({ controllers: [] }), []);
    assert.deepEqual(normalizeGpus({}), []);
    assert.deepEqual(normalizeGpus(null), []);
    assert.deepEqual(normalizeGpus(undefined), []);
    assert.deepEqual(normalizeGpus({ controllers: null }), []);
    // No model/vendor yields an empty name so the dashboard can apply its
    // localized `thermal.unknownGpu` fallback; the main process never
    // hardcodes display text.
    const [nameless, vendorOnly] = normalizeGpus({ controllers: [{ temperatureGpu: 40 }, { vendor: 'AMD', temperatureGpu: 41 }] });
    assert.equal(nameless.name, '');
    assert.equal(vendorOnly.name, 'AMD');
    // Non-object entries are skipped, never crash.
    assert.equal(normalizeGpus({ controllers: [null, 'x', 42, { model: 'G', temperatureGpu: 43 }] }).length, 1);
  });
});

describe('combined collection', () => {
  function fakeSi(cpuResult, gpuResult, cpuError = null, gpuError = null) {
    return {
      cpuTemperature: async () => { if (cpuError) throw cpuError; return cpuResult; },
      graphics: async () => { if (gpuError) throw gpuError; return gpuResult; },
    };
  }

  it('collects CPU and GPU together when both succeed', async () => {
    const snapshot = await collectThermal(fakeSi(
      { main: 50, max: 55, cores: [49, 50] },
      { controllers: [{ vendor: 'NVIDIA', model: 'GeForce', temperatureGpu: 47 }] }
    ));
    assert.equal(snapshot.cpu.available, true);
    assert.equal(snapshot.cpu.mainC, 50);
    assert.equal(snapshot.gpus.length, 1);
    assert.equal(snapshot.gpus[0].temperatureC, 47);
    assert.ok(typeof snapshot.sampledAt === 'string');
  });

  it('keeps a valid CPU when graphics throws', async () => {
    const snapshot = await collectThermal(fakeSi({ main: 50, cores: [] }, null, null, new Error('no gpu')));
    assert.equal(snapshot.cpu.available, true);
    assert.deepEqual(snapshot.gpus, []);
  });

  it('keeps valid GPUs when the CPU sensor throws', async () => {
    const snapshot = await collectThermal(
      fakeSi(null, { controllers: [{ model: 'GeForce', temperatureGpu: 47 }] }, new Error('no cpu'), null)
    );
    assert.equal(snapshot.cpu.available, false);
    assert.equal(snapshot.gpus[0].available, true);
  });

  it('reports both unavailable when both sources fail', async () => {
    const snapshot = await collectThermal(fakeSi(null, null, new Error('a'), new Error('b')));
    assert.equal(snapshot.cpu.available, false);
    assert.deepEqual(snapshot.gpus, []);
  });
});

describe('thermal sampler failure behavior', () => {
  function loggedSampler(collect) {
    const logs = { warn: [], info: [] };
    const sample = createThermalSampler({
      collect,
      logger: {
        warn: (message, meta) => logs.warn.push({ message, meta }),
        info: (message) => logs.info.push(message),
      },
    });
    return { sample, logs };
  }

  it('returns an unavailable snapshot instead of throwing', async () => {
    const { sample } = loggedSampler(async () => { throw new Error('sensor bus down'); });
    const snapshot = await sample();
    assert.equal(snapshot.cpu.available, false);
    assert.deepEqual(snapshot.gpus, []);
    assert.ok(typeof snapshot.sampledAt === 'string');
  });

  it('logs the first failure and then rate-limits repeated failures', async () => {
    const { sample, logs } = loggedSampler(async () => { throw new Error('down'); });
    for (let i = 0; i < 25; i += 1) await sample();
    assert.equal(logs.warn.length, 3);
    assert.equal(logs.warn[0].meta.consecutiveFailures, 1);
  });

  it('logs a single recovery note when collection succeeds again', async () => {
    let fail = true;
    const { sample, logs } = loggedSampler(async () => {
      if (fail) throw new Error('down');
      return { cpu: { available: true, mainC: 42, maxC: null, coresC: [] }, gpus: [], sampledAt: 'now' };
    });
    await sample();
    fail = false;
    const snapshot = await sample();
    assert.equal(snapshot.cpu.mainC, 42);
    assert.equal(logs.info.length, 1);
    await sample();
    assert.equal(logs.info.length, 1);
  });

  it('stays silent when sensors are merely absent (not errors)', async () => {
    const { sample, logs } = loggedSampler(async () => unavailableSnapshot());
    for (let i = 0; i < 12; i += 1) await sample();
    assert.equal(logs.warn.length, 0);
    assert.equal(logs.info.length, 0);
  });
});

describe('thermal dashboard UI', () => {
  const dashboardPath = path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'dashboard.js');
  const ui = fs.readFileSync(dashboardPath, 'utf8');

  it('renders a temperatures card with CPU and GPU targets', () => {
    assert.match(ui, /id="thermalCard"/);
    assert.match(ui, /id="thermalCpu"/);
    assert.match(ui, /id="thermalGpus"/);
    assert.match(ui, /thermal\.title/);
  });

  it('writes readings with textContent, never raw HTML interpolation', () => {
    assert.ok(!/thermalGpus['"]?\s*\)?\.innerHTML\s*=(?!=)/.test(ui), 'GPU list must not use innerHTML');
    assert.match(ui, /system:thermalSnapshot/);
  });

  it('refreshes on a 15s non-overlapping loop cleaned up on navigation', () => {
    assert.match(ui, /THERMAL_REFRESH_MS = 15000/);
    assert.match(ui, /thermalTimer = setTimeout\(refreshThermal, THERMAL_REFRESH_MS\)/);
    assert.match(ui, /clearTimeout\(thermalTimer\)/);
  });

  it('shows Unavailable states and per-GPU labels', () => {
    assert.match(ui, /thermal\.unavailable/);
    assert.match(ui, /thermal\.cpu/);
    assert.match(ui, /thermal\.gpu/);
    assert.match(ui, /thermal\.unknownGpu/);
  });

  it('clears stale GPU readings when a refresh fails', () => {
    // The catch branch must reset both targets: otherwise a failed refresh
    // would leave the previous GPU temperatures visible as if current.
    const refreshFn = ui.slice(ui.indexOf('async function refreshThermal'));
    const catchAt = refreshFn.indexOf('} catch (_) {');
    assert.ok(catchAt >= 0, 'refreshThermal has a catch branch');
    const catchBlock = refreshFn.slice(catchAt, catchAt + 700);
    assert.match(catchBlock, /#thermalCpu/);
    assert.match(catchBlock, /#thermalGpus/);
  });

  it('introduces no threshold or health classification', () => {
    for (const word of ['Critical', 'Warning', 'threshold', 'healthScore', 'health.score']) {
      const inThermal = ui.split('refreshThermal')[0].includes(word) && ui.includes('thermal');
      assert.ok(!new RegExp(`thermal[^\\n]*${word}`, 'i').test(ui), `threshold language near thermal: ${word}`);
    }
    assert.ok(!/thermal.*(score|penalty)/i.test(ui));
  });
});

describe('thermal i18n', () => {
  it('provides every thermal string in all locales', () => {
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'src', 'i18n', 'locales')).filter((f) => f.endsWith('.json'))) {
      const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', file), 'utf8'));
      for (const key of ['thermal.title', 'thermal.cpu', 'thermal.gpu', 'thermal.unavailable', 'thermal.unknownGpu']) {
        assert.ok(typeof strings[key] === 'string' && strings[key].length > 0, `${file} missing ${key}`);
      }
    }
  });

  it('registers the system snapshot IPC channel', () => {
    const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'system.js'), 'utf8');
    assert.match(ipc, /ipcMain\.handle\('system:thermalSnapshot'/);
  });
});
