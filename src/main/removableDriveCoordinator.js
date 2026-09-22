'use strict';

// Removable-drive scan coordination for issue #124.
//
// Owns everything the detector must not: user prompts, the bounded FIFO
// of pending arrivals, the bounded scan queue, and entry into the EXISTING
// custom-scan pipeline (ScanEngine.runCustomScan). No second ClamAV runner,
// no special quarantine/report path, no renderer-provided paths: the main
// process revalidates every mount against live enumeration before scanning.

const { RemovableDriveMonitor, canonicalMountRoot } = require('./removableDriveMonitor');

const SETTING_KEY = 'scan.autoScanRemovableDrives';
const MAX_QUEUE_SIZE = 8;
const MAX_PENDING_SIZE = 8;

class RemovableDriveCoordinator {
  constructor(options = {}) {
    this.db = options.db || null;
    this.scanEngine = options.scanEngine || null;
    this.eventBus = options.eventBus || null;
    this.showNotification = typeof options.showNotification === 'function' ? options.showNotification : null;
    this.t = typeof options.t === 'function' ? options.t : ((key) => key);
    this.logger = options.logger || null;
    this.monitor = options.monitor || new RemovableDriveMonitor({
      getBlockDevices: options.getBlockDevices,
      pollIntervalMs: options.pollIntervalMs,
      onArrival: (mount) => this._onArrival(mount),
      onRemoval: (mount) => this._onRemoval(mount),
      logger: this.logger,
    });
    this._queue = new Map();
    this._pendingQueue = [];
    this._activeTarget = null;
    this._unsubscribeComplete = null;
    this._disposed = false;
  }

  autoScanEnabled() {
    try {
      // Strict equality: missing, malformed, or unreadable settings must
      // never silently enable automatic scanning.
      return this.db?.getSetting?.(SETTING_KEY, false) === true;
    } catch (_) {
      return false;
    }
  }

  getStatus() {
    return {
      running: this.monitor.isRunning(),
      autoScan: this.autoScanEnabled(),
      pending: this._pendingQueue.length ? { ...this._pendingQueue[0] } : null,
      pendingCount: this._pendingQueue.length,
      queued: [...this._queue.keys()],
      activeTarget: this._activeTarget,
    };
  }

  start() {
    if (this._disposed) return { running: false };
    this.monitor.start();
    if (this.eventBus && !this._unsubscribeComplete) {
      this._unsubscribeComplete = this.eventBus.on('scan:complete', () => {
        this._onScanSettled().catch(() => {});
      });
    }
    return { running: true };
  }

  dispose() {
    this._disposed = true;
    try { this.monitor.stop(); } catch (_) {}
    if (this._unsubscribeComplete) {
      try { this._unsubscribeComplete(); } catch (_) {}
      this._unsubscribeComplete = null;
    }
    this._queue.clear();
    this._pendingQueue = [];
    this._activeTarget = null;
  }

  _pushPending(mount) {
    // Bounded FIFO: every prompt-mode arrival stays actionable in order, so
    // no arrival is silently lost when several drives appear in succession.
    // The toast action carries no mount (renderer must never supply paths),
    // so Scan always consumes the oldest pending arrival.
    if (!this._pendingQueue.some((entry) => entry.mount === mount)) {
      if (this._pendingQueue.length >= MAX_PENDING_SIZE) {
        try { this.logger?.warn('Removable drive pending queue is full; dropping oldest arrival', { mount }); } catch (_) {}
        this._pendingQueue.shift();
      }
      this._pendingQueue.push({ mount, arrivedAt: new Date().toISOString() });
    }
  }

  _dropPending(mount) {
    const before = this._pendingQueue.length;
    this._pendingQueue = this._pendingQueue.filter((entry) => entry.mount !== mount);
    return this._pendingQueue.length !== before;
  }

  async _onArrival(mount) {
    if (this._disposed) return;
    if (this.autoScanEnabled()) {
      await this._requestScan(mount, { automatic: true });
      return;
    }
    this._pushPending(mount);
    try {
      this.showNotification?.(
        this.t('removableDrive.promptTitle', { drive: mount }),
        this.t('removableDrive.promptBody', { drive: mount }),
        'info',
        null,
        'removable-scan'
      );
    } catch (_) {}
  }

