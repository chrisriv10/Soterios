'use strict';

window.I18n = {
  locale: 'en',
  catalog: {},
  fallbackCatalog: {},

  async initialize(locale) {
    const requested = locale || await window.api.invoke('db:getSetting', 'ui.language', '');
    await this.setLocale(requested || 'en', { persist: false });
  },

  async setLocale(locale, options = {}) {
    const normalized = await window.api.invoke('i18n:normalizeLocale', locale || 'en');
    this.catalog = await window.api.invoke('i18n:getCatalog', normalized);
    this.fallbackCatalog = normalized === 'en'
      ? this.catalog
      : await window.api.invoke('i18n:getCatalog', 'en');
    this.locale = normalized;
    document.documentElement.setAttribute('lang', normalized);
    const rtl = await window.api.invoke('i18n:isRtlLocale', normalized);
    document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    if (window.AppState) window.AppState.currentLanguage = normalized;
    if (options.persist !== false) {
      await window.api.invoke('db:setSetting', 'ui.language', normalized);
    }
    this.translateUI();
  },

  t(key, vars) {
    let value = this.catalog[key];
    if (value == null) value = this.fallbackCatalog[key];
    if (value == null) return key;
    
    // If no variables, return the value directly
    if (!vars || typeof vars !== 'object' || Object.keys(vars).length === 0) {
      return value;
    }

    // Handle simple variable substitution
    return String(value).replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
    ));
  },

  translateUI() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = this.t(key);
      if (translated !== key) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = translated;
        } else {
          el.textContent = translated;
        }
      }
    });
  }
};