'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const auditPageSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'audit.js'),
  'utf8'
);

function loadAuditPage(shellOverrides = {}, apiOverrides = {}) {
  const calls = [];
  const shell = {
    openPowerShell: async (context) => { calls.push(['powershell', context]); return { success: true }; },
    openWindowsUtility: async (context) => { calls.push(['utility', context]); return { success: true }; },
    openControlPanel: async (command) => { calls.push(['control', command]); return { success: true }; },
    openExternal: async (uri) => { calls.push(['external', uri]); return { success: true }; },
    ...shellOverrides
  };
  const translations = {
    'audit.action.openUac': 'Open UAC settings',
    'audit.action.openRemoteDesktop': 'Open Remote Desktop',
    'audit.action.inspectPowerShell': 'Inspect in PowerShell',
    'audit.action.forCheck': '{action} for {check}',
    'audit.unsupportedAction': 'Unsupported action.',
    'audit.openSettingsError': 'Could not open settings.'
  };
  const sandbox = {
    window: {
      Pages: {},
      I18n: {
        t(key, vars) {
          let value = translations[key] || key;
          for (const [name, replacement] of Object.entries(vars || {})) {
            value = value.replace(`{${name}}`, replacement);
          }
          return value;
        }
      },
      soterios: { shell },
      api: {
        invoke: async () => [],
        on: () => () => {},
        ...apiOverrides
      }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    document: {},
    alert() {},
    escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console
  };

  vm.runInNewContext(auditPageSource, sandbox, { filename: 'audit.js' });
  return { page: sandbox.window.Pages.audit, calls, appWindow: sandbox.window };
}

describe('audit page', () => {
  it('includes informational results in the summary', () => {
    const { page } = loadAuditPage();
    const counts = page.resultCounts([
      { status: 'pass' },
      { status: 'fail' },
      { status: 'warn' },
      { status: 'error' },
      { status: 'info' },
      { status: 'unknown' }
    ]);

    assert.equal(counts.pass, 1);
    assert.equal(counts.fail, 1);
    assert.equal(counts.warn, 1);
    assert.equal(counts.error, 1);
    assert.equal(counts.info, 1);
    assert.match(page.buildSummaryHtml([{ status: 'info' }]), /data-audit-stat="info"/);
  });

  it('uses contextual labels for Manage destinations', () => {
    const { page } = loadAuditPage();

    assert.equal(page.manageLabelKey({ manageContext: 'uac' }), 'audit.action.openUac');
    assert.equal(
      page.manageLabelKey({ actionUri: 'ms-settings:remotedesktop' }),
      'audit.action.openRemoteDesktop'
    );
    assert.equal(
      page.manageLabelKey({ manageAction: 'open-powershell' }),
      'audit.action.inspectPowerShell'
    );
  });

  it('routes Manage actions to the intended preload API', async () => {
    const { page, calls } = loadAuditPage();

    await page.invokeManageAction('open-windows-utility', 'uac', '');
    await page.invokeManageAction('open-powershell', 'network-protection', '');
    await page.invokeManageAction('', '', 'control userpasswords2');
    await page.invokeManageAction('', '', 'ms-settings:remotedesktop');

    assert.deepEqual(calls, [
      ['utility', 'uac'],
      ['powershell', 'network-protection'],
      ['control', 'control userpasswords2'],
      ['external', 'ms-settings:remotedesktop']
    ]);
  });

  it('surfaces structured launch failures and unsupported actions', async () => {
    const { page } = loadAuditPage({
      openWindowsUtility: async () => ({ success: false, error: 'UAC handler unavailable' })
    });

    await assert.rejects(
      () => page.invokeManageAction('open-windows-utility', 'uac', ''),
      /UAC handler unavailable/
    );
    await assert.rejects(() => page.invokeManageAction('', '', ''), /Unsupported action/);
  });

  it('renders a descriptive, typed Manage button', () => {
    const { page } = loadAuditPage();
    const html = page.buildResultCard({
      status: 'warn',
      name: 'User Account Control (UAC)',
      message: 'UAC needs attention.',
      manageAction: 'open-windows-utility',
      manageContext: 'uac'
    });

    assert.match(html, /type="button" class="btn btn-sm audit-open-settings"/);
    assert.match(html, /data-action="open-windows-utility"/);
    assert.match(html, /data-context="uac"/);
    assert.match(html, /aria-label="Open UAC settings for User Account Control \(UAC\)"/);
    assert.match(html, />Open UAC settings<\/button>/);
  });

  it('rebuilds visible results and the summary after ignore state changes', async () => {
    const ignored = [{ id: 'audit:uac' }];
    const { page } = loadAuditPage({}, {
      invoke: async (channel) => channel === 'warnings:listIgnored' ? ignored : []
    });
    const rendered = [];
    const ignoredSections = [];
    page._currentTranslatedResults = [
      { _ignoreId: 'audit:uac', status: 'warn', name: 'UAC' },
      { _ignoreId: 'audit:defender', status: 'pass', name: 'Defender' }
    ];
    page.renderResults = (_container, results) => rendered.push(results.map((result) => result.name));
    page.updateIgnoredWarningsSection = async (_container, rows) => ignoredSections.push(rows);

    await page.refreshVisibleResults({});

    assert.deepEqual(rendered, [['Defender']]);
    assert.equal(ignoredSections.length, 1);
    assert.equal(ignoredSections[0][0].id, 'audit:uac');
  });

  it('does not let an older overlapping audit overwrite newer results', async () => {
    const deferred = [];
    const invoke = (channel) => {
      if (channel === 'warnings:listIgnored') return Promise.resolve([]);
      if (channel === 'audit:run') {
        return new Promise((resolve) => deferred.push(resolve));
      }
      return Promise.resolve([]);
    };
    const { page } = loadAuditPage({}, { invoke, on: () => () => {} });
    const content = {
      innerHTML: '',
      querySelector: () => null,
      setAttribute() {}
    };
    const refreshButton = {
      disabled: false,
      setAttribute() {}
    };
    const container = {
      isConnected: true,
      querySelector(selector) {
        if (selector === '#auditContent') return content;
        if (selector === '#auditRefreshBtn') return refreshButton;
        return null;
      }
    };
    const rendered = [];
    page.renderPageResults = (_container, results) => rendered.push(results.map((result) => result.name));

    const olderLoad = page.load(container, true);
    const newerLoad = page.load(container, true);
    deferred[1]([{ status: 'pass', name: 'Newer result', message: 'new' }]);
    await newerLoad;
    deferred[0]([{ status: 'fail', name: 'Older result', message: 'old' }]);
    await olderLoad;

    assert.deepEqual(rendered, [['Newer result']]);
    assert.equal(page._cachedResults[0].name, 'Newer result');
    assert.equal(page._isLoading, false);
  });
});
