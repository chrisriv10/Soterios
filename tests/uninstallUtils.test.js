'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { normalizeApps, tokenizeAppName, findLeftoverCandidates } = require('../src/scripts/safeScripts/uninstallUtils');
const { isProtected } = require('../src/scripts/safeScripts/protectedPaths');

describe('uninstallUtils', () => {
  it('normalizes registry rows into app objects', () => {
    const apps = normalizeApps([
      { DisplayName: 'Example App', DisplayVersion: '1.2.3', UninstallString: 'setup.exe /uninstall' }
    ]);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].name, 'Example App');
    assert.equal(apps[0].version, '1.2.3');
  });

  it('tokenizes app names for fuzzy matching', () => {
    assert.deepEqual(tokenizeAppName('Example App Suite'), ['example', 'app', 'suite']);
  });

  it('refuses protected paths during leftover removal checks', () => {
    if (process.platform === 'win32') {
      assert.equal(isProtected('C:\\Windows\\Temp\\leftover'), true);
    }
    assert.equal(isProtected(path.join(process.cwd(), 'safe-user-folder')), false);
  });
});

describe('findLeftoverCandidates', () => {
  it('returns an array without throwing when no matches exist', () => {
    const matches = findLeftoverCandidates('Nonexistent Vendor Product', 'C:\\missing\\path');
    assert.ok(Array.isArray(matches));
  });
});
