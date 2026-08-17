'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const util = require('util');

describe('SystemAudit', () => {
  let SystemAudit;
  let originalExec;
  let mockExecResults = [];
  let currentExecHandler;

  /**
   * Creates a mock child_process.exec function for SystemAudit tests.
   *
   * @returns {Function} Mock exec function.
   */
  const makeMockExec = () => {
    /**
     * Mock exec implementation.
     *
     * @param {string} command - Command to run.
     * @param {Object} [options] - Execution options.
     * @param {Function} [callback] - Optional callback.
     * @returns {Promise<{stdout: string, stderr: string}>} Mock result.
     */
    const fn = (command, options, callback) => { };
    fn[util.promisify.custom] = async (command, options) => {
      return currentExecHandler(command, options);
    };
    return fn;
  };

  beforeEach(() => {
    // Mock exec to avoid running actual PowerShell commands
    originalExec = childProcess.exec;
    mockExecResults = [];

    currentExecHandler = (command, options) => {
      mockExecResults.push({ command, options });

      // Return mock results based on command
      if (command.includes('Get-MpComputerStatus')) {
        return {
          stdout: JSON.stringify({
            AMServiceEnabled: true,
            AntivirusEnabled: true,
            RealTimeProtectionEnabled: true,
            AMEngineVersion: '1.1.21000.0',
            AntivirusSignatureVersion: '1.371.1234.0',
            AntivirusSignatureAge: 1
          }),
          stderr: ''
        };
      }

      if (command.includes('EnableLUA')) {
        return { stdout: '1', stderr: '' };
      }

      if (command.includes('Microsoft.Update.Session')) {
        return { stdout: '0', stderr: '' };
      }

      if (command.includes('Get-BitLockerVolume')) {
        return {
          stdout: JSON.stringify([{ ProtectionStatus: 1 }]),
          stderr: ''
        };
      }

      if (command.includes('Get-ExecutionPolicy')) {
        return { stdout: 'RemoteSigned', stderr: '' };
      }

      if (command.includes('Confirm-SecureBootUEFI')) {
        return { stdout: 'True', stderr: '' };
      }

      // Default error response
      const error = new Error('Command failed');
      error.killed = false;
      error.signal = null;
      error.stderr = 'Mock error';
      throw error;
    };

    childProcess.exec = makeMockExec();

    // Clear require cache and re-require to pick up the mock
    delete require.cache[require.resolve('../src/security/SystemAudit')];
    SystemAudit = require('../src/security/SystemAudit');
  });

  afterEach(() => {
    childProcess.exec = originalExec;
    // Do NOT delete the promisify custom symbol from originalExec —
    // it is non-configurable on Node 22+, and deleting it in strict
    // mode throws a TypeError.
  });

  it('runPowerShell executes PowerShell command successfully', async () => {
    const audit = new SystemAudit();
    const result = await audit.runPowerShell('Get-MpComputerStatus');
    assert.equal(result.ok, true);
    assert.ok(result.stdout);
  });

  it('runPowerShell handles command errors', async () => {
    const audit = new SystemAudit();
    // Force an error by using a command that doesn't match our mocks
    const result = await audit.runPowerShell('Invalid-Command');
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('runPowerShell handles timeout', async () => {
    const audit = new SystemAudit();
    // Mock a timeout scenario
    currentExecHandler = async () => {
      const error = new Error('Timeout');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    };
    
    const result = await audit.runPowerShell('Get-Process', 5000);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('timed out'));
  });

  it('checkDefender returns pass when Defender is enabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.ok(results.length > 0);
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('enabled'));
  });

  it('checkDefender returns fail when Defender is disabled', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({
          AMServiceEnabled: true,
          AntivirusEnabled: false,
          RealTimeProtectionEnabled: false,
          AMEngineVersion: '1.1.21000.0',
          AntivirusSignatureVersion: '1.371.1234.0',
          AntivirusSignatureAge: 1
        }),
        stderr: ''
      };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('disabled'));
  });

  it('checkDefender handles parse errors', async () => {
    currentExecHandler = async () => {
      return { stdout: 'invalid json', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.equal(results[0].status, 'error');
    assert.ok(results[0].message.includes('Could not parse'));
  });

  it('checkDefender handles query failures', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.equal(results[0].status, 'error');
    assert.ok(results[0].message.includes('Failed to query'));
  });

  it('checkUac returns pass when UAC is enabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkUac();
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('enabled'));
  });

  it('checkUac returns fail when UAC is disabled', async () => {
    currentExecHandler = async () => {
      return { stdout: '0', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkUac();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('disabled'));
  });

  it('checkUac handles query failures', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkUac();
    assert.equal(results[0].status, 'error');
    assert.ok(results[0].message.includes('Could not check'));
  });

  it('checkWindowsUpdate returns pass when no updates pending', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkWindowsUpdate();
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('No pending'));
  });

  it('checkWindowsUpdate returns warn when updates pending', async () => {
    currentExecHandler = async () => {
      return { stdout: '5', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkWindowsUpdate();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('5 update'));
  });

  it('checkWindowsUpdate handles parse errors', async () => {
    currentExecHandler = async () => {
      return { stdout: 'invalid', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkWindowsUpdate();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('Could not parse'));
  });

  it('checkWindowsUpdate handles query failures', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkWindowsUpdate();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('Could not query'));
  });

  it('checkBitLocker returns pass when drive is encrypted', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkBitLocker();
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('encrypted'));
  });

  it('checkBitLocker returns warn when drive not encrypted', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify([{ ProtectionStatus: 0 }]),
        stderr: ''
      };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkBitLocker();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('NOT encrypted'));
  });

  it('checkBitLocker handles unsupported systems', async () => {
    currentExecHandler = async () => {
      throw new Error('Not supported');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkBitLocker();
    assert.equal(results[0].status, 'info');
    assert.ok(results[0].message.includes('not available'));
  });

  it('checkExecutionPolicy returns pass for secure policies', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkExecutionPolicy();
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('RemoteSigned'));
  });

  it('checkExecutionPolicy returns warn for insecure policies', async () => {
    currentExecHandler = async () => {
      return { stdout: 'Unrestricted', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkExecutionPolicy();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('Unrestricted'));
  });

  it('checkExecutionPolicy handles query failures', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkExecutionPolicy();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('failed'));
  });

  it('checkSecureBoot returns pass when enabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkSecureBoot();
    assert.equal(results[0].status, 'pass');
    assert.ok(results[0].message.includes('enabled'));
  });

  it('checkSecureBoot returns fail when disabled', async () => {
    currentExecHandler = async () => {
      return { stdout: 'False', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkSecureBoot();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('disabled'));
  });

  it('checkSecureBoot handles unsupported systems', async () => {
    currentExecHandler = async () => {
      throw new Error('Not supported');
    };
    
    const audit = new SystemAudit();
    const results = await audit.checkSecureBoot();
    assert.equal(results[0].status, 'info');
    assert.ok(results[0].message.includes('could not be determined'));
  });

  it('runAudit executes all checks concurrently', async () => {
    const progressCalls = [];
    const audit = new SystemAudit();
    
    const results = await audit.runAudit((progress) => {
      progressCalls.push(progress);
    });
    
    // Should return results from all 6 checks
    assert.ok(results.length >= 6);
    
    // Should have called progress callback
    assert.ok(progressCalls.length > 0);
    
    // Progress should include start and complete events
    assert.ok(progressCalls.some(p => p.type === 'start'));
    assert.ok(progressCalls.some(p => p.type === 'complete'));
  });

  it('runAudit returns results in expected order', async () => {
    const audit = new SystemAudit();
    const results = await audit.runAudit();
    
    // Results should be flattened in specific order
    const resultNames = results.map(r => r.name);
    assert.ok(resultNames.some(n => n.includes('Windows Defender')));
    assert.ok(resultNames.includes('User Account Control (UAC)'));
    assert.ok(resultNames.includes('Windows Updates'));
    assert.ok(resultNames.includes('BitLocker Drive Encryption'));
    assert.ok(resultNames.includes('PowerShell Execution Policy'));
    assert.ok(resultNames.includes('Secure Boot'));
  });

  it('runAudit works without progress callback', async () => {
    const audit = new SystemAudit();
    const results = await audit.runAudit();
    assert.ok(results.length >= 6);
  });

  it('runAudit handles individual check failures gracefully', async () => {
    // Make one check fail
    let callCount = 0;
    currentExecHandler = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('First check failed');
      }
      return { stdout: '1', stderr: '' };
    };
    
    const audit = new SystemAudit();
    const results = await audit.runAudit();
    
    // Should still return results for all checks
    assert.ok(results.length >= 6);
    
    // At least one should have error status
    assert.ok(results.some(r => r.status === 'error' || r.status === 'warn'));
  });
});
