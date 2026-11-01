'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
// Allows proving the regressions against an immutable base without checkout.
const read = file => process.env.SOTERIOS_TEST_BASE
  ? execFileSync('git', ['show', `${process.env.SOTERIOS_TEST_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
const english = JSON.parse(read('src/i18n/locales/en.json'));
const translate = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), english[key] || key);
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function harness(invoke = async () => null) {
  const elements = new Map(), events = new Map(), alerts = [], toasts = [], calls = [];
  function element(key) {
    if (!elements.has(key)) {
      const classes = new Set(), listeners = {};
      elements.set(key, {
        innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, children: [], value: '',
        isConnected: true, disabled: false, checked: false, hidden: false,
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { if (on) classes.add(x); else classes.delete(x); } },
        addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {}, listeners,
        setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name]; },
        appendChild(child) { this.children.push(child); }, replaceChildren() {}, replaceWith() {},
        querySelector: selector => selector.startsWith('#') ? element(selector) : null,
        querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 600, height: 220 }),
      });
    }
    return elements.get(key);
  }
  const sandbox = {
    window: { Pages: {}, I18n: { t: translate, locale: 'en', translateUI() {} }, AppState: {}, location: { hash: '#dashboard' },
      api: { invoke: async (...args) => { calls.push(args); return invoke(...args); }, on: (name, fn) => { events.set(name, fn); return () => events.delete(name); } },
      localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {},
    },
    document: { getElementById: id => element('#' + id), querySelector: selector => element(selector), querySelectorAll: () => [], createElement: tag => element(Symbol(tag)), body: { contains: () => true }, documentElement: element('html') },
    escapeHtml, formatBytes: String, parseSqliteTimestamp: value => new Date(value),
    setButtonLoading: (btn, value) => { btn.disabled = value; },
    showToast: (...args) => toasts.push(args), alert: message => alerts.push(message),
    setTimeout: (fn, ms) => { if (ms <= 300) queueMicrotask(fn); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, console, Map, Set, Date,
  };
  sandbox.window.alert = sandbox.alert;
  const context = vm.createContext(sandbox);
  return { ...sandbox, elements, element, events, calls, alerts, toasts, context,
    load(file) { return vm.runInContext(read(file), context, { filename: path.join(root, file) }); } };
}

describe('functional hardening: rendered dashboard', () => {
  for (const [name, response, expected] of [
    ['all enabled', [{ Enabled: true }, { Enabled: 1 }], 'dashboard.firewallActive'],
    ['all disabled', [{ Enabled: false }, { Enabled: 0 }], 'dashboard.firewallDisabled'],
    ['mixed profiles', [{ Enabled: true }, { Enabled: false }], 'dashboard.firewallDisabled'],
    ['single profile', { Enabled: 1 }, 'dashboard.firewallActive'],
    ['empty', [], 'common.unknown'], ['malformed', [{ Enabled: 'false' }], 'common.unknown'],
    ['backend failure', new Error('denied'), 'common.notAvailable'],
  ]) it(name, async () => {
    const h = harness(async (channel, key, fallback) => {
      if (channel === 'firewall:status') { if (response instanceof Error) throw response; return response; }
      if (channel === 'db:getSetting') return fallback;
      if (channel === 'health:score') return { score: 50, reasons: [], breakdown: [] };
      if (channel === 'quarantine:list') return [];
      if (channel === 'scan:status') return {};
      if (channel === 'maintenance:getManualHistory') return { ok: true, data: [] };
      return null;
    });
    h.context.Api = { runTool: async () => ({ issues: [] }) };
    h.load('src/ui/js/pages/dashboard.js');
    await h.window.Pages.dashboard.render(h.element('container'));
    assert.equal(h.element('#fwStatusText').textContent, translate(expected));
    assert.equal(h.element('#fwIcon').className.includes('safe'), expected === 'dashboard.firewallActive');
  });
});

describe('functional hardening: settings IPC and restart', () => {
  for (const key of ['autoUpdates', 'vpnAutoConnect']) it(`${key} persists both values through the real allowlisted write path`, async () => {
    const DatabaseService = require('../src/core/database');
    const { writeRendererSetting, validateRendererSetting } = require('../src/main/rendererWritableSettings');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-settings-hardening-'));
    let db = new DatabaseService(path.join(dir, 'test.db'));
    try {
      db.setSetting('feature.autoReports', false);
      const h = harness(async (channel, setting, value) => {
        if (channel === 'db:getSetting') return db.getSetting(setting, value);
        if (channel === 'db:setSetting') return writeRendererSetting({ db }, setting, value);
        throw new Error(channel);
      });
      h.load('src/ui/js/api.js');
      for (const value of [true, false]) {
        await h.window.Api.updateSettings({ features: { [key]: value } });
        assert.ok(h.calls.some(args => args[0] === 'db:setSetting' && args[1] === `feature.${key}` && args[2] === value));
        db.db.close(); db = new DatabaseService(path.join(dir, 'test.db'));
        assert.equal((await h.window.Api.getSettings()).features[key], value);
        assert.equal(db.getSetting('feature.autoReports'), false);
      }
      assert.throws(() => validateRendererSetting(`feature.${key}`, 'true'), /Invalid value/);
      assert.throws(() => validateRendererSetting('feature.arbitrary', true), /not writable/);
      h.window.api.invoke = async () => { throw new Error('write denied'); };
      await assert.rejects(h.window.Api.updateSettings({ features: { [key]: true } }), /write denied/);
      assert.equal(db.getSetting(`feature.${key}`), false);
    } finally { db.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('failed feature save rolls back the checkbox and only emits an error toast', async () => {
    const h = harness();
    h.context.Api = { updateSettings: async () => { throw new Error('denied'); } };
    // Execute the existing handler in its page scope; no replacement save logic.
    const source = read('src/ui/js/pages/settings.js');
    const start = source.indexOf('    async function saveFeature(');
    const end = source.indexOf("    container.querySelector('#rtpToggle')", start);
    vm.runInContext(`const t = window.I18n.t; ${source.slice(start, end)}; globalThis.saveFeature = saveFeature;`, h.context);
    for (const key of ['autoUpdates', 'vpnAutoConnect']) {
      const input = { checked: true };
      await h.context.saveFeature(key, true, input);
      assert.equal(input.checked, false); assert.equal(input.disabled, false);
    }
    assert.deepEqual(h.toasts.map(t => t[1]), ['error', 'error']);
  });
});

describe('functional hardening: reports', () => {
  const cases = [
    ['listReports', '#reportHistory', '#clearAllSavedReports', [{ name: 'soterios-report-test.json', path: 'C:\\reports\\test.json', mtime: '2026-01-01T00:00:00Z' }], 'reports.noSavedReports'],
    ['listManualMaintenanceHistory', '#maintenanceHistory', '#clearAllManualMaintenance', { ok: true, data: [{ runId: '1', toolId: 'disk-space-report', status: 'completed', summary: {}, startedAt: '2026-01-01T00:00:00Z' }] }, 'reports.noMaintenance'],
    ['listScheduledMaintenanceHistory', '#scheduledMaintenanceHistory', '#clearAllScheduledMaintenance', { ok: true, data: [{ id: 1, results: [], ok_count: 1, total_count: 1 }] }, 'reports.noMaintenance'],
  ];
  for (const [method, list, button, populated, emptyKey] of cases) {
    it(`${method}: populated, empty, malformed, rejected and recovered`, async () => {
      let value = populated;
      const h = harness(async () => { if (value instanceof Error) throw value; return value; });
      h.load('src/ui/js/pages/reports.js');
      const page = h.window.Pages.reports;
      await page[method](h.element('container'));
      assert.match(h.element(list).innerHTML, /history-item/);
      assert.equal(h.element(button).classList.contains('hidden'), false);
      value = Array.isArray(populated) ? [] : { ok: true, data: [] };
      await page[method](h.element('container'));
      assert.ok(h.element(list).innerHTML.includes(translate(emptyKey)));
      assert.equal(h.element(button).classList.contains('hidden'), true);
      for (const bad of [new Error('read denied'), { ok: false, data: [], error: 'read denied' }, Array.isArray(populated) ? [null] : { ok: true, data: [null] }]) {
        value = bad; await page[method](h.element('container'));
        assert.ok(!h.element(list).innerHTML.includes(translate(emptyKey)));
        assert.ok(h.element(list).innerHTML.includes('Error'));
        assert.equal(h.element(button).classList.contains('hidden'), true);
      }
      value = populated; await page[method](h.element('container'));
      assert.match(h.element(list).innerHTML, /history-item/);
    });
  }
  for (const format of ['csv', 'pdf']) for (const locale of ['en', 'de']) it(`${format} export success/failure/rejection (${locale})`, async () => {
    let result = { success: true, path: 'C:\\exports\\result.' + format };
    const h = harness(async () => { if (result instanceof Error) throw result; return result; });
    const catalog = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    h.window.I18n.t = key => catalog[key] || key;
    h.load('src/ui/js/pages/reports.js');
    const page = h.window.Pages.reports, confirmations = [];
    page._currentSecurityReportPath = 'C:\\reports\\source.json';
    page.showExportToast = (...args) => confirmations.push(args);
    await page.exportCurrentReport(h.element('container'), format);
    assert.equal(confirmations.length, 1);
    assert.ok(confirmations[0][1].includes(catalog['reports.exportSuccess']));
    assert.equal(confirmations[0][2], result.path);
    assert.deepEqual(h.calls[0], [format === 'pdf' ? 'report:exportPDF' : 'report:exportCSV', page._currentSecurityReportPath, 'security']);
    for (const bad of [{ success: false, error: 'export denied' }, { success: false }, new Error('IPC denied')]) {
      result = bad; await page.exportCurrentReport(h.element('container'), format);
    }
    assert.equal(confirmations.length, 1); assert.equal(h.alerts.length, 3);
    assert.equal(h.element(format === 'pdf' ? '#exportReportPdf' : '#exportReportCsv').disabled, false);
  });
});

describe('functional hardening: tray router', () => {
  it('handles Network and existing routes before and after async initialization', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness(async () => ({ queued: true }));
    h.window.Api = { initializeTheme: () => gate, initializeLanguage: async () => {}, getSettings: async () => ({ features: {} }) };
    for (const name of ['dashboard', 'network', 'scanner', 'tools']) h.window.Pages[name] = { render() {} };
    const initialized = h.load('src/ui/js/router.js');
    assert.ok(h.events.has('navigate-to-network'));
    h.events.get('navigate-to-network')();
    assert.equal(h.window.AppRouter.current(), 'network');
    release(); await initialized;
    assert.equal(h.window.AppRouter.current(), 'network');
    for (const [event, route] of [['navigate-to-scanner', 'scanner'], ['navigate-to-tools', 'tools'], ['navigate-to-network', 'network'], ['navigate-to-removable-scan', 'scanner']]) {
      h.events.get(event)(); assert.equal(h.window.AppRouter.current(), route);
    }
  });
});

describe('functional hardening: network renderer', () => {
  it('distinguishes unavailable, fresh empty, stale populated and recovered data', async () => {
    let connections = new Error('collector unavailable'), vpn = new Error('VPN unavailable');
    const h = harness(async channel => {
      if (channel === 'network:geo') return {};
      const result = channel === 'network:connections' ? connections : channel === 'network:vpn:list' ? vpn : channel === 'db:getSetting' ? false : null;
      if (result instanceof Error) throw result; return result;
    });
    h.load('src/ui/js/pages/network.js');
    const page = h.window.Pages.network;
    page.applyConnectionFilter = () => {};
    page.renderAlertHits = async () => {};
    const content = h.element('#networkContent');
    // Child controls are irrelevant to generated result/status markup.
    content.querySelector = () => null;
    await page.load(h.element('container'));
    assert.ok(content.innerHTML.includes(translate('common.notAvailable')));
    assert.ok(!content.innerHTML.includes(translate('network.noConnections')));
    assert.ok(!content.innerHTML.includes(escapeHtml(translate('network.vpnNoProfiles'))));
    connections = []; vpn = { ok: true, vpns: [] };
    await page.load(h.element('container'));
    assert.ok(content.innerHTML.includes(translate('network.noConnections')));
    assert.ok(content.innerHTML.includes(escapeHtml(translate('network.vpnNoProfiles'))));
    connections = [{ remoteAddress: '203.0.113.1', processName: 'fixture.exe', state: 'ESTABLISHED', classification: 'SAFE' }];
    await page.load(h.element('container'));
    connections = new Error('collector failed'); vpn = { ok: false, vpns: [], error: 'denied' };
    await page.load(h.element('container'));
    assert.ok(content.innerHTML.includes(translate('network.staleData')));
    assert.ok(content.innerHTML.includes('fixture.exe'));
    assert.ok(!content.innerHTML.includes(escapeHtml(translate('network.vpnNoProfiles'))));
    connections = [];
    await page.load(h.element('container'));
    assert.ok(!content.innerHTML.includes(translate('network.staleData')));
    assert.ok(content.innerHTML.includes(translate('network.noConnections')));
    connections = [null];
    await page.load(h.element('container'));
    assert.ok(content.innerHTML.includes('role="alert"'));
    assert.ok(!content.innerHTML.includes(translate('network.noConnections')));
  });

  it('history distinguishes rejected reads with/without cached rows from successful empty reads', async () => {
    let result = new Error('history denied');
    const h = harness(async channel => {
      if (channel === 'db:getSetting') return true;
      if (result instanceof Error) throw result;
      return result;
    });
    const drawing = new Proxy({}, { get: (_, name) => name === 'measureText' ? () => ({ width: 10 }) : () => {} });
    h.element('#networkHistoryChart').getContext = () => drawing;
    h.context.Path2D = function () { return drawing; };
    h.context.getComputedStyle = () => ({ getPropertyValue: () => '#888', fontFamily: 'sans-serif' });
    h.load('src/ui/js/pages/network.js');
    const page = h.window.Pages.network, empty = h.element('#networkHistoryEmpty');
    await page.paintHistoryChart(h.element('content'));
    assert.equal(empty.textContent, translate('common.notAvailable')); assert.equal(empty.hidden, false);
    result = []; await page.paintHistoryChart(h.element('content'));
    assert.equal(empty.textContent, translate('network.historyEmpty'));
    result = [{ recorded_at: '2026-01-01T00:00:00Z', rx_sec: 1, tx_sec: 2 }];
    await page.paintHistoryChart(h.element('content'));
    assert.equal(empty.hidden, true);
    result = new Error('history denied'); await page.paintHistoryChart(h.element('content'));
    assert.equal(empty.textContent, translate('network.staleData')); assert.equal(empty.hidden, false);
    result = []; await page.paintHistoryChart(h.element('content'));
    assert.equal(empty.textContent, translate('network.historyEmpty'));
  });
});
