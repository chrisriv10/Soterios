'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FolderWatcher = require('../src/security/FolderWatcher');

describe('FolderWatcher', () => {
  let tmp;
  let watcher;
  let scanned;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-fw-'));
    scanned = [];
    watcher = new FolderWatcher({
      watchDirs: [tmp],
      debounceMs: 50,
      clamEngine: { isReady: true },
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: {
        isScanning: false,
        async runScan(scanType, paths) {
          scanned.push({ scanType, paths });
          return { success: true, threatsFound: 0, threats: [] };
        },
        async runCustomScan(paths) {
          scanned.push({ scanType: 'custom', paths });
          return { success: true, threatsFound: 0, threats: [] };
        }
      }
    });
  });

  afterEach(() => {
    if (watcher) watcher.stop();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('starts and stops without throwing on missing dirs', () => {
    const missing = new FolderWatcher({
      watchDirs: [path.join(tmp, 'nope')],
      scanEngine: { async runCustomScan() { return {}; } }
    });
    const status = missing.start();
    assert.equal(status.running, true);
    assert.deepEqual(status.watched, []);
    missing.stop();
    assert.equal(missing.getStatus().running, false);
  });

  it('opens the native watcher with the canonical temp directory', () => {
    const canonicalTmp = typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(tmp)
      : fs.realpathSync(tmp);
    const nativeWatcher = new FolderWatcher({
      watchDirs: [tmp],
      scanEngine: { async runCustomScan() { return {}; } }
    });

    try {
      const status = nativeWatcher.start();
      assert.deepEqual(status.watched, [canonicalTmp]);
    } finally {
      nativeWatcher.stop();
    }
  });

  it('debounces and queues a folderwatch scan for new files', async () => {
    watcher.start();
    const filePath = path.join(tmp, 'payload.bin');
    fs.writeFileSync(filePath, 'hello');
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].scanType, 'folderwatch');
    assert.deepEqual(scanned[0].paths, [filePath]);
  });

  it('skips duplicate scans within the cooldown window', async () => {
    watcher.start();
    const filePath = path.join(tmp, 'once.bin');
    fs.writeFileSync(filePath, 'x');
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 120));
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(scanned.filter((entry) => entry.paths[0] === filePath).length, 1);
  });

  it('does not scan when ClamAV is unavailable', async () => {
    watcher.clamEngine = { isReady: false };
    watcher.start();
    const filePath = path.join(tmp, 'blocked.bin');
    fs.writeFileSync(filePath, 'x');
    watcher._enqueue(filePath);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(scanned.length, 0);
    assert.equal(watcher.getStatus().queued, 1);
  });

  it('uses the canonical directory for watching, status, and event paths', () => {
    const shortPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\soterios-fw-short';
    let watchedPath;
    let onEvent;
    const canonical = new FolderWatcher({
      watchDirs: [shortPath],
      resolveWatchPath(dir) {
        assert.equal(dir, shortPath);
        return tmp;
      },
      watchFactory(dir, _options, callback) {
        watchedPath = dir;
        onEvent = callback;
        return { on() { return this; }, close() {} };
      },
      scanEngine: { async runCustomScan() { return {}; } }
    });
    let scheduledPath;
    canonical._schedule = (filePath) => { scheduledPath = filePath; };

    const status = canonical.start();
    assert.equal(watchedPath, tmp);
    assert.deepEqual(status.watched, [tmp]);
    onEvent('rename', Buffer.from('payload.bin'));
    assert.equal(scheduledPath, path.join(tmp, 'payload.bin'));
    canonical.stop();
  });

  it('deduplicates configured aliases that resolve to the same directory', () => {
    let watchCalls = 0;
    const canonical = new FolderWatcher({
      watchDirs: ['short-alias', 'long-alias'],
      resolveWatchPath() { return tmp; },
      watchFactory() {
        watchCalls += 1;
        return { on() { return this; }, close() {} };
      },
      scanEngine: { async runCustomScan() { return {}; } }
    });
    const status = canonical.start();
    assert.equal(watchCalls, 1);
    assert.deepEqual(status.watched, [tmp]);
    canonical.stop();
  });
  it('bounds the scan queue and counts dropped jobs during a burst', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
      watcher.start();
      watcher.scanEngine.isScanning = true;

      for (let i = 0; i < 1000; i++) {
        const filePath = path.join(tmp, `burst-${i}.bin`);
        fs.writeFileSync(filePath, 'x');
        watcher._enqueue(filePath);
      }

      assert.equal(watcher.getStatus().queued, 256);
      assert.equal(watcher.getStatus().dropped, 744);
      // Nothing scanned while the engine reports busy.
      assert.equal(scanned.length, 0);
      // Every drop was reported through the structured warning.
      assert.equal(warnings.length, 744);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('expires old recent-scan entries', () => {
    const oldTime = Date.now() - 61_000;
    const recentTime = Date.now();

    watcher._scannedRecently.set(
      path.join(tmp, 'old.bin'),
      oldTime
    );

    watcher._scannedRecently.set(
      path.join(tmp, 'recent.bin'),
      recentTime
    );

    watcher._pruneRecentScans();

    assert.equal(
      watcher._scannedRecently.has(path.join(tmp, 'old.bin')),
      false
    );

    assert.equal(
      watcher._scannedRecently.has(path.join(tmp, 'recent.bin')),
      true
    );
  });

  it('skips a directory when its canonical path cannot be resolved', () => {
    let watchCalls = 0;
    const inaccessible = new FolderWatcher({
      watchDirs: ['C:\\inaccessible'],
      resolveWatchPath() { throw new Error('access denied'); },
      watchFactory() {
        watchCalls += 1;
        return { on() { return this; }, close() {} };
      },
      scanEngine: { async runCustomScan() { return {}; } }
    });
    const status = inaccessible.start();
    assert.equal(watchCalls, 0);
    assert.deepEqual(status.watched, []);
    inaccessible.stop();
  });

  it('creates exactly one cleanup timer across repeated starts', () => {
    watcher.start();
    const first = watcher._recentScanCleanupTimer;
    assert.ok(first, 'cleanup timer must exist after start');
    watcher.start();
    assert.strictEqual(watcher._recentScanCleanupTimer, first, 'second start must not duplicate the timer');
    watcher.stop();
  });

  it('clears the cleanup timer on stop and creates a fresh one on restart', () => {
    watcher.start();
    const first = watcher._recentScanCleanupTimer;
    assert.ok(first);
    watcher.stop();
    assert.equal(watcher._recentScanCleanupTimer, null);
    watcher.stop();
    assert.equal(watcher._recentScanCleanupTimer, null, 'double stop must not throw or resurrect');
    watcher.start();
    const second = watcher._recentScanCleanupTimer;
    assert.ok(second);
    assert.notStrictEqual(second, first, 'restart must create a fresh timer');
    watcher.stop();
  });

  it('clears recent-scan state on stop while keeping the dropped counter', () => {
    watcher._scannedRecently.set(path.join(tmp, 'a.bin'), Date.now());
    watcher._droppedQueueJobs = 7;
    watcher.start();
    watcher.stop();
    assert.equal(watcher._scannedRecently.size, 0, 'stop must bound dedup state');
    assert.equal(watcher.getStatus().dropped, 7, 'dropped counter stays cumulative');
    assert.equal(watcher.getStatus().queued, 0);
  });

  it('prunes expired entries while idle without new enqueues', async () => {
    const idleWatcher = new FolderWatcher({
      watchDirs: [tmp],
      debounceMs: 50,
      recentScanCleanupIntervalMs: 40,
      clamEngine: { isReady: true },
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: { async runCustomScan() { return {}; } }
    });
    try {
      idleWatcher._scannedRecently.set(path.join(tmp, 'stale.bin'), Date.now() - 61_000);
      idleWatcher._scannedRecently.set(path.join(tmp, 'fresh.bin'), Date.now());
      idleWatcher.start();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(idleWatcher._scannedRecently.has(path.join(tmp, 'stale.bin')), false);
      assert.equal(idleWatcher._scannedRecently.has(path.join(tmp, 'fresh.bin')), true);
    } finally {
      idleWatcher.stop();
    }
  });

  it('stopped watcher performs no idle pruning afterwards', async () => {
    const idleWatcher = new FolderWatcher({
      watchDirs: [tmp],
      recentScanCleanupIntervalMs: 40,
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: { async runCustomScan() { return {}; } }
    });
    idleWatcher.start();
    idleWatcher.stop();
    idleWatcher._scannedRecently.set(path.join(tmp, 'stale.bin'), Date.now() - 61_000);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(idleWatcher._scannedRecently.has(path.join(tmp, 'stale.bin')), true);
    assert.equal(idleWatcher._recentScanCleanupTimer, null);
  });

  it('logs queue-full drops as structured escaped args, never interpolated', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
      watcher.start();
      watcher.scanEngine.isScanning = true;
      // Quote/semicolon/dollar/backtick are legal in Windows filenames and
      // meaningful to shells; newlines are not creatable, so the invariant
      // is enforced structurally: fixed prefix plus JSON-encoded path.
      const tricky = path.join(tmp, `we'ird; $(x) & q.bin`);
      fs.writeFileSync(tricky, 'x');
      for (let i = 0; i < 256; i++) {
        const filePath = path.join(tmp, `fill-${i}.bin`);
        fs.writeFileSync(filePath, 'x');
        watcher._enqueue(filePath);
      }
      assert.equal(watcher.getStatus().queued, 256);
      watcher._enqueue(tricky);
      assert.equal(watcher.getStatus().dropped, 1);
      assert.equal(warnings.length, 1);
      const [prefix, encoded] = warnings[0];
      assert.equal(prefix, 'FolderWatcher scan queue full; dropping path:');
      assert.equal(JSON.parse(encoded), tricky);
      assert.ok(!prefix.includes(tricky), 'raw path must not appear in the fixed prefix');
    } finally {
      console.warn = originalWarn;
    }
  });
});
