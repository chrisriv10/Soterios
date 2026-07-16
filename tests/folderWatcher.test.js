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
});
