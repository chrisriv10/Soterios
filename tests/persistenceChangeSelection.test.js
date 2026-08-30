'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'tools.js'),
  'utf8',
);

describe('Persistence Change Monitor selection controls', () => {
  it('renders a select-all control when persistence changes are present', () => {
    assert.match(toolsSource, /id="persistenceSelectAll"/);
    assert.match(toolsSource, /Select all changes/);
    assert.match(toolsSource, /changes\.total \? '<div class="maintenance-result-toolbar persistence-selection-toolbar"/);
  });

  it('selects every change and keeps the master checkbox synchronized', () => {
    assert.match(toolsSource, /target\.id === 'persistenceSelectAll'/);
    assert.match(toolsSource, /querySelectorAll\('\.persistence-change-select'\)\.forEach/);
    assert.match(toolsSource, /selectAll\.indeterminate = selected > 0 && selected < inputs\.length/);
  });
});
