'use strict';

// Tests for Phase 2A ad/tracker ruleset control:
//   - browser-extension/dist/test/adblock.js (controller, mocked chrome DNR)
//   - browser-extension/dist/test/settings.js (migration/normalization)
// Requires `npm run extension:build` first (npm test runs it via pretest).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  AD_RULESET_ID,
  TRACKER_RULESET_ID,
  desiredRulesets,
  syncAdblockRulesets,
  getAdblockState,
  applyAdTrackerPatch,
  adblockViewState,
} = require('../browser-extension/dist/test/adblock.js');
const {
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeAdTrackerProtection,
} = require('../browser-extension/dist/test/settings.js');

function mockDnr(initiallyEnabled = []) {
  const calls = [];
  let enabled = [...initiallyEnabled];
  return {
    calls,
    api: {
      getEnabledRulesets: async () => [...enabled],
      updateEnabledRulesets: async (options) => {
        calls.push(options);
        const next = new Set(enabled);
        for (const id of options.disableRulesetIds || []) next.delete(id);
        for (const id of options.enableRulesetIds || []) next.add(id);
        enabled = [...next];
        return undefined;
      },
    },
    current: () => enabled,
  };
}

const ON_BOTH = { adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: true } };

describe('adblock desired rulesets', () => {
  it('enables nothing when globally off', () => {
    assert.deepEqual(desiredRulesets({ adTrackerProtection: { enabled: false, blockAds: true, blockTrackers: true } }), []);
    assert.deepEqual(desiredRulesets({}), []);
    assert.deepEqual(desiredRulesets(null), []);
  });

  it('enables both rulesets when fully on', () => {
    assert.deepEqual(desiredRulesets(ON_BOTH), [AD_RULESET_ID, TRACKER_RULESET_ID]);
  });

  it('enables ads only or trackers only', () => {
    assert.deepEqual(
      desiredRulesets({ adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: false } }),
      [AD_RULESET_ID]
    );
    assert.deepEqual(
      desiredRulesets({ adTrackerProtection: { enabled: true, blockAds: false, blockTrackers: true } }),
      [TRACKER_RULESET_ID]
    );
  });

  it('enables nothing when both child toggles are off', () => {
    assert.deepEqual(
      desiredRulesets({ adTrackerProtection: { enabled: true, blockAds: false, blockTrackers: false } }),
      []
    );
  });

  it('uses stable ruleset IDs', () => {
    assert.equal(AD_RULESET_ID, 'soterios-ads');
    assert.equal(TRACKER_RULESET_ID, 'soterios-trackers');
  });
});

