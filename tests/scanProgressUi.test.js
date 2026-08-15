'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listAvailableLocales, loadCatalog } = require('../src/i18n');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('detailed scan progress UI', () => {
  const scannerSource = read('src', 'ui', 'js', 'pages', 'scanner.js');
  const indicatorSource = read('src', 'ui', 'js', 'scanIndicator.js');
  const shellSource = read('src', 'ui', 'pages', 'shell.html');
  const styles = read('src', 'ui', 'css', 'style.css');

  it('renders the persistent metrics and an accessible overall progress bar', () => {
    for (const id of [
      'scanStatusCard',
      'scanProgressPct',
      'scanFilesMetric',
      'scanThreatsMetric',
      'scanElapsedMetric',
      'scanTargetsMetric'
    ]) {
      assert.match(scannerSource, new RegExp(`id=["']${id}["']`));
    }
    assert.match(scannerSource, /role="progressbar"/);
    assert.match(scannerSource, /aria-valuenow="0"/);
    assert.match(scannerSource, /aria-live="polite"/);
    assert.doesNotMatch(scannerSource, /hideCardTimer/);
    assert.doesNotMatch(scannerSource, /estimated time|time remaining|\bETA\b/i);
  });

  it('marks full-scan progress as estimated and ignores folder-watch events', () => {
    assert.match(scannerSource, /progressEstimated: scanType === 'full'/);
    assert.match(scannerSource, /scanType === 'folderwatch'/);
    assert.match(styles, /\.scan-progress-estimate/);
  });

  it('makes the sidebar indicator keyboard accessible and focuses scan details', () => {
    assert.match(shellSource, /id="scanIndicatorOpen"[^>]*role="button"[^>]*tabindex="0"/);
    assert.match(indicatorSource, /window\.AppRouter\.navigate\('scanner'\)/);
    assert.match(indicatorSource, /panel\.scrollIntoView/);
    assert.match(indicatorSource, /panel\.focus/);
    assert.match(indicatorSource, /event\.key !== 'Enter'/);
    assert.match(indicatorSource, /e\.stopPropagation\(\)/);
  });

  it('defines every new progress label in every locale', () => {
    const keys = [
      'scanIndicator.openDetails',
      'scanner.overallProgress',
      'scanner.estimatedProgress',
      'scanner.currentActivity',
      'scanner.filesScanned',
      'scanner.threatsFoundLabel',
      'scanner.elapsedTime',
      'scanner.scanTargets',
      'scanner.phasePreparing',
      'scanner.phaseScanning',
      'scanner.phaseUpdatingDefinitions',
      'scanner.phaseQuarantining',
      'scanner.phaseCanceling',
      'scanner.phaseCompleted',
      'scanner.phaseFailed',
      'scanner.phaseCanceled'
    ];
    for (const locale of listAvailableLocales()) {
      const catalog = loadCatalog(locale);
      for (const key of keys) {
        assert.ok(catalog[key], `${locale} is missing ${key}`);
      }
    }
  });
});
