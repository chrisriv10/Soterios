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
  normalizeDisabledSites,
  normalizeExceptionHostname,
  exceptionHostnameFromUrl,
  siteExceptionRulesFor,
  desiredSiteExceptionRules,
  setSiteException,
  syncSiteExceptions,
  reconcileAdblock,
  getAdblockSiteState,
  SITE_EXCEPTION_ID_BASE,
  SITE_EXCEPTION_PRIORITY,
  MAX_SITE_EXCEPTIONS,
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
  const current = { enabled: false, blockAds: true, blockTrackers: true, disabledSites: {} };

  it('applies supported boolean fields', () => {
    assert.deepEqual(applyAdTrackerPatch(current, { enabled: true }), { enabled: true, blockAds: true, blockTrackers: true, disabledSites: {} });
    assert.deepEqual(applyAdTrackerPatch(current, { blockAds: false }), { enabled: false, blockAds: false, blockTrackers: true, disabledSites: {} });
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
      { enabled: true, blockAds: true, blockTrackers: true, disabledSites: {} }
    );
  });

  it('preserves existing site exceptions across boolean patches', () => {
    const withException = { ...current, disabledSites: { 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } } };
    assert.deepEqual(applyAdTrackerPatch(withException, { blockAds: false }), {
      enabled: false, blockAds: false, blockTrackers: true,
      disabledSites: { 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } },
    });
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
      disabledSites: {},
    });
  });

  it('normalizes missing, partial, and invalid stored values', () => {
    assert.deepEqual(normalizeAdTrackerProtection(undefined), { enabled: false, blockAds: true, blockTrackers: true, disabledSites: {} });
    assert.deepEqual(normalizeAdTrackerProtection(null), { enabled: false, blockAds: true, blockTrackers: true, disabledSites: {} });
    assert.deepEqual(normalizeAdTrackerProtection({ enabled: true }), { enabled: true, blockAds: true, blockTrackers: true, disabledSites: {} });
    assert.deepEqual(
      normalizeAdTrackerProtection({ enabled: 'yes', blockAds: 0, blockTrackers: null }),
      { enabled: false, blockAds: true, blockTrackers: true, disabledSites: {} }
    );
  });

  it('migrates missing disabledSites to empty without touching flags', () => {
    assert.deepEqual(
      normalizeAdTrackerProtection({ enabled: true, blockAds: false, blockTrackers: true }),
      { enabled: true, blockAds: false, blockTrackers: true, disabledSites: {} }
    );
    const normalized = normalizeDisabledSites({
      'Example.COM.': { createdAt: '2026-09-01T00:00:00.000Z' },
      'not a host!!': { createdAt: '2026-09-01T00:00:00.000Z' },
      'b.example': { createdAt: '2026-09-02T00:00:00.000Z' },
      'a.example': { createdAt: 'not-a-date-but-kept' },
    });
    assert.deepEqual(Object.keys(normalized), ['a.example', 'b.example', 'example.com']);
    assert.equal(normalized['example.com'].createdAt, '2026-09-01T00:00:00.000Z');
  });

  it('keeps blocking off for migrated installs while preserving the rest', () => {
    const current = {
      version: 2,
      credentialProtection: false,
      onlineServices: { enabled: true, hibp: true, feed: true, googleSafeBrowsing: false },
      sites: { 'example.com': { pausedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' } },
    };
    const { settings } = migrateSettings({ settingsV2: current }, {});
    assert.deepEqual(settings.adTrackerProtection, { enabled: false, blockAds: true, blockTrackers: true, disabledSites: {} });
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
    assert.deepEqual(settings.adTrackerProtection, { enabled: true, blockAds: false, blockTrackers: true, disabledSites: {} });
  });
});