describe('adblock ruleset synchronization', () => {
  it('enables both rulesets from a clean state with exact arrays', async () => {
    const mock = mockDnr([]);
    const result = await syncAdblockRulesets(ON_BOTH, mock.api);
    assert.equal(result.ok, true);
    assert.deepEqual(result.enabledRulesets, [AD_RULESET_ID, TRACKER_RULESET_ID]);
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(mock.calls[0], {
      enableRulesetIds: [AD_RULESET_ID, TRACKER_RULESET_ID],
      disableRulesetIds: [],
    });
  });

  it('disables the tracker ruleset while keeping ads', async () => {
    const mock = mockDnr([AD_RULESET_ID, TRACKER_RULESET_ID]);
    const result = await syncAdblockRulesets(
      { adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: false } },
      mock.api
    );
    assert.equal(result.ok, true);
    assert.deepEqual(mock.calls[0], { enableRulesetIds: [], disableRulesetIds: [TRACKER_RULESET_ID] });
    assert.deepEqual(mock.current(), [AD_RULESET_ID]);
  });

  it('disables everything when globally off without touching foreign rulesets', async () => {
    const mock = mockDnr([AD_RULESET_ID, 'third-party-ruleset']);
    const result = await syncAdblockRulesets(
      { adTrackerProtection: { enabled: false, blockAds: true, blockTrackers: true } },
      mock.api
    );
    assert.equal(result.ok, true);
    assert.deepEqual(mock.calls[0], { enableRulesetIds: [], disableRulesetIds: [AD_RULESET_ID] });
    assert.deepEqual(mock.current(), ['third-party-ruleset']);
  });

  it('skips the API write when already in sync', async () => {
    const mock = mockDnr([AD_RULESET_ID, TRACKER_RULESET_ID]);
    const result = await syncAdblockRulesets(ON_BOTH, mock.api);
    assert.equal(result.ok, true);
    assert.equal(mock.calls.length, 0);
  });

  it('reports failure without throwing when the API rejects', async () => {
    const failing = {
      getEnabledRulesets: async () => [],
      updateEnabledRulesets: async () => { throw new Error('denied'); },
    };
    const result = await syncAdblockRulesets(ON_BOTH, failing);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('reports unavailable when DNR is missing', async () => {
    const result = await syncAdblockRulesets(ON_BOTH, null);
    assert.equal(result.ok, false);
    assert.match(result.error || '', /unavailable/i);
  });
});

describe('adblock state helper', () => {
  it('reports flags and live enabled rulesets', async () => {
    const mock = mockDnr([AD_RULESET_ID]);
    const state = await getAdblockState(ON_BOTH, mock.api);
    assert.equal(state.available, true);
    assert.equal(state.enabled, true);
    assert.equal(state.blockAds, true);
    assert.equal(state.blockTrackers, true);
    assert.equal(state.adsActive, true);
    assert.equal(state.trackersActive, false);
    assert.deepEqual(state.enabledRulesets, [AD_RULESET_ID]);
  });

  it('reports unavailable without DNR access', async () => {
    const state = await getAdblockState(ON_BOTH, null);
    assert.equal(state.available, false);
    assert.equal(state.adsActive, false);
    assert.equal(state.trackersActive, false);
    assert.deepEqual(state.enabledRulesets, []);
  });
});

describe('adblock lifecycle', () => {
  it('fresh installs start with no rulesets desired', () => {
    assert.deepEqual(desiredRulesets(DEFAULT_SETTINGS), []);
  });

  it('onboarding confirmation enables blocking from a clean browser state', async () => {
    // Mirrors CONFIRM_ONBOARDING: explicit acceptance flips the stored flag,
    // then startup-style synchronization enables the selected rulesets.
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    settings.adTrackerProtection.enabled = true;
    const mock = mockDnr([]);
    const result = await syncAdblockRulesets(settings, mock.api);
    assert.equal(result.ok, true);
    assert.deepEqual(result.enabledRulesets, [AD_RULESET_ID, TRACKER_RULESET_ID]);
  });

  it('startup with previously enabled settings enables both rulesets', async () => {
    // Manifest ships disabled; the background reconciles persisted intent.
    const mock = mockDnr([]);
    const result = await syncAdblockRulesets(ON_BOTH, mock.api);
    assert.equal(result.ok, true);
    assert.deepEqual(mock.current().sort(), [AD_RULESET_ID, TRACKER_RULESET_ID]);
  });

  it('failed synchronization leaves the safe state and reports inactive', async () => {
    const failing = {
      getEnabledRulesets: async () => { throw new Error('unavailable'); },
      updateEnabledRulesets: async () => { throw new Error('denied'); },
    };
    const result = await syncAdblockRulesets(ON_BOTH, failing);
    assert.equal(result.ok, false);
    const state = await getAdblockState(ON_BOTH, failing);
    assert.equal(state.available, false);
    assert.deepEqual(state.enabledRulesets, []);
  });
});

describe('adblock settings patch validation', () => {
  const current = { enabled: false, blockAds: true, blockTrackers: true };

  it('applies supported boolean fields', () => {
    assert.deepEqual(applyAdTrackerPatch(current, { enabled: true }), { enabled: true, blockAds: true, blockTrackers: true });
    assert.deepEqual(applyAdTrackerPatch(current, { blockAds: false }), { enabled: false, blockAds: false, blockTrackers: true });
  });

  it('rejects invalid values without changing stored state', () => {
    assert.deepEqual(applyAdTrackerPatch(current, { enabled: 'yes' }), current);
    assert.deepEqual(applyAdTrackerPatch(current, { blockAds: 1 }), current);
    assert.deepEqual(applyAdTrackerPatch(current, null), current);
    assert.deepEqual(applyAdTrackerPatch(current, 'enabled'), current);
  });

  it('ignores unknown fields and arbitrary DNR operations', () => {
    assert.deepEqual(
      applyAdTrackerPatch(current, { enabled: true, disabledSites: ['example.com'], rulesetIds: ['x'], updateDynamicRules: [] }),
      { enabled: true, blockAds: true, blockTrackers: true }
    );
  });
});

describe('adblock runtime status', () => {
  function stateWith(overrides) {
    return {
      available: true, enabled: false, blockAds: true, blockTrackers: true,
      adsActive: false, trackersActive: false, enabledRulesets: [], ...overrides,
    };
  }

  it('reports active only when desired and live rulesets match with protection on', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(
      adblockRuntimeStatus(stateWith({ enabled: true, enabledRulesets: [AD_RULESET_ID, TRACKER_RULESET_ID] })),
      'active'
    );
  });

  it('reports off when globally disabled with nothing live', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(adblockRuntimeStatus(stateWith({ enabled: false })), 'off');
  });

  it('reports inactive when enabled but no child preference is selected', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(
      adblockRuntimeStatus(stateWith({ enabled: true, blockAds: false, blockTrackers: false })),
      'inactive'
    );
  });

  it('reports attention when a desired ruleset failed to enable', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(
      adblockRuntimeStatus(stateWith({ enabled: true, enabledRulesets: [TRACKER_RULESET_ID] })),
      'attention'
    );
  });

  it('reports attention when a ruleset failed to disable', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(
      adblockRuntimeStatus(stateWith({ enabled: false, enabledRulesets: [AD_RULESET_ID] })),
      'attention'
    );
  });

  it('reports unavailable without DNR access', () => {
    const { adblockRuntimeStatus } = require('../browser-extension/dist/test/adblock.js');
    assert.equal(adblockRuntimeStatus({ ...stateWith({ enabled: true }), available: false }), 'unavailable');
    assert.equal(adblockRuntimeStatus(null), 'unavailable');
  });
});

