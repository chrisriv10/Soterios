'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PROVIDERS, getAllProviders, getProvider, getServerForProvider } = require('../src/main/vpnProviders');

describe('vpnProviders', () => {
  it('ships only the custom IKEv2 provider', () => {
    const providers = getAllProviders();
    assert.deepEqual(providers.map((p) => p.id), ['custom']);
  });

  it('names the custom provider IKEv2 / Custom', () => {
    assert.equal(PROVIDERS.custom.name, 'IKEv2 / Custom');
  });

  it('returns null for unknown provider ids', () => {
    assert.equal(getProvider('protonvpn'), null);
    assert.equal(getProvider('nordvpn'), null);
    assert.equal(getProvider('ivpn'), null);
    assert.equal(getProvider('not-a-provider'), null);
  });

  it('returns no servers for the custom provider', () => {
    assert.deepEqual(getServerForProvider('custom', 'anything'), null);
    assert.deepEqual(PROVIDERS.custom.servers, []);
  });
});