describe('adblock exact-host normalization', () => {
  it('normalizes exact hostnames without folding subdomains', () => {
    assert.equal(normalizeExceptionHostname('Example.COM'), 'example.com');
    assert.equal(normalizeExceptionHostname('  www.example.com. '), 'www.example.com');
    assert.equal(normalizeExceptionHostname('münchen.de'), 'xn--mnchen-3ya.de');
    assert.equal(normalizeExceptionHostname('127.0.0.1'), '127.0.0.1');
    assert.equal(normalizeExceptionHostname('localhost'), 'localhost');
    assert.equal(normalizeExceptionHostname('[::1]'), '[::1]');
    // Exactness proof: related hostnames stay distinct strings.
    assert.notEqual(normalizeExceptionHostname('example.com'), normalizeExceptionHostname('www.example.com'));
    assert.notEqual(normalizeExceptionHostname('www.example.com'), normalizeExceptionHostname('example.com'));
    assert.notEqual(normalizeExceptionHostname('a.example.com'), normalizeExceptionHostname('b.example.com'));
  });

  it('rejects empty, malformed, and non-web hostnames', () => {
    for (const bad of ['', '   ', null, undefined, 42, 'not a host!!', 'foo_bar.com', 'http://example.com/path']) {
      assert.equal(normalizeExceptionHostname(bad), null, JSON.stringify(bad));
    }
  });

  it('derives exact hosts from http/https URLs only', () => {
    assert.equal(exceptionHostnameFromUrl('https://example.com/'), 'example.com');
    assert.equal(exceptionHostnameFromUrl('http://example.com:8080/path?q=1'), 'example.com');
    assert.equal(exceptionHostnameFromUrl('https://WWW.Example.COM/a/b'), 'www.example.com');
    assert.equal(exceptionHostnameFromUrl('http://127.0.0.1:8901/x'), '127.0.0.1');
    assert.equal(exceptionHostnameFromUrl('chrome://settings/'), null);
    assert.equal(exceptionHostnameFromUrl('edge://settings/'), null);
    assert.equal(exceptionHostnameFromUrl('chrome-extension://abc/popup.html'), null);
    assert.equal(exceptionHostnameFromUrl('file:///C:/x.html'), null);
    assert.equal(exceptionHostnameFromUrl('javascript:void(0)'), null);
    assert.equal(exceptionHostnameFromUrl('data:text/plain,x'), null);
    assert.equal(exceptionHostnameFromUrl(''), null);
    assert.equal(exceptionHostnameFromUrl(null), null);
    assert.equal(exceptionHostnameFromUrl('not a url'), null);
  });
});

