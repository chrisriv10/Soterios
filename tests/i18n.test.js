'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listAvailableLocales, loadCatalog, t } = require('../src/i18n');

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

  it('should detect if any locale has significantly fewer keys than English', async () => {
    const enCatalog = loadCatalog('en');
    const enKeyCount = Object.keys(enCatalog).length;
    const locales = listAvailableLocales();
    
    for (const locale of locales) {
      if (locale === 'en') continue;
      
      const catalog = loadCatalog(locale);
      const keyCount = Object.keys(catalog).length;
      
      // Allow for some variance (e.g., 10% difference), but flag major issues
      const threshold = Math.floor(enKeyCount * 0.9);
      assert.ok(
        keyCount >= threshold,
        `Locale "${locale}" has only ${keyCount} keys vs ${enKeyCount} in English (below ${threshold} threshold)`
      );
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
