'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, isFeatureSupported } = require('../src/platform');

describe('platform abstraction', () => {
  it('returns a provider for the current platform', () => {
    const provider = getProvider();
    assert.ok(provider.id);
    assert.ok(provider.label);
  });

  it('reports Windows-only features as unsupported elsewhere', () => {
    if (process.platform === 'win32') {
      assert.equal(isFeatureSupported('uninstaller', 'win32'), true);
    } else {
      assert.equal(isFeatureSupported('uninstaller', 'darwin'), false);
      assert.equal(isFeatureSupported('uninstaller', 'linux'), false);
    }
  });

  it('returns unavailable messages for unsupported features', () => {
    const provider = getProvider('darwin');
    assert.match(provider.unavailableMessage('uninstaller'), /macOS/i);
  });

  it('uses the base provider for unknown platforms', () => {
    const provider = getProvider('freebsd');
    assert.equal(provider.id, 'base');
  });
});
