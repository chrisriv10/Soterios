'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

describe('windowsChecks', () => {
  let windowsChecks;
  let originalExecFile;
  let mockExecResults = [];

  beforeEach(() => {
    // Mock execFile to avoid running actual PowerShell commands
    originalExecFile = childProcess.execFile;
    mockExecResults = [];
    
    childProcess.execFile = (command, args, options, callback) => {
      mockExecResults.push({ command, args, options });
      
      // Simulate successful PowerShell execution
      const script = args[args.length - 1];
      
      if (script.includes('Get-MpComputerStatus')) {
        callback(null, JSON.stringify({
          available: true,
          antivirusEnabled: true,
          realTimeProtectionEnabled: true,
          antispywareEnabled: true,
          signaturesAge: 1,
          engineVersion: '1.1.21000.0',
          signatureVersion: '1.371.1234.0'
        }), '');
        return;
      }
      
      if (script.includes('Get-NetFirewallProfile')) {
        callback(null, JSON.stringify([
          { Name: 'Domain', Enabled: true, DefaultInboundAction: 'Block', DefaultOutboundAction: 'Allow' },
          { Name: 'Private', Enabled: true, DefaultInboundAction: 'Block', DefaultOutboundAction: 'Allow' },
          { Name: 'Public', Enabled: true, DefaultInboundAction: 'Block', DefaultOutboundAction: 'Block' }
        ]), '');
        return;
      }
      
      if (script.includes('Microsoft.Update.Session')) {
        callback(null, JSON.stringify({
          pendingCount: 0,
          lastUpdateDate: '2024-01-15',
          lastUpdateTitle: 'Security Update'
        }), '');
        return;
      }
      
      if (script.includes('Get-AuthenticodeSignature')) {
        callback(null, JSON.stringify({
          status: 'Valid',
          publisher: 'CN=Microsoft Corporation'
        }), '');
        return;
      }
      
      if (script.includes('Get-ScheduledTask')) {
        callback(null, JSON.stringify([
          { TaskName: 'Task1', TaskPath: '\\Task1', State: 'Ready', Actions: [{ Execute: 'C:\\test.exe', Arguments: '' }] }
        ]), '');
        return;
      }
      
      if (script.includes('Get-CimInstance Win32_Service')) {
        callback(null, JSON.stringify([
          { Name: 'TestService', DisplayName: 'Test Service', PathName: '"C:\\test.exe"', StartMode: 'Auto', State: 'Running' }
        ]), '');
        return;
      }
      
      if (script.includes('Registry Run')) {
        callback(null, JSON.stringify([
          { source: 'Registry Run', name: 'TestApp', command: 'C:\\test.exe', location: 'HKCU\\Run', path: null }
        ]), '');
        return;
      }
      
      // Default error
      callback(new Error('Command failed'), '', 'Mock error');
    };
    
    // Clear require cache
    delete require.cache[require.resolve('../src/security/windowsChecks')];
    windowsChecks = require('../src/security/windowsChecks');
  });

  afterEach(() => {
    childProcess.execFile = originalExecFile;
  });

  it('asArray returns empty array for null/undefined', () => {
    assert.deepEqual(windowsChecks.asArray(null), []);
    assert.deepEqual(windowsChecks.asArray(undefined), []);
  });

  it('asArray returns array for single value', () => {
    assert.deepEqual(windowsChecks.asArray('test'), ['test']);
    assert.deepEqual(windowsChecks.asArray(123), [123]);
  });

  it('asArray returns array as-is for arrays', () => {
    const arr = [1, 2, 3];
    assert.deepEqual(windowsChecks.asArray(arr), arr);
  });

  it('runPowerShell returns error on non-Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    
    const result = await windowsChecks.runPowerShell('Get-Process');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Windows checks are only available'));
    
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('runPowerShell executes successfully on Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      const result = await windowsChecks.runPowerShell('Get-Process');
      assert.equal(result.ok, true);
      assert.ok(result.stdout);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('runPowerShell handles errors', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      childProcess.execFile = (command, args, options, callback) => {
        callback(new Error('Failed'), '', 'Error output');
      };
      
      const result = await windowsChecks.runPowerShell('Invalid-Command');
      assert.equal(result.ok, false);
      assert.ok(result.error);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('runJsonPowerShell parses JSON output successfully', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      const result = await windowsChecks.runJsonPowerShell('Get-Process');
      assert.equal(result.ok, true);
      assert.ok(result.data);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('runJsonPowerShell handles parse errors', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      childProcess.execFile = (command, args, options, callback) => {
        callback(null, 'invalid json', '');
      };
      
      const result = await windowsChecks.runJsonPowerShell('Get-Process');
      assert.equal(result.ok, false);
      assert.ok(result.error);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('runJsonPowerShell returns fallback on empty output', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      childProcess.execFile = (command, args, options, callback) => {
        callback(null, '', '');
      };
      
      const fallback = { test: 'fallback' };
      const result = await windowsChecks.runJsonPowerShell('Get-Process', fallback);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, fallback);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('runJsonPowerShell returns fallback on PowerShell error', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      childProcess.execFile = (command, args, options, callback) => {
        callback(new Error('Failed'), '', 'Error');
      };
      
      const fallback = { test: 'fallback' };
      const result = await windowsChecks.runJsonPowerShell('Get-Process', fallback);
      assert.equal(result.ok, false);
      assert.deepEqual(result.data, fallback);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('getDefenderStatus returns available status on Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      const result = await windowsChecks.getDefenderStatus();
      assert.equal(result.available, true);
      assert.equal(result.antivirusEnabled, true);
      assert.equal(result.realTimeProtectionEnabled, true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('getDefenderStatus returns unavailable on non-Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    
    const result = await windowsChecks.getDefenderStatus();
    assert.equal(result.available, false);
    assert.ok(result.error);
    
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('getDefenderStatus handles all strategy failures', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    
    try {
      childProcess.execFile = (command, args, options, callback) => {
        callback(new Error('All strategies failed'), '', 'Error');
      };
      
      const result = await windowsChecks.getDefenderStatus();
      assert.equal(result.available, false);
      assert.ok(result.error);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('getFirewallStatus returns firewall profiles', async () => {
    const result = await windowsChecks.getFirewallStatus();
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    assert.ok(result[0].name);
    assert.equal(typeof result[0].enabled, 'boolean');
  });

  it('getFirewallStatus handles empty results', async () => {
    execFile = (command, args, options, callback) => {
      callback(null, '[]', '');
    };
    
    const result = await windowsChecks.getFirewallStatus();
    assert.deepEqual(result, []);
  });

  it('getUpdateStatus returns update information', async () => {
    const result = await windowsChecks.getUpdateStatus();
    assert.equal(result.pendingCount, 0);
    assert.ok(result.lastUpdateDate);
  });

  it('getUpdateStatus returns unavailable on non-Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    
    const result = await windowsChecks.getUpdateStatus();
    assert.equal(result.pendingCount, null);
    assert.ok(result.error);
    
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('getUpdateStatus handles all strategy failures', async () => {
    execFile = (command, args, options, callback) => {
      callback(new Error('All strategies failed'), '', 'Error');
    };
    
    const result = await windowsChecks.getUpdateStatus();
    assert.equal(result.pendingCount, null);
    assert.ok(result.error);
  });

  it('getSignatureInfo returns signature status', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-sig-'));
    const testFile = path.join(tmp, 'test.exe');
    fs.writeFileSync(testFile, 'test');
    
    const result = await windowsChecks.getSignatureInfo(testFile);
    assert.equal(result.status, 'Valid');
    assert.ok(result.publisher);
    
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('getSignatureInfo returns unknown for non-existent file', async () => {
    const result = await windowsChecks.getSignatureInfo('C:\\nonexistent.exe');
    assert.equal(result.status, 'Unknown');
    assert.equal(result.publisher, null);
  });

  it('getSignatureInfo returns unknown on non-Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    
    const result = await windowsChecks.getSignatureInfo('test.exe');
    assert.equal(result.status, 'Unknown');
    assert.equal(result.publisher, null);
    
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('isExecutablePath returns true for executable extensions', () => {
    assert.equal(windowsChecks.isExecutablePath('test.exe'), true);
    assert.equal(windowsChecks.isExecutablePath('test.dll'), true);
    assert.equal(windowsChecks.isExecutablePath('test.sys'), true);
    assert.equal(windowsChecks.isExecutablePath('test.scr'), true);
    assert.equal(windowsChecks.isExecutablePath('test.com'), true);
    assert.equal(windowsChecks.isExecutablePath('test.msi'), true);
  });

  it('isExecutablePath returns false for non-executable extensions', () => {
    assert.equal(windowsChecks.isExecutablePath('test.txt'), false);
    assert.equal(windowsChecks.isExecutablePath('test.pdf'), false);
    assert.equal(windowsChecks.isExecutablePath('test.jpg'), false);
    assert.equal(windowsChecks.isExecutablePath('test'), false);
  });

  it('isExecutablePath is case-insensitive', () => {
    assert.equal(windowsChecks.isExecutablePath('test.EXE'), true);
    assert.equal(windowsChecks.isExecutablePath('test.DLL'), true);
    assert.equal(windowsChecks.isExecutablePath('test.Exe'), true);
  });

  it('suspiciousPathSignals detects AppData locations', () => {
    const signals = windowsChecks.suspiciousPathSignals('C:\\Users\\test\\AppData\\Roaming\\test.exe');
    assert.ok(signals.some(s => s.message.includes('AppData')));
  });

  it('suspiciousPathSignals detects temp locations', () => {
    const signals = windowsChecks.suspiciousPathSignals('C:\\Users\\test\\AppData\\Local\\Temp\\test.exe');
    assert.ok(signals.some(s => s.message.includes('temporary')));
  });

  it('suspiciousPathSignals detects Windows temp', () => {
    const signals = windowsChecks.suspiciousPathSignals('C:\\Windows\\Temp\\test.exe');
    assert.ok(signals.some(s => s.message.includes('writable Windows')));
  });

  it('suspiciousPathSignals detects recycle bin', () => {
    const signals = windowsChecks.suspiciousPathSignals('C:\\$Recycle.Bin\\test.exe');
    assert.ok(signals.some(s => s.message.includes('Recycle Bin')));
  });

  it('suspiciousPathSignals detects double extensions', () => {
    const signals = windowsChecks.suspiciousPathSignals('test.pdf.exe');
    assert.ok(signals.some(s => s.message.includes('double extension')));
  });

  it('suspiciousPathSignals returns empty for safe paths', () => {
    const signals = windowsChecks.suspiciousPathSignals('C:\\Program Files\\test\\test.exe');
    assert.deepEqual(signals, []);
  });

  it('suspiciousPathSignals handles empty/null paths', () => {
    assert.deepEqual(windowsChecks.suspiciousPathSignals(''), []);
    assert.deepEqual(windowsChecks.suspiciousPathSignals(null), []);
    assert.deepEqual(windowsChecks.suspiciousPathSignals(undefined), []);
  });

  it('getStartupFolders returns startup items', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-startup-'));
    const startupFolder = path.join(tmp, 'Startup');
    fs.mkdirSync(startupFolder, { recursive: true });
    fs.writeFileSync(path.join(startupFolder, 'test.lnk'), 'shortcut');
    
    // Mock homedir to use temp directory
    const originalHomedir = os.homedir;
    const originalPlatform = process.platform;
    
    try {
      os.homedir = () => tmp;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      
      const result = await windowsChecks.getStartupFolders();
      assert.ok(Array.isArray(result));
      assert.ok(result.some(item => item.source === 'Startup Folder'));
    } finally {
      os.homedir = originalHomedir;
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('getStartupFolders handles non-existent folders', async () => {
    const result = await windowsChecks.getStartupFolders();
    assert.ok(Array.isArray(result));
  });

  it('getRegistryRunItems returns registry run items', async () => {
    const result = await windowsChecks.getRegistryRunItems();
    assert.ok(Array.isArray(result));
    if (result.length > 0) {
      assert.equal(result[0].source, 'Registry Run');
    }
  });

  it('getRegistryRunItems handles empty results', async () => {
    execFile = (command, args, options, callback) => {
      callback(null, '[]', '');
    };
    
    const result = await windowsChecks.getRegistryRunItems();
    assert.deepEqual(result, []);
  });

  it('getScheduledTasks returns scheduled tasks', async () => {
    const result = await windowsChecks.getScheduledTasks();
    assert.ok(Array.isArray(result));
    if (result.length > 0) {
      assert.equal(result[0].source, 'Scheduled Task');
      assert.ok(result[0].name);
    }
  });

  it('getScheduledTasks handles empty results', async () => {
    execFile = (command, args, options, callback) => {
      callback(null, '[]', '');
    };
    
    const result = await windowsChecks.getScheduledTasks();
    assert.deepEqual(result, []);
  });

  it('getServices returns Windows services', async () => {
    const result = await windowsChecks.getServices();
    assert.ok(Array.isArray(result));
    if (result.length > 0) {
      assert.equal(result[0].source, 'Windows Service');
      assert.ok(result[0].name);
    }
  });

  it('getServices handles empty results', async () => {
    execFile = (command, args, options, callback) => {
      callback(null, '[]', '');
    };
    
    const result = await windowsChecks.getServices();
    assert.deepEqual(result, []);
  });

  it('extractExecutablePath extracts from quoted paths', () => {
    const result = windowsChecks.extractExecutablePath('"C:\\Program Files\\test.exe" /arg');
    assert.equal(result, 'C:\\Program Files\\test.exe');
  });

  it('extractExecutablePath extracts from unquoted paths', () => {
    const result = windowsChecks.extractExecutablePath('C:\\test.exe /arg');
    assert.equal(result, 'C:\\test.exe');
  });

  it('extractExecutablePath handles null/empty', () => {
    assert.equal(windowsChecks.extractExecutablePath(null), null);
    assert.equal(windowsChecks.extractExecutablePath(''), null);
    assert.equal(windowsChecks.extractExecutablePath(undefined), null);
  });

  it('extractExecutablePath handles complex paths', () => {
    const result = windowsChecks.extractExecutablePath('C:\\Program Files\\App\\app.exe --option');
    assert.equal(result, 'C:\\Program Files\\App\\app.exe');
  });

  it('extractExecutablePath handles paths with spaces', () => {
    const result = windowsChecks.extractExecutablePath('"C:\\Program Files\\My App\\app.exe"');
    assert.equal(result, 'C:\\Program Files\\My App\\app.exe');
  });
});
