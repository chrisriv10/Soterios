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
});
