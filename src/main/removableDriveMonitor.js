'use strict';

// Removable-drive arrival/removal detection for issue #124.
//
// Polls systeminformation.blockDevices() on an interval and reports
// lifecycle transitions for confidently-identified removable MOUNTED
// volumes (canonical `X:\` roots). This module only detects; scan
// orchestration lives with the coordinator so detection stays testable
// without hardware (inject getBlockDevices) and free of scan concerns.
//
// Identity is the canonical mount root, tracked in memory only: no serial
// numbers, labels, or hardware identifiers are read or persisted.

const DEFAULT_POLL_INTERVAL_MS = 7000;
const MIN_POLL_INTERVAL_MS = 5000;
const MAX_POLL_INTERVAL_MS = 10000;
// Log every Nth consecutive enumeration failure so a permanently broken
// subsystem cannot flood the log at polling frequency.
const FAILURE_LOG_EVERY = 10;

const DRIVE_ROOT_RE = /^[A-Za-z]:\\?$/;

function canonicalMountRoot(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DRIVE_ROOT_RE.test(trimmed)) return null;
  return `${trimmed[0].toUpperCase()}:\\`;
}

function eligibleMount(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  // Strict boolean: only volumes the OS explicitly flags removable.
  if (entry.removable !== true) return null;
  return canonicalMountRoot(entry.mount);
}

function eligibleSet(devices) {
  const mounts = new Set();
  const list = Array.isArray(devices) ? devices : [];
  for (const entry of list) {
    const mount = eligibleMount(entry);
    if (mount) mounts.add(mount);
  }
  return mounts;
}

class RemovableDriveMonitor {
  constructor(options = {}) {
    this.getBlockDevices = typeof options.getBlockDevices === 'function'
      ? options.getBlockDevices
      : () => require('systeminformation').blockDevices();
    const interval = Number(options.pollIntervalMs);
    this.pollIntervalMs = Number.isFinite(interval)
      ? Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, Math.round(interval)))
      : DEFAULT_POLL_INTERVAL_MS;
    this.onArrival = typeof options.onArrival === 'function' ? options.onArrival : null;
    this.onRemoval = typeof options.onRemoval === 'function' ? options.onRemoval : null;
    this.logger = options.logger || null;
    this._known = new Set();
    this._seeded = false;
    this._timer = null;
    this._polling = false;
    this._stopped = false;
    this._consecutiveFailures = 0;
  }

  getKnownMounts() {
    return [...this._known];
  }

  isRunning() {
    return this._timer !== null;
  }

  start() {
    if (this._timer) return { running: true };
    this._stopped = false;
    // Seed synchronously when the provider allows it; the async path seeds
    // on the first poll. Either way the initial set emits no arrivals, even
    // if the first enumeration resolves after the interval already fired.
    try {
      const initial = this.getBlockDevices();
      if (initial && typeof initial.then === 'function') {
        initial.then(
          (devices) => { if (!this._stopped && !this._seeded) { this._known = eligibleSet(devices); this._seeded = true; } },
          () => {}
        );
      } else {
        this._known = eligibleSet(initial);
        this._seeded = true;
      }
    } catch (_) {}
    this._timer = setInterval(() => {
      this.pollNow().catch(() => {});
    }, this.pollIntervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    return { running: true };
  }

  stop() {
    this._stopped = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return { running: false };
  }

  // Re-reads eligibility for one mount right now (used to revalidate before
  // scanning). Never throws: failures resolve false (fail closed).
  async isCurrentlyEligible(mount) {
    const canonical = canonicalMountRoot(mount);
    if (!canonical) return false;
    try {
      const devices = await this.getBlockDevices();
      return eligibleSet(devices).has(canonical);
    } catch (_) {
      return false;
    }
  }

  async pollNow() {
    if (this._stopped || this._polling) return { stopped: this._stopped, skipped: this._polling };
    this._polling = true;
    try {
      const devices = await this.getBlockDevices();
      if (this._stopped) return { stopped: true };
      const current = eligibleSet(devices);
      this._consecutiveFailures = 0;
      if (!this._seeded) {
        // First successful enumeration wins the seed, however late it
        // arrives: pre-mounted drives are never reported as arrivals.
        this._seeded = true;
        this._known = current;
        return { stopped: false, seeded: true, arrived: [], removed: [] };
      }
      const arrived = [...current].filter((mount) => !this._known.has(mount));
      const removed = [...this._known].filter((mount) => !current.has(mount));
      this._known = current;
      for (const mount of arrived) {
        try { await this.onArrival?.(mount); } catch (_) {}
      }
      for (const mount of removed) {
        try { await this.onRemoval?.(mount); } catch (_) {}
      }
      return { stopped: false, arrived, removed };
    } catch (error) {
      // Preserve the previous snapshot: a failed enumeration must never
      // look like "all drives removed", or the recovery poll would fake
      // a re-arrival for every drive.
      this._consecutiveFailures += 1;
      if (this._consecutiveFailures === 1 || this._consecutiveFailures % FAILURE_LOG_EVERY === 0) {
        try {
          this.logger?.warn('Removable drive enumeration failed', {
            error: error?.message || String(error),
            consecutiveFailures: this._consecutiveFailures,
          });
        } catch (_) {}
      }
      return { stopped: false, failed: true };
    } finally {
      this._polling = false;
    }
  }
}

module.exports = {
  RemovableDriveMonitor,
  canonicalMountRoot,
  eligibleMount,
  eligibleSet,
  DEFAULT_POLL_INTERVAL_MS,
};
