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
        if (this._running && this._overflowRoots.size) this._drain();
      }, this.recentScanCleanupIntervalMs);
      if (typeof this._recentScanCleanupTimer.unref === 'function') {
        this._recentScanCleanupTimer.unref();
      }
    }
    return this.getStatus();
  }

  stop() {
    this._running = false;
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
    try {
      while (this._running && (this._queue.length || this._overflowRoots.size)) {
        if (this.clamEngine && !this.clamEngine.isReady) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        // Only wait if a user scan is in progress - folder watch should not block user scans
        if (this.scanEngine && this.scanEngine.isScanning) {
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
            if (result && (result.error || result.canceled)) {
              if (result.canceled) {
                // The background scan was canceled (e.g. via scan:abort); drop
                // the remaining queue so it can't immediately restart.
                this._queue = [];
                if (!this._userScanActive()) this._overflowRoots.clear();
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
        // scan. A non-recovered outcome stops this pass; later events or the
        // maintenance tick trigger the next attempt. Never hot-loops here.
        const outcome = await this._recoverOverflow();
        if (outcome !== 'recovered') break;
      }
    } finally {
      this._draining = false;
    }
  }

  _userScanActive() {
    try {
      return !!(this.scanEngine && this.scanEngine.isScanning);
    } catch (_) {
      return false;
    }
  }

  // Scan the pending overflow roots as one coalesced background folderwatch
  // scan. Generation-safe: snapshot roots are removed BEFORE the scan, so
  // overflow arriving mid-scan re-adds and survives completion. Returns
  // 'recovered', 'deferred' (failed/preempted, still pending), or 'aborted'.
  async _recoverOverflow() {
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
    if (result && result.canceled) {
      if (this._userScanActive()) {
        // Preempted by a user scan: restore for a later retry.
        for (const root of snapshot) this._overflowRoots.add(root);
        return 'deferred';
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
