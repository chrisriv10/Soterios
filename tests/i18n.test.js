'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../src/i18n');

describe('i18n', () => {
  it('loads the English catalog by default', () => {
    assert.equal(i18n.t('tools.title', 'en'), 'Tools & Maintenance');
  });

  it('falls back to English for missing keys', () => {
    assert.equal(i18n.t('missing.key', 'es'), 'missing.key');
  });

  it('normalizes regional locale codes', () => {
    assert.equal(i18n.normalizeLocale('es-ES'), 'es');
    assert.equal(i18n.normalizeLocale('fr-FR'), 'fr');
    assert.equal(i18n.normalizeLocale('pt-BR'), 'pt-BR');
    assert.equal(i18n.normalizeLocale('pt-PT'), 'pt-BR');
    assert.equal(i18n.normalizeLocale('zh-CN'), 'zh-CN');
    assert.equal(i18n.normalizeLocale('zh-TW'), 'zh-CN');
  });

  it('falls back to English for unsupported locales', () => {
    assert.equal(i18n.normalizeLocale('xx-YY'), 'en');
  });

  it('returns translated strings for all initial target languages', () => {
    const targets = ['es', 'fr', 'de', 'pt-BR', 'ja', 'zh-CN', 'ko', 'it', 'pl', 'nl', 'ru', 'tr', 'ar', 'hi'];
    for (const locale of targets) {
      const title = i18n.t('tools.title', locale);
      assert.notEqual(title, 'tools.title');
      assert.notEqual(title, i18n.t('tools.title', 'en'));
    }
  });

  it('lists all initial target locale files', () => {
    const codes = i18n.listAvailableLocales();
    for (const code of ['en', 'es', 'fr', 'de', 'pt-BR', 'ja', 'zh-CN', 'ko', 'it', 'pl', 'nl', 'ru', 'tr', 'ar', 'hi']) {
      assert.ok(codes.includes(code), `missing locale file for ${code}`);
    }
  });

  it('replaces placeholders in translated strings', () => {
    assert.equal(i18n.t('uninstaller.removedCount', 'en', { count: 3 }), 'Removed 3 folder(s)');
  });

  it('detects RTL locales', () => {
    assert.equal(i18n.isRtlLocale('ar'), true);
    assert.equal(i18n.isRtlLocale('en'), false);
  });

  it('returns locale metadata for the settings picker', () => {
    const locales = i18n.listLocales();
    assert.ok(locales.length >= 15);
    assert.ok(locales.some((entry) => entry.code === 'pt-BR' && entry.label.includes('Português')));
  });
});
