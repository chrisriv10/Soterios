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
      scanEngine: {
        isScanning: false,
        async runCustomScan(paths) {
          scanned.push(...paths);
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

  it('debounces and queues a custom scan for new files', async () => {
    watcher.start();
    const filePath = path.join(tmp, 'payload.bin');
    fs.writeFileSync(filePath, 'hello');
    // Force schedule path used by watcher (fs.watch is flaky in CI/tmp).
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(scanned.includes(filePath));
  });

  it('skips duplicate scans within the cooldown window', async () => {
    watcher.start();
    const filePath = path.join(tmp, 'once.bin');
    fs.writeFileSync(filePath, 'x');
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 120));
    watcher._schedule(filePath);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(scanned.filter((p) => p === filePath).length, 1);
  });
});
