'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIVACY_SENSITIVE_FEATURES,
  snapshotFeatures,
  buildDisablePatch,
  buildRestorePatch,
} = require('../src/tools/privacyMode');

describe('privacyMode PRIVACY_SENSITIVE_FEATURES', () => {
  it('covers the data-sharing and retention features', () => {
    assert.deepEqual(
      [...PRIVACY_SENSITIVE_FEATURES].sort(),
      ['aiAssistant', 'autoReports', 'externalLookups', 'geoLookup', 'networkTrafficHistory', 'scanHistory'].sort()
    );
  });
});

describe('privacyMode snapshotFeatures', () => {
  it('captures only present sensitive keys with boolean values', () => {
    const snapshot = snapshotFeatures({
      externalLookups: true,
      geoLookup: 0,
      aiAssistant: false,
      scanHistory: 'yes',
      folderWatch: true,
      realtimeProtection: true
    });
    assert.deepEqual(snapshot, {
      externalLookups: true,
      geoLookup: false,
      aiAssistant: false,
      scanHistory: true
    });
  });
});

describe('privacyMode buildDisablePatch', () => {
  it('sets every sensitive feature to false', () => {
    const patch = buildDisablePatch();
    assert.deepEqual(Object.keys(patch).sort(), [...PRIVACY_SENSITIVE_FEATURES].sort());
    for (const value of Object.values(patch)) assert.equal(value, false);
  });
});

describe('privacyMode buildRestorePatch', () => {
  it('restores only keys present in the snapshot', () => {
    const patch = buildRestorePatch({ externalLookups: true, geoLookup: false, aiAssistant: true });
    assert.deepEqual(patch, { externalLookups: true, geoLookup: false, aiAssistant: true });
  });

  it('ignores unknown keys and coerces values to booleans', () => {
    const patch = buildRestorePatch({ externalLookups: 1, folderWatch: false, bogus: true });
    assert.deepEqual(patch, { externalLookups: true });
  });

  it('returns an empty patch for null, undefined, or empty snapshots', () => {
    assert.deepEqual(buildRestorePatch(null), {});
    assert.deepEqual(buildRestorePatch(undefined), {});
    assert.deepEqual(buildRestorePatch({}), {});
  });
});