describe('adblock site exception settings', () => {
  function baseSettings() {
    return {
      version: 2,
      credentialProtection: true,
      continuousAccess: false,
      onlineServices: { enabled: true, hibp: true, feed: true, googleSafeBrowsing: false },
      adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: true, disabledSites: {} },
      sites: { 'paused.example': { pausedUntil: null, createdAt: '2026-01-01T00:00:00.000Z' } },
    };
  }

  it('adds an exception with only hostname and timestamp persisted', () => {
    const result = setSiteException(baseSettings(), 'Example.COM', true, '2026-09-16T00:00:00.000Z');
    assert.ok(!('error' in result));
    assert.equal(result.hostname, 'example.com');
    assert.deepEqual(result.settings.adTrackerProtection.disabledSites, {
      'example.com': { createdAt: '2026-09-16T00:00:00.000Z' },
    });
    // Privacy: no URL, path, query, or title persisted.
    assert.ok(!JSON.stringify(result.settings).includes('http'));
  });

  it('removes an exception while keeping others', () => {
    const settings = baseSettings();
    settings.adTrackerProtection.disabledSites = {
      'a.example': { createdAt: '2026-09-01T00:00:00.000Z' },
      'b.example': { createdAt: '2026-09-02T00:00:00.000Z' },
    };
    const result = setSiteException(settings, 'a.example', false);
    assert.ok(!('error' in result));
    assert.deepEqual(result.settings.adTrackerProtection.disabledSites, {
      'b.example': { createdAt: '2026-09-02T00:00:00.000Z' },
    });
  });

  it('is idempotent for repeated add/remove', () => {
    const first = setSiteException(baseSettings(), 'example.com', true, '2026-09-01T00:00:00.000Z');
    assert.ok(!('error' in first));
    const second = setSiteException(first.settings, 'example.com', true, '2026-09-02T00:00:00.000Z');
    assert.ok(!('error' in second));
    // Original timestamp preserved, not overwritten.
    assert.equal(second.settings.adTrackerProtection.disabledSites['example.com'].createdAt, '2026-09-01T00:00:00.000Z');
    const removed = setSiteException(second.settings, 'example.com', false);
    assert.ok(!('error' in removed));
    assert.deepEqual(removed.settings.adTrackerProtection.disabledSites, {});
    const removedAgain = setSiteException(removed.settings, 'example.com', false);
    assert.ok(!('error' in removedAgain));
    assert.deepEqual(removedAgain.settings.adTrackerProtection.disabledSites, {});
  });

  it('rejects invalid hostnames cleanly', () => {
    for (const bad of ['', 'not a host!!', 'chrome://settings', null]) {
      const result = setSiteException(baseSettings(), bad, true);
      assert.ok('error' in result, JSON.stringify(bad));
    }
  });

  it('rejects new exceptions past the capacity cap', () => {
    const settings = baseSettings();
    for (let i = 0; i < MAX_SITE_EXCEPTIONS; i += 1) {
      settings.adTrackerProtection.disabledSites[`host${i}.example`] = { createdAt: '2026-09-01T00:00:00.000Z' };
    }
    const over = setSiteException(settings, 'one-more.example', true);
    assert.ok('error' in over);
    // Removing still works at capacity.
    const removed = setSiteException(settings, 'host0.example', false);
    assert.ok(!('error' in removed));
  });

  it('never touches non-adblock protection state', () => {
    const before = baseSettings();
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = setSiteException(before, 'example.com', true, '2026-09-01T00:00:00.000Z');
    assert.ok(!('error' in result));
    const { adTrackerProtection: _changed, ...restAfter } = result.settings;
    const { adTrackerProtection: _original, ...restBefore } = snapshot;
    assert.deepEqual(restAfter, restBefore);
    assert.deepEqual(result.settings.sites, snapshot.sites);
    assert.equal(result.settings.credentialProtection, true);
    assert.equal(result.settings.continuousAccess, false);
    assert.deepEqual(result.settings.onlineServices, snapshot.onlineServices);
  });
});

describe('adblock session exception rules', () => {
  it('builds deterministic http+https allowAllRequests rules per host', () => {
    const rules = siteExceptionRulesFor('example.com', 3);
    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0], {
      id: SITE_EXCEPTION_ID_BASE + 6,
      priority: SITE_EXCEPTION_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { urlFilter: '|http://example.com^', resourceTypes: ['main_frame'] },
    });
    assert.deepEqual(rules[1], {
      id: SITE_EXCEPTION_ID_BASE + 7,
      priority: SITE_EXCEPTION_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { urlFilter: '|https://example.com^', resourceTypes: ['main_frame'] },
    });
  });

  it('uses exact left-anchored filters that cannot match subdomains', () => {
    const rules = siteExceptionRulesFor('example.com', 0);
    for (const rule of rules) {
      assert.ok(rule.condition.urlFilter.startsWith('|http'));
      assert.ok(!rule.condition.urlFilter.includes('||'));
      assert.ok(!rule.condition.urlFilter.includes('*'));
    }
  });

  it('assigns stable IDs independent of settings ordering', () => {
    const { desiredSiteExceptionRules } = require('../browser-extension/dist/test/adblock.js');
    const first = desiredSiteExceptionRules({ 'b.example': { createdAt: 'x' }, 'a.example': { createdAt: 'y' } });
    const second = desiredSiteExceptionRules({ 'a.example': { createdAt: 'y' }, 'b.example': { createdAt: 'x' } });
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((rule) => rule.id), [
      SITE_EXCEPTION_ID_BASE, SITE_EXCEPTION_ID_BASE + 1,
      SITE_EXCEPTION_ID_BASE + 2, SITE_EXCEPTION_ID_BASE + 3,
    ]);
  });

  it('proves exception priority exceeds the real static maximum', () => {
    const fs = require('fs');
    const path = require('path');
    let maxStatic = 0;
    for (const file of ['ads.json', 'trackers.json']) {
      const rules = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'browser-extension', 'dist', 'chromium', 'rules', file), 'utf8'));
      for (const rule of rules) {
        assert.ok(Number.isInteger(rule.priority) && rule.priority >= 1);
        maxStatic = Math.max(maxStatic, rule.priority);
      }
    }
    assert.ok(maxStatic > 0);
    assert.ok(SITE_EXCEPTION_PRIORITY > maxStatic,
      `SITE_EXCEPTION_PRIORITY (${SITE_EXCEPTION_PRIORITY}) must exceed static max (${maxStatic})`);
  });
});

