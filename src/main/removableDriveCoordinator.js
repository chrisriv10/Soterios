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
      this._unsubscribeComplete = this.eventBus.on('scan:complete', (completion) => {
        this._onScanSettled(completion).catch(() => {});
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

  _notifyPrompt(mount) {
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

  async _onArrival(mount) {
    if (this._disposed) return;
    if (this.autoScanEnabled()) {
      const result = await this._requestScan(mount, { automatic: true });
      // A failed automatic scan must stay actionable: downgrade to prompt
      // mode so the user can retry from the notification instead of the
      // arrival disappearing silently. Queued results are already tracked;
      // revalidate so a vanished drive gains no stale pending entry. Recheck
      // disposal: a quit during the awaits must not create a dead prompt.
      if (result && !result.ok && !result.queued && (await this._revalidate(mount))) {
        if (this._disposed) return;
        this._pushPending(mount);
        this._notifyPrompt(mount);
      }
      return;
    }
    this._pushPending(mount);
    this._notifyPrompt(mount);
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
    const result = await this._requestScan(mount, { automatic: false });
    // A failed non-queued retry must not consume the user's only Scan
    // action: _startScan drops the pending entry before the engine runs, so
    // restore it to keep the drive retryable. Sequential checks: disposal
    // during the fallback revalidation must not resurrect pending state.
    // The caller already surfaces the failure itself, so no new toast here.
    if (result && !result.ok && !result.queued && !this._disposed) {
      const stillEligible = await this._revalidate(mount);
      if (!this._disposed && stillEligible) {
        this._pushPending(mount);
      }
    }
    return result;
  }

  async _requestScan(mount, { automatic } = {}) {
    // Entry guard: reject new requests after disposal, including the
    // "already in progress" recursive retry path below.
    if (this._disposed) {
      return { ok: false, error: this.t('removableDrive.unavailable') };
    }
    const canonical = canonicalMountRoot(mount);
    if (!canonical) return { ok: false, error: this.t('removableDrive.unavailable') };
    // Post-await guard: disposal during live eligibility enumeration must
    // leave queue/pending state untouched — the continuation goes inert.
    const eligible = await this._revalidate(canonical);
    if (this._disposed) {
      return { ok: false, error: this.t('removableDrive.unavailable') };
    }
    if (!eligible) {
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
    // Defense in depth: caller-side disposal checks own the sequencing, but
    // a scan must never begin on a disposed coordinator even if a caller
    // races disposal.
    if (this._disposed) {
      return { ok: false, error: this.t('removableDrive.unavailable') };
    }
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

  // A scan:complete event settles removable ownership only when it belongs
  // to the tracked scan. ScanEngine broadcasts completions for every scan
  // type (folder-watch, manual, definitions updates), so an unfiltered
  // listener would clear _activeTarget mid-scan and break removal-abort.
  // While a removable target is active the rule fails CLOSED: only a
  // custom scan whose single target canonicalizes to the active mount
  // settles ownership. Malformed, foreign, or payload-less completions are
  // ignored. With no active target, any completion may wake queued work.
  _completionSettlesActive(completion) {
    if (this._activeTarget == null) return true;
    if (!completion || typeof completion !== 'object') return false;
    if (completion.scanType !== 'custom') return false;
    const targets = Array.isArray(completion.targetPaths) ? completion.targetPaths : null;
    if (!targets || targets.length !== 1) return false;
    return canonicalMountRoot(targets[0]) === this._activeTarget;
  }

  async _onScanSettled(completion) {
    if (this._disposed) return;
    if (!this._completionSettlesActive(completion)) return;
    this._activeTarget = null;
    if (!this._queue.size) return;
    const next = [...this._queue.keys()][0];
    // Disposal during any await below must stop the continuation: no scan
    // may start and no prompt may appear after dispose().
    const eligible = await this._revalidate(next);
    if (this._disposed) return;
    if (!eligible) {
      this._queue.delete(next);
      return this._onScanSettled();
    }
    if (this._isBusy()) return;
    // A failed start must not stall the rest of the queue: nothing is
    // scanning, so no future completion will drain it. Continue only when
    // the failed entry actually left the queue (each step then removes one
    // entry and this always terminates); a re-enqueued entry waits for the
    // scan that is really running. A failed automatic (or pending-backed)
    // entry stays actionable through the same revalidated prompt fallback
    // as a failed direct automatic scan — never silently dropped.
    const queuedEntry = this._queue.get(next);
    const hadPending = this._pendingQueue.some((entry) => entry.mount === next);
    const result = await this._startScan(next);
    if (this._disposed) return;
    if (!result?.ok && !this._queue.has(next) && !this._isBusy()) {
      const stillEligible = await this._revalidate(next);
      if (this._disposed) return;
      if ((queuedEntry?.automatic || hadPending) && stillEligible) {
        this._pushPending(next);
        this._notifyPrompt(next);
      }
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
