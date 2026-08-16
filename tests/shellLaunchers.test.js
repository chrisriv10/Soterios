'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  openExternal,
  openPowerShell,
  openControlPanel,
  openWindowsUtility,
  spawnDetached
} = require('../src/main/shellLaunchers');

function successfulSpawner(calls) {
  return (file, args, options) => {
    const child = new EventEmitter();
    child.unrefCalled = false;
    child.unref = () => { child.unrefCalled = true; };
    calls.push({ file, args, options, child });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}

describe('shell launchers', () => {
  it('opens UAC and Windows Features with their canonical executables', async () => {
    const calls = [];
    const spawn = successfulSpawner(calls);

    assert.deepEqual(await openWindowsUtility(spawn, 'uac'), { success: true });
    assert.deepEqual(await openWindowsUtility(spawn, 'windows-features'), { success: true });

    assert.equal(calls[0].file, 'UserAccountControlSettings.exe');
    assert.deepEqual(calls[0].args, []);
    assert.equal(calls[1].file, 'OptionalFeatures.exe');
    assert.deepEqual(calls[1].args, []);
    assert.equal(calls[0].child.unrefCalled, true);
  });

  it('allows only known PowerShell inspection contexts', async () => {
    const calls = [];
    const spawn = successfulSpawner(calls);

    assert.deepEqual(await openPowerShell(spawn, 'network-protection'), { success: true });
    assert.equal(calls[0].file, 'powershell.exe');
    assert.equal(calls[0].args[0], '-NoExit');
    assert.match(calls[0].args.join(' '), /Get-MpPreference/);

    assert.deepEqual(await openPowerShell(spawn, 'not-allowlisted'), {
      success: false,
      error: 'Unsupported PowerShell action.'
    });
    assert.equal(calls.length, 1);
  });

  it('allows only known Control Panel destinations', async () => {
    const calls = [];
    const spawn = successfulSpawner(calls);

    assert.deepEqual(await openControlPanel(spawn, 'control userpasswords2'), { success: true });
    assert.equal(calls[0].file, 'control.exe');
    assert.deepEqual(calls[0].args, ['userpasswords2']);

    assert.deepEqual(await openControlPanel(spawn, 'control /name Arbitrary.Target'), {
      success: false,
      error: 'Unsupported control panel command.'
    });
    assert.equal(calls.length, 1);
  });

  it('rejects unsupported utilities without spawning a process', async () => {
    const calls = [];
    const result = await openWindowsUtility(successfulSpawner(calls), 'unknown');

    assert.deepEqual(result, { success: false, error: 'Unsupported Windows utility.' });
    assert.equal(calls.length, 0);
  });

  it('reports a spawn error instead of claiming the destination opened', async () => {
    const result = await spawnDetached(() => {
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('error', new Error('launch denied')));
      return child;
    }, 'OptionalFeatures.exe', []);

    assert.deepEqual(result, { success: false, error: 'launch denied' });
  });

  it('awaits allowed external destinations and rejects unsafe schemes', async () => {
    const opened = [];
    const shell = {
      openExternal: async (url) => {
        opened.push(url);
        if (url.includes('fail')) throw new Error('handler unavailable');
      }
    };

    assert.deepEqual(await openExternal(shell, 'ms-settings:remotedesktop'), { success: true });
    assert.deepEqual(await openExternal(shell, 'windowsdefender://threatsettings/'), { success: true });
    assert.deepEqual(await openExternal(shell, 'file:///C:/Windows/System32'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://fail.example'), {
      success: false,
      error: 'handler unavailable'
    });
    assert.equal(opened.length, 3);
  });
});