describe('adblock session reconciliation', () => {
  function sessionMock(initial = [], initiallyEnabled = ['soterios-ads', 'soterios-trackers']) {
    const calls = [];
    let rules = initial.map((rule) => ({ ...rule }));
    let enabled = [...initiallyEnabled];
    return {
      calls,
      api: {
        getEnabledRulesets: async () => [...enabled],
        updateEnabledRulesets: async (options) => {
          calls.push({ static: options });
          const next = new Set(enabled);
          for (const id of options.disableRulesetIds || []) next.delete(id);
          for (const id of options.enableRulesetIds || []) next.add(id);
          enabled = [...next];
        },
        getSessionRules: async () => rules.map((rule) => ({ ...rule })),
        updateSessionRules: async (options) => {
          calls.push({ session: options });
          const remaining = rules.filter((rule) => !(options.removeRuleIds || []).includes(rule.id));
          rules = [...remaining, ...(options.addRules || [])];
        },
      },
      current: () => rules,
    };
  }

  function enabledSettings(disabledSites) {
    return { adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: true, disabledSites } };
  }

  it('installs nothing for zero disabled sites', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const mock = sessionMock([]);
    const report = await reconcileAdblock(enabledSettings({}), mock.api);
    assert.equal(report.ok, true);
    assert.equal(report.exceptionsOk, true);
    assert.deepEqual(report.exceptionHosts, []);
    assert.equal(mock.calls.length, 0);
  });

  it('installs exact rules for one disabled site', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const mock = sessionMock([]);
    const report = await reconcileAdblock(
      enabledSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), mock.api);
    assert.equal(report.ok, true);
    assert.deepEqual(report.exceptionHosts, ['example.com']);
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(mock.calls[0].session.removeRuleIds, []);
    assert.equal(mock.calls[0].session.addRules.length, 2);
    assert.deepEqual(mock.calls[0].session.addRules[0].condition, { urlFilter: '|http://example.com^', resourceTypes: ['main_frame'] });
  });

  it('rebuilds rules on service-worker restart from empty session state', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const settings = enabledSettings({
      'b.example': { createdAt: '2026-09-01T00:00:00.000Z' },
      'a.example': { createdAt: '2026-09-02T00:00:00.000Z' },
    });
    const mock = sessionMock([]);
    const report = await reconcileAdblock(settings, mock.api);
    assert.equal(report.ok, true);
    assert.deepEqual(report.exceptionHosts, ['a.example', 'b.example']);
    assert.equal(mock.calls[0].session.addRules.length, 4);
  });

  it('removes one exception while leaving others intact', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const full = enabledSettings({
      'a.example': { createdAt: '2026-09-01T00:00:00.000Z' },
      'b.example': { createdAt: '2026-09-02T00:00:00.000Z' },
    });
    const mock = sessionMock([]);
    await reconcileAdblock(full, mock.api);
    assert.equal(mock.current().length, 4);
    const reduced = enabledSettings({ 'b.example': { createdAt: '2026-09-02T00:00:00.000Z' } });
    const report = await reconcileAdblock(reduced, mock.api);
    assert.equal(report.ok, true);
    const remaining = mock.current();
    assert.equal(remaining.length, 2);
    assert.ok(remaining.every((rule) => rule.condition.urlFilter.includes('b.example')));
  });

  it('removes runtime exception rules when global protection turns off', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const mock = sessionMock([]);
    await reconcileAdblock(enabledSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), mock.api);
    assert.equal(mock.current().length, 2);
    const off = { adTrackerProtection: { enabled: false, blockAds: true, blockTrackers: true, disabledSites: { 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } } } };
    const report = await reconcileAdblock(off, mock.api);
    assert.equal(report.ok, true);
    assert.deepEqual(mock.current(), []);
    // Persisted intent survives for the next enable.
    assert.deepEqual(report.exceptionHosts, []);
  });

  it('restores persisted exceptions when protection turns back on', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const mock = sessionMock([]);
    const report = await reconcileAdblock(
      enabledSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), mock.api);
    assert.equal(report.ok, true);
    assert.deepEqual(report.exceptionHosts, ['example.com']);
    assert.equal(mock.current().length, 2);
  });

  it('leaves unrelated session rules untouched', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const foreign = { id: 42, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'other' } };
    const mock = sessionMock([foreign]);
    const report = await reconcileAdblock(enabledSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), mock.api);
    assert.equal(report.ok, true);
    assert.ok(mock.current().some((rule) => rule.id === 42));
    const sessionCalls = mock.calls.filter((call) => call.session);
    assert.equal(sessionCalls.length, 1);
    assert.equal(sessionCalls[0].session.removeRuleIds.includes(42), false);
  });

  it('skips writes when session state already matches', async () => {
    const { reconcileAdblock, desiredSiteExceptionRules } = require('../browser-extension/dist/test/adblock.js');
    const sites = { 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } };
    const mock = sessionMock(desiredSiteExceptionRules(sites));
    const report = await reconcileAdblock(enabledSettings(sites), mock.api);
    assert.equal(report.ok, true);
    assert.equal(mock.calls.length, 0);
  });

  it('reports DNR failure without throwing', async () => {
    const { reconcileAdblock } = require('../browser-extension/dist/test/adblock.js');
    const failing = {
      getEnabledRulesets: async () => { throw new Error('down'); },
      updateEnabledRulesets: async () => {},
      getSessionRules: async () => { throw new Error('down'); },
      updateSessionRules: async () => {},
    };
    const report = await reconcileAdblock(enabledSettings({}), failing);
    assert.equal(report.ok, false);
    assert.equal(report.staticOk, false);
    assert.equal(report.exceptionsOk, false);
    assert.ok(report.error);
  });
});

