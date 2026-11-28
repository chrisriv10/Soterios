'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ProcessInspector = require('../src/security/ProcessInspector');

describe('ProcessInspector suspicious assessment', () => {
  it('flags unsigned executables under system directories', async () => {
    const inspector = new ProcessInspector({
      getSignatureInfo: async () => ({ status: 'NotSigned', publisher: null })
    });

    const result = await inspector._assessSuspicious({
      name: 'fakehost.exe',
      path: 'C:\\Windows\\System32\\fakehost.exe',
      cmd: 'C:\\Windows\\System32\\fakehost.exe'
    });

    assert.ok(result.suspiciousReasons.some((r) => /Unsigned or untrusted/i.test(r)));
  });

  it('does not treat Valid signatures in system dirs as suspicious', async () => {
    const inspector = new ProcessInspector({
      getSignatureInfo: async () => ({ status: 'Valid', publisher: 'CN=Microsoft' })
    });

    const result = await inspector._assessSuspicious({
      name: 'notepad.exe',
      path: 'C:\\Windows\\System32\\notepad.exe',
      cmd: 'C:\\Windows\\System32\\notepad.exe'
    });

    assert.equal(result.suspiciousReasons.some((r) => /Unsigned or untrusted/i.test(r)), false);
  });

  it('marks location-based AppData paths as suspicious for UI badges', async () => {
    const inspector = new ProcessInspector({
      getSignatureInfo: async () => ({ status: 'Unknown', publisher: null })
    });

    const result = await inspector._assessSuspicious({
      name: 'payload.exe',
      path: 'C:\\Users\\a\\AppData\\Roaming\\payload.exe',
      cmd: 'C:\\Users\\a\\AppData\\Roaming\\payload.exe'
    });

    assert.equal(result.suspicious, true);
    assert.ok(result.locationReasons.length > 0);
  });

  it('describes a Recycle Bin process as unusual without claiming it is illegitimate', async () => {
    const inspector = new ProcessInspector({
      getSignatureInfo: async () => ({ status: 'Unknown', publisher: null })
    });

    const result = await inspector._assessSuspicious({
      name: 'payload.exe',
      path: 'C:\\$Recycle.Bin\\payload.exe',
      cmd: 'C:\\$Recycle.Bin\\payload.exe'
    });

    assert.equal(result.recommendedAction, 'An executable running from the Recycle Bin is unusual. Verify its source before allowing it to continue.');
  });
});
