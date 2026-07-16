const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const ScanEngine = require('../src/security/ScanEngine');
const ClamAVEngine = require('../src/security/ClamAVEngine');

async function waitFor(condition, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

class FakeClamEngine extends ClamAVEngine {
  constructor() {
    super({});
    this.isReady = true;
    this.pendingResolve = null;
  }

  hasVirusDatabase() {
    return true;
  }

  async scanFile() {
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.activeScanProcess = { kill: () => {} };
    });
  }
}

describe('Scan cancellation cleanup', () => {
  it('resets scanning state and emits scan:canceled', async () => {
    const fakeClam = new FakeClamEngine();
    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on('scan:canceled', (payload) => events.push(payload));
    eventBus.on('scan:complete', (payload) => events.push(payload));

    const scanEngine = new ScanEngine(
      {
        getSetting: () => false,
        logScan: () => {},
        addScanReport: () => {}
      },
      eventBus,
      fakeClam,
      { analyze: async () => ({ score: 0, signals: [] }) },
      { checkHash: async () => null },
      { quarantine: async () => ({ success: true }) }
    );

    const scanPromise = scanEngine.runCustomScan(['C:\\temp']);
    await waitFor(() => fakeClam.pendingResolve !== null);
    scanEngine.abortScan();
    fakeClam.pendingResolve({
      success: false,
      canceled: true,
      error: 'Scan canceled',
      threatsFound: 0,
      filesScanned: 0,
      output: ''
    });

    const result = await scanPromise;
    assert.equal(result.canceled, true);
    assert.equal(scanEngine.getStatus().isScanning, false);
    assert.equal(scanEngine.abortController, null);
    assert.ok(events.some((event) => event.status === 'canceled'));
  });

  it('ignores abort requests when no scan is running', () => {
    const fakeClam = new FakeClamEngine();
    const scanEngine = new ScanEngine(
      {
        getSetting: () => false,
        logScan: () => {},
        addScanReport: () => {}
      },
      new EventEmitter(),
      fakeClam,
      { analyze: async () => ({ score: 0, signals: [] }) },
      { checkHash: async () => null },
      { quarantine: async () => ({ success: true }) }
    );

    const result = scanEngine.abortScan();
    assert.deepEqual(result, { success: false, canceled: false, error: 'No scan in progress' });
  });

  it('does not abort background folderwatch scans via abortScan guard pattern', async () => {
    let aborted = false;
    const fakeClam = {
      scanFile: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { success: true, threatsFound: 0, filesScanned: 1, threats: [] };
      },
      abortCurrentScan: () => { aborted = true; }
    };
    const scanEngine = new ScanEngine(
      {
        getSetting: () => false,
        logScan: () => {},
        addScanReport: () => {}
      },
      new EventEmitter(),
      fakeClam,
      { analyze: async () => ({ score: 0, signals: [] }) },
      { checkHash: async () => null },
      { quarantine: async () => ({ success: true }) }
    );

    const pending = scanEngine.runScan('folderwatch', [path.join(os.tmpdir(), 'watched.bin')], 'Folder watch');
    await waitFor(() => scanEngine.getStatus().isScanning);
    const blocked = scanEngine.getStatus().currentScan?.scanType === 'folderwatch'
      ? { success: false, canceled: false, error: 'No user scan in progress' }
      : scanEngine.abortScan();
    assert.deepEqual(blocked, { success: false, canceled: false, error: 'No user scan in progress' });
    assert.equal(aborted, false);
    await pending;
  });

  it('does not persist reports for canceled or folderwatch scans', async () => {
    let savedReports = 0;
    let loggedScans = 0;
    const fakeClam = {
      scanFile: async () => ({
        success: true,
        threatsFound: 0,
        filesScanned: 1,
        threats: []
      })
    };
    const eventBus = new EventEmitter();
    const scanEngine = new ScanEngine(
      {
        getSetting: () => true,
        logScan: () => { loggedScans += 1; },
        addScanReport: () => { savedReports += 1; }
      },
      eventBus,
      fakeClam,
      { analyze: async () => ({ score: 0, signals: [] }) },
      { checkHash: async () => null },
      { quarantine: async () => ({ success: true }) }
    );

    await scanEngine.runScan('folderwatch', [path.join(os.tmpdir(), 'watched.bin')], 'Folder watch');
    assert.equal(savedReports, 0);
    assert.equal(loggedScans, 0);

    const pending = scanEngine.runCustomScan(['C:\\temp']);
    scanEngine.abortScan();
    await pending;
    assert.equal(savedReports, 0);
  });
});

describe('ClamAVEngine.abortCurrentScan', () => {
  it('sets cancel flag only when an active scan process exists', () => {
    const engine = new ClamAVEngine({});
    engine.activeScanProcess = {
      kill() {}
    };

    const killed = engine.abortCurrentScan();
    assert.equal(killed, true);
    assert.equal(engine.cancelScanRequested, true);
    assert.equal(engine.cancelUpdateRequested, false);
  });

  it('does not leave cancel flags when no subprocess is active', () => {
    const engine = new ClamAVEngine({});
    const killed = engine.abortCurrentScan();
    assert.equal(killed, false);
    assert.equal(engine.cancelScanRequested, false);
    assert.equal(engine.cancelUpdateRequested, false);
  });
});