describe('adblock site state', () => {
  function siteMock(sessionRules, enabledRulesets = ['soterios-ads', 'soterios-trackers']) {
    return {
      getEnabledRulesets: async () => [...enabledRulesets],
      updateEnabledRulesets: async () => undefined,
      getSessionRules: async () => sessionRules.map((rule) => ({ ...rule })),
      updateSessionRules: async () => undefined,
    };
  }

  function onSettings(sites) {
    return { adTrackerProtection: { enabled: true, blockAds: true, blockTrackers: true, disabledSites: sites } };
  }

  it('marks non-web URLs ineligible without inventing hostnames', async () => {
    const { getAdblockSiteState } = require('../browser-extension/dist/test/adblock.js');
    for (const url of ['chrome://settings/', 'about:blank', '', null, 'file:///C:/x.html']) {
      const state = await getAdblockSiteState(url, onSettings({}), false, siteMock([]));
      assert.equal(state.eligible, false, String(url));
      assert.equal(state.hostname, null);
    }
  });

  it('is unavailable in incognito without persisting anything', async () => {
    const { getAdblockSiteState } = require('../browser-extension/dist/test/adblock.js');
    const state = await getAdblockSiteState('https://example.com/', onSettings({}), true, siteMock([]));
    assert.equal(state.eligible, false);
    assert.equal(state.hostname, 'example.com');
  });

  it('reports active protection with no exception', async () => {
    const { getAdblockSiteState } = require('../browser-extension/dist/test/adblock.js');
    const state = await getAdblockSiteState('https://example.com/path?q=1', onSettings({}), false, siteMock([]));
    assert.equal(state.eligible, true);
    assert.equal(state.hostname, 'example.com');
    assert.equal(state.disabledByUser, false);
    assert.equal(state.exceptionActive, false);
    assert.equal(state.protectionActive, true);
    assert.equal(state.applyWarning, false);
  });

  it('reports an active exception only with both session rules live', async () => {
    const { desiredSiteExceptionRules, getAdblockSiteState } = require('../browser-extension/dist/test/adblock.js');
    const full = desiredSiteExceptionRules({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } });
    const both = await getAdblockSiteState(
      'https://example.com/', onSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), false,
      siteMock(full));
    assert.equal(both.disabledByUser, true);
    assert.equal(both.exceptionActive, true);
    assert.equal(both.protectionActive, false);
    assert.equal(both.applyWarning, false);
    const partial = await getAdblockSiteState(
      'https://example.com/', onSettings({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } }), false,
      siteMock([full[0]]));
    assert.equal(partial.exceptionActive, false);
    assert.equal(partial.applyWarning, true);
  });

  it('warns when the preference was removed but rules remain', async () => {
    const { desiredSiteExceptionRules, getAdblockSiteState } = require('../browser-extension/dist/test/adblock.js');
    const lingering = desiredSiteExceptionRules({ 'example.com': { createdAt: '2026-09-01T00:00:00.000Z' } });
    const state = await getAdblockSiteState('https://example.com/', onSettings({}), false, siteMock(lingering));
    assert.equal(state.disabledByUser, false);
    assert.equal(state.exceptionActive, true);
    assert.equal(state.protectionActive, false);
    assert.equal(state.applyWarning, true);
  });
});

