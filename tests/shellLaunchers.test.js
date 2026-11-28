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
    assert.equal(calls[0].file, 'cmd.exe');
    assert.equal(calls[0].args[0], '/d');
    assert.equal(calls[0].args[1], '/c');
    assert.equal(calls[0].args[2], 'start');
    assert.equal(calls[0].args[3], 'Soterios PowerShell');
    assert.equal(calls[0].args[4], 'powershell.exe');
    assert.ok(calls[0].args.includes('-NoExit'));
    assert.ok(calls[0].args.includes('-NoLogo'));
    assert.ok(calls[0].args.includes('-NoProfile'));
    assert.ok(!calls[0].args.includes('-ExecutionPolicy'));
    assert.ok(!calls[0].args.includes('Bypass'));
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

  it('opens trusted external destinations and rejects untrusted URLs', async () => {
    const opened = [];
    const shell = {
      openExternal: async (url) => {
        opened.push(url);
        if (url === 'https://github.com/chrisriv10/Soterios') throw new Error('handler unavailable');
      }
    };

    assert.deepEqual(await openExternal(shell, 'ms-settings:remotedesktop'), { success: true });
    assert.deepEqual(await openExternal(shell, 'windowsdefender://threatsettings/'), { success: true });
    assert.deepEqual(await openExternal(shell, 'https://github.com/chrisriv10/Soterios/wiki/Troubleshooting'), { success: true });
    assert.deepEqual(await openExternal(shell, 'https://github.com/chrisriv10/Soterios/issues/new?template=bug_report.yml'), { success: true });
    assert.deepEqual(await openExternal(shell, 'https://ollama.com/download'), { success: true });
    assert.deepEqual(await openExternal(shell, 'https://chrisriv10.github.io/Soterios/feedback/?appVersion=1.4.2#bug-reports'), { success: true });
    assert.deepEqual(await openExternal(shell, 'file:///C:/Windows/System32'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://github.com.evil.example/chrisriv10/Soterios'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://github.com/chrisriv10/Soterios/issues/new?title=private-data'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://chrisriv10.github.io/Soterios/feedback/?appVersion=1.4.2&username=chris'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://chrisriv10.github.io/Soterios/feedback/?appVersion=../../Users'), {
      success: false,
      error: 'Invalid URL.'
    });
    assert.deepEqual(await openExternal(shell, 'https://github.com/chrisriv10/Soterios'), {
      success: false,
      error: 'handler unavailable'
    });
    assert.equal(opened.length, 7);
  });
});
