'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { listAvailableLocales, loadCatalog } = require('../src/i18n');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('detailed scan progress UI', () => {
  const scannerSource = read('src', 'ui', 'js', 'pages', 'scanner.js');
  const indicatorSource = read('src', 'ui', 'js', 'scanIndicator.js');
  const scanIpcSource = read('src', 'main', 'ipc', 'scan.js');
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

  it('orders progress, scan choices, Scheduled Scan, and ClamAV status correctly', () => {
    const progress = scannerSource.indexOf('id="scanStatusCard"');
    const choices = scannerSource.indexOf('id="scanChoiceGrid"');
    const schedule = scannerSource.indexOf('id="scheduleCard"');
    const clam = scannerSource.indexOf('id="clamStatusCard"');
    assert.ok(progress > 0 && progress < choices);
    assert.ok(choices < schedule);
    assert.ok(schedule < clam);
  });

  it('defines scanning, result, and expanded page visibility states', () => {
    assert.match(scannerSource, /const mode = hasResult \? 'result' : isScanRunning \? 'scanning' : 'idle'/);
    assert.match(scannerSource, /scanChoiceGrid\.style\.display = isScanRunning \|\| focusMode \? 'none' : 'grid'/);
    assert.match(scannerSource, /clamStatusCard\.style\.display = isScanRunning \|\| focusMode \? 'none' : 'block'/);
    assert.match(scannerSource, /scheduleCard\.style\.display = focusMode \? 'none' : 'block'/);
    assert.match(scannerSource, /scan-progress-panel--expanded/);
    assert.match(scannerSource, /scan-progress-panel--result/);
  });

  it('supports card expansion and rich result details', () => {
    assert.match(scannerSource, /scanCard\.addEventListener\('click'/);
    assert.match(scannerSource, /isInteractiveTarget\(event\.target\)/);
    assert.match(scannerSource, /expandButton\.addEventListener\('click'/);
    assert.doesNotMatch(scannerSource, /btnCollapseScanProgress/);
    for (const id of ['scanTargetsList', 'scanDetectionsList', 'scanIssuesList', 'scanStartedAt', 'scanCompletedAt']) {
      assert.match(scannerSource, new RegExp(`id=["']${id}["']`));
    }
    assert.match(scannerSource, /data\.report\?\.threats/);
  });

  it('adds a checkmark to targets after their scan finishes', () => {
    assert.match(scannerSource, /Array\.isArray\(data\.completedTargets\)/);
    assert.match(scannerSource, /scan-detail-path--complete/);
    assert.match(scannerSource, /checkmark\.textContent = '✓'/);
    assert.match(styles, /\.scan-detail-path-check/);
  });

  it('stops terminal-state animations and lets results be dismissed', () => {
    assert.match(styles, /\.scan-indicator--done \.scan-indicator-dot[^}]*animation: none/);
    assert.match(styles, /\.scan-progress-panel--result \.scan-progress-track::before[^}]*animation: none/);
    assert.match(scannerSource, /id="btnDismissScanResult"/);
    assert.match(scannerSource, /invoke\('scan:dismissResult'\)/);
    assert.match(scannerSource, /scanCard\.style\.display = 'none'/);
    assert.match(indicatorSource, /window\.ScanIndicatorView = \{ dismiss \}/);
    assert.match(scanIpcSource, /ipcMain\.handle\('scan:dismissResult'/);
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
    assert.match(indicatorSource, /focusTarget\.focus/);
    assert.match(indicatorSource, /event\.key !== 'Enter'/);
    assert.match(indicatorSource, /e\.stopPropagation\(\)/);
    assert.match(indicatorSource, /expandScanProgress = true/);
  });

  it('hides a canceled sidebar indicator after three seconds and ignores late progress', () => {
    function element() {
      const listeners = {};
      return {
        style: {},
        textContent: '',
        disabled: false,
        listeners,
        classList: { add() {}, remove() {} },
        addEventListener(type, listener) { listeners[type] = listener; },
        querySelector() { return null; },
        scrollIntoView() {},
        focus() {}
      };
    }
    const indicator = element();
    const label = element();
    const dot = element();
    indicator.querySelector = (selector) => selector.includes('label') ? label : dot;
    const elements = {
      scanIndicator: indicator,
      scanIndicatorOpen: element(),
      scanIndicatorFill: element(),
      scanIndicatorPct: element(),
      scanIndicatorMsg: element(),
      btnScanIndicatorCancel: element()
    };
    const channels = {};
    const timers = new Map();
    let timerId = 0;
    const context = {
      document: { getElementById: (id) => elements[id] || null },
      window: {
        api: {
          on(channel, listener) { channels[channel] = listener; },
          invoke: async () => ({ success: true })
        },
        I18n: { t: (key) => key }
      },
      requestAnimationFrame: (callback) => callback(),
      setTimeout(callback, delay) {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) { timers.delete(id); }
    };
    vm.runInNewContext(indicatorSource, context);

    channels['scan:progress']({ scanType: 'quick', startedAt: 'scan-1', pct: 25, message: 'Scanning' });
    assert.equal(indicator.style.display, 'block');
    channels['scan:complete']({ scanType: 'quick', startedAt: 'scan-1', status: 'canceled', threatsFound: 0 });
    const doneTimer = [...timers.values()].find((timer) => timer.delay === 3000);
    assert.ok(doneTimer, 'canceled indicator must schedule a three-second dismissal');

    const timerCount = timers.size;
    channels['scan:progress']({ scanType: 'quick', startedAt: 'scan-1', pct: 30, message: 'Late progress' });
    assert.equal(timers.size, timerCount, 'late progress for the completed scan must be ignored');
    doneTimer.callback();
    assert.equal(indicator.style.display, 'none');
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
      'scanner.phaseCanceled',
      'scanner.expandDetails',
      'scanner.collapseDetails',
      'scanner.scannedTargets',
      'scanner.detections',
      'scanner.notesAndErrors',
      'scanner.resultClean'
    ];
    for (const locale of listAvailableLocales()) {
      const catalog = loadCatalog(locale);
      for (const key of keys) {
        assert.ok(catalog[key], `${locale} is missing ${key}`);
      }
    }
  });
});
