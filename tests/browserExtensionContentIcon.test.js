'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'src', 'content.ts'), 'utf8');

describe('browser extension password-field control', () => {
  it('uses the packaged Soterios icon for the idle field control', () => {
    assert.match(contentSource, /icon\.src = chrome\.runtime\.getURL\('icons\/icon32\.png'\)/);
    assert.match(contentSource, /setFieldGlyph\(button, 'S'\)/);
    assert.doesNotMatch(contentSource, /button\.textContent = 'S'/);
  });
});