describe('adblock view state', () => {
  it('shows on with available controls when fully active', () => {
    assert.deepEqual(
      adblockViewState({ available: true, enabled: true, blockAds: true, blockTrackers: true, adsActive: true, trackersActive: true, enabledRulesets: [AD_RULESET_ID, TRACKER_RULESET_ID] }),
      { status: 'active', controlsDisabled: false, globalChecked: true, adsChecked: true, trackersChecked: true, showApplyWarning: false }
    );
  });

  it('disables child controls but preserves prefs when globally off', () => {
    assert.deepEqual(
      adblockViewState({ available: true, enabled: false, blockAds: true, blockTrackers: false, adsActive: false, trackersActive: false, enabledRulesets: [] }),
      { status: 'off', controlsDisabled: true, globalChecked: false, adsChecked: true, trackersChecked: false, showApplyWarning: false }
    );
  });

  it('keeps the global toggle checked for the inactive state', () => {
    assert.deepEqual(
      adblockViewState({ available: true, enabled: true, blockAds: false, blockTrackers: false, adsActive: false, trackersActive: false, enabledRulesets: [] }),
      { status: 'inactive', controlsDisabled: false, globalChecked: true, adsChecked: false, trackersChecked: false, showApplyWarning: false }
    );
  });

  it('shows unavailable with disabled controls when DNR is missing', () => {
    assert.deepEqual(
      adblockViewState({ available: false, enabled: true, blockAds: true, blockTrackers: true, adsActive: false, trackersActive: false, enabledRulesets: [] }),
      { status: 'unavailable', controlsDisabled: true, globalChecked: false, adsChecked: false, trackersChecked: false, showApplyWarning: false }
    );
    assert.deepEqual(
      adblockViewState(null),
      { status: 'unavailable', controlsDisabled: true, globalChecked: false, adsChecked: false, trackersChecked: false, showApplyWarning: false }
    );
  });

  it('warns instead of claiming protection when intent diverges from live state', () => {
    const view = adblockViewState({ available: true, enabled: true, blockAds: true, blockTrackers: true, adsActive: false, trackersActive: true, enabledRulesets: [TRACKER_RULESET_ID] });
    assert.equal(view.status, 'attention');
    assert.equal(view.showApplyWarning, true);
  });

  it('labels every runtime status distinctly', () => {
    const { adblockStatusPresentation } = require('../browser-extension/dist/test/adblock.js');
    assert.deepEqual(adblockStatusPresentation('active'), { label: 'On', className: 'healthy' });
    assert.deepEqual(adblockStatusPresentation('off'), { label: 'Off', className: 'unknown' });
    assert.deepEqual(adblockStatusPresentation('inactive'), { label: 'Inactive', className: 'unknown' });
    assert.deepEqual(adblockStatusPresentation('attention'), { label: 'Needs attention', className: 'warn' });
    assert.deepEqual(adblockStatusPresentation('unavailable'), { label: 'Unavailable', className: 'degraded' });
  });
});

describe('adblock settings model', () => {
  it('ships conservative fresh-install defaults', () => {
    assert.deepEqual(DEFAULT_SETTINGS.adTrackerProtection, {
      enabled: false,
      blockAds: true,
      blockTrackers: true,
    });
  });

  it('normalizes missing, partial, and invalid stored values', () => {
    assert.deepEqual(normalizeAdTrackerProtection(undefined), { enabled: false, blockAds: true, blockTrackers: true });
    assert.deepEqual(normalizeAdTrackerProtection(null), { enabled: false, blockAds: true, blockTrackers: true });
    assert.deepEqual(normalizeAdTrackerProtection({ enabled: true }), { enabled: true, blockAds: true, blockTrackers: true });
    assert.deepEqual(
      normalizeAdTrackerProtection({ enabled: 'yes', blockAds: 0, blockTrackers: null }),
      { enabled: false, blockAds: true, blockTrackers: true }
    );
  });

  it('keeps blocking off for migrated installs while preserving the rest', () => {
    const current = {
      version: 2,
      credentialProtection: false,
      onlineServices: { enabled: true, hibp: true, feed: true, googleSafeBrowsing: false },
      sites: { 'example.com': { pausedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' } },
    };
    const { settings } = migrateSettings({ settingsV2: current }, {});
    assert.deepEqual(settings.adTrackerProtection, { enabled: false, blockAds: true, blockTrackers: true });
    assert.equal(settings.credentialProtection, false);
    assert.deepEqual(settings.sites, current.sites);
    assert.equal(settings.version, 2);
  });

  it('preserves an explicitly enabled stored value', () => {
    const current = {
      version: 2,
      adTrackerProtection: { enabled: true, blockAds: false, blockTrackers: true },
    };
    const { settings } = migrateSettings({ settingsV2: current }, {});
    assert.deepEqual(settings.adTrackerProtection, { enabled: true, blockAds: false, blockTrackers: true });
  });
});
