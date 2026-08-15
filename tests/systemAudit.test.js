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

  const makeMockExec = () => {
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
      if (command.includes('Get-MpPreference')) {
        return {
          stdout: JSON.stringify({
            tamperProtected: true,
            cloudProtectionLevel: 2,
            networkProtection: true
          }),
          stderr: ''
        };
      }

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

      if (command.includes('LanmanServer')) {
        return { stdout: '0', stderr: '' };
      }

      if (command.includes('Winlogon')) {
        return {
          stdout: JSON.stringify({ autoAdminLogon: '', hasDefaultPassword: false }),
          stderr: ''
        };
      }

      if (command.includes('Terminal Server')) {
        return {
          stdout: JSON.stringify({ rdpEnabled: false, nlaEnabled: false }),
          stderr: ''
        };
      }

      if (command.includes('RunAsPPL')) {
        return { stdout: '1', stderr: '' };
      }

      if (command.includes('WinNT://')) {
        return {
          stdout: JSON.stringify({ minLength: 12, lockout: 5, complexity: true, guestDisabled: true }),
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

  it('checkDefender results carry Windows Security manage URI', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.ok(results.every((r) => r.actionUri === 'ms-settings:windowsdefender'));
  });

  it('checkDefender error branches carry Windows Security manage URI', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    const audit = new SystemAudit();
    const results = await audit.checkDefender();
    assert.equal(results[0].status, 'error');
    assert.equal(results[0].actionUri, 'ms-settings:windowsdefender');
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

  it('checkUac results carry UAC settings manage URI', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkUac();
    assert.equal(results[0].actionUri, 'control userpasswords2');
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
    assert.ok(results[0].message.includes('5 mandatory update'));
    assert.equal(results[0].actionUri, 'ms-settings:windowsupdate');
  });

  it('checkWindowsUpdate pass branch carries manage URI', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkWindowsUpdate();
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].actionUri, 'ms-settings:windowsupdate');
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

  it('checkBitLocker results carry BitLocker manage URI', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkBitLocker();
    assert.equal(results[0].actionUri, 'control /name Microsoft.BitLockerDriveEncryption');
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

  it('checkExecutionPolicy results carry open-powershell manage action', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkExecutionPolicy();
    assert.equal(results[0].manageAction, 'open-powershell');
  });

  it('checkExecutionPolicy error branch carries open-powershell manage action', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    const audit = new SystemAudit();
    const results = await audit.checkExecutionPolicy();
    assert.equal(results[0].status, 'warn');
    assert.equal(results[0].manageAction, 'open-powershell');
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

  it('checkSecureBoot results carry recovery settings manage URI', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkSecureBoot();
    assert.equal(results[0].actionUri, 'ms-settings:recovery');
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

  it('checkDefenderHardening returns pass rows when protections are on', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkDefenderHardening();
    assert.equal(results.length, 3);
    assert.equal(results[0].name, 'Tamper Protection');
    assert.equal(results[1].name, 'Cloud-delivered Protection');
    assert.equal(results[2].name, 'Network Protection');
    assert.ok(results.every((r) => r.status === 'pass'));
    assert.ok(results.every((r) => r.section === 'antivirus'));
    assert.ok(results.every((r) => r.actionUri === 'ms-settings:windowsdefender'));
  });

  it('checkDefenderHardening flags tamper protection off', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ tamperProtected: false, cloudProtectionLevel: 2, networkProtection: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkDefenderHardening();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('Tamper protection is off'));
    assert.ok(results[0].recommendation.length > 0);
  });

  it('checkDefenderHardening flags cloud protection off', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ tamperProtected: true, cloudProtectionLevel: 0, networkProtection: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkDefenderHardening();
    assert.equal(results[1].status, 'fail');
    assert.ok(results[1].message.includes('off'));
  });

  it('checkDefenderHardening flags network protection off', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ tamperProtected: true, cloudProtectionLevel: 2, networkProtection: false }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkDefenderHardening();
    assert.equal(results[2].status, 'fail');
    assert.ok(results[2].message.includes('off'));
  });

  it('checkDefenderHardening handles query failures with manage URI', async () => {
    currentExecHandler = async () => {
      throw new Error('Query failed');
    };
    const audit = new SystemAudit();
    const results = await audit.checkDefenderHardening();
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.status === 'error'));
    assert.ok(results.every((r) => r.actionUri === 'ms-settings:windowsdefender'));
  });

  it('checkSmb1 returns pass when SMBv1 is disabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkSmb1();
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].name, 'SMBv1');
    assert.equal(results[0].section, 'system');
    assert.equal(results[0].actionUri, 'control /name Microsoft.WindowsOptionalFeatures');
  });

  it('checkSmb1 returns fail when SMBv1 is enabled', async () => {
    currentExecHandler = async () => {
      return { stdout: '1', stderr: '' };
    };
    const audit = new SystemAudit();
    const results = await audit.checkSmb1();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('enabled'));
  });

  it('checkSmb1 warns when status cannot be confirmed', async () => {
    currentExecHandler = async () => {
      return { stdout: '', stderr: '' };
    };
    const audit = new SystemAudit();
    const results = await audit.checkSmb1();
    assert.equal(results[0].status, 'warn');
  });

  it('checkAutoLogon returns pass when disabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkAutoLogon();
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].name, 'Automatic Logon');
    assert.equal(results[0].section, 'accounts');
    assert.equal(results[0].actionUri, 'control userpasswords2');
  });

  it('checkAutoLogon warns when enabled without stored password', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ autoAdminLogon: '1', hasDefaultPassword: false }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAutoLogon();
    assert.equal(results[0].status, 'warn');
  });

  it('checkAutoLogon fails when a plaintext password is stored', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ autoAdminLogon: '1', hasDefaultPassword: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAutoLogon();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('plaintext'));
  });

  it('checkRemoteDesktop returns pass when disabled', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkRemoteDesktop();
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].name, 'Remote Desktop');
    assert.equal(results[0].section, 'system');
    assert.equal(results[0].actionUri, 'ms-settings:system-remote-desktop');
  });

  it('checkRemoteDesktop warns when enabled with NLA', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ rdpEnabled: true, nlaEnabled: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkRemoteDesktop();
    assert.equal(results[0].status, 'warn');
  });

  it('checkRemoteDesktop fails when enabled without NLA', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ rdpEnabled: true, nlaEnabled: false }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkRemoteDesktop();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('WITHOUT Network Level Authentication'));
    assert.ok(results[0].recommendation.length > 0);
  });

  it('checkLsaProtection returns pass when RunAsPPL is set', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkLsaProtection();
    assert.equal(results[0].status, 'pass');
    assert.equal(results[0].name, 'LSA Protection');
    assert.equal(results[0].manageAction, 'open-powershell');
  });

  it('checkLsaProtection fails when RunAsPPL is off', async () => {
    currentExecHandler = async () => {
      return { stdout: '0', stderr: '' };
    };
    const audit = new SystemAudit();
    const results = await audit.checkLsaProtection();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].message.includes('off'));
  });

  it('checkLsaProtection reports info when value is not set', async () => {
    currentExecHandler = async () => {
      return { stdout: '', stderr: '' };
    };
    const audit = new SystemAudit();
    const results = await audit.checkLsaProtection();
    assert.equal(results[0].status, 'info');
  });

  it('checkAccounts returns pass for strong policy and disabled guest', async () => {
    const audit = new SystemAudit();
    const results = await audit.checkAccounts();
    assert.equal(results.length, 2);
    assert.equal(results[0].name, 'Password Policy');
    assert.equal(results[1].name, 'Guest Account');
    assert.ok(results.every((r) => r.section === 'accounts'));
    assert.ok(results.every((r) => r.manageAction === 'open-powershell'));
    assert.ok(results.every((r) => r.status === 'pass'));
  });

  it('checkAccounts fails when guest account is enabled', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ minLength: 12, lockout: 5, complexity: true, guestDisabled: false }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAccounts();
    assert.equal(results[1].status, 'fail');
    assert.ok(results[1].message.includes('enabled'));
  });

  it('checkAccounts fails when password policy is weak', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ minLength: 0, lockout: 0, complexity: false, guestDisabled: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAccounts();
    assert.equal(results[0].status, 'fail');
    assert.ok(results[0].recommendation.length > 0);
  });

  it('checkAccounts warns for moderate policy', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ minLength: 10, lockout: 5, complexity: false, guestDisabled: true }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAccounts();
    assert.equal(results[0].status, 'warn');
  });

  it('checkAccounts warns when policy cannot be determined', async () => {
    currentExecHandler = async () => {
      return {
        stdout: JSON.stringify({ minLength: null, lockout: null, complexity: null, guestDisabled: false }),
        stderr: ''
      };
    };
    const audit = new SystemAudit();
    const results = await audit.checkAccounts();
    assert.equal(results[0].status, 'warn');
    assert.ok(results[0].message.includes('could not be determined'));
    assert.equal(results[1].status, 'fail');
  });

  it('runAudit executes all checks concurrently', async () => {
    const progressCalls = [];
    const audit = new SystemAudit();
    
    const results = await audit.runAudit((progress) => {
      progressCalls.push(progress);
    });
    
    // Should return results from all 12 checks (16 result rows)
    assert.ok(results.length >= 12);
    
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
    assert.ok(resultNames.includes('Tamper Protection'));
    assert.ok(resultNames.includes('Cloud-delivered Protection'));
    assert.ok(resultNames.includes('Network Protection'));
    assert.ok(resultNames.includes('SMBv1'));
    assert.ok(resultNames.includes('Automatic Logon'));
    assert.ok(resultNames.includes('Remote Desktop'));
    assert.ok(resultNames.includes('LSA Protection'));
    assert.ok(resultNames.includes('Password Policy'));
    assert.ok(resultNames.includes('Guest Account'));
  });

  it('runAudit results carry section keys for grouping', async () => {
    const audit = new SystemAudit();
    const results = await audit.runAudit();
    const sections = new Set(results.map((r) => r.section));
    assert.ok(sections.has('antivirus'));
    assert.ok(sections.has('system'));
    assert.ok(sections.has('accounts'));
    assert.ok(sections.has('updates'));
  });

  it('runAudit works without progress callback', async () => {
    const audit = new SystemAudit();
    const results = await audit.runAudit();
    assert.ok(results.length >= 12);
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
    assert.ok(results.length >= 12);
    
    // At least one should have error status
    assert.ok(results.some(r => r.status === 'error' || r.status === 'warn'));
  });
});
