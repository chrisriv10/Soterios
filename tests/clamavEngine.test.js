'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// Mock the spawn function to avoid actually running clamscan
let mockSpawn = null;
let mockSpawnArgs = [];
let mockSpawnCallbacks = {};

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {
    proc.emit('close', 1);
  };
  return proc;
}

describe('ClamAVEngine', () => {
  let tmp;
  let ClamAVEngine;
  let originalSpawn;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-clamav-'));
    
    // Create mock clamav directory structure
    const clamavDir = path.join(tmp, 'clamav');
    fs.mkdirSync(clamavDir, { recursive: true });
    fs.mkdirSync(path.join(clamavDir, 'database'), { recursive: true });
    fs.mkdirSync(path.join(clamavDir, 'certs'), { recursive: true });
    
    // Create mock executables
    fs.writeFileSync(path.join(clamavDir, 'clamscan.exe'), 'mock');
    fs.writeFileSync(path.join(clamavDir, 'freshclam.exe'), 'mock');
    
    // Mock spawn
    originalSpawn = require('child_process').spawn;
    mockSpawnArgs = [];
    mockSpawnCallbacks = {};
    
    require('child_process').spawn = function(exe, args, options) {
      mockSpawnArgs.push({ exe, args, options });
      const proc = createMockProcess();
      
      // Simulate successful freshclam update
      if (exe.includes('freshclam')) {
        setTimeout(() => {
          proc.stdout.emit('data', 'ClamAV update process started\n');
          proc.stdout.emit('data', 'Downloading main.cvd\n');
          proc.stdout.emit('data', 'Downloading daily.cvd\n');
          proc.emit('close', 0);
        }, 10);
      }
      
      // Simulate successful clamscan
      if (exe.includes('clamscan')) {
        setTimeout(() => {
          proc.stdout.emit('data', '/test/file: OK\n');
          proc.emit('close', 0);
        }, 10);
      }
      
      return proc;
    };
    
    // Clear require cache to get fresh module
    delete require.cache[require.resolve('../src/security/ClamAVEngine')];
    ClamAVEngine = require('../src/security/ClamAVEngine');
  });

  afterEach(() => {
    require('child_process').spawn = originalSpawn;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('constructor resolves baseDir from candidates', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    assert.ok(engine.baseDir.includes('clamav'));
    assert.ok(engine.clamscanPath.includes('clamscan.exe'));
    assert.ok(engine.freshclamPath.includes('freshclam.exe'));
    assert.equal(engine.isReady, false);
  });

  it('constructor uses fallback when baseDir not provided', () => {
    const engine = new ClamAVEngine();
    assert.ok(engine.baseDir);
    assert.ok(engine.clamscanPath);
    assert.ok(engine.freshclamPath);
  });

  it('init creates dbDir and sets isReady when clamscan exists', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    await engine.init();
    assert.equal(engine.isReady, true);
    assert.ok(fs.existsSync(engine.dbDir));
  });

  it('init sets isReady false when clamscan not found', async () => {
    const badDir = path.join(tmp, 'bad-clamav');
    fs.mkdirSync(badDir, { recursive: true });
    const engine = new ClamAVEngine({ baseDir: badDir });
    await engine.init();
    assert.equal(engine.isReady, false);
  });

  it('getStatus returns current engine state', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    await engine.init();
    const status = engine.getStatus();
    assert.equal(status.ready, true);
    assert.equal(typeof status.hasDefinitions, 'boolean');
    assert.equal(status.baseDir, engine.baseDir);
    assert.equal(status.dbDir, engine.dbDir);
  });

  it('hasVirusDatabase returns false when no db files exist', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    assert.equal(engine.hasVirusDatabase(), false);
  });

  it('hasVirusDatabase returns true when cvd files exist', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'main.cvd'), 'mock');
    assert.equal(engine.hasVirusDatabase(), true);
  });

  it('hasVirusDatabase returns true when cld files exist', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'daily.cld'), 'mock');
    assert.equal(engine.hasVirusDatabase(), true);
  });

  it('hasVirusDatabase returns true when hdb files exist', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'test.hdb'), 'mock');
    assert.equal(engine.hasVirusDatabase(), true);
  });

  it('toClamPath converts Windows paths to forward slashes', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const result = engine.toClamPath('C:\\Program Files\\test');
    assert.equal(result, 'C:/Program Files/test');
  });

  it('ensureFreshclamConfig creates config file', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const configPath = engine.ensureFreshclamConfig();
    assert.ok(fs.existsSync(configPath));
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(content.includes('DatabaseDirectory'));
    assert.ok(content.includes('DatabaseMirror'));
  });

  it('ensureFreshclamConfig includes certs dir when exists', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const configPath = engine.ensureFreshclamConfig();
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(content.includes('CVDCertsDirectory'));
  });

  it('updateDefinitions returns success when freshclam succeeds', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const result = await engine.updateDefinitions();
    assert.equal(result.success, true);
  });

  it('updateDefinitions returns error when freshclam not found', async () => {
    const badDir = path.join(tmp, 'bad-clamav');
    fs.mkdirSync(badDir, { recursive: true });
    const engine = new ClamAVEngine({ baseDir: badDir });
    const result = await engine.updateDefinitions();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));
  });

  it('scanFile returns error when not ready', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const result = await engine.scanFile(path.join(tmp, 'test.txt'));
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not ready'));
  });

  it('scanFile scans file successfully when ready', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    // Create a mock database file to make it ready
    fs.writeFileSync(path.join(engine.dbDir, 'main.cvd'), 'mock');
    await engine.init();
    
    const testFile = path.join(tmp, 'test.txt');
    fs.writeFileSync(testFile, 'test content');
    
    const result = await engine.scanFile(testFile);
    assert.equal(result.success, true);
    assert.equal(result.threatsFound, 0);
  });

  it('scanFile returns error for non-existent file', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'main.cvd'), 'mock');
    await engine.init();
    
    const result = await engine.scanFile(path.join(tmp, 'nonexistent.txt'));
    assert.equal(result.success, false);
  });

  it('scanFile scans directory recursively', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'main.cvd'), 'mock');
    await engine.init();
    
    const testDir = path.join(tmp, 'testdir');
    fs.mkdirSync(testDir);
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'content');
    
    const result = await engine.scanFile(testDir);
    assert.equal(result.success, true);
  });

  it('abortCurrentScan kills active scan process', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    fs.writeFileSync(path.join(engine.dbDir, 'main.cvd'), 'mock');
    await engine.init();
    
    const testFile = path.join(tmp, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    
    // Start a scan (it will be mocked)
    const scanPromise = engine.scanFile(testFile);
    
    // Abort immediately
    const killed = engine.abortCurrentScan();
    assert.equal(killed, true);
  });

  it('abortCurrentScan returns false when no active process', () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    const killed = engine.abortCurrentScan();
    assert.equal(killed, false);
  });

  it('init attempts update when no database exists', async () => {
    const engine = new ClamAVEngine({ baseDir: path.join(tmp, 'clamav') });
    // Ensure no database files exist
    const dbFiles = fs.readdirSync(engine.dbDir);
    dbFiles.forEach(f => fs.unlinkSync(path.join(engine.dbDir, f)));
    
    await engine.init();
    // Should still be ready even if update fails (graceful degradation)
    assert.equal(engine.isReady, true);
  });
});
