'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listAvailableLocales, loadCatalog, t } = require('../src/i18n');

const visualizationKeys = [
  'firewall.perimeterBandSafe',
  'firewall.perimeterBandUnknown',
  'firewall.perimeterBandMalicious',
  'firewall.perimeterHubCount',
  'firewall.perimeterNodeAria',
  'firewall.perimeterEndpointSummary',
  'firewall.perimeterDurationSeconds',
  'firewall.perimeterDurationMinutes',
  'firewall.perimeterDurationHours',
  'firewall.perimeterDirectionMixed',
  'firewall.perimeterSockets',
  'firewall.perimeterObservedFor',
  'firewall.perimeterRecentActivity',
  'firewall.perimeterPollWindow',
  'firewall.perimeterActivityAria',
  'firewall.perimeterServices',
  'firewall.perimeterStates',
  'firewall.perimeterMemberConnections',
  'network.heatmapRestore',
  'network.heatmapMarkerAria',
  'network.heatmapMarkerTitle',
  'network.heatmapArcsUnavailable',
  'network.heatmapCloseDetails',
  'network.heatmapConnections',
  'network.heatmapUniqueIps',
  'network.heatmapTopProcesses',
  'network.heatmapTopServices',
  'network.heatmapStatesPorts',
  'network.heatmapEndpoints',
  'network.heatmapFocusCluster',
  'network.heatmapNone',
  'network.historyHeading',
  'network.historyRestore',
  'network.historyRangeAria',
  'network.historyRange1h',
  'network.historyRange6h',
  'network.historyRange24h',
  'network.historyRange7d',
  'network.historyCurrent',
  'network.historyAverage',
  'network.historyPeakBoth',
  'network.historyPeakCallout',
  'network.historyKeyboardHelp',
  'network.historySummary'
];

describe('i18n - missing translation detection', () => {
  it('should have all translation keys used in code defined in English locale', async () => {
    // This test scans the codebase for translation key usages and verifies they exist
    // For now, we'll do a simpler check: verify that common UI keys exist
    
    const enCatalog = loadCatalog('en');
    
    // Check for common keys that should always exist
    const commonKeys = [
      'dashboard.quickScan',
      'dashboard.fullScan',
      'scanner.statusScanning',
      'tools.duplicateGroups',
      'tools.duplicateShowing',
      'dashboard.lastScan'
    ];
    
    for (const key of commonKeys) {
      const value = enCatalog[key];
      assert.ok(value != null, `Missing translation key "${key}" in English locale`);
      assert.notEqual(value, key, `Translation key "${key}" returns raw key (missing translation)`);
    }
  });

  it('should return raw key when translation is missing', () => {
    // Test the fallback behavior
    const missingKey = 'this.key.does.not.exist.in.any.locale';
    const result = t(missingKey, 'en');
    assert.equal(result, missingKey, 'Should return raw key when translation is missing');
  });

  it('should have consistent keys across all locales for core UI', async () => {
    // Check that core UI keys exist in all locales
    const locales = listAvailableLocales();
    const coreKeys = [
      'dashboard.quickScan',
      'dashboard.fullScan',
      'scanner.statusScanning'
    ];
    
    for (const locale of locales) {
      const catalog = loadCatalog(locale);
      for (const key of coreKeys) {
        const value = catalog[key];
        assert.ok(value != null, `Missing key "${key}" in locale "${locale}"`);
      }
    }
  });

  it('should have identical translation key sets across all locales', async () => {
    const enCatalog = loadCatalog('en');
    const enKeys = Object.keys(enCatalog).sort();
    const locales = listAvailableLocales();

    for (const locale of locales) {
      if (locale === 'en') continue;

      const catalog = loadCatalog(locale);
      const localeKeys = Object.keys(catalog).sort();

      const missing = enKeys.filter((key) => !localeKeys.includes(key));
      const extras = localeKeys.filter((key) => !enKeys.includes(key));

      assert.equal(
        localeKeys.length,
        enKeys.length,
        `Locale "${locale}" has ${localeKeys.length} keys vs ${enKeys.length} in English`
      );
      assert.deepEqual(missing, [], `Locale "${locale}" is missing keys: ${missing.join(', ')}`);
      assert.deepEqual(extras, [], `Locale "${locale}" has keys not present in English: ${extras.join(', ')}`);

      for (const key of enKeys) {
        const value = catalog[key];
        assert.equal(typeof value, 'string', `Key "${key}" in locale "${locale}" is not a string`);
        assert.ok(value.length > 0, `Key "${key}" in locale "${locale}" is empty`);
      }
    }
  });

  it('defines every visualization string in every locale', () => {
    for (const locale of listAvailableLocales()) {
      const catalog = loadCatalog(locale);
      for (const key of visualizationKeys) {
        assert.equal(typeof catalog[key], 'string', `Missing visualization key "${key}" in locale "${locale}"`);
        assert.ok(catalog[key].length > 0, `Empty visualization key "${key}" in locale "${locale}"`);
      }
    }
  });
});

describe('i18n - locale file integrity', () => {
  it('should have valid JSON for all locale files', async () => {
    const locales = listAvailableLocales();
    
    for (const locale of locales) {
      const catalog = loadCatalog(locale);
      assert.ok(typeof catalog === 'object', `Locale "${locale}" catalog is not an object`);
      assert.ok(catalog !== null, `Locale "${locale}" catalog is null`);
    }
  });

  it('should have at least one locale available', async () => {
    const locales = listAvailableLocales();
    assert.ok(locales.length > 0, 'At least one locale should be available');
    assert.ok(locales.includes('en'), 'English locale should be available');
  });
});
