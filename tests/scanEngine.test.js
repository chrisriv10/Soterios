'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

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
    assert.equal(engine.currentScan, null);
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
    engine.isScanning = true;
    
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
    engine.isScanning = true;
    
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
    engine.isScanning = true;
    
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
    engine.isScanning = true;
    
    const result = await engine.runScan('quick', [tmp], 'Starting...');
    assert.equal(result.error, 'Scan already in progress');
  });

  it('runScan allows folderwatch scan during user scan', async () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    engine.isScanning = true;
    
    const result = await engine.runScan('folderwatch', [tmp], 'Starting...');
    // Should not return error since folderwatch uses separate flag
    assert.equal(result.success, true);
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
    
    engine.isScanning = true;
    engine.currentScan = { scanType: 'quick', paths: [tmp] };
    engine.abortController = { abort: () => {} };
    
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

  it('abortScan returns error when only folderwatch scan is active', () => {
    const engine = new ScanEngine(
      mockDb,
      mockEventBus,
      mockClamEngine,
      mockHeuristicEngine,
      mockReputationEngine,
      mockQuarantineManager
    );
    
    engine.isFolderWatchScanning = true;
    engine.currentScan = { scanType: 'folderwatch', paths: [tmp] };
    
    const result = engine.abortScan();
    assert.equal(result.success, false);
    assert.equal(result.error, 'No user scan in progress');
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
    
    engine.isScanning = true;
    engine.currentScan = { scanType: 'quick', paths: [tmp] };
    engine.abortController = { abort: () => {} };
    
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
    // Should still complete but with quarantine errors
    assert.equal(result.success, true);
    assert.ok(result.errors.some(e => e.includes('Failed to quarantine')));
  });
});
