'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'tools.js'),
  'utf8'
);
const toolsStyles = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'css', 'style.css'),
  'utf8'
);

describe('duplicate finder path layout', () => {
  it('keeps duplicate row paths contained and exposes their full values on hover', () => {
    assert.match(toolsSource, /class="path-cell" title="\$\{this\.e\(file\.path\)\}">\$\{this\.e\(file\.path\)\}/);
    assert.match(toolsSource, /<small title="\$\{this\.e\(file\.parentFolder\)\}">\$\{this\.e\(file\.parentFolder\)\}<\/small>/);
    assert.match(toolsStyles, /\.duplicate-file-row\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
    assert.match(toolsStyles, /\.duplicate-file-row > small\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/);
    assert.match(toolsStyles, /\.duplicate-result-group > header select\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*text-overflow:\s*ellipsis;/);
  });

  it('provides the retained path to the closed select as a tooltip', () => {
    assert.match(toolsSource, /class="duplicate-keep" data-group-id="\$\{this\.e\(group\.id\)\}" title="\$\{this\.e\(keep \|\| ''\)\}"/);
  });
});
