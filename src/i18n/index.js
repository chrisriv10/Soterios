'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'locales');
const DEFAULT_LOCALE = 'en';

const LOCALE_LABELS = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  ja: '日本語',
  'zh-CN': '中文（简体）',
  ko: '한국어',
  it: 'Italiano',
  pl: 'Polski',
  nl: 'Nederlands',
  ru: 'Русский',
  tr: 'Türkçe',
  ar: 'العربية',
  hi: 'हिन्दी'
};

const RTL_LOCALES = new Set(['he', 'fa', 'ur', 'ar']);

const catalogCache = new Map();
let availableLocalesCache = null;

/**
 * Reads the locale JSON files from the locales directory.
 *
 * @returns {string[]} Available locale codes derived from filenames.
 */
function readLocaleFiles() {
  if (!fs.existsSync(LOCALES_DIR)) return [];
  return fs.readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5));
}

/**
 * Returns the sorted list of locale codes available in the locales directory.
 *
 * The default locale `en` is always listed first. Remaining locales are
 * sorted by their display label.
 *
 * @returns {string[]} Available locale codes.
 */
function listAvailableLocales() {
  if (!availableLocalesCache) {
    availableLocalesCache = readLocaleFiles().sort((a, b) => {
      if (a === DEFAULT_LOCALE) return -1;
      if (b === DEFAULT_LOCALE) return 1;
      const labelA = LOCALE_LABELS[a] || a;
      const labelB = LOCALE_LABELS[b] || b;
      return labelA.localeCompare(labelB);
    });
  }
  return [...availableLocalesCache];
}

/**
 * Returns the list of available locales with their display labels and RTL flags.
 *
 * @returns {Array<{code: string, label: string, rtl: boolean}>} Locale descriptors.
 */
function listLocales() {
  return listAvailableLocales().map((code) => ({
    code,
    label: LOCALE_LABELS[code] || code,
    rtl: isRtlLocale(code)
  }));
}

/**
 * Determines whether a locale is right-to-left.
 *
 * Checks the normalized locale code and its base language subtag against
 * the known RTL locale set.
 *
 * @param {string} locale - Locale code to test.
 * @returns {boolean} True if the locale is RTL.
 */
function isRtlLocale(locale) {
  const normalized = normalizeLocale(locale);
  const base = normalized.split('-')[0];
  return RTL_LOCALES.has(normalized) || RTL_LOCALES.has(base);
}

/**
 * Normalizes a locale code to one of the available catalog codes.
 *
 * Resolution order:
 * 1. Exact match against available codes.
 * 2. Case-insensitive match.
 * 3. Language-prefix fallback (e.g. `pt` → `pt-BR`, `zh` → `zh-CN`).
 * 4. Base-language match against available codes.
 * 5. Falls back to the default locale (`en`) when no match is found.
 *
 * @param {string} locale - Raw locale code to normalize.
 * @returns {string} Resolved available locale code.
 */
function normalizeLocale(locale) {
  const available = listAvailableLocales();
  const availableSet = new Set(available);
  const value = String(locale || '').trim();
  if (!value) return DEFAULT_LOCALE;

  if (availableSet.has(value)) return value;

  const lower = value.toLowerCase();
  for (const code of available) {
    if (code.toLowerCase() === lower) return code;
  }

  if (lower.startsWith('pt') && availableSet.has('pt-BR')) return 'pt-BR';
  if (lower.startsWith('zh') && availableSet.has('zh-CN')) return 'zh-CN';

  const base = value.split('-')[0].toLowerCase();
  for (const code of available) {
    if (code.toLowerCase() === base || code.split('-')[0].toLowerCase() === base) {
      return code;
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Loads a translation catalog for the given locale.
 *
 * Results are cached in memory. If the requested locale file cannot be
 * read or parsed, the function falls back to the default locale catalog
 * unless the default locale itself was requested.
 *
 * @param {string} locale - Locale code whose catalog should be loaded.
 * @returns {Object} Translation key/value pairs for the locale.
 */
function loadCatalog(locale) {
  const normalized = normalizeLocale(locale);
  if (catalogCache.has(normalized)) return catalogCache.get(normalized);

  const filePath = path.join(LOCALES_DIR, `${normalized}.json`);
  let catalog = {};
  try {
    catalog = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    if (normalized !== DEFAULT_LOCALE) {
      return loadCatalog(DEFAULT_LOCALE);
    }
  }
  catalogCache.set(normalized, catalog);
  return catalog;
}

/**
 * Translates a localization key for the given locale.
 *
 * Lookup order:
 * 1. Exact key in the requested locale catalog.
 * 2. Fallback to the default locale catalog if the requested locale differs.
 * 3. Returns the key itself when no translation is found.
 *
 * Interpolation: `{variable}` placeholders in the translation string are
 * replaced with the corresponding values from `vars`.
 *
 * @param {string} key - Translation key to resolve.
 * @param {string} [locale=DEFAULT_LOCALE] - Target locale code.
 * @param {Object} [vars={}] - Interpolation variables.
 * @returns {string} Translated string, or the key when missing.
 */
function t(key, locale = DEFAULT_LOCALE, vars = {}) {
  const normalized = normalizeLocale(locale);
  const catalog = loadCatalog(normalized);
  let value = catalog[key];
  if (value == null && normalized !== DEFAULT_LOCALE) {
    value = loadCatalog(DEFAULT_LOCALE)[key];
  }
  if (value == null) return key;
  return String(value).replace(/\{(\w+)\}/g, (_match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
  ));
}

module.exports = {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  RTL_LOCALES,
  listAvailableLocales,
  listLocales,
  isRtlLocale,
  normalizeLocale,
  loadCatalog,
  t
};
