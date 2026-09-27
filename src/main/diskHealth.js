'use strict';

// Physical disk SMART health collection for issue #121 (display-only).
//
// Single normalization boundary: raw `systeminformation.diskLayout()`
// output becomes a stable snapshot. Health classification is deliberately
// narrow — only systeminformation's own documented status strings are
// honored (`ok` → healthy; `fail` / `predicted failure` → warning);
// everything else, including raw vendor SMART attributes, is surfaced as
// Unknown or as uninterpreted raw data. Temperature follows the same
// conservative sensor philosophy as thermal monitoring (#120).

const { validTempC } = require('./thermal');

const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;
const MAX_RAW_JSON_CHARS = 65536;

function normalizeSmartStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'ok') return 'healthy';
  // 'Predicted Failure' is systeminformation's own documented failure
  // signal (Linux/macOS/Windows backends); 'fail' is the contracted alias.
  if (normalized === 'fail' || normalized === 'predicted failure') return 'warning';
  return 'unknown';
}

function safeText(value, maxLength = 128) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  if (!trimmed || /[\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

function safeBytes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeSmartData(value) {
  if (value == null) return null;
  if (isPlainObject(value)) return value;
  return null;
}

function normalizeDisk(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const health = normalizeSmartStatus(raw.smartStatus);
  return {
    id: `disk-${index}`,
    name: safeText(raw.name) || safeText(raw.model) || 'Unknown disk',
    type: safeText(raw.type, 32),
    sizeBytes: safeBytes(raw.size),
    smartStatusRaw: typeof raw.smartStatus === 'string' ? raw.smartStatus.trim().slice(0, 64) : null,
    health,
    temperatureC: validTempC(raw.temperature),
    smartData: normalizeSmartData(raw.smartData),
  };
}

function normalizeDiskLayout(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const disks = [];
  for (let index = 0; index < list.length; index += 1) {
    // One malformed entry must never hide its valid siblings.
    try {
      const disk = normalizeDisk(list[index], index);
      if (disk) disks.push(disk);
    } catch (_) {}
  }
  return {
    disks,
    available: true,
    sampledAt: new Date().toISOString(),
  };
}

function unavailableSnapshot() {
  return { disks: [], available: false, sampledAt: new Date().toISOString() };
}

async function collectDiskHealth(siImpl) {
  const si = siImpl || require('systeminformation');
  return normalizeDiskLayout(await si.diskLayout());
}

// TTL-cached sampler: successful snapshots are reused for SUCCESS_TTL_MS,
// failures back off for FAILURE_RETRY_MS, and concurrent callers share one
// in-flight diskLayout() call. No background timer: the dashboard requests
// on its slow cadence and navigation within TTL reuses the cache instead
// of hitting WMI again. Never throws and never permanently poisons.
function createDiskHealthSampler(options = {}) {
  const collect = typeof options.collect === 'function' ? options.collect : () => collectDiskHealth(options.si);
  const logger = options.logger || null;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const successTtlMs = Number.isFinite(Number(options.successTtlMs)) && Number(options.successTtlMs) > 0
    ? Number(options.successTtlMs)
    : SUCCESS_TTL_MS;
  const failureRetryMs = Number.isFinite(Number(options.failureRetryMs)) && Number(options.failureRetryMs) > 0
    ? Number(options.failureRetryMs)
    : FAILURE_RETRY_MS;
  let cached = null;
  let cachedAt = 0;
  let cachedFailed = false;
  let inflight = null;
  let consecutiveFailures = 0;

  function logWarn(message, meta) {
    if (logger && typeof logger.warn === 'function') {
      try { logger.warn(message, meta); } catch (_) {}
    }
  }

  function logInfo(message) {
    if (logger && typeof logger.info === 'function') {
      try { logger.info(message); } catch (_) {}
    }
  }

  return async function sampleDiskHealth() {
    const startedAt = now();
    if (cached && !cachedFailed && startedAt - cachedAt < successTtlMs) return cached;
    if (cached && cachedFailed && startedAt - cachedAt < failureRetryMs) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const snapshot = await collect();
        cached = snapshot;
        cachedAt = now();
        cachedFailed = false;
        if (consecutiveFailures > 0) logInfo('Disk health collection recovered');
        consecutiveFailures = 0;
        return snapshot;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures === 1 || consecutiveFailures % 10 === 0) {
          logWarn('Disk health collection failed', {
            error: error?.message || String(error),
            consecutiveFailures,
          });
        }
        cached = unavailableSnapshot();
        cachedAt = now();
        cachedFailed = true;
        return cached;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

module.exports = {
  normalizeSmartStatus,
  normalizeDisk,
  normalizeDiskLayout,
  collectDiskHealth,
  unavailableSnapshot,
  createDiskHealthSampler,
  SUCCESS_TTL_MS,
  FAILURE_RETRY_MS,
  MAX_RAW_JSON_CHARS,
};
