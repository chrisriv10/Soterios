'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'reports.js'),
  'utf8'
);
const reportsStyles = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'css', 'style.css'),
  'utf8'
);

describe('reports section action alignment', () => {
  it('gives every report heading the same clear and chevron slots', () => {
    assert.equal((reportsSource.match(/class="report-section-clear-slot"/g) || []).length, 4);
    assert.equal((reportsSource.match(/class="report-section-chevron"/g) || []).length, 4);
    assert.equal((reportsSource.match(/report-section-toggle--single-action/g) || []).length, 3);
    assert.match(reportsStyles, /\.report-section-toggle\s*\{[\s\S]*display:\s*grid\s*!important;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 80px 168px 14px;/);
    assert.match(reportsStyles, /\.report-section-toggle--single-action\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 80px 0 14px;/);
    assert.match(reportsStyles, /\.report-clear-button\s*\{[\s\S]*width:\s*80px;/);
  });

  it('keeps Generate System Report in a separate action slot', () => {
    assert.match(reportsSource, /class="report-section-extra-slot"><button class="btn btn-primary btn-sm report-generate-button" id="generateReport"/);
    assert.match(reportsStyles, /\.report-generate-button\s*\{[\s\S]*width:\s*168px;/);
  });
});
