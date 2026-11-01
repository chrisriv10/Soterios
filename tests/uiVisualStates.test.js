'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

it('disk health severity resets across warning, healthy, unknown and unavailable snapshots', () => {
  const ui = source('src/ui/js/pages/dashboard.js');
  const start = ui.indexOf('function renderDiskHealth(snapshot)');
  const end = ui.indexOf('async function refreshDiskHealth()', start);
  assert.ok(start >= 0 && end > start);
  const element = () => ({ textContent: '', className: '', style: {}, children: [], appendChild(child) { this.children.push(child); } });
  const nodes = Object.fromEntries(['diskHealthSummary', 'diskHealthRows', 'diskHealthIcon'].map(id => [id, element()]));
  const render = vm.runInNewContext(`(${ui.slice(start, end).trim()})`, {
    container: { querySelector: selector => nodes[selector.slice(1)] },
    document: { createElement: element },
    t: key => key,
    formatSizeGB: () => null,
    formatTempC: value => String(value),
  });
  for (const [health, icon, rowClass] of [
    ['warning', 'warning', 'disk-health-warning'],
    ['healthy', 'safe', ''],
    ['unknown', 'info', ''],
    ['warning', 'warning', 'disk-health-warning'],
  ]) {
    nodes.diskHealthRows.children = [];
    render({ available: true, disks: [{ name: 'Test disk', health }] });
    assert.equal(nodes.diskHealthIcon.className, `status-icon ${icon}`);
    assert.equal(nodes.diskHealthRows.children[0].children[1].className, rowClass);
  }
  render({ available: false });
  assert.equal(nodes.diskHealthIcon.className, 'status-icon info');
  assert.equal(nodes.diskHealthSummary.textContent, 'diskHealth.queryUnavailable');
  assert.equal(nodes.diskHealthRows.textContent, '');
  render({ available: true, disks: [] });
  assert.equal(nodes.diskHealthIcon.className, 'status-icon info');
});

it('removable-drive toast names the scan destination without relabeling other actions', () => {
  const main = source('src/main/main.js');
  const declaration = main.match(/const translatedOpenText = ([^;]+);/);
  assert.ok(declaration);
  const label = action => vm.runInNewContext(declaration[1], { action, t: key => key });
  assert.equal(label('removable-scan'), 'nav.scanner');
  for (const action of ['scanner', 'dashboard', undefined]) assert.equal(label(action), 'toast.open');
});

it('report clear actions follow populated, empty and failed list refreshes', async () => {
  let populated = true;
  let fail = false;
  const sandbox = {
    window: { Pages: {}, api: { invoke: async channel => {
      if (fail) throw new Error('Unavailable');
      if (channel === 'db:getSetting') return true;
      if (channel.includes(':deleteAll')) { populated = false; return { success: true }; }
      const rows = populated ? [{ id: 1, status: 'completed', name: 'soterios-report-test.json', path: 'test.json', mtime: '2026-10-25T12:00:00Z', summary: {}, results: [] }] : [];
      return channel.startsWith('maintenance:') ? { ok: true, data: rows } : rows;
    } } },
    escapeHtml: value => String(value ?? ''),
    tFactory: () => key => key,
  };
  vm.runInNewContext(source('src/ui/js/pages/reports.js'), sandbox, {
    filename: path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'reports.js'),
  });
  const reports = sandbox.window.Pages.reports;
  for (const [method, clearChannel] of [
    ['listScanReports', 'scanReports:deleteAll'],
    ['listReports', 'reports:deleteAll'],
    ['listManualMaintenanceHistory', 'maintenance:deleteAllManual'],
    ['listScheduledMaintenanceHistory', 'maintenance:deleteAllScheduled'],
  ]) {
    let hidden = true;
    const button = { classList: { add: () => { hidden = true; }, toggle: (_, value) => { hidden = value; } } };
    // An empty list still has its empty-state DOM child; it is not a report.
    const list = { innerHTML: '', children: [{ className: 'empty-state' }], querySelectorAll: () => [] };
    const container = { querySelector: selector => selector.startsWith('#clearAll') ? button : list };
    fail = false;
    for (const state of [true, false, true]) {
      populated = state;
      await reports[method](container);
      assert.equal(hidden, !state, `${method}: populated=${state}`);
    }
    fail = true;
    await reports[method](container);
    assert.equal(hidden, true, `${method}: failed refresh`);
    fail = false;
    populated = true;
    await reports[method](container);
    await reports.handleClearAll(container, clearChannel, 'confirm', () => reports[method](container));
    assert.equal(hidden, true, `${method}: successful clear leaves only the empty state`);
  }
});
