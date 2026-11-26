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
    assert.equal((reportsSource.match(/class="report-section-clear-slot"/g) || []).length, 5);
    assert.equal((reportsSource.match(/class="report-section-chevron"/g) || []).length, 5);
    assert.equal((reportsSource.match(/report-section-toggle--single-action/g) || []).length, 3);
    assert.match(reportsStyles, /\.report-section-toggle\s*\{[\s\S]*display:\s*grid\s*!important;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 80px 168px 14px;/);
    assert.match(reportsStyles, /\.report-browser\s*\{\s*container:\s*reports-browser \/ inline-size;/);
    assert.match(reportsStyles, /@container reports-browser \(max-width:\s*520px\)/);
    assert.match(reportsStyles, /\.report-section-toggle--single-action\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 80px 14px;[\s\S]*grid-template-areas:\s*"label clear chevron";/);
    assert.match(reportsStyles, /\.report-section-toggle--single-action\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 80px 0 14px;/);
    assert.match(reportsStyles, /\.report-clear-button\s*\{[\s\S]*width:\s*80px;/);
  });

  it('keeps Generate System Report in a separate action slot', () => {
    assert.match(reportsSource, /class="report-section-extra-slot"><button class="btn btn-primary btn-sm report-generate-button" id="generateReport"/);
    assert.match(reportsStyles, /\.report-generate-button\s*\{[\s\S]*width:\s*168px;/);
    assert.match(reportsStyles, /\.report-generate-button\s*\{[^}]*min-width:\s*168px;[^}]*flex-shrink:\s*0;/);
    assert.match(reportsStyles, /@container reports-browser \(max-width:\s*520px\)[\s\S]*"label label chevron"\s*"clear extra extra"/);
  });

  it('scopes Defender rows and controls to shrink-safe responsive layouts', () => {
    assert.match(reportsSource, /class="history-item defender-history-item"/);
    assert.match(reportsSource, /class="defender-history-content"/);
    assert.match(reportsSource, /class="defender-history-actions"/);
    assert.match(reportsSource, /class="history-meta defender-history-resource" dir="ltr"/);
    assert.match(reportsStyles, /\.history-item\s*\{\s*display:\s*flex;/, 'generic history layout remains unchanged');
    assert.match(reportsStyles, /\.defender-history-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    assert.match(reportsStyles, /\.defender-history-content\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
    assert.match(reportsStyles, /\.defender-history-detected,\s*\.defender-history-resource\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/);
    assert.match(reportsStyles, /\.defender-history-resource\s*\{[^}]*direction:\s*ltr;/);
    assert.match(reportsStyles, /@container reports-browser \(max-width:\s*700px\)[\s\S]*\.defender-history-filter-buttons\s*\{\s*grid-column:\s*1 \/ -1;/);
    assert.match(reportsStyles, /@container reports-browser \(max-width:\s*400px\)[\s\S]*\.defender-history-item\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