describe('adblock renderer wiring', () => {
  it('keeps DNR access inside background/adblock modules only', () => {
    const fs = require('fs');
    const path = require('path');
    for (const file of ['popup.ts', 'options.ts']) {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'browser-extension', 'src', file), 'utf8');
      assert.ok(!source.includes('chrome.declarativeNetRequest'),
        `${file} must not touch DNR directly`);
      assert.ok(!source.includes('updateSessionRules') && !source.includes('updateEnabledRulesets'),
        `${file} must not call rule APIs directly`);
    }
  });

  it('wires the site toggle to narrow messages with labelled controls', () => {
    const fs = require('fs');
    const path = require('path');
    const popupHtml = fs.readFileSync(
      path.join(__dirname, '..', 'browser-extension', 'popup.html'), 'utf8');
    assert.ok(popupHtml.includes('id="adblock-site-toggle"'));
    assert.ok(popupHtml.includes('id="adblock-site-status"'));
    const popupTs = fs.readFileSync(
      path.join(__dirname, '..', 'browser-extension', 'src', 'popup.ts'), 'utf8');
    assert.ok(popupTs.includes('GET_ADBLOCK_SITE_STATE'));
    assert.ok(popupTs.includes('SET_ADBLOCK_SITE_EXCEPTION'));
    assert.ok(!popupTs.includes('window.api.invoke'));
  });
});
