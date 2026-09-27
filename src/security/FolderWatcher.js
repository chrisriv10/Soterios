'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_QUEUE_SIZE = 256;
const RECENT_SCAN_WINDOW_MS = 60_000;

/**
 * Watches high-risk directories and queues custom scans when files appear
 * or change. Uses Node's fs.watch (no extra dependency).
 */
class FolderWatcher {
  /**
   * @param {object} options
   * @param {import('../core/database')} [options.db]
   * @param {{ emit: Function }} [options.eventBus]
   * @param {{ runCustomScan: Function, runScan?: Function, isScanning?: boolean }} options.scanEngine
   * @param {{ isReady?: boolean }} [options.clamEngine]
   * @param {(title: string, body: string, level?: string) => void} [options.notify]
   * @param {string[]} [options.watchDirs]
   * @param {number} [options.debounceMs]
   * @param {(dir: string) => string} [options.resolveWatchPath]
   * @param {typeof fs.watch} [options.watchFactory]
   * @param {number} [options.recentScanCleanupIntervalMs] - How often idle
   *   pruning of `_scannedRecently` runs. Defaults to RECENT_SCAN_WINDOW_MS.
   *   Tests may pass a small value; production never changes this.
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.eventBus = options.eventBus || null;
    this.scanEngine = options.scanEngine;
    this.clamEngine = options.clamEngine || null;
    this.notify = options.notify || (() => {});
    this.watchFactory = options.watchFactory || fs.watch;
    this.resolveWatchPath = options.resolveWatchPath || ((dir) => {
      const realpath = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native
        : fs.realpathSync;
      return realpath(dir);
    });
    this.debounceMs = options.debounceMs || 1500;
    const cleanupIntervalMs = Number(options.recentScanCleanupIntervalMs);
    this.recentScanCleanupIntervalMs = Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0
      ? cleanupIntervalMs
      : RECENT_SCAN_WINDOW_MS;
    this.watchDirs = options.watchDirs || FolderWatcher.defaultWatchDirs();
    this._watchers = new Map();
    this._pending = new Map();
    this._queue = [];
    this._draining = false;
    this._running = false;
    this._scannedRecently = new Map();
    this._droppedQueueJobs = 0;
    this._recentScanCleanupTimer = null;
    // Bounded overflow recovery: when the per-file queue is full, affected
    // WATCH ROOTS (never individual paths) are recorded here so a coalesced
    // recovery scan can cover them after the normal queue drains. Bounded by
    // active watch-directory count, not by file-event count.
    this._overflowRoots = new Set();
    // Lifecycle generation (O(1) scalar): incremented on every real
    // stop/start transition. Async drain/recovery passes capture the
    // generation they belong to and must not write pending work (queue,
    // overflow roots) after it changes, so an in-flight result can never
    // repopulate state cleared by stop() or leak into a restarted watcher.
    this._lifecycleGeneration = 0;
  }

  static defaultWatchDirs() {
    const home = os.homedir();
    const windir = process.env.WINDIR || 'C:\\Windows';
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      path.join(home, 'Downloads'),
      process.env.TEMP || process.env.TMP || os.tmpdir(),
      path.join(windir, 'Temp'),
      path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    ];
  }

  getStatus() {
    return {
      running: this._running,
      watched: [...this._watchers.keys()],
      queued: this._queue.length,
      dropped: this._droppedQueueJobs,
      overflowPending: this._overflowRoots.size
    };
  }

  start() {
    if (this._running) return this.getStatus();
    this._running = true;
    // A real lifecycle transition: invalidate every in-flight async pass
    // from the previous generation. Idempotent restarts return above and
    // never manufacture a new generation.
    this._lifecycleGeneration += 1;
    for (const dir of this.watchDirs) {
      this._watchDir(dir);
    }
    // One lifecycle-managed cleanup timer: `_pruneRecentScans()` otherwise
    // runs only from `_enqueue()`, so expired entries would linger forever
    // once the watcher goes idle. The same tick retries pending overflow
    // recovery (failed/preempted generations) without a second timer;
    // `_drain()` re-entry is guarded. Guarded against duplicate starts;
    // cleared in stop(). Unref'd so it can never keep the process alive.
    if (!this._recentScanCleanupTimer) {
      this._recentScanCleanupTimer = setInterval(() => {
        this._pruneRecentScans();
        // Wake EITHER bounded pending kind. A generation-B enqueue can call
        // _drain() while a stale generation-A pass still owns the single
        // drain guard; once generation A releases it, this tick provides the
        // bounded later trigger so generation-B work is never stranded.
        if (this._running && (this._queue.length || this._overflowRoots.size)) this._drain();
      }, this.recentScanCleanupIntervalMs);
      if (typeof this._recentScanCleanupTimer.unref === 'function') {
        this._recentScanCleanupTimer.unref();
      }
    }
    return this.getStatus();
  }

  stop() {
    this._running = false;
    // Invalidate the current lifecycle BEFORE clearing: every in-flight
    // async pass captured the old generation and must discard its outcome
    // instead of restoring queue/overflow state into a stopped or
    // restarted watcher.
    this._lifecycleGeneration += 1;
    for (const [, watcher] of this._watchers) {
      try { watcher.close(); } catch (_) {}
    }
    this._watchers.clear();
    for (const timer of this._pending.values()) clearTimeout(timer);
    this._pending.clear();
    this._queue = [];
    if (this._recentScanCleanupTimer) {
      clearInterval(this._recentScanCleanupTimer);
      this._recentScanCleanupTimer = null;
    }
    // A stopped watcher restarts without history: drop dedup state so it
    // cannot grow across stop/start cycles. The dropped-job counter stays
    // cumulative for the process lifetime (see getStatus()).
    this._scannedRecently.clear();
    // Overflow recovery belongs to a running watcher only; a restart
    // re-derives it from fresh events. Never restart work from here.
    this._overflowRoots.clear();
    return this.getStatus();
  }

  _watchDir(dir) {
    try {
      const watchDir = this.resolveWatchPath(dir);
      if (!watchDir || !fs.existsSync(watchDir)) return;
      if (this._watchers.has(watchDir)) return;
      const watcher = this.watchFactory(watchDir, { persistent: false }, (_eventType, filename) => {
        if (!filename || !this._running) return;
        const relativePath = Buffer.isBuffer(filename) ? filename.toString('utf8') : String(filename);
        if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return;
        this._schedule(path.join(watchDir, relativePath));
      });
      watcher.on('error', () => {
        try { watcher.close(); } catch (_) {}
        this._watchers.delete(watchDir);
      });
      this._watchers.set(watchDir, watcher);
    } catch (_) {
      /* missing or inaccessible directory is fine */
    }
  }

  _schedule(filePath) {
    const existing = this._pending.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this._pending.delete(filePath);
      this._enqueue(filePath);
    }, this.debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
    this._pending.set(filePath, timer);
  }

  _pruneRecentScans(now = Date.now()) {
    for (const [filePath, timestamp] of this._scannedRecently) {
      if (now - timestamp >= RECENT_SCAN_WINDOW_MS) {
        this._scannedRecently.delete(filePath);
      }
    }
  }

  // Map an overflowed file to the canonical ACTIVE watch root containing it.
  // Path-aware containment (never a startsWith prefix check, so C:\Temp2 is
  // not mistaken for C:\Temp). A realpath retry covers alias forms that are
  // textually different but identical on disk (8.3 short names, junctions,
  // case variants) — observed on CI tmp dirs. Returns null when no active
  // root owns the path; callers then fall back to per-path accounting
  // without scanning an arbitrary parent directory.
  _ownerWatchRoot(filePath) {
    if (typeof filePath !== 'string' || !filePath) return null;
    const direct = this._matchWatchRoot(filePath);
    if (direct) return direct;
    try {
      const realpath = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native
        : fs.realpathSync;
      const resolved = realpath(filePath);
      if (typeof resolved === 'string' && resolved !== filePath) {
        return this._matchWatchRoot(resolved);
      }
    } catch (_) {
      // Unresolvable (vanished/odd) path: not attributable to any root.
    }
    return null;
  }

  _matchWatchRoot(filePath) {
    const lowerFile = filePath.toLowerCase();
    for (const root of this._watchers.keys()) {
      if (typeof root !== 'string' || !root) continue;
      const lowerRoot = root.toLowerCase();
      if (lowerFile === lowerRoot) return root;
      const prefix = lowerRoot.endsWith(path.sep) ? lowerRoot : lowerRoot + path.sep;
      if (lowerFile.startsWith(prefix)) return root;
    }
    return null;
  }

  _enqueue(filePath) {
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) return;
    } catch (_) {
      return;
    }

    const now = Date.now();
    this._pruneRecentScans(now);

    const last = this._scannedRecently.get(filePath) || 0;
    if (now - last < RECENT_SCAN_WINDOW_MS) return;

    if (this._queue.includes(filePath)) return;

    if (this._queue.length >= MAX_QUEUE_SIZE) {
      this._droppedQueueJobs++;
      // Bounded coalescing: record only the owning watched root so a later
      // recovery scan covers the overflow without retaining paths. One log
      // line per newly-pending root; repeats for an already-pending root
      // stay silent. Never interpolate the raw path into a log string.
      const owner = this._ownerWatchRoot(filePath);
      if (owner && !this._overflowRoots.has(owner)) {
        this._overflowRoots.add(owner);
        console.warn('FolderWatcher scan queue full; coalescing overflow into root recovery scan for:', JSON.stringify(owner));
      } else if (!owner) {
        console.warn('FolderWatcher scan queue full; dropping path:', JSON.stringify(filePath));
      }
      return;
    }

    this._queue.push(filePath);
    this._drain();
  }

  async _drain() {
    if (this._draining) return;
    this._draining = true;
    // Lifecycle generation owned by this pass. Post-await audit: every
    // await below that precedes a watcher-state write rechecks it.
    // - per-file scan await: stale outcome breaks BEFORE _restorePreemptedFile
    //   (queue/overflow write), BEFORE the explicit-abort queue/overflow
    //   clear, and before result handling. A genuinely completed scan's
    //   threat findings have no watcher-state writes and still surface.
    // - _recoverOverflow() await: the callee guards its own snapshot
    //   restoration and returns 'stale'; this caller breaks on it.
    // - 500ms scheduling waits: no state writes follow; the loop-top
    //   condition rechecks the generation.
    const generation = this._lifecycleGeneration;
    try {
      while (this._running && this._lifecycleGeneration === generation && (this._queue.length || this._overflowRoots.size)) {
        if (this.clamEngine && !this.clamEngine.isReady) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        // Only wait if a user scan is in progress - folder watch should not block user scans.
        // The takeover-pending flag is included so no background scan can
        // start in the handoff gap before userScan.isScanning flips true.
        if (this._foregroundBusy()) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (this.scanEngine && this.scanEngine.isFolderWatchScanning) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (this._queue.length) {
          const filePath = this._queue.shift();
          this._scannedRecently.set(filePath, Date.now());
          try {
            const result = typeof this.scanEngine.runScan === 'function'
              ? await this.scanEngine.runScan('folderwatch', [filePath], 'Folder watch scan starting...')
              : await this.scanEngine.runCustomScan([filePath]);
            // Old lifecycle (stop, or stop/start since this scan began):
            // discard the outcome entirely. It must neither restore work
            // into a stopped watcher nor clear/repopulate a new generation.
            if (this._lifecycleGeneration !== generation) break;
            if (result && (result.error || result.canceled)) {
              if (result.canceled) {
                if (this._classifyCancellation(result) === 'preempted') {
                  // Foreground takeover, proven or inferred: preserve bounded
                  // pending work (including this file's coverage) and let the
                  // loop wait out the user scan via the guards above, then
                  // resume automatically. Never hot-loops: every path below
                  // either waits or exits the loop.
                  this._restorePreemptedFile(filePath);
                  continue;
                }
                // Explicit background abort (proven or legacy default): drop
                // the remaining queue so it can't immediately restart.
                this._queue = [];
                this._overflowRoots.clear();
                break;
              }
              continue;
            }
            const threats = (result && result.threatsFound) || 0;
            if (threats > 0) {
              const msg = `Folder watch found ${threats} threat(s) in ${filePath}`;
              if (this.db) this.db.addAlert('danger', msg);
              if (this.eventBus) this.eventBus.emit('folderwatch:threat', { filePath, result });
              this.notify('Folder watch alert', msg, 'danger');
            }
          } catch (_) {
            /* skip individual failures */
          }
          continue;
        }
        // Normal queue drained with overflow pending: one coalesced recovery
        // scan. A preempted recovery continues the loop (the guards above
        // wait out the user scan, then retry automatically); failed or
        // aborted recoveries stop this pass and rely on later triggers.
        // Never hot-loops here: every outcome either waits or exits.
        const outcome = await this._recoverOverflow();
        if (outcome === 'stale') break;
        if (outcome === 'preempted') continue;
        if (outcome !== 'recovered') break;
      }
    } finally {
      this._draining = false;
    }
  }

  // Foreground ownership for scheduling: true while a user scan is active
  // OR a user scan has claimed takeover priority but is still waiting for
  // the folder-watch scan to release. Missing getters (older engines,
  // test doubles) read as falsy, preserving legacy behavior. Never true
  // for folderwatch-busy alone: that has its own separate guard.
  _foregroundBusy() {
    try {
      if (this.scanEngine && this.scanEngine.isScanning) return true;
      if (this.scanEngine && this.scanEngine.isUserScanTakeoverPending) return true;
    } catch (_) {}
    return false;
  }

  // Classify a canceled scan result for FolderWatcher state handling.
  // Returns 'preempted' when bounded pending work must be preserved and
  // 'aborted' when it must be stopped. The explicit ScanEngine reason is
  // authoritative: timing inference alone cannot distinguish a user-scan
  // takeover (which clears folderWatchScan.isScanning BEFORE userScan
  // becomes active) from an explicit background abort. Unknown reasons fall
  // back to the live-state check, and unknown-but-idle keeps the legacy
  // explicit-abort behavior rather than inventing preemption.
  _classifyCancellation(result) {
    if (result && result.cancellationReason === 'user-preempt') return 'preempted';
    if (result && result.cancellationReason === 'explicit-abort') return 'aborted';
    return this._foregroundBusy() ? 'preempted' : 'aborted';
  }

  // Restore coverage for a normal-queue file whose scan was preempted. The
  // file was already shifted off the queue; pin its owning root for
  // coalesced recovery (bounded by watch roots) so it is covered without
  // requeueing paths. Only when no root owns it, requeue boundedly; only
  // when even that is impossible, drop the recent marker so a future event
  // can retry, and count the loss honestly. The marker is otherwise kept so
  // the covered file is not scanned twice.
  _restorePreemptedFile(filePath) {
    const owner = this._ownerWatchRoot(filePath);
    if (owner) {
      this._overflowRoots.add(owner);
      return;
    }
    if (this._queue.length < MAX_QUEUE_SIZE && !this._queue.includes(filePath)) {
      this._queue.unshift(filePath);
      return;
    }
    this._scannedRecently.delete(filePath);
    this._droppedQueueJobs++;
  }

  // Scan the pending overflow roots as one coalesced background folderwatch
  // scan. Generation-safe: snapshot roots are removed BEFORE the scan, so
  // overflow arriving mid-scan re-adds and survives completion. Returns
  // 'recovered', 'preempted' (restored: caller waits and retries),
  // 'deferred' (failed: caller stops, future triggers retry), 'aborted', or
  // 'stale' (lifecycle changed mid-scan: nothing restored, caller stops).
  // Lifecycle audit: the snapshot-restore writes in the canceled and error
  // paths below are skipped on a stale generation; the success path's
  // threat surfacing writes no watcher state and still runs.
  async _recoverOverflow() {
    // Equals the caller's captured generation (no await can interleave
    // between the caller's check and this line), so either capture agrees.
    const generation = this._lifecycleGeneration;
    const snapshot = [...this._overflowRoots];
    if (!snapshot.length) return 'recovered';
    for (const root of snapshot) this._overflowRoots.delete(root);
    let result;
    try {
      result = typeof this.scanEngine.runScan === 'function'
        ? await this.scanEngine.runScan('folderwatch', snapshot, 'Folder watch overflow recovery scan starting...')
        : await this.scanEngine.runCustomScan(snapshot);
    } catch (_) {
      result = { error: 'overflow recovery scan failed' };
    }
    // Old lifecycle: never restore or defer snapshot roots into a stopped
    // watcher or a new generation.
    if (this._lifecycleGeneration !== generation) return 'stale';
    if (result && result.canceled) {
      if (this._classifyCancellation(result) === 'preempted') {
        // Preempted by a user scan: restore for the caller's automatic
        // retry once the user scan finishes.
        for (const root of snapshot) this._overflowRoots.add(root);
        return 'preempted';
      }
      // Explicit background abort with nothing else running: honor the
      // user's intent, do not restart this work automatically.
      return 'aborted';
    }
    if (result && result.error) {
      // Genuine failure: keep pending for a later maintenance/drain
      // trigger. The caller breaks instead of retrying immediately.
      for (const root of snapshot) this._overflowRoots.add(root);
      console.warn('FolderWatcher overflow recovery scan failed; will retry on a later trigger.');
      return 'deferred';
    }
    const threats = (result && result.threatsFound) || 0;
    if (threats > 0) {
      const msg = `Folder watch overflow recovery found ${threats} threat(s).`;
      if (this.db) this.db.addAlert('danger', msg);
      if (this.eventBus) {
        this.eventBus.emit('folderwatch:threat', {
          filePaths: snapshot,
          result,
          overflowRecovery: true
        });
      }
      this.notify('Folder watch alert', msg, 'danger');
    }
    return 'recovered';
  }
}

module.exports = FolderWatcher;
