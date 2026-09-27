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
      // Overflow coalesces to the single affected root: one warning for the
      // newly-pending root, silence for repeats, counter authoritative.
      assert.equal(watcher.getStatus().overflowPending, 1);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][0], 'FolderWatcher scan queue full; coalescing overflow into root recovery scan for:');
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
      // Owned-root overflow coalesces: the warning names the root, encoded.
      const [prefix, encoded] = warnings[0];
      assert.equal(prefix, 'FolderWatcher scan queue full; coalescing overflow into root recovery scan for:');
      const canonicalTmp = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native(tmp)
        : fs.realpathSync(tmp);
      assert.equal(JSON.parse(encoded), canonicalTmp);
      assert.ok(!prefix.includes(tricky), 'raw path must not appear in the fixed prefix');
      // A repeat overflow for the same pending root stays silent.
      const tricky2 = path.join(tmp, 'second.bin');
      fs.writeFileSync(tricky2, 'x');
      watcher._enqueue(tricky2);
      assert.equal(watcher.getStatus().dropped, 2);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('logs per-path structured warning when no watch root owns the file', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
      // Never started: no active watch roots, so ownership is unknown.
      watcher.scanEngine.isScanning = true;
      for (let i = 0; i < 257; i++) {
        const filePath = path.join(tmp, `orphan-${i}.bin`);
        fs.writeFileSync(filePath, 'x');
        watcher._enqueue(filePath);
      }
      assert.equal(watcher.getStatus().queued, 256);
      assert.equal(watcher.getStatus().dropped, 1);
      assert.equal(watcher.getStatus().overflowPending, 0);
      assert.equal(warnings.length, 1);
      const [prefix, encoded] = warnings[0];
      assert.equal(prefix, 'FolderWatcher scan queue full; dropping path:');
      assert.equal(JSON.parse(encoded), path.join(tmp, 'orphan-256.bin'));
    } finally {
      console.warn = originalWarn;
    }
  });

  it('maps overflow files to owning roots without prefix confusion', () => {
    const fakeRoots = new FolderWatcher({
      watchDirs: [],
      scanEngine: { async runCustomScan() { return {}; } }
    });
    fakeRoots._watchers.set('C:\\Temp', { close() {} });
    fakeRoots._watchers.set('C:\\TempData', { close() {} });
    assert.equal(fakeRoots._ownerWatchRoot('C:\\Temp\\a.bin'), 'C:\\Temp');
    assert.equal(fakeRoots._ownerWatchRoot('C:\\TempData\\b.bin'), 'C:\\TempData');
    assert.equal(fakeRoots._ownerWatchRoot('C:\\Temp2\\c.bin'), null);
    assert.equal(fakeRoots._ownerWatchRoot('C:\\Other\\d.bin'), null);
    assert.equal(fakeRoots._ownerWatchRoot('C:\\Temp'), 'C:\\Temp');
    assert.equal(fakeRoots._ownerWatchRoot(''), null);
    assert.equal(fakeRoots._ownerWatchRoot(null), null);
    assert.equal(fakeRoots._ownerWatchRoot(42), null);
    fakeRoots.stop();
  });

  it('resolves alias-form paths (junctions/short names) to the canonical root', { skip: process.platform !== 'win32' && 'requires Windows junctions (mklink /J)' }, () => {
    const { execFileSync } = require('child_process');
    const realDir = path.join(tmp, 'realroot');
    const linkDir = path.join(tmp, 'linkroot');
    fs.mkdirSync(realDir, { recursive: true });
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', linkDir, realDir], { windowsHide: true });
    const probeFile = path.join(linkDir, 'alias.bin');
    fs.writeFileSync(probeFile, 'x');
    const aliased = new FolderWatcher({
      watchDirs: [],
      scanEngine: { async runCustomScan() { return {}; } }
    });
    try {
      // Production registers canonical (realpath-resolved) roots in
      // _watchDir; mirror that here so the test exercises the real shape.
      const realpath = typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native
        : fs.realpathSync;
      const canonicalReal = realpath(realDir);
      aliased._watchers.set(canonicalReal, { close() {} });
      // Textually different (junction path) but identical on disk: the
      // owning canonical root must still be found so overflow coalesces
      // instead of degrading to per-path accounting.
      assert.equal(aliased._ownerWatchRoot(probeFile), canonicalReal);
      assert.equal(aliased._ownerWatchRoot(path.join(canonicalReal, 'alias.bin')), canonicalReal);
    } finally {
      aliased.stop();
    }
  });

  it('recovers overflow with a coalesced root scan after the queue drains', async () => {
    const recoveryScans = [];
    watcher.scanEngine.runScan = async (scanType, paths, message) => {
      if (paths.length === 1 && paths[0] !== undefined && !paths[0].endsWith('.bin')) {
        recoveryScans.push({ scanType, paths, message });
      } else {
        scanned.push({ scanType, paths });
      }
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `rec-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    assert.equal(watcher.getStatus().queued, 256);
    assert.equal(watcher.getStatus().overflowPending, 1);
    watcher.scanEngine.isScanning = false;
    const deadline = Date.now() + 5000;
    while ((watcher.getStatus().queued > 0 || watcher.getStatus().overflowPending > 0) && Date.now() < deadline) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(recoveryScans.length, 1);
    assert.equal(recoveryScans[0].scanType, 'folderwatch');
    assert.deepEqual(recoveryScans[0].paths.length, 1);
    assert.equal(scanned.length, 256, 'all normal queued files still scanned individually');
  });

  it('coalesces multiple roots and skips unaffected ones', async () => {
    const dirA = path.join(tmp, 'rootA');
    const dirB = path.join(tmp, 'rootB');
    const dirC = path.join(tmp, 'rootC');
    for (const dir of [dirA, dirB, dirC]) fs.mkdirSync(dir, { recursive: true });
    // Production registers canonical (realpath-resolved) roots; tmp itself
    // may use 8.3 short names on CI, so resolve expectations the same way.
    const realpath = typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native
      : fs.realpathSync;
    const canonicalA = realpath(dirA);
    const canonicalB = realpath(dirB);
    const canonicalC = realpath(dirC);
    const multi = new FolderWatcher({
      watchDirs: [dirA, dirB, dirC],
      debounceMs: 50,
      clamEngine: { isReady: true },
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: {
        isScanning: true,
        async runCustomScan() { return { success: true }; }
      }
    });
    const recoveryRoots = [];
    multi.scanEngine.runScan = async (scanType, paths) => {
      // Recovery scans carry watch roots (never *.bin); file scans pass through.
      if (paths.every((entry) => !String(entry).endsWith('.bin'))) recoveryRoots.push(paths);
      return { success: true, threatsFound: 0, threats: [] };
    };
    try {
      multi.start();
      for (const dir of [dirA, dirB]) {
        for (let i = 0; i < 257; i++) {
          const filePath = path.join(dir, `m-${i}.bin`);
          fs.writeFileSync(filePath, 'x');
          multi._enqueue(filePath);
        }
      }
      assert.equal(multi.getStatus().queued, 256);
      assert.equal(multi.getStatus().overflowPending, 2);
      multi.scanEngine.isScanning = false;
      const deadline = Date.now() + 8000;
      while ((multi.getStatus().queued > 0 || multi.getStatus().overflowPending > 0) && Date.now() < deadline) {
        multi._drain();
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(multi.getStatus().queued, 0);
      assert.equal(multi.getStatus().overflowPending, 0);
      assert.equal(recoveryRoots.length, 1, 'one coalesced recovery scan');
      assert.deepEqual([...recoveryRoots[0]].sort(), [canonicalA, canonicalB].sort());
      assert.ok(!recoveryRoots[0].includes(canonicalC), 'unaffected root must not be scanned');
    } finally {
      multi.stop();
    }
  });

  it('keeps late overflow pending across an in-flight recovery (generations)', async () => {
    const calls = [];
    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let recoveryStartedResolve;
    const recoveryStarted = new Promise((resolve) => { recoveryStartedResolve = resolve; });
    let recoveries = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveries += 1;
        calls.push(paths[0]);
        if (recoveries === 1) {
          recoveryStartedResolve();
          await recoveryGate;
        }
        return { success: true, threatsFound: 0, threats: [] };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `gen-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    assert.equal(watcher.getStatus().overflowPending, 1);
    watcher.scanEngine.isScanning = false;
    const drainPromise = watcher._drain();
    await recoveryStarted;
    // Recovery #1 in flight: overflow again while the queue has drained.
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `gen2-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    releaseRecovery();
    await drainPromise;
    const deadline = Date.now() + 8000;
    while ((watcher.getStatus().queued > 0 || watcher.getStatus().overflowPending > 0) && Date.now() < deadline) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(recoveries, 2, 'second generation must run its own recovery');
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(watcher.getStatus().queued, 0);
  });

  it('failed recovery stays pending without hot-looping', async () => {
    let recoveryAttempts = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveryAttempts += 1;
        return { error: 'synthetic failure' };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `fail-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    // The fill-phase drain loop owns _draining; wait until it settles
    // instead of assuming an explicit _drain() call drives completion.
    const deadline = Date.now() + 8000;
    while (recoveryAttempts === 0 && Date.now() < deadline) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(recoveryAttempts, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(recoveryAttempts, 1, 'exactly one recovery attempt, no tight retry loop');
    assert.equal(watcher.getStatus().overflowPending, 1, 'root stays pending for a later trigger');
    assert.equal(watcher.getStatus().queued, 0);
    // A later drain trigger retries and can succeed.
    watcher.scanEngine.runScan = async () => ({ success: true, threatsFound: 0, threats: [] });
    await watcher._drain();
    const deadline2 = Date.now() + 5000;
    while (watcher._draining && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().overflowPending, 0);
  });

  it('user-scan preemption preserves overflow for later retry', async () => {
    // Exact race from review: the recovery returns an explicit user-preempt
    // reason while scanEngine.isScanning is STILL false (the takeover has
    // not flipped the user-scan flag yet). The reason alone must settle it.
    // Takeover-pending is then modeled explicitly to prove no immediate
    // second recovery starts during the handoff gap.
    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let recoveryStartedResolve;
    const recoveryStarted = new Promise((resolve) => { recoveryStartedResolve = resolve; });
    let recoveries = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveries += 1;
        if (recoveries === 1) {
          recoveryStartedResolve();
          await recoveryGate;
          return { canceled: true, cancellationReason: 'user-preempt' };
        }
        return { success: true, threatsFound: 0, threats: [] };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `pre-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    const drainPromise = watcher._drain();
    await recoveryStarted;
    // Model the production handoff gap BEFORE releasing: takeover claimed,
    // user scan not yet active.
    watcher.scanEngine.isUserScanTakeoverPending = true;
    releaseRecovery();
    await drainPromise;
    const deadline = Date.now() + 8000;
    while ((watcher.getStatus().overflowPending !== 1) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Restored by reason, and NO second recovery starts while takeover is
    // pending — the loop must observe foreground ownership and wait.
    assert.equal(watcher.getStatus().overflowPending, 1);
    assert.equal(recoveries, 1);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(recoveries, 1, 'no immediate retry during the takeover gap');
    // Foreground ownership transfer: still no background retry.
    watcher.scanEngine.isUserScanTakeoverPending = false;
    watcher.scanEngine.isScanning = true;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(recoveries, 1, 'no retry while the user scan is active');
    // Foreground scan finishes: the existing loop resumes and recovers.
    watcher.scanEngine.isScanning = false;
    const deadline2 = Date.now() + 8000;
    while ((watcher._draining || watcher.getStatus().overflowPending !== 0 || watcher.getStatus().queued !== 0) && Date.now() < deadline2) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(recoveries, 2);
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(watcher.getStatus().queued, 0);
    delete watcher.scanEngine.isUserScanTakeoverPending;
  });

  it('new enqueue during takeover cannot start a background scan', async () => {
    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let recoveryStartedResolve;
    const recoveryStarted = new Promise((resolve) => { recoveryStartedResolve = resolve; });
    let runScans = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveryStartedResolve();
        await recoveryGate;
        return { canceled: true, cancellationReason: 'user-preempt' };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `re-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    watcher._drain();
    await recoveryStarted;
    watcher.scanEngine.isUserScanTakeoverPending = true;
    releaseRecovery();
    const deadline = Date.now() + 8000;
    while (watcher.getStatus().overflowPending !== 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().overflowPending, 1);
    // A new filesystem event arrives mid-gap: it must queue boundedly
    // without starting any background scan.
    const lateFile = path.join(tmp, 're-late.bin');
    fs.writeFileSync(lateFile, 'x');
    watcher._enqueue(lateFile);
    runScans = scanned.length;
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(scanned.length, runScans, 'no background scan during takeover');
    assert.equal(watcher.getStatus().queued, 1, 'late file stays queued and bounded');
    // Transfer, then finish, the foreground scan: pending work resumes.
    watcher.scanEngine.isUserScanTakeoverPending = false;
    watcher.scanEngine.isScanning = true;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(scanned.length, runScans, 'no background scan while user scan active');
    watcher.scanEngine.isScanning = false;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    const deadline2 = Date.now() + 8000;
    while ((watcher._draining || watcher.getStatus().queued !== 0 || watcher.getStatus().overflowPending !== 0) && Date.now() < deadline2) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(watcher.getStatus().overflowPending, 0);
    delete watcher.scanEngine.isUserScanTakeoverPending;
  });

  it('per-file preemption preserves the queue and covers the in-flight file', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    let firstStartedResolve;
    const firstStarted = new Promise((resolve) => { firstStartedResolve = resolve; });
    let fileScans = 0;
    let queueLenAtCancel = null;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) return { success: true, threatsFound: 0, threats: [] };
      fileScans += 1;
      if (fileScans === 1) {
        firstStartedResolve();
        await firstGate;
        queueLenAtCancel = watcher._queue.length;
        // Explicit reason while NO user scan is visible: the exact race.
        return { canceled: true, cancellationReason: 'user-preempt' };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `pp-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    const drainPromise = watcher._drain();
    await firstStarted;
    // Model the handoff gap: takeover claimed while the user scan is not
    // yet active. The restored root must wait, not retry or scan.
    watcher.scanEngine.isUserScanTakeoverPending = true;
    releaseFirst();
    await drainPromise;
    // Remaining queue was NOT wiped (255 files still pending at cancel).
    assert.equal(queueLenAtCancel, 255);
    const restored = Date.now() + 8000;
    while (watcher.getStatus().overflowPending !== 1 && Date.now() < restored) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().overflowPending, 1, 'in-flight file covered by the pinned root');
    assert.equal(fileScans, 1, 'no second file scan starts during the takeover gap');
    assert.equal(watcher.getStatus().queued, 255, 'queue preserved, not cleared, during the gap');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(fileScans, 1, 'gap holds: still no background file scan');
    // Foreground ownership transfer: still no background file scan.
    watcher.scanEngine.isUserScanTakeoverPending = false;
    watcher.scanEngine.isScanning = true;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fileScans, 1, 'no background file scan while the user scan is active');
    // Foreground scan finishes: per-file work plus the pinned root resume.
    watcher.scanEngine.isScanning = false;
    delete watcher.scanEngine.isUserScanTakeoverPending;
    const deadline = Date.now() + 10000;
    while ((watcher._draining || watcher.getStatus().queued !== 0 || watcher.getStatus().overflowPending !== 0) && Date.now() < deadline) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(watcher.getStatus().overflowPending, 0);
    // 255 individually scanned + the preempted file covered by root recovery.
    assert.equal(scanned.length, 255);
    assert.equal(watcher.getStatus().dropped, 1);
    // The preempted file kept its dedup marker (coverage moved to the
    // pinned root instead), so a duplicate event cannot double-queue it.
    assert.equal(watcher._scannedRecently.has(path.join(tmp, 'pp-0.bin')), true);
  });

  it('unknown cancellation with no user scan keeps legacy abort behavior', async () => {
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) return { canceled: true };
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `unk-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    const deadline = Date.now() + 8000;
    while ((watcher._draining || watcher.getStatus().queued !== 0) && Date.now() < deadline) {
      watcher._drain();
      await new Promise((r) => setTimeout(r, 10));
    }
    // Unknown reason + idle engine: legacy explicit-abort semantics win,
    // nothing is silently reinterpreted as preemption.
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(watcher.getStatus().overflowPending, 0);
  });

  it('classifies cancellation causes without timing inference', () => {
    assert.equal(watcher._classifyCancellation({ canceled: true, cancellationReason: 'user-preempt' }), 'preempted');
    assert.equal(watcher._classifyCancellation({ canceled: true, cancellationReason: 'explicit-abort' }), 'aborted');
    watcher.scanEngine.isScanning = true;
    assert.equal(watcher._classifyCancellation({ canceled: true }), 'preempted');
    assert.equal(watcher._classifyCancellation({ canceled: true, cancellationReason: null }), 'preempted');
    watcher.scanEngine.isScanning = false;
    assert.equal(watcher._classifyCancellation({ canceled: true }), 'aborted');
    assert.equal(watcher._classifyCancellation({ canceled: true, cancellationReason: 'bogus' }), 'aborted');
    // Takeover-pending is foreground ownership too: an unknown cancellation
    // during the handoff gap reads as preemption, never as explicit abort.
    watcher.scanEngine.isUserScanTakeoverPending = true;
    assert.equal(watcher._classifyCancellation({ canceled: true }), 'preempted');
    assert.equal(watcher._classifyCancellation({ canceled: true, cancellationReason: null }), 'preempted');
    delete watcher.scanEngine.isUserScanTakeoverPending;
    assert.equal(watcher._classifyCancellation({ canceled: true }), 'aborted');
  });

  it('explicit abort with no user scan clears overflow without restart', async () => {
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) return { canceled: true, cancellationReason: 'explicit-abort' };
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `abort-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    const deadline = Date.now() + 8000;
    while (watcher._draining && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(watcher.getStatus().overflowPending, 0, 'explicit abort honors user intent');
    assert.equal(watcher.getStatus().queued, 0);
    const scansAfterAbort = scanned.length;
    await watcher._drain();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(scanned.length, scansAfterAbort, 'no automatic restart after explicit abort');
  });

  it('stop during in-flight per-file preemption restores nothing', async () => {
    let releaseScan;
    const scanGate = new Promise((resolve) => { releaseScan = resolve; });
    let startedResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    watcher.scanEngine.runScan = async (scanType, paths) => {
      startedResolve();
      await scanGate;
      return { canceled: true, cancellationReason: 'user-preempt' };
    };
    watcher.start();
    const filePath = path.join(tmp, 'stop-race.bin');
    fs.writeFileSync(filePath, 'x');
    watcher._enqueue(filePath);
    await started;
    const generation = watcher._lifecycleGeneration;
    watcher.stop();
    assert.equal(watcher._lifecycleGeneration, generation + 1);
    releaseScan();
    const deadline = Date.now() + 8000;
    while (watcher._draining && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // The stale preempted result is discarded: no requeue, no pinned root.
    assert.equal(watcher._draining, false);
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(watcher.getStatus().running, false);
  });

  it('fast stop/start isolates the old per-file result from the new lifecycle', async () => {
    // Short maintenance tick: generation B's stranded work must be picked
    // up by the timer once generation A releases the single drain guard,
    // with no further enqueue or manual drain call from the test.
    const gen = new FolderWatcher({
      watchDirs: [tmp],
      debounceMs: 50,
      recentScanCleanupIntervalMs: 25,
      clamEngine: { isReady: true },
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: {
        isScanning: false,
        async runScan(scanType, paths) {
          calls += 1;
          if (calls === 1) {
            startedResolve();
            await scanGate;
            return { canceled: true, cancellationReason: 'user-preempt' };
          }
          scanned.push({ scanType, paths });
          return { success: true, threatsFound: 0, threats: [] };
        },
        async runCustomScan(paths) {
          scanned.push({ scanType: 'custom', paths });
          return { success: true, threatsFound: 0, threats: [] };
        }
      }
    });
    let releaseScan;
    const scanGate = new Promise((resolve) => { releaseScan = resolve; });
    let startedResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    let calls = 0;
    try {
      gen.start();
      const oldFile = path.join(tmp, 'gen-a.bin');
      fs.writeFileSync(oldFile, 'x');
      gen._enqueue(oldFile);
      await started;
      gen.stop();
      gen.start();
      const freshFile = path.join(tmp, 'gen-b.bin');
      fs.writeFileSync(freshFile, 'x');
      gen._enqueue(freshFile);
      // Generation B's enqueue hit _drain() while generation A still owned
      // the guard, so it queued without scanning. Release generation A:
      // its stale result must not restore the old file, pin a root, or
      // disturb generation B's pending work.
      releaseScan();
      const deadline = Date.now() + 10000;
      while (gen.getStatus().queued !== 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(gen.getStatus().queued, 0);
      assert.equal(gen.getStatus().overflowPending, 0);
      // Exactly one successful scan ran (generation B's fresh file, woken by
      // the maintenance tick after generation A released the guard); the
      // old file was never requeued or covered by a stale root recovery.
      assert.equal(scanned.length, 1);
      assert.deepEqual(scanned[0].paths, [freshFile]);
      assert.equal(calls, 2);
    } finally {
      gen.stop();
    }
  });

  it('stop during overflow preemption restores no snapshot roots', async () => {
    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let recoveryStartedResolve;
    const recoveryStarted = new Promise((resolve) => { recoveryStartedResolve = resolve; });
    let recoveries = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveries += 1;
        recoveryStartedResolve();
        await recoveryGate;
        return { canceled: true, cancellationReason: 'user-preempt' };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `stop-ov-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    watcher._drain();
    await recoveryStarted;
    watcher.stop();
    releaseRecovery();
    const deadline = Date.now() + 8000;
    while (watcher._draining && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Stale preempted recovery discarded: snapshot not restored, no retry.
    assert.equal(watcher._draining, false);
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(recoveries, 1);
  });

  it('stop during overflow failure defers nothing into the stopped watcher', async () => {
    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let recoveryStartedResolve;
    const recoveryStarted = new Promise((resolve) => { recoveryStartedResolve = resolve; });
    let recoveries = 0;
    watcher.scanEngine.runScan = async (scanType, paths) => {
      const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
      if (isRoot) {
        recoveries += 1;
        recoveryStartedResolve();
        await recoveryGate;
        return { error: 'synthetic failure' };
      }
      scanned.push({ scanType, paths });
      return { success: true, threatsFound: 0, threats: [] };
    };
    watcher.scanEngine.isScanning = true;
    watcher.start();
    for (let i = 0; i < 257; i++) {
      const filePath = path.join(tmp, `stop-fail-${i}.bin`);
      fs.writeFileSync(filePath, 'x');
      watcher._enqueue(filePath);
    }
    watcher.scanEngine.isScanning = false;
    watcher._drain();
    await recoveryStarted;
    // Stronger variant: restart immediately, then resolve the old failure.
    watcher.stop();
    watcher.start();
    releaseRecovery();
    const deadline = Date.now() + 8000;
    while (watcher._draining && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Old failure must not repopulate the new lifecycle as deferred work,
    // and no stale retry scan may run.
    assert.equal(watcher.getStatus().overflowPending, 0);
    assert.equal(watcher.getStatus().queued, 0);
    assert.equal(recoveries, 1);
  });

  it('lifecycle timer retries deferred overflow without a new trigger', async () => {
    // The single maintenance tick must wake overflow recovery again after a
    // genuine same-generation failure, with no further enqueue or manual
    // drain call from the test.
    const timed = new FolderWatcher({
      watchDirs: [tmp],
      debounceMs: 50,
      recentScanCleanupIntervalMs: 25,
      clamEngine: { isReady: true },
      watchFactory() {
        return { on() { return this; }, close() {} };
      },
      scanEngine: {
        isScanning: false,
        async runScan(scanType, paths) {
          const isRoot = paths.length === 1 && !paths[0].endsWith('.bin');
          if (isRoot) {
            recoveries += 1;
            if (recoveries === 1) return { error: 'synthetic failure' };
            return { success: true, threatsFound: 0, threats: [] };
          }
          scanned.push({ scanType, paths });
          return { success: true, threatsFound: 0, threats: [] };
        },
        async runCustomScan(paths) {
          scanned.push({ scanType: 'custom', paths });
          return { success: true, threatsFound: 0, threats: [] };
        }
      }
    });
    let recoveries = 0;
    try {
      timed.scanEngine.isScanning = true;
      timed.start();
      for (let i = 0; i < 257; i++) {
        const filePath = path.join(tmp, `timer-ov-${i}.bin`);
        fs.writeFileSync(filePath, 'x');
        timed._enqueue(filePath);
      }
      timed.scanEngine.isScanning = false;
      timed._drain();
      const deadline = Date.now() + 10000;
      while ((timed.getStatus().overflowPending !== 0 || timed.getStatus().queued !== 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      // First recovery failed (deferred, still pending); the timer retried
      // it to a clean recovery with no hot loop and no test-driven trigger.
      assert.equal(recoveries, 2);
      assert.equal(timed.getStatus().overflowPending, 0);
      assert.equal(timed.getStatus().queued, 0);
      assert.equal(scanned.length, 256);
    } finally {
      timed.stop();
    }
  });
});
