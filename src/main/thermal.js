'use strict';

// CPU/GPU temperature collection for issue #120 (display-only monitoring).
//
// Single normalization boundary: raw systeminformation output becomes a
// stable snapshot where every exposed temperature is a finite number and
// everything else is an explicit unavailable state. The UI must never see
// 0, NaN, undefined, or guessed values.
//
// Conservative unavailable rule: missing, null, non-numeric, NaN, infinite,
// boolean, or <= 0 readings are unavailable. A running consumer CPU/GPU at
// or below 0°C is not expected, and sensor APIs commonly report 0 for
// "no sensor". No upper threshold is imposed.

function validTempC(value) {
  if (typeof value === 'boolean' || value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function unavailableCpu() {
  return { available: false, mainC: null, maxC: null, coresC: [] };
}

function normalizeCpuTemperature(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailableCpu();
  const cores = Array.isArray(raw.cores)
    ? raw.cores.map(validTempC).filter((value) => value !== null)
    : [];
  let main = validTempC(raw.main);
  // Documented fallback: when the aggregate sensor is missing but at least
  // one core reports a valid reading, the hottest valid core stands in.
  // The reading is still a real sensor value, never an average or guess.
  if (main === null && cores.length > 0) main = Math.max(...cores);
  return {
    available: main !== null,
    mainC: main,
    maxC: validTempC(raw.max),
    coresC: cores,
  };
}

function normalizeGpus(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.controllers)) return [];
  return raw.controllers
    .filter((controller) => controller && typeof controller === 'object')
    .map((controller) => {
      const temperatureC = validTempC(controller.temperatureGpu);
      const model = typeof controller.model === 'string' ? controller.model.trim().slice(0, 128) : '';
      const vendor = typeof controller.vendor === 'string' ? controller.vendor.trim().slice(0, 128) : '';
      return {
        name: model || vendor,
        available: temperatureC !== null,
        temperatureC,
      };
    });
}

async function collectThermal(siImpl) {
  const si = siImpl || require('systeminformation');
  const [cpuSettled, gpuSettled] = await Promise.allSettled([
    si.cpuTemperature(),
    si.graphics(),
  ]);
  return {
    cpu: normalizeCpuTemperature(cpuSettled.status === 'fulfilled' ? cpuSettled.value : null),
    gpus: normalizeGpus(gpuSettled.status === 'fulfilled' ? gpuSettled.value : null),
    sampledAt: new Date().toISOString(),
  };
}

function unavailableSnapshot() {
  return { cpu: unavailableCpu(), gpus: [], sampledAt: new Date().toISOString() };
}

// Persistent sampler with bounded failure logging: the first collection
// error and every 10th consecutive one are logged; successful collections
// (even with no sensors present, which is a normal state) stay silent
// apart from a single recovery note.
function createThermalSampler(options = {}) {
  const collect = typeof options.collect === 'function' ? options.collect : () => collectThermal(options.si);
  const logger = options.logger || null;
  let consecutiveFailures = 0;
  return async function sampleThermal() {
    try {
      const snapshot = await collect();
      if (consecutiveFailures > 0 && logger && typeof logger.info === 'function') {
        try { logger.info('Thermal sensor collection recovered'); } catch (_) {}
      }
      consecutiveFailures = 0;
      return snapshot;
    } catch (error) {
      consecutiveFailures += 1;
      if ((consecutiveFailures === 1 || consecutiveFailures % 10 === 0) && logger && typeof logger.warn === 'function') {
        try {
          logger.warn('Thermal sensor collection failed', {
            error: error?.message || String(error),
            consecutiveFailures,
          });
        } catch (_) {}
      }
      return unavailableSnapshot();
    }
  };
}

module.exports = {
  validTempC,
  normalizeCpuTemperature,
  normalizeGpus,
  collectThermal,
  unavailableSnapshot,
  createThermalSampler,
};
