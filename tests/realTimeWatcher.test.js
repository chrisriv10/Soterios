const { test } = require('node:test');
const assert = require('node:assert/strict');
const RealTimeWatcher = require('../src/security/RealTimeWatcher');

const tamperProtectionError = 'Windows Defender Tamper Protection is preventing this app from changing real-time protection. Disable Tamper Protection in Windows Security > Virus & threat protection settings, then try again.';

test('start() returns a tamper protection error when Defender does not actually enable real-time protection', async () => {
  const watcher = new RealTimeWatcher();
  watcher.audit.runPowerShell = async (script) => {
    if (script.includes('Set-MpPreference')) {
      return { ok: true, stdout: '', stderr: '' };
    }
    if (script.includes('Get-MpComputerStatus')) {
      return { ok: true, stdout: 'False', stderr: '' };
    }
    throw new Error(`Unexpected script: ${script}`);
  };

  const result = await watcher.start();

  assert.deepStrictEqual(result, {
    ok: false,
    enabled: false,
    error: tamperProtectionError
  });
});

test('stop() returns a tamper protection error when Defender does not actually disable real-time protection', async () => {
  const watcher = new RealTimeWatcher();
  watcher.audit.runPowerShell = async (script) => {
    if (script.includes('Set-MpPreference')) {
      return { ok: true, stdout: '', stderr: '' };
    }
    if (script.includes('Get-MpComputerStatus')) {
      return { ok: true, stdout: 'True', stderr: '' };
    }
    throw new Error(`Unexpected script: ${script}`);
  };

  const result = await watcher.stop();

  assert.deepStrictEqual(result, {
    ok: false,
    enabled: true,
    error: tamperProtectionError
  });
});
