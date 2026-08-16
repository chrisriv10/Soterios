'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const performanceModes = require('../src/main/performanceModes');

describe('performanceModes', () => {
  it('exposes exactly the three expected modes in display order', () => {
    assert.deepEqual(performanceModes.MODE_LIST.map((m) => m.id), ['balanced', 'gaming', 'quiet']);
  });

  it('maps each mode to a well-formed, distinct GUID', () => {
    const guids = new Set();
    for (const mode of performanceModes.MODE_LIST) {
      assert.match(mode.guid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      guids.add(mode.guid);
    }
    assert.equal(guids.size, 3, 'each mode should have a unique GUID');
  });

  it('setMode calls powercfg /setactive with the correct GUID for gaming mode', async () => {
    let calledWith = null;
    const fakeExec = async (cmd, args) => {
      calledWith = { cmd, args };
      return { stdout: '', stderr: '' };
    };

    const result = await performanceModes.setMode('gaming', fakeExec);

    assert.equal(result.ok, true);
    assert.equal(result.modeId, 'gaming');
    assert.equal(calledWith.cmd, 'powercfg.exe');
    assert.deepEqual(calledWith.args, ['/setactive', performanceModes.MODES.gaming.guid]);
  });

  it('setMode rejects an unknown mode id without touching the system', async () => {
    let called = false;
    const fakeExec = async () => { called = true; return { stdout: '' }; };

    const result = await performanceModes.setMode('turbo-ultra-max', fakeExec);

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(called, false, 'should not shell out for an invalid mode id');
  });

  it('setMode surfaces the underlying error when powercfg fails', async () => {
    const fakeExec = async () => { throw new Error('powercfg is not recognized'); };

    const result = await performanceModes.setMode('balanced', fakeExec);

    assert.equal(result.ok, false);
    assert.match(result.error, /powercfg is not recognized/);
  });

  it('getActiveMode parses the GUID out of powercfg /getactivescheme output and maps it to a mode id', async () => {
    const fakeExec = async (cmd, args) => {
      assert.equal(cmd, 'powercfg.exe');
      assert.deepEqual(args, ['/getactivescheme']);
      return { stdout: 'Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\r\n' };
    };

    const result = await performanceModes.getActiveMode(fakeExec);

    assert.equal(result.ok, true);
    assert.equal(result.modeId, 'gaming');
    assert.equal(result.guid, '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');
  });

  it('getActiveMode returns a null modeId (not an error) for a custom/unknown plan', async () => {
    const fakeExec = async () => ({
      stdout: 'Power Scheme GUID: 00000000-1111-2222-3333-444444444444  (Some OEM Plan)\r\n'
    });

    const result = await performanceModes.getActiveMode(fakeExec);

    assert.equal(result.ok, true);
    assert.equal(result.modeId, null);
    assert.equal(result.guid, '00000000-1111-2222-3333-444444444444');
  });

  it('getActiveMode reports a clean error when powercfg is unavailable (e.g. non-Windows)', async () => {
    const fakeExec = async () => { throw new Error('command not found'); };

    const result = await performanceModes.getActiveMode(fakeExec);

    assert.equal(result.ok, false);
    assert.match(result.error, /command not found/);
  });

  it('guidToModeId is case-insensitive', () => {
    const upper = performanceModes.MODES.quiet.guid.toUpperCase();
    assert.equal(performanceModes.guidToModeId(upper), 'quiet');
  });
});