  _onRemoval(mount) {
    this._queue.delete(mount);
    this._dropPending(mount);
    if (this._activeTarget === mount) {
      this._activeTarget = null;
      // Cancel only OUR scan: the active user scan is this removable scan
      // (manual scans are never preempted, and nothing else can start one
      // while it runs). Unrelated scans are never touched here.
      try {
        const result = this.scanEngine?.abortScan?.();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (_) {}
      try {
        this.showNotification?.(
          this.t('removableDrive.removedTitle', { drive: mount }),
          this.t('removableDrive.removedBody', { drive: mount }),
          'warn'
        );
      } catch (_) {}
    }
  }

  // Narrow IPC entry for the notification's Scan action. Takes no path: the
  // mount comes from main-process pending state and is revalidated live.
  async scanPending() {
    if (this._disposed) return { ok: false, error: 'Removable drive scanning is unavailable.' };
    const mount = this._pendingQueue.length ? this._pendingQueue[0].mount : null;
    if (!mount) return { ok: false, error: this.t('removableDrive.noPendingDrive') };
    return this._requestScan(mount, { automatic: false });
  }

  async _requestScan(mount, { automatic } = {}) {
    const canonical = canonicalMountRoot(mount);
    if (!canonical) return { ok: false, error: this.t('removableDrive.unavailable') };
    if (!(await this._revalidate(canonical))) {
      this._dropPending(canonical);
      this._queue.delete(canonical);
      return { ok: false, error: this.t('removableDrive.unavailable') };
    }
    if (this._isBusy()) {
      if (!this._queue.has(canonical)) {
        if (this._queue.size >= MAX_QUEUE_SIZE) {
          try { this.logger?.warn('Removable drive scan queue is full; ignoring arrival', { mount: canonical }); } catch (_) {}
          return { ok: false, error: this.t('removableDrive.queueFull') };
        }
        this._queue.set(canonical, { requestedAt: new Date().toISOString(), automatic: !!automatic });
      }
      return { ok: true, queued: true };
    }
    return this._startScan(canonical);
  }

  async _startScan(mount) {
    if (!this.scanEngine || typeof this.scanEngine.runCustomScan !== 'function') {
      return { ok: false, error: this.t('removableDrive.unavailable') };
    }
    // A concurrent start for another mount must not steal ownership: if this
    // call does not actually start a scan, the previous target is restored
    // so a later removal still cancels the scan that is really running.
    const previousTarget = this._activeTarget;
    this._activeTarget = mount;
    this._dropPending(mount);
    this._queue.delete(mount);
    let result;
    try {
      result = await this.scanEngine.runCustomScan([mount]);
    } catch (error) {
      if (this._activeTarget === mount) this._activeTarget = previousTarget;
      return { ok: false, error: error?.message || String(error) };
    }
    if (result?.error) {
      if (this._activeTarget === mount) this._activeTarget = previousTarget;
      // Lost a start race after revalidation: fall back to the queue rather
      // than failing an eligible drive.
      if (/already in progress/i.test(String(result.error))) {
        return this._requestScan(mount, { automatic: false });
      }
      return { ok: false, error: String(result.error) };
    }
    return { ok: true };
  }

  async _onScanSettled() {
    if (this._disposed) return;
    this._activeTarget = null;
    if (!this._queue.size) return;
    const next = [...this._queue.keys()][0];
    if (!(await this._revalidate(next))) {
      this._queue.delete(next);
      return this._onScanSettled();
    }
    if (this._isBusy()) return;
    // A failed start must not stall the rest of the queue: nothing is
    // scanning, so no future completion will drain it. Continue only when
    // the failed entry actually left the queue (each step then removes one
    // entry and this always terminates); a re-enqueued entry waits for the
    // scan that is really running.
    const result = await this._startScan(next);
    if (!result?.ok && !this._queue.has(next) && !this._isBusy()) {
      return this._onScanSettled();
    }
    return result;
  }

  async _revalidate(mount) {
    try {
      return await this.monitor.isCurrentlyEligible(mount);
    } catch (_) {
      return false;
    }
  }

  _isBusy() {
    try {
      return !!this.scanEngine?.isScanning;
    } catch (_) {
      return true;
    }
  }
}

module.exports = {
  RemovableDriveCoordinator,
  REMOVABLE_DRIVE_SETTING_KEY: SETTING_KEY,
  REMOVABLE_DRIVE_QUEUE_LIMIT: MAX_QUEUE_SIZE,
};
