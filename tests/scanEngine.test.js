'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

describe('ScanEngine', () => {
  let tmp;
  let mockDb;
  let mockEventBus;
  let mockClamEngine;
  let mockHeuristicEngine;
  let mockReputationEngine;
  let mockQuarantineManager;
  let ScanEngine;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-scan-'));
    
    // Create mock dependencies
    mockDb = {
      getSetting: (key, def) => def,
      logScan: () => {},
      addScanReport: () => {}
    };
    
    mockEventBus = new EventEmitter();
    mockEventBus.emit = () => {};
    
    mockClamEngine = {
      isReady: true,
      scanFile: async () => ({
        success: true,
        threatsFound: 0,
        filesScanned: 10,
        threats: [],
        output: ''
      }),
      abortCurrentScan: () => true
    };
    
    mockHeuristicEngine = {};
    mockReputationEngine = {};
    mockQuarantineManager = {
      quarantine: async () => ({ success: true })
    };
    
    // Clear require cache
    delete require.cache[require.resolve('../src/security/ScanEngine')];
    ScanEngine = require('../src/security/ScanEngine');
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('constructor initializes with dependencies', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    assert.equal(engine.db, mockDb);
    assert.equal(engine.eventBus, mockEventBus);
    assert.equal(engine.clamEngine, mockClamEngine);
    assert.equal(engine.isScanning, false);
    assert.equal(engine.isFolderWatchScanning, false);
    assert.equal(engine.userScan.currentScan, null);
  });

  it('getStatus returns current scan state', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const status = engine.getStatus();
    assert.equal(status.isScanning, false);
    assert.equal(status.isFolderWatchScanning, false);
    assert.equal(status.currentScan, null);
  });

  it('runQuickScan returns error when scan already in progress', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    engine.userScan.isScanning = true;
    
    const result = await engine.runQuickScan();
    assert.equal(result.error, 'Scan already in progress');
  });

  it('runFullScan returns error when scan already in progress', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    engine.userScan.isScanning = true;
    
    const result = await engine.runFullScan();
    assert.equal(result.error, 'Scan already in progress');
  });

  it('runCustomScan returns error when scan already in progress', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    engine.userScan.isScanning = true;
    
    const result = await engine.runCustomScan(['C:\\test']);
    assert.equal(result.error, 'Scan already in progress');
  });

  it('runScan sets isScanning flag for user scans', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const scanPromise = engine.runScan('quick', [tmp], 'Starting...');
 assert.equal(engine.isScanning, true);
    
    await scanPromise;
    assert.equal(engine.isScanning, false);
  });

  it('runScan sets isFolderWatchScanning flag for folderwatch scans', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const scanPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    assert.equal(engine.isFolderWatchScanning, true);
    assert.equal(engine.isScanning, false);
    
    await scanPromise;
    assert.equal(engine.isFolderWatchScanning, false);
  });

  it('runScan returns error when user scan already in progress', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    engine.userScan.isScanning = true;
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.error, 'Scan already in progress');
  });

  it('runScan lets a user scan preempt a running folderwatch scan', async () => {
    // Folder watch must never block the user: starting a user scan cancels
    // the background scan and proceeds normally.
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const folderwatchPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    assert.equal(pending.length, 1);

    // User scan must not be rejected while folderwatch is active.
    const userPromise = engine.runScan('quick', [tmp], 'Starting...');
    // Let the preempt arm, then release the folder-watch scan as canceled.
    await new Promise((r) => setTimeout(r, 50));
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });

    // Release the user scan's own clamscan once it has taken over.
    await waitFor(() => pending.length === 1);
    pending.shift()({ success: true, threatsFound: 0, filesScanned: 1, threats: [], output: '' });

    const result = await userPromise;
    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');

    const folderwatchResult = await folderwatchPromise;
    assert.equal(engine.isFolderWatchScanning, false);
    assert.equal(engine.isScanning, false);
    // The takeover marks its cause explicitly so consumers never infer it.
    assert.equal(folderwatchResult.canceled, true);
    assert.equal(folderwatchResult.cancellationReason, 'user-preempt');
  });

  it('takeover exposes pending state across the handoff gap', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    assert.equal(engine.isUserScanTakeoverPending, false);

    const folderwatchPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    // Foreground call runs synchronously until its first await, so the
    // pending flag is observable immediately after invoking it.
    const userPromise = engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(engine.isUserScanTakeoverPending, true);
    assert.equal(engine.isScanning, false);

    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });
    const folderwatchResult = await folderwatchPromise;
    assert.equal(folderwatchResult.canceled, true);
    assert.equal(folderwatchResult.cancellationReason, 'user-preempt');

    // Handoff completes only when the foreground scan becomes active.
    await waitFor(() => engine.isScanning);
    assert.equal(engine.isUserScanTakeoverPending, false);

    await waitFor(() => pending.length === 1);
    pending.shift()({ success: true, threatsFound: 0, filesScanned: 1, threats: [], output: '' });
    const userResult = await userPromise;
    assert.equal(userResult.success, true);
    assert.equal(userResult.canceled, false);
    assert.equal(engine.isScanning, false);
    assert.equal(engine.isUserScanTakeoverPending, false);
    assert.equal(engine._pendingUserScanCancelRequested, false);
  });

  it('second foreground scan during takeover is rejected, not concurrent', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const folderwatchPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    const firstUser = engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(engine.isUserScanTakeoverPending, true);
    const rejected = await engine.runScan('full', ['C:\\'], 'Starting...');
    assert.equal(rejected.error, 'Scan already in progress');
    // The rejected call mutates nothing owned by the accepted request.
    assert.equal(engine._pendingUserScanCancelRequested, false);
    assert.equal(engine.folderWatchScan.cancelReason, 'user-preempt');
    assert.equal(engine.isUserScanTakeoverPending, true);

    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });
    await folderwatchPromise;
    await waitFor(() => engine.isScanning);
    await waitFor(() => pending.length === 1);
    pending.shift()({ success: true, threatsFound: 0, filesScanned: 1, threats: [], output: '' });
    const userResult = await firstUser;
    assert.equal(userResult.success, true);
    assert.equal(engine.isUserScanTakeoverPending, false);
  });

  it('abort during takeover cancels the pending foreground request', async () => {
    const pending = [];
    let scanFileCalls = 0;
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        scanFileCalls += 1;
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const folderwatchPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    const userPromise = engine.runScan('quick', [tmp], 'Starting...');
    await waitFor(() => engine.isUserScanTakeoverPending);
    assert.equal(engine.isScanning, false);
    // Cancel during the handoff gap targets the PENDING foreground request,
    // not the already-preempted folder-watch scan.
    const abortResult = engine.abortScan();
    assert.equal(abortResult.success, true);
    assert.equal(abortResult.canceled, true);
    // Release the folder-watch Clam call as canceled.
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });
    const folderwatchResult = await folderwatchPromise;
    assert.equal(folderwatchResult.canceled, true);
    assert.equal(folderwatchResult.cancellationReason, 'user-preempt');
    // The foreground request resolves WITHOUT any second Clam invocation:
    // userPromise settles only after the takeover decision point, so a
    // resolved promise with no new scanFile call proves Clam never started.
    const userResult = await userPromise;
    assert.equal(pending.length, 0);
    assert.equal(scanFileCalls, 1);
    assert.equal(userResult.canceled, true);
    assert.equal(userResult.cancellationReason, 'explicit-abort');
    assert.equal(userResult.status, 'canceled');
    assert.equal(userResult.success, false);
    assert.equal(userResult.filesScanned, 0);
    assert.equal(engine.isScanning, false);
    assert.equal(engine.isUserScanTakeoverPending, false);
    assert.equal(engine._pendingUserScanCancelRequested, false);
    assert.equal(engine.userScan.lastResult, null);
  });

  it('runScan aborted through abortScan reports an explicit-abort reason', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const scanPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    assert.equal(pending.length, 1);
    engine.abortScan();
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });

    const result = await scanPromise;
    assert.equal(result.canceled, true);
    assert.equal(result.cancellationReason, 'explicit-abort');
    assert.equal(engine.isFolderWatchScanning, false);
  });

  it('rejected folder-watch call preserves the active explicit-abort reason', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const scanPromise = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    engine.abortScan();
    assert.equal(engine.folderWatchScan.cancelReason, 'explicit-abort');
    // A second folder-watch call is rejected and must not erase the reason
    // recorded on the still-active scan.
    const rejected = await engine.runScan('folderwatch', [tmp], 'Starting...');
    assert.equal(rejected.error, 'Folder watch scan already in progress');
    assert.equal(engine.folderWatchScan.cancelReason, 'explicit-abort');
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });

    const result = await scanPromise;
    assert.equal(result.canceled, true);
    assert.equal(result.cancellationReason, 'explicit-abort');
    assert.equal(engine.folderWatchScan.cancelReason, null);
  });

  it('rejected user call preserves the active explicit-abort reason', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const scanPromise = engine.runScan('quick', [tmp], 'Starting...');
    await waitFor(() => engine.isScanning);
    engine.abortScan();
    assert.equal(engine.userScan.cancelReason, 'explicit-abort');
    // A second user call is rejected and must not erase the reason recorded
    // on the still-active scan.
    const rejected = await engine.runScan('full', ['C:\\'], 'Starting...');
    assert.equal(rejected.error, 'Scan already in progress');
    assert.equal(engine.userScan.cancelReason, 'explicit-abort');
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });

    const result = await scanPromise;
    assert.equal(result.canceled, true);
    assert.equal(result.cancellationReason, 'explicit-abort');
    assert.equal(engine.userScan.cancelReason, null);
  });

  it('runScan never leaks a cancellation reason into a later scan', async () => {
    const pending = [];
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        return new Promise((resolve) => pending.push(resolve));
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const first = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => engine.isFolderWatchScanning);
    engine.abortScan();
    pending.shift()({ success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' });
    const aborted = await first;
    assert.equal(aborted.canceled, true);
    assert.equal(aborted.cancellationReason, 'explicit-abort');
    assert.equal(engine.isUserScanTakeoverPending, false);

    pending.length = 0;
    const second = engine.runScan('folderwatch', [tmp], 'Starting...');
    await waitFor(() => pending.length === 1);
    pending.shift()({ success: true, threatsFound: 0, filesScanned: 1, threats: [], output: '' });
    const completed = await second;
    assert.equal(completed.canceled, false);
    assert.equal(completed.cancellationReason, null);
    assert.equal(engine.folderWatchScan.cancelReason, null);
    assert.equal(engine.isUserScanTakeoverPending, false);
    assert.equal(engine._pendingUserScanCancelRequested, false);
  });

  it('runScan completes successfully with no threats', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.threatsFound, 0);
    assert.equal(result.threats.length, 0);
  });

  it('runScan handles threats and quarantines them', async () => {
    const testFile = path.join(tmp, 'threat.exe');
    fs.writeFileSync(testFile, 'malicious content');
    
    mockClamEngine.scanFile = async () => ({
      success: true,
      threatsFound: 1,
      filesScanned: 1,
      threats: [{ path: testFile, name: 'Eicar-Test-Signature' }],
      output: ''
    });
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.success, true);
    assert.equal(result.threatsFound, 1);
    assert.equal(result.threats.length, 1);
    assert.equal(engine.getStatus().lastResult.threats.length, 1);
    assert.equal(engine.getStatus().lastResult.threats[0].name, 'Eicar-Test-Signature');
  });

  it('runScan skips quarantining files whose hash is trusted', async () => {
    const testFile = path.join(tmp, 'falsepositive.bin');
    fs.writeFileSync(testFile, 'benign-ish content');
    let quarantineCalls = 0;

    mockDb.isHashTrusted = () => true;
    mockQuarantineManager.quarantine = async () => {
      quarantineCalls += 1;
      return { success: true };
    };
    mockClamEngine.scanFile = async () => ({
      success: true,
      threatsFound: 1,
      filesScanned: 1,
      threats: [{ path: testFile, name: 'Some-Signature' }],
      output: ''
    });

    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.success, true);
    assert.equal(quarantineCalls, 0);
    assert.equal(result.threats.length, 1);
    assert.equal(result.threats[0].trusted, true);
    assert.equal(fs.existsSync(testFile), true);
  });

  it('runScan handles scan errors', async () => {
    mockClamEngine.scanFile = async () => ({
      success: false,
      error: 'Scan failed',
      threatsFound: 0,
      filesScanned: 0,
      output: ''
    });
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    assert.ok(result.errors.length > 0);
  });

  it('abortScan cancels active user scan', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    engine.userScan.isScanning = true;
    engine.userScan.currentScan = { scanType: 'quick', paths: [tmp] };
    engine.userScan.abortController = { abort: () => {} };
    
    const result = engine.abortScan();
    assert.equal(result.success, true);
    assert.equal(result.canceled, true);
  });

  it('abortScan returns error when no scan in progress', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const result = engine.abortScan();
    assert.equal(result.success, false);
    assert.equal(result.error, 'No scan in progress');
  });

  it('abortScan cancels a running folderwatch scan', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    engine.folderWatchScan.isScanning = true;
    engine.folderWatchScan.currentScan = { scanType: 'folderwatch', paths: [tmp] };
    engine.folderWatchScan.abortController = { abort: () => {} };
    
    const result = engine.abortScan();
    assert.equal(result.success, true);
    assert.equal(result.canceled, true);
  });

  it('abortScan calls clamEngine.abortCurrentScan', () => {
    let abortCalled = false;
    mockClamEngine.abortCurrentScan = () => {
      abortCalled = true;
      return true;
    };
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    engine.userScan.isScanning = true;
    engine.userScan.currentScan = { scanType: 'quick', paths: [tmp] };
    engine.userScan.abortController = { abort: () => {} };
    
    engine.abortScan();
    assert.equal(abortCalled, true);
  });

  it('saveScanReport creates JSON and HTML files', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const report = {
      scanType: 'quick',
      status: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      targetPaths: [tmp],
      filesScanned: 100,
      threatsFound: 0,
      durationMs: 5000,
      threats: [],
      errors: [],
      details: { threats: [], errors: [] }
    };
    
    const saved = engine.saveScanReport(report);
    assert.ok(saved.jsonPath);
    assert.ok(saved.htmlPath);
    assert.ok(fs.existsSync(saved.jsonPath));
    assert.ok(fs.existsSync(saved.htmlPath));
    
    const jsonContent = JSON.parse(fs.readFileSync(saved.jsonPath, 'utf8'));
    assert.equal(jsonContent.scanType, 'quick');
    
    const htmlContent = fs.readFileSync(saved.htmlPath, 'utf8');
    assert.ok(htmlContent.includes('Soterios Scan Report'));
  });

  it('saveScanReport does not save when scanHistory disabled', () => {
    mockDb.getSetting = (key, def) => {
      if (key === 'feature.scanHistory') return false;
      return def;
    };
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const report = {
      scanType: 'quick',
      status: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      targetPaths: [tmp],
      filesScanned: 100,
      threatsFound: 0,
      durationMs: 5000,
      threats: [],
      errors: [],
      details: { threats: [], errors: [] }
    };
    
    const saved = engine.saveScanReport(report);
    assert.equal(saved.jsonPath, undefined);
    assert.equal(saved.htmlPath, undefined);
  });

  it('runScan preserves a completed outcome when report persistence fails', async () => {
    const events = [];
    mockEventBus.emit = (event, data) => { events.push({ event, data }); };
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => ({
        success: true,
        threatsFound: 0,
        filesScanned: 7,
        threats: [],
        output: ''
      })
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    // Fail ONLY the report file writes (Windows-safe: no permission tricks).
    const fsModule = require('fs');
    const realWrite = fsModule.writeFileSync;
    fsModule.writeFileSync = (...args) => {
      if (String(args[0]).includes('scan-reports')) throw new Error('ENOSPC: no space left on device');
      return realWrite.apply(fsModule, args);
    };
    const loggerModule = require('../src/utils/logger');
    const realWarn = loggerModule.warn;
    const warnings = [];
    loggerModule.warn = (message) => { warnings.push(String(message)); };
    let result;
    try {
      result = await engine.runScan('quick', [tmp], 'Starting...');
    } finally {
      fsModule.writeFileSync = realWrite;
      loggerModule.warn = realWarn;
    }
    assert.equal(fsModule.writeFileSync, realWrite, 'fs stub is always restored');
    assert.equal(loggerModule.warn, realWarn, 'logger stub is always restored');
    // The warning names both intended files plus the OS reason, never
    // report contents.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Scan report persistence failed/);
    assert.match(warnings[0], /scan-quick-.*\.json/);
    assert.match(warnings[0], /scan-quick-.*\.html/);
    assert.match(warnings[0], /ENOSPC/);

    // Terminal outcome preserved, persistence failure surfaced, no throw.
    assert.equal(result.status, 'completed');
    assert.equal(result.success, true);
    assert.equal(result.canceled, false);
    assert.equal(result.filesScanned, 7);
    assert.equal(result.threatsFound, 0);
    assert.deepEqual(result.threats, []);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^Scan report persistence failed: /);
    assert.match(result.errors[0], /ENOSPC/);
    // The fallback report claims no saved files.
    const lastResult = engine.getStatus().lastResult;
    assert.ok(lastResult);
    assert.equal(lastResult.report.jsonPath, undefined);
    assert.equal(lastResult.report.htmlPath, undefined);
    // In-memory fallback report reflects the same failure.
    assert.ok(lastResult.report.errors.includes(result.errors[0]));
    // Engine state cleaned up and terminal.
    assert.equal(engine.isScanning, false);
    assert.equal(engine.userScan.currentScan, null);
    assert.equal(engine.userScan.abortController, null);
    assert.equal(lastResult.status, 'completed');
    assert.deepEqual(lastResult.errors, result.errors);
    assert.deepEqual(lastResult.threats, []);
    // Exactly one terminal scan:complete, agreeing with the result.
    const completes = events.filter((e) => e.event === 'scan:complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0].data.status, 'completed');
    assert.equal(completes[0].data.filesScanned, 7);
    assert.deepEqual(completes[0].data.errors, result.errors);
    assert.deepEqual(completes[0].data.threats, []);
    assert.equal(completes[0].data.report.jsonPath, undefined);
    assert.equal(completes[0].data.report.htmlPath, undefined);
  });

  it('runScan preserves a canceled outcome when report persistence fails', async () => {
    const events = [];
    mockEventBus.emit = (event, data) => { events.push({ event, data }); };
    let releaseScan;
    const scanGate = new Promise((resolve) => { releaseScan = resolve; });
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => {
        await scanGate;
        return { success: false, canceled: true, error: 'Scan canceled', threatsFound: 0, filesScanned: 0, output: '' };
      }
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const scanPromise = engine.runScan('quick', [tmp], 'Starting...');
    await waitFor(() => engine.isScanning);
    engine.abortScan();
    const fsModule = require('fs');
    const realWrite = fsModule.writeFileSync;
    fsModule.writeFileSync = (...args) => {
      if (String(args[0]).includes('scan-reports')) throw new Error('EACCES: permission denied');
      return realWrite.apply(fsModule, args);
    };
    let result;
    try {
      releaseScan();
      result = await scanPromise;
    } finally {
      fsModule.writeFileSync = realWrite;
    }

    assert.equal(result.status, 'canceled');
    assert.equal(result.canceled, true);
    assert.equal(result.cancellationReason, 'explicit-abort');
    assert.match(result.errors[0], /^Scan report persistence failed: /);
    const canceledEvents = events.filter((e) => e.event === 'scan:canceled');
    const completeEvents = events.filter((e) => e.event === 'scan:complete');
    assert.equal(canceledEvents.length, 1);
    assert.equal(completeEvents.length, 1);
    assert.equal(completeEvents[0].data.status, 'canceled');
    assert.deepEqual(completeEvents[0].data.errors, result.errors);
    assert.equal(engine.isScanning, false);
  });

  it('runScan keeps original errors when scan and report persistence both fail', async () => {
    const events = [];
    mockEventBus.emit = (event, data) => { events.push({ event, data }); };
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => ({ success: false, error: 'Clam engine exploded', threatsFound: 0, filesScanned: 0, output: '' })
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    const fsModule = require('fs');
    const realWrite = fsModule.writeFileSync;
    fsModule.writeFileSync = (...args) => {
      if (String(args[0]).includes('scan-reports')) throw new Error('ENOSPC: no space left on device');
      return realWrite.apply(fsModule, args);
    };
    let result;
    try {
      result = await engine.runScan('quick', [tmp], 'Starting...');
    } finally {
      fsModule.writeFileSync = realWrite;
    }

    assert.equal(result.status, 'failed');
    assert.equal(result.success, false);
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0], 'Clam engine exploded');
    assert.match(result.errors[1], /^Scan report persistence failed: /);
    const completes = events.filter((e) => e.event === 'scan:complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0].data.status, 'failed');
    assert.deepEqual(completes[0].data.errors, result.errors);
  });

  it('runScan contains directory-creation failure the same as write failure', async () => {
    const clam = {
      isReady: true,
      abortCurrentScan: () => true,
      scanFile: async () => ({
        success: true,
        threatsFound: 0,
        filesScanned: 3,
        threats: [],
        output: ''
      })
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      clam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    // Prove the containment boundary wraps mkdir too, not just the writes.
    const fsModule = require('fs');
    const realMkdir = fsModule.mkdirSync;
    fsModule.mkdirSync = (...args) => {
      if (String(args[0]).includes('scan-reports')) throw new Error('EROFS: read-only file system');
      return realMkdir.apply(fsModule, args);
    };
    const loggerModule = require('../src/utils/logger');
    const realWarn = loggerModule.warn;
    const warnings = [];
    loggerModule.warn = (message) => { warnings.push(String(message)); };
    let result;
    try {
      result = await engine.runScan('custom', [tmp], 'Starting...');
    } finally {
      fsModule.mkdirSync = realMkdir;
      loggerModule.warn = realWarn;
    }
    assert.equal(fsModule.mkdirSync, realMkdir, 'fs stub is always restored');
    // Paths are derived before mkdir, so even a directory-creation failure
    // names both intended files.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /scan-custom-.*\.json/);
    assert.match(warnings[0], /scan-custom-.*\.html/);

    assert.equal(result.status, 'completed');
    assert.equal(result.success, true);
    assert.equal(result.filesScanned, 3);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^Scan report persistence failed: /);
    assert.equal(engine.getStatus().lastResult.report.jsonPath, undefined);
    assert.equal(engine.isScanning, false);
  });

  it('runScan emits progress events', async () => {
    const progressEvents = [];
    mockEventBus.emit = (event, data) => {
      if (event === 'scan:progress') {
        progressEvents.push(data);
      }
    };
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    await engine.runScan('quick', [tmp], 'Starting...');
    assert.ok(progressEvents.length > 0);
    assert.ok(progressEvents[0].message.includes('Starting'));
  });

  it('runScan emits complete event with results', async () => {
    let completeEvent = null;
    mockEventBus.emit = (event, data) => {
      if (event === 'scan:complete') {
        completeEvent = data;
      }
    };
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    await engine.runScan('quick', [tmp], 'Starting...');
    assert.ok(completeEvent);
    assert.equal(completeEvent.status, 'completed');
    assert.ok(completeEvent.filesScanned >= 0);
  });

  it('runScan handles quarantine errors gracefully', async () => {
    const testFile = path.join(tmp, 'threat.exe');
    fs.writeFileSync(testFile, 'malicious content');
    
    mockClamEngine.scanFile = async () => ({
      success: true,
      threatsFound: 1,
      filesScanned: 1,
      threats: [{ path: testFile, name: 'Eicar-Test-Signature' }],
      output: ''
    });
    
    mockQuarantineManager.quarantine = async () => ({
      success: false,
      error: 'Quarantine failed'
    });
    
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    // Quarantine failure should result in failed scan
    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    assert.ok(result.errors.some(e => e.includes('Failed to quarantine')));
  });

  it('publishes structured progress and retains the final result', async () => {
    const progressEvents = [];
    mockEventBus.emit = (event, data) => {
      if (event === 'scan:progress') progressEvents.push(data);
    };
    mockClamEngine.scanFile = async (target, onProgress) => {
      onProgress({ fileCount: 3 });
      return { success: true, threatsFound: 0, filesScanned: 3, threats: [], output: '' };
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    await engine.runScan('custom', [tmp], 'Starting...');

    const scanningEvent = progressEvents.find((event) => event.phase === 'scanning' && event.filesScanned === 3);
    assert.ok(scanningEvent, 'expected a structured scanning event');
    assert.equal(scanningEvent.currentTarget, tmp);
    assert.equal(scanningEvent.targetIndex, 1);
    assert.equal(scanningEvent.targetCount, 1);
    assert.equal(scanningEvent.progressEstimated, false);
    assert.ok(scanningEvent.startedAt);
    const targetCompleteEvent = progressEvents.find((event) => event.completedTargets?.includes(tmp));
    assert.ok(targetCompleteEvent, 'expected progress after the target finished scanning');

    const status = engine.getStatus();
    assert.equal(status.isScanning, false);
    assert.equal(status.lastResult.status, 'completed');
    assert.equal(status.lastResult.filesScanned, 3);
    assert.equal(status.lastResult.progress, 100);
    assert.deepEqual(status.lastResult.completedTargets, [tmp]);
  });

  it('clears the retained result when the next scan starts', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    await engine.runScan('quick', [tmp], 'First scan');
    assert.ok(engine.getStatus().lastResult);

    let releaseScan;
    mockClamEngine.scanFile = () => new Promise((resolve) => { releaseScan = resolve; });
    const pending = engine.runScan('full', [tmp], 'Second scan');
    await waitFor(() => typeof releaseScan === 'function');

    const active = engine.getStatus();
    assert.equal(active.lastResult, null);
    assert.equal(active.currentScan.scanType, 'full');
    assert.equal(active.progressEstimated, true);

    releaseScan({ success: true, threatsFound: 0, filesScanned: 1, threats: [], output: '' });
    await pending;
  });

  it('does not retain folder-watch results as user-facing history', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );

    await engine.runScan('folderwatch', [tmp], 'Watching...');
    assert.equal(engine.getStatus().lastResult, null);
  });

  it('marks the scan failed, never completed-clean, when the scanner fails (BUG-5)', async () => {
    const failingClam = {
      ...mockClamEngine,
      scanFile: async () => ({
        success: false,
        error: 'clamscan exited with code 3',
        threats: [],
        threatsFound: 0,
        filesScanned: 0,
        output: ''
      })
    };
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      failingClam,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    const target = path.join(tmp, 'victim.txt');
    fs.writeFileSync(target, 'content');
    await engine.runCustomScan([target]);
    const lastResult = engine.getStatus().lastResult;
    assert.equal(lastResult.status, 'failed');
    assert.equal(lastResult.threatsFound, 0);
    assert.ok(lastResult.errors.length > 0);
  });
});
