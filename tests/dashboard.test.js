'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('dashboard warning metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'dashboard.js'), 'utf8');

  function extractWarningActions() {
    const marker = 'const warningActions = {';
    const startIdx = source.indexOf(marker);
    assert.ok(startIdx !== -1, 'warningActions object must exist in dashboard.js');
    const objStart = source.indexOf('{', startIdx);
    let depth = 0;
    let endIdx = -1;
    for (let i = objStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    assert.ok(endIdx !== -1, 'warningActions object must be parseable');
    const objText = source.slice(objStart, endIdx);
    const sandbox = { window: { api: { invoke: async () => {} } } };
    return vm.runInNewContext(`(${objText})`, sandbox);
  }

  it('should not reference the deleted warningTranslations object', () => {
    assert.ok(
      !source.includes('warningTranslations'),
      'dashboard.js must not reference the deleted warningTranslations object'
    );
  });

  it('should have a single translateWarning definition', () => {
    const matches = source.match(/function translateWarning/g) || [];
    assert.equal(matches.length, 1, 'translateWarning should be defined exactly once');
  });

  it('should give every warning a title, detail and label for translation', () => {
    const actions = extractWarningActions();
    const entries = Object.entries(actions);
    assert.ok(entries.length >= 14, `expected at least 14 known warnings, got ${entries.length}`);
    for (const [rawTitle, meta] of entries) {
      assert.equal(typeof rawTitle, 'string');
      assert.ok(rawTitle.length > 0, 'warning key must be a non-empty string');
      assert.equal(typeof meta.title, 'string', `${rawTitle}: missing title i18n key`);
      assert.equal(typeof meta.detail, 'string', `${rawTitle}: missing detail i18n key`);
      assert.equal(typeof meta.label, 'string', `${rawTitle}: missing action label i18n key`);
      assert.ok(meta.title.startsWith('dashboard.warn.'), `${rawTitle}: title key must live under dashboard.warn`);
      assert.ok(meta.label.startsWith('dashboard.action.'), `${rawTitle}: label key must live under dashboard.action`);
    }
  });

  it('should translate a known warning via the shared source of truth', () => {
    const actions = extractWarningActions();
    const i18n = require(path.join(__dirname, '..', 'src', 'i18n'));
    const catalog = i18n.loadCatalog('en');
    const sample = Object.entries(actions)[0];
    const [rawTitle, meta] = sample;
    const title = catalog[meta.title];
    const detail = catalog[meta.detail];
    assert.ok(title != null, `missing en translation for ${meta.title}`);
    assert.ok(detail != null, `missing en translation for ${meta.detail}`);
    assert.notEqual(title, meta.title, `en translation for ${meta.title} must not fall back to the raw key`);
  });

  it('should fetch the ignored list from the DB, not from cached recommendations', () => {
    const cacheBranch = source.slice(source.indexOf('const data = (now - warningCacheTs'));
    assert.ok(
      cacheBranch.includes("await window.api.invoke('warnings:listIgnored')"),
      'ignored warnings must be re-fetched from the DB on every load'
    );
    assert.ok(
      !/warningCacheData\.recommendations[\s\S]*unignore-warning/.test(cacheBranch),
      'ignored list must not be rendered from warningCacheData.recommendations'
    );
  });

  it('should invalidate the warning cache after ignore, restore and action handlers', () => {
    assert.ok(
      source.includes('function invalidateWarningCache()'),
      'an invalidateWarningCache helper must exist'
    );
    for (const [name, line] of [
      ['ignore', "await window.api.invoke('warnings:ignore'"],
      ['restore', "await window.api.invoke('warnings:unignore'"],
      ['action', 'await action.handler();']
    ]) {
      const idx = source.indexOf(line);
      assert.ok(idx !== -1, `loadWarnings must contain the ${name} handler`);
      const tail = source.slice(idx);
      assert.ok(
        tail.includes('invalidateWarningCache()'),
        `the ${name} handler must invalidate the warning cache before reloading`
      );
    }
  });
});
