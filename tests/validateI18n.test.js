'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LOCALES_DIR,
  REFERENCE_FILE,
  collectKeys,
  loadLocale,
  validate
} = require('../tools/validate-i18n');

const tempDirs = [];

function makeLocalesDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-i18n-'));
  tempDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const raw = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
    fs.writeFileSync(path.join(dir, name), raw);
  }
  return dir;
}

function problemsFor(result, file) {
  const failure = result.failures.find((entry) => entry.file === file);
  return failure ? failure.problems : [];
}

after(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('validate-i18n collectKeys', () => {
  it('collects flat leaf paths without flagging nested or duplicate entries', () => {
    const keys = new Set();
    const duplicates = new Set();
    const nested = new Set();
    collectKeys({ 'a.b': 'x', 'c.d.e': 'y' }, '', keys, duplicates, nested);
    assert.deepEqual([...keys].sort(), ['a.b', 'c.d.e']);
    assert.equal(duplicates.size, 0);
    assert.equal(nested.size, 0);
  });

  it('flags object values as nested while still collecting their flattened paths', () => {
    const keys = new Set();
    const duplicates = new Set();
    const nested = new Set();
    collectKeys({ settings: { theme: { title: 'Dark' } } }, '', keys, duplicates, nested);
    assert.ok(nested.has('settings'));
    assert.ok(nested.has('settings.theme'));
    assert.ok(keys.has('settings.theme.title'));
  });

  it('flags array values as nested', () => {
    const keys = new Set();
    const duplicates = new Set();
    const nested = new Set();
    collectKeys({ 'list.items': ['a', 'b'] }, '', keys, duplicates, nested);
    assert.ok(nested.has('list.items'));
    assert.equal(keys.size, 0);
  });

  it('records a duplicate when a flat dotted key collides with a nested path', () => {
    const keys = new Set();
    const duplicates = new Set();
    const nested = new Set();
    collectKeys({ 'a.b': 'flat', a: { b: 'nested' } }, '', keys, duplicates, nested);
    assert.ok(duplicates.has('a.b'));
    assert.ok(nested.has('a'));
  });
});

describe('validate-i18n validate', () => {
  it('passes when locales match the flat reference keys', () => {
    const dir = makeLocalesDir({
      'en.json': { 'a.b': 'one', 'c.d': 'two' },
      'fr.json': { 'a.b': 'un', 'c.d': 'deux' }
    });
    const result = validate(dir);
    assert.equal(result.fatal, undefined);
    assert.deepEqual(result.failures, []);
    assert.equal(result.checked, 1);
    assert.equal(result.keyCount, 2);
  });

  it('rejects a nested locale even when its flattened keys match the reference', () => {
    // Regression: a nested object flattens to "settings.theme.title" so it used
    // to pass parity, but the runtime lookup is a flat catalog[key] and would
    // fall back to English. It must now fail validation.
    const dir = makeLocalesDir({
      'en.json': { 'settings.theme.title': 'Theme' },
      'fr.json': { settings: { theme: { title: 'Thème' } } }
    });
    const result = validate(dir);
    const problems = problemsFor(result, 'fr.json');
    assert.ok(problems.some((problem) => problem.includes('nested object: settings')));
    assert.ok(!problems.some((problem) => problem.startsWith('missing key')));
    assert.ok(!problems.some((problem) => problem.startsWith('extra key')));
  });

  it('fails the reference locale when en.json has duplicate flattened paths', () => {
    // Regression: reference duplicates were collected but never reported.
    const dir = makeLocalesDir({
      'en.json': { 'a.b': 'flat', a: { b: 'nested' } },
      'fr.json': { 'a.b': 'plat' }
    });
    const result = validate(dir);
    const problems = problemsFor(result, REFERENCE_FILE);
    assert.ok(problems.some((problem) => problem.includes('duplicate key: a.b')));
  });

  it('fails the reference locale when en.json has a nested object', () => {
    const dir = makeLocalesDir({
      'en.json': { settings: { theme: { title: 'Theme' } } },
      'fr.json': { 'settings.theme.title': 'Thème' }
    });
    const result = validate(dir);
    const problems = problemsFor(result, REFERENCE_FILE);
    assert.ok(problems.some((problem) => problem.includes('nested object: settings')));
  });

  it('still fails a non-reference locale with duplicate flattened paths', () => {
    const dir = makeLocalesDir({
      'en.json': { 'a.b': 'one' },
      'fr.json': { 'a.b': 'flat', a: { b: 'nested' } }
    });
    const result = validate(dir);
    const problems = problemsFor(result, 'fr.json');
    assert.ok(problems.some((problem) => problem.includes('duplicate key: a.b')));
    assert.ok(problems.some((problem) => problem.includes('nested object: a')));
  });

  it('still reports missing and extra keys', () => {
    const dir = makeLocalesDir({
      'en.json': { 'a.b': 'one', 'c.d': 'two' },
      'fr.json': { 'a.b': 'un', 'e.f': 'trois' }
    });
    const result = validate(dir);
    const problems = problemsFor(result, 'fr.json');
    assert.ok(problems.some((problem) => problem === 'missing key: c.d'));
    assert.ok(problems.some((problem) => problem === 'extra key: e.f'));
  });

  it('reports invalid JSON and non-object locale files', () => {
    const dir = makeLocalesDir({
      'en.json': { 'a.b': 'one' },
      'fr.json': '{ not json',
      'de.json': '["a", "b"]'
    });
    const result = validate(dir);
    assert.ok(problemsFor(result, 'fr.json').some((problem) => problem.startsWith('invalid JSON')));
    assert.ok(problemsFor(result, 'de.json').some((problem) => problem.includes('expected a JSON object')));
  });

  it('returns a fatal error when the reference file is missing', () => {
    const dir = makeLocalesDir({ 'fr.json': { 'a.b': 'un' } });
    const result = validate(dir);
    assert.ok(result.fatal.includes(REFERENCE_FILE));
  });

  it('validates the shipped locales directory cleanly', () => {
    const result = validate(LOCALES_DIR);
    assert.equal(result.fatal, undefined);
    assert.deepEqual(result.failures, []);
  });
});
