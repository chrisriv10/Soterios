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

function readLocaleFiles() {
  if (!fs.existsSync(LOCALES_DIR)) return [];
  return fs.readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5));
}

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

function listLocales() {
  return listAvailableLocales().map((code) => ({
    code,
    label: LOCALE_LABELS[code] || code,
    rtl: isRtlLocale(code)
  }));
}

function isRtlLocale(locale) {
  const normalized = normalizeLocale(locale);
  const base = normalized.split('-')[0];
  return RTL_LOCALES.has(normalized) || RTL_LOCALES.has(base);
}

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
