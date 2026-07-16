'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Watches high-risk directories and queues custom scans when files appear
 * or change. Uses Node's fs.watch (no extra dependency).
 */
class FolderWatcher {
  /**
   * @param {object} options
   * @param {import('../core/database')} [options.db]
   * @param {{ emit: Function }} [options.eventBus]
   * @param {{ runCustomScan: Function, isScanning?: boolean }} options.scanEngine
   * @param {(title: string, body: string, level?: string) => void} [options.notify]
   * @param {string[]} [options.watchDirs]
   * @param {number} [options.debounceMs]
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.eventBus = options.eventBus || null;
    this.scanEngine = options.scanEngine;
    this.notify = options.notify || (() => {});
    this.debounceMs = options.debounceMs || 1500;
    this.watchDirs = options.watchDirs || FolderWatcher.defaultWatchDirs();
    this._watchers = new Map();
    this._pending = new Map();
    this._queue = [];
    this._draining = false;
    this._running = false;
    this._scannedRecently = new Map();
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
      queued: this._queue.length
    };
  }

  start() {
    if (this._running) return this.getStatus();
    this._running = true;
    for (const dir of this.watchDirs) {
      this._watchDir(dir);
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
    return this.getStatus();
  }

  _watchDir(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      if (this._watchers.has(dir)) return;
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (!filename || !this._running) return;
        const fullPath = path.join(dir, filename.toString());
        this._schedule(fullPath);
      });
      watcher.on('error', () => {
        try { watcher.close(); } catch (_) {}
        this._watchers.delete(dir);
      });
      this._watchers.set(dir, watcher);
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

  _enqueue(filePath) {
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) return;
    } catch (_) {
      return;
    }
    const last = this._scannedRecently.get(filePath) || 0;
    if (Date.now() - last < 60_000) return;
    if (this._queue.includes(filePath)) return;
    this._queue.push(filePath);
    this._drain();
  }

  async _drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this._queue.length && this._running) {
        if (this.scanEngine && this.scanEngine.isScanning) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const filePath = this._queue.shift();
        this._scannedRecently.set(filePath, Date.now());
        try {
          let result;
          if(typeof this.scanEngine.runScan === 'function') {
            result = await this.scanEngine.runScan('folderwatch', [filePath], 'Folder watch scan starting...');
          } else {
            result = await this.scanEngine.runCustomScan([filePath]);
          }

          if (result && result.error) continue;
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
      }
    } finally {
      this._draining = false;
    }
  }
}

module.exports = FolderWatcher;
