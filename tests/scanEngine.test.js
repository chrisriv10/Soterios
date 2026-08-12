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

    await folderwatchPromise;
    assert.equal(engine.isFolderWatchScanning, false);
    assert.equal(engine.isScanning, false);
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
});
