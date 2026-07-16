'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const uninstallerReport = require('../src/scripts/safeScripts/uninstallerReport');

describe('uninstallerReport platform guard', () => {
  it('returns supported:false on non-Windows platforms', async () => {
    if (process.platform === 'win32') return;
    const result = await uninstallerReport({});
    assert.equal(result.supported, false);
    assert.ok(result.message);
  });
});
