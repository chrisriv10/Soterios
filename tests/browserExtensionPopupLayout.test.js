'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'browser-extension');
const css = fs.readFileSync(path.join(extensionRoot, 'src', 'ui.css'), 'utf8');
const popup = fs.readFileSync(path.join(extensionRoot, 'popup.html'), 'utf8');

describe('browser extension popup layout', () => {
  it('uses the wide desktop shell and avoids the old forced narrow width', () => {
    assert.match(css, /\.popup\{width:560px;min-width:560px;min-height:560px\}/);
    assert.doesNotMatch(css, /\.popup\{width:320px/);
    assert.match(css, /@media\(max-width:460px\)\{\.popup\{width:100vw;min-width:0\}/);
    assert.doesNotMatch(css, /max-width:100vw/);
  });

  it('uses wide layouts for protection actions and generator controls', () => {
    assert.match(popup, /class="actions protection-actions"/);
    assert.match(css, /\.protection-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(popup, /class="row wrap generator-row"/);
    assert.match(css, /\.generator-row\{display:grid!important;grid-template-columns:minmax\(0,1fr\) auto/);
    assert.match(css, /\.generator-row \.button\{min-width:105px\}/);
  });
});
