'use strict';

// Tests for the read-only Windows Defender threat-history feature:
//   - backend: src/security/DefenderThreatHistory.js (fully hermetic; the
//     PowerShell runner is always injected, never the real one)
//   - renderer logic: pure helpers on window.Pages.reports (reports.js is
//     loaded with a stubbed `window`; DOM string output is asserted through
//     a minimal container stub, no browser/jsdom required)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const defender = require('../src/security/DefenderThreatHistory');

const {
  DefenderThreatHistory,
  normalizeDetection,
  normalizeResource,
  buildThreatIndex,
  sortDetections,
  parseDefenderDate,
  sanitizeDisplayPath,
  normalizeStatus,
  actionFor,
  statusLabelFor,
  classifyQueryError,
  MAX_DETECTIONS,
} = defender;

// ---------------------------------------------------------------------------
// Fixtures shaped like real Get-MpThreatDetection / Get-MpThreat output
// (property names verified against the live MSFT_MpThreatDetection and
// MSFT_MpThreat CIM classes).
// ---------------------------------------------------------------------------

function detectionFixture(overrides = {}) {
  return {
    DetectionID: '{11111111-2222-3333-4444-555555555555}',
    ThreatID: 123,
    ProcessName: 'C:\\Windows\\explorer.exe',
    DomainUser: 'TESTBOX\\Alice',
    DetectionSourceTypeID: 3,
    Resources: ['file:C:\\Users\\Alice\\Downloads\\evil.exe'],
    InitialDetectionTime: '/Date(1786653672000)/',
    LastThreatStatusChangeTime: '/Date(1786653791000)/',
    RemediationTime: '/Date(1786653760000)/',
    CurrentThreatExecutionStatusID: 4,
    ThreatStatusID: 3,
    ThreatStatusErrorCode: 0,
    CleaningActionID: 2,
    ActionSuccess: true,
    AdditionalActionsBitMask: 0,
    AMProductVersion: '4.18.0.0',
    ...overrides,
  };
}

function threatFixture(overrides = {}) {
  return {
    ThreatID: 123,
    ThreatName: 'Trojan:Win32/TestFixture.A!ml',
    SeverityID: 4,
    CategoryID: 8,
    TypeID: 0,
    DidThreatExecute: false,
    IsActive: false,
    Resources: ['file:C:\\Users\\Alice\\Downloads\\evil.exe'],
    RollupStatus: 0,
    ...overrides,
  };
}

function historyRunner({ detections = [], threats = [], error = null, throws = null } = {}) {
  const calls = [];
  const runJson = async (script, fallback, timeout) => {
    calls.push({ script, fallback, timeout });
    if (throws) throw throws;
    if (error) return { ok: false, error };
    return { ok: true, data: { detections, threats } };
  };
  return { calls, runJson };
}

function historyInstance(runnerOptions = {}, options = {}) {
  const runner = historyRunner(runnerOptions);
  const history = new DefenderThreatHistory({
    runJson: runner.runJson,
    platform: 'win32',
    now: () => 1786654000000,
    cacheTtlMs: 45000,
    ...options,
  });
  return { runner, history };
}

// ---------------------------------------------------------------------------
// Backend: collection states
// ---------------------------------------------------------------------------

describe('DefenderThreatHistory collection', () => {
  it('returns an empty list without error when Defender reports nothing', async () => {
    const { history } = historyInstance({ detections: [], threats: [] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.detections, []);
    assert.equal(result.data.source, 'Microsoft Defender');
  });

  it('treats null payload sections as empty history', async () => {
    const { history } = historyInstance({ detections: null, threats: null });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.detections, []);
  });

  it('normalizes a single object payload (not an array)', async () => {
    const { history } = historyInstance({
      detections: detectionFixture(),
      threats: threatFixture(),
    });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.equal(result.data.detections.length, 1);
    const [item] = result.data.detections;
    assert.equal(item.threatName, 'Trojan:Win32/TestFixture.A!ml');
    assert.equal(item.status, 'remediated');
    assert.equal(item.action, 'quarantined');
    assert.equal(item.actionSuccess, true);
  });

  it('sorts multiple detections newest first', async () => {
    const older = detectionFixture({
      DetectionID: '{aaaaaaaa-0000-0000-0000-000000000001}',
      InitialDetectionTime: '/Date(1786650000000)/',
    });
    const newer = detectionFixture({
      DetectionID: '{aaaaaaaa-0000-0000-0000-000000000002}',
      InitialDetectionTime: '/Date(1786653000000)/',
    });
    const { history } = historyInstance({ detections: [older, newer], threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.deepEqual(
      result.data.detections.map((d) => d.id),
      ['detection:{aaaaaaaa-0000-0000-0000-000000000002}', 'detection:{aaaaaaaa-0000-0000-0000-000000000001}']
    );
  });

  it('is unavailable on non-Windows without spawning PowerShell', async () => {
    const { runner, history } = historyInstance({}, { platform: 'linux' });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unavailable');
    assert.equal(runner.calls.length, 0);
  });

  it('reports cmdlets missing as unavailable', async () => {
    const { history } = historyInstance({
      error: "Get-MpThreatDetection : The term 'Get-MpThreatDetection' is not recognized as the name of a cmdlet.",
    });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unavailable');
    assert.match(result.error, /not available/);
  });

  it('reports PowerShell failure as unavailable', async () => {
    const missing = new Error("spawn powershell.exe ENOENT");
    missing.code = 'ENOENT';
    const { history } = historyInstance({ throws: missing });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unavailable');
  });

  it('reports access denied as unavailable', async () => {
    const { history } = historyInstance({ error: 'Access is denied. (Exception from HRESULT: 0x80070005)' });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'unavailable');
  });

  it('reports timeouts with the timeout code', async () => {
    const timeout = new Error('Timed out');
    timeout.killed = true;
    const { history } = historyInstance({ throws: timeout });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeout');
  });

  it('classifies the production timeout shape without message matching', async () => {
    // The real runner reports { timedOut: true } with an arbitrary message;
    // classification must not depend on timeout wording.
    const { history } = historyInstance({});
    history.runJson = async () => ({ ok: false, error: 'process was killed', timedOut: true });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeout');
    assert.equal(result.error, 'Reading Defender threat history timed out.');
  });

  it('reports a real process timeout with structured metadata on Windows', async function () {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }
    const { runDefenderJson } = defender;
    const result = await runDefenderJson('Start-Sleep -Seconds 30', 500);
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
  });

  it('returns a clean error for malformed JSON without leaking parser text', async () => {
    const { history } = historyInstance({ error: "Unexpected token 'o', \"not json\" is not valid JSON" });
    const result = await history.getHistory();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'failed');
    assert.equal(result.error, 'Soterios could not read Defender threat history.');
  });

  it('caches briefly and refreshes on demand', async () => {
    let now = 1786654000000;
    const runner = historyRunner({ detections: [], threats: [] });
    const history = new DefenderThreatHistory({
      runJson: runner.runJson,
      platform: 'win32',
      now: () => now,
      cacheTtlMs: 45000,
    });
    await history.getHistory();
    await history.getHistory();
    assert.equal(runner.calls.length, 1);
    await history.getHistory({ refresh: true });
    assert.equal(runner.calls.length, 2);
    now += 46000;
    await history.getHistory();
    assert.equal(runner.calls.length, 3);
  });

  it('executes the hardened invocation live on Windows (no Bypass)', async function () {
    // Proves -NoProfile -NonInteractive without -ExecutionPolicy Bypass can
    // run the fixed query shape. Skipped off Windows (spawns powershell.exe).
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }
    const { runDefenderJson } = defender;
    const result = await runDefenderJson('[PSCustomObject]@{ probe = 41 + 1 }', 15000);
    assert.equal(result.ok, true);
    assert.equal(result.data && result.data.probe, 42);
  });

  it('uses a fixed read-only script with no remediation cmdlets', async () => {

    const { runner, history } = historyInstance({ detections: [], threats: [] });
    await history.getHistory();
    assert.equal(runner.calls.length, 1);
    const { script, timeout } = runner.calls[0];
    assert.match(script, /Get-MpThreatDetection/);
    assert.match(script, /Get-MpThreat/);
    assert.ok(timeout >= 10000);
    for (const banned of [
      'Remove-MpThreat',
      'Set-MpPreference',
      'Add-MpPreference',
      'Remove-MpPreference',
      'Start-MpScan',
      'Update-MpSignature',
    ]) {
      assert.ok(!script.includes(banned), `script must not contain ${banned}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Backend: normalization
// ---------------------------------------------------------------------------

describe('DefenderThreatHistory normalization', () => {
  function normalized(detectionOverrides = {}, threatOverrides = {}) {
    const index = buildThreatIndex([threatFixture(threatOverrides)]);
    return normalizeDetection(detectionFixture(detectionOverrides), index);
  }

  it('correlates threat names across repeated detections of one ThreatID', () => {
    const index = buildThreatIndex([threatFixture({ ThreatID: 123 })]);
    const first = normalizeDetection(detectionFixture({ DetectionID: '{id-1}' }), index);
    const second = normalizeDetection(detectionFixture({ DetectionID: '{id-2}' }), index);
    assert.equal(first.threatName, 'Trojan:Win32/TestFixture.A!ml');
    assert.equal(second.threatName, 'Trojan:Win32/TestFixture.A!ml');
  });

  it('keeps separate detections of one threat on different resources separate', () => {
    const index = buildThreatIndex([threatFixture()]);
    const first = normalizeDetection(
      detectionFixture({ DetectionID: '{id-1}', Resources: ['file:C:\\a\\one.exe'] }),
      index
    );
    const second = normalizeDetection(
      detectionFixture({ DetectionID: '{id-2}', Resources: ['file:C:\\b\\two.exe'] }),
      index
    );
    assert.notEqual(first.id, second.id);
    assert.equal(first.threatName, second.threatName);
  });

  it('deduplicates exact repeat records by stable id', async () => {
    const raw = detectionFixture();
    const { history } = historyInstance({ detections: [raw, { ...raw }], threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.equal(result.data.detections.length, 1);
    assert.equal(result.data.truncated, false);
  });

  it('bounds oversized histories to the newest records and reports truncation', async () => {
    const base = 1786650000000;
    const raws = [];
    for (let i = 0; i < MAX_DETECTIONS + 3; i += 1) {
      raws.push(
        detectionFixture({
          DetectionID: `{bulk-${String(i).padStart(5, '0')}}`,
          InitialDetectionTime: `/Date(${base + i * 60000})/`,
        })
      );
    }
    // Shuffle so the test proves ordering, not input order.
    raws.reverse();
    const { history } = historyInstance({ detections: raws, threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.equal(result.data.detections.length, MAX_DETECTIONS);
    assert.equal(result.data.truncated, true);
    // Newest retained first.
    assert.equal(result.data.detections[0].id, `detection:{bulk-${String(MAX_DETECTIONS + 2).padStart(5, '0')}}`);
  });

  it('does not report truncation at exactly the backend limit', async () => {

    const base = 1786650000000;
    const raws = [];
    for (let i = 0; i < MAX_DETECTIONS; i += 1) {
      raws.push(
        detectionFixture({
          DetectionID: `{exact-${String(i).padStart(5, '0')}}`,
          InitialDetectionTime: `/Date(${base + i * 60000})/`,
        })
      );
    }
    const { history } = historyInstance({ detections: raws, threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.equal(result.data.detections.length, MAX_DETECTIONS);
    assert.equal(result.data.truncated, false);
  });

  it('reports truncation from raw source length despite duplicate collapse', async () => {
    // 5001 raw records collapsing below the limit via duplicates must still
    // report truncated: the source exceeded the boundary.
    const base = 1786650000000;
    const raws = [];
    for (let i = 0; i < MAX_DETECTIONS + 1; i += 1) {
      raws.push(
        detectionFixture({
          DetectionID: `{dup-${String(i % 100).padStart(3, '0')}}`,
          InitialDetectionTime: `/Date(${base + i * 60000})/`,
        })
      );
    }
    assert.equal(raws.length, MAX_DETECTIONS + 1);
    const { history } = historyInstance({ detections: raws, threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.ok(result.data.detections.length < MAX_DETECTIONS);
    assert.equal(result.data.truncated, true);
  });

  it('reports truncation from raw source length despite malformed rows', async () => {
    // 5001 raw records collapsing below the limit via malformed rows must
    // still report truncated: the source exceeded the boundary.
    const base = 1786650000000;
    const raws = [];
    for (let i = 0; i < MAX_DETECTIONS - 100; i += 1) {
      raws.push(
        detectionFixture({
          DetectionID: `{ok-${String(i).padStart(5, '0')}}`,
          InitialDetectionTime: `/Date(${base + i * 60000})/`,
        })
      );
    }
    for (let i = 0; i < 101; i += 1) {
      raws.push(i % 2 === 0 ? 'oops' : null);
    }
    assert.equal(raws.length, MAX_DETECTIONS + 1);
    const { history } = historyInstance({ detections: raws, threats: [threatFixture()] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.ok(result.data.detections.length < MAX_DETECTIONS);
    assert.equal(result.data.skipped, 101);
    assert.equal(result.data.truncated, true);
  });

  it('normalizes an active detection from its own status', () => {
    // Threat-level IsActive must not decide the row; status 1 (Detected) does.
    const item = normalized({ ThreatStatusID: 1, ActionSuccess: null }, { IsActive: false });
    assert.equal(item.status, 'active');
    assert.equal(item.active, true);
    assert.equal(item.statusLabel, 'Detected');
  });

  it('keeps an older remediated occurrence remediated when a newer one is active', async () => {
    // Regression fixture: one ThreatID, two historical states. A threat-level
    // IsActive=true must not flip the older remediated row to active.
    const threat = threatFixture({ ThreatID: 555, IsActive: true, DidThreatExecute: true });
    const older = detectionFixture({
      DetectionID: '{older-remediated}',
      ThreatID: 555,
      ThreatStatusID: 3,
      CleaningActionID: 2,
      ActionSuccess: true,
      InitialDetectionTime: '/Date(1786650000000)/',
      Resources: ['file:C:\\old\\one.exe'],
    });
    const newer = detectionFixture({
      DetectionID: '{newer-active}',
      ThreatID: 555,
      ThreatStatusID: 1,
      CleaningActionID: 0,
      ActionSuccess: null,
      InitialDetectionTime: '/Date(1786653000000)/',
      Resources: ['file:C:\\new\\two.exe'],
    });
    const { history } = historyInstance({ detections: [older, newer], threats: [threat] });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.equal(result.data.detections.length, 2);
    const byId = new Map(result.data.detections.map((d) => [d.id, d]));
    // Newest first.
    assert.equal(result.data.detections[0].id, 'detection:{newer-active}');
    assert.equal(byId.get('detection:{newer-active}').status, 'active');
    assert.equal(byId.get('detection:{newer-active}').active, true);
    assert.equal(byId.get('detection:{older-remediated}').status, 'remediated');
    assert.equal(byId.get('detection:{older-remediated}').active, false);
    // Threat-level rollup is modeled separately from row state.
    assert.equal('threatActive' in byId.get('detection:{newer-active}'), false);
    assert.equal('threatExecuted' in byId.get('detection:{newer-active}'), false);
  });

  it('treats a currently-executing detection as active', () => {
    const item = normalized({ ThreatStatusID: 0, CurrentThreatExecutionStatusID: 3, ActionSuccess: null });
    assert.equal(item.status, 'active');
  });

  it('normalizes a remediated detection', () => {
    const item = normalized({ ThreatStatusID: 3, CleaningActionID: 2, ActionSuccess: true });
    assert.equal(item.status, 'remediated');
    assert.equal(item.active, false);
    assert.equal(item.statusLabel, 'Quarantined');
    assert.equal(item.remediatedAt, '2026-08-13T20:42:40.000Z');
  });

  it('marks a failed action without crashing', () => {
    const item = normalized({ ThreatStatusID: 102, ActionSuccess: false });
    assert.equal(item.status, 'failed');
    assert.equal(item.actionSuccess, false);
    assert.equal(item.statusLabel, 'Quarantine failed');
  });

  it('maps unknown numeric status and action values to unknown', () => {
    const item = normalized({ ThreatStatusID: 250, CleaningActionID: 99 });
    assert.equal(item.status, 'unknown');
    assert.equal(item.statusLabel, 'Unknown');
    // Unknown actions fall back to the documented status outcome when it
    // states one, else remain unknown with the raw value preserved.
    assert.equal(actionFor(99), 'unknown');
    assert.equal(statusLabelFor(250), 'Unknown');
  });

  it('prefers the documented status outcome over an unknown action id', () => {
    const item = normalized({ ThreatStatusID: 3, CleaningActionID: 99, ActionSuccess: true });
    assert.equal(item.action, 'quarantined');
    assert.equal(item.rawAction, 99);
  });

  it('treats a nonzero threat status error code as failed', () => {
    assert.equal(normalizeStatus(3, true, 2147467259, null), 'failed');
  });

  it('normalizes Defender `type:_payload` resource separators', () => {
    const underscored = normalizeResource('file:_C:\\Users\\ExampleUser\\Downloads\\evil.exe');
    assert.equal(underscored.type, 'file');
    assert.equal(underscored.display, 'C:\\Users\\<user>\\Downloads\\evil.exe');
    const plain = normalizeResource('file:C:\\Users\\ExampleUser\\Downloads\\evil.exe');
    assert.equal(plain.type, 'file');
    assert.equal(plain.display, 'C:\\Users\\<user>\\Downloads\\evil.exe');
  });

  it('handles amsi/process/regkey payload shapes without inventing semantics', () => {
    const amsi = normalizeResource('amsi:_C:\\Users\\ExampleUser\\script.ps1');
    assert.equal(amsi.display, 'C:\\Users\\<user>\\script.ps1');
    const proc = normalizeResource('process:_pid:4321,ProcessStart:133000000000000000');
    assert.equal(proc.type, 'process');
    assert.equal(proc.display, 'pid:4321,ProcessStart:133000000000000000');
    const reg = normalizeResource('regkey:_HKLM\\SOFTWARE\\Evil');
    assert.equal(reg.type, 'registry');
    assert.equal(reg.display, 'HKLM\\SOFTWARE\\Evil');
  });

  it('leaves unknown resource prefixes as other without guessing', () => {
    const item = normalizeResource('frobnicate:_something-odd');
    assert.equal(item.type, 'other');
  });

  it('preserves multiple resources', () => {
    const item = normalized({
      Resources: ['file:C:\\a\\one.exe', 'file:C:\\b\\two.exe', 'regkey:HKLM\\Software\\Evil'],
    });
    assert.equal(item.resources.length, 3);
    assert.deepEqual(
      item.resources.map((r) => r.type),
      ['file', 'file', 'registry']
    );
  });

  it('renders rows with missing resources', () => {
    const item = normalized({ Resources: null });
    assert.deepEqual(item.resources, []);
  });

  it('handles a missing process name gracefully', () => {
    const item = normalized({ ProcessName: '' });
    assert.equal(item.processName, null);
  });

  it('handles missing timestamps gracefully and sorts them last', () => {
    const withDate = normalized({});
    const withoutDate = normalized({
      DetectionID: '{nodate}',
      InitialDetectionTime: null,
      LastThreatStatusChangeTime: null,
      RemediationTime: null,
    });
    assert.equal(withoutDate.detectedAt, null);
    assert.equal(withoutDate.remediatedAt, null);
    const sorted = sortDetections([withoutDate, withDate]);
    assert.equal(sorted[0].id, withDate.id);
    assert.equal(sorted[1].id, withoutDate.id);
  });

  it('parses PowerShell /Date()/ timestamps and ISO strings', () => {
    assert.equal(parseDefenderDate('/Date(1786653672000)/'), '2026-08-13T20:41:12.000Z');
    assert.equal(parseDefenderDate('2026-08-13T20:41:12.000Z'), '2026-08-13T20:41:12.000Z');
    assert.equal(parseDefenderDate(null), null);
    assert.equal(parseDefenderDate('not a date'), null);
  });

  it('treats Defender unset timestamps as missing', () => {
    assert.equal(parseDefenderDate('/Date(-62135596800000)/'), null);
    assert.equal(parseDefenderDate('1601-01-01T00:00:00'), null);
  });

  it('skips a malformed row but keeps valid rows', async () => {
    const { history } = historyInstance({
      detections: ['oops', null, 42, detectionFixture()],
      threats: [threatFixture()],
    });
    const result = await history.getHistory();
    assert.equal(result.ok, true);
    assert.equal(result.data.detections.length, 1);
    assert.equal(result.data.skipped, 3);
  });

  it('leaves threat name null when the correlation map misses', () => {
    const item = normalizeDetection(detectionFixture({ ThreatID: 999 }), buildThreatIndex([]));
    assert.equal(item.threatName, null);
    assert.equal(item.severity, 'unknown');
    assert.equal(item.category, null);
  });

  it('derives category and severity from correlated threat metadata', () => {
    const item = normalized({}, { ThreatName: 'Worm:Win32/Conficker.A', SeverityID: 3, CategoryID: 5 });
    assert.equal(item.category, 'Worm');
    assert.equal(item.severity, 'high');
  });

  it('sanitizes user profile paths in resource display output', () => {
    const display = sanitizeDisplayPath('C:\\Users\\ExampleUser\\Downloads\\evil.exe');
    assert.ok(!display.includes('ExampleUser'));
    assert.ok(display.includes('C:\\Users\\<user>\\Downloads\\evil.exe'));
  });

  it('never exposes the username from detection resources', () => {
    const item = normalized({ Resources: ['file:C:\\Users\\ExampleUser\\Downloads\\evil.exe'] });
    assert.equal(item.resources.length, 1);
    assert.ok(!item.resources[0].display.includes('ExampleUser'));
    assert.ok(item.resources[0].display.includes('<user>'));
    assert.ok(!JSON.stringify(item).includes('ExampleUser'));
  });

  it('keeps threat-level rollup fields out of normalized records', () => {
    const item = normalized({ ThreatStatusID: 3, ActionSuccess: true }, { IsActive: true, DidThreatExecute: true });
    assert.equal(item.status, 'remediated');
    for (const key of ['threatActive', 'threatExecuted', 'executed', 'domainUser']) {
      assert.equal(key in item, false, `expected no ${key} field`);
    }
    assert.ok(!JSON.stringify(item).includes('IsActive'));
  });

  it('sanitizes full paths in ProcessName like resource paths', () => {
    const item = normalized({
      ProcessName: 'C:\\Users\\ExampleUser\\AppData\\Local\\Temp\\abc\\example.exe',
    });
    assert.ok(item.processName);
    assert.ok(!item.processName.includes('ExampleUser'));
    assert.ok(item.processName.includes('C:\\Users\\<user>\\'));
    assert.ok(!JSON.stringify(item).includes('ExampleUser'));
  });

  it('keeps bare process names unchanged', () => {
    const item = normalized({ ProcessName: 'example.exe' });
    assert.equal(item.processName, 'example.exe');
  });

  it('does not infer remediated from ActionSuccess alone', () => {
    // A successful cleaning action with a missing/unknown status is unknown,
    // not remediated: ActionSuccess alone never establishes final status.
    const missing = normalized({ ThreatStatusID: null, ActionSuccess: true });
    assert.equal(missing.status, 'unknown');
    const zero = normalized({ ThreatStatusID: 0, ActionSuccess: true });
    assert.equal(zero.status, 'unknown');
    assert.equal(zero.actionSuccess, true);
  });
});

// ---------------------------------------------------------------------------
// classifyQueryError unit coverage
// ---------------------------------------------------------------------------

describe('DefenderThreatHistory error classification', () => {
  it('classifies missing cmdlets, timeouts, and generic failures', () => {
    assert.equal(classifyQueryError('Get-MpThreatDetection is not recognized').code, 'unavailable');
    assert.equal(classifyQueryError('The operation has timed out').code, 'timeout');
    assert.equal(classifyQueryError('Access is denied').code, 'unavailable');
    assert.equal(classifyQueryError('Something unexpected broke').code, 'failed');
    assert.equal(classifyQueryError('Something unexpected broke').error, 'Soterios could not read Defender threat history.');
  });
});

// ---------------------------------------------------------------------------
// Renderer logic: reports.js pure helpers (window stub, no DOM library)
// ---------------------------------------------------------------------------

function loadReportsPage() {
  if (!global.window) global.window = {};
  if (!global.window.Pages) {
    require('../src/ui/js/pages/reports.js');
  }
  return global.window.Pages.reports;
}

function defenderListFixture() {
  const index = buildThreatIndex([threatFixture()]);
  return [
    normalizeDetection(detectionFixture({ DetectionID: '{active-1}', ThreatStatusID: 1, ActionSuccess: null, ThreatName: undefined }), buildThreatIndex([threatFixture({ IsActive: true })])),
    normalizeDetection(detectionFixture({ DetectionID: '{rem-1}', ThreatStatusID: 4, ActionSuccess: true }), index),
    normalizeDetection(
      detectionFixture({ DetectionID: '{fail-1}', ThreatStatusID: 102, ActionSuccess: false, ThreatID: 777 }),
      buildThreatIndex([threatFixture({ ThreatID: 777, ThreatName: 'Ransom:Win32/Other.B' })])
    ),
  ];
}

describe('Defender history renderer filters', () => {
  it('filters by active status', () => {
    const page = loadReportsPage();
    const list = defenderListFixture();
    const active = page.filterDefenderDetections(list, { status: 'active', query: '', range: 'all' });
    assert.equal(active.length, 1);
    assert.equal(active[0].status, 'active');
  });

  it('filters by remediated status', () => {
    const page = loadReportsPage();
    const list = defenderListFixture();
    const remediated = page.filterDefenderDetections(list, { status: 'remediated', query: '', range: 'all' });
    assert.equal(remediated.length, 1);
    assert.equal(remediated[0].status, 'remediated');
  });

  it('filters by failed status', () => {
    const page = loadReportsPage();
    const list = defenderListFixture();
    const failed = page.filterDefenderDetections(list, { status: 'failed', query: '', range: 'all' });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, 'failed');
  });

  it('searches by threat name case-insensitively', () => {
    const page = loadReportsPage();
    const list = defenderListFixture();
    const found = page.filterDefenderDetections(list, { status: 'all', query: 'ransom', range: 'all' });
    assert.equal(found.length, 1);
    assert.match(found[0].threatName || '', /Ransom/);
    const none = page.filterDefenderDetections(list, { status: 'all', query: 'no-such-threat', range: 'all' });
    assert.equal(none.length, 0);
  });

  it('applies a 24h date range and drops undated records', () => {
    const page = loadReportsPage();
    const realNow = Date.now;
    Date.now = () => 1786654000000;
    try {
      const index = buildThreatIndex([threatFixture()]);
      const recent = normalizeDetection(detectionFixture({ DetectionID: '{recent}' }), index);
      const old = normalizeDetection(
        detectionFixture({ DetectionID: '{old}', InitialDetectionTime: '/Date(1786400000000)/' }),
        index
      );
      const undated = normalizeDetection(
        detectionFixture({ DetectionID: '{undated}', InitialDetectionTime: null }),
        index
      );
      const filtered = page.filterDefenderDetections([recent, old, undated], { status: 'all', query: '', range: '24h' });
      assert.deepEqual(filtered.map((d) => d.id), [recent.id]);
      const all = page.filterDefenderDetections([recent, old, undated], { status: 'all', query: '', range: 'all' });
      assert.equal(all.length, 3);
    } finally {
      Date.now = realNow;
    }
  });

  it('renders loading, empty, error, and populated states without leaking usernames', () => {
    const page = loadReportsPage();
    const t = (key, vars) => {
      if (vars && vars.error) return `${key}:${vars.error}`;
      if (vars && vars.shown !== undefined) return `${key}:${vars.shown}/${vars.total}`;
      return key;
    };
    if (!global.escapeHtml) {
      global.escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    }
    if (!global.setButtonLoading) global.setButtonLoading = () => {};
    global.window.I18n = { t };
    global.window.soterios = {
      defender: {
        getThreatHistory: async () => ({
          ok: true,
          data: {
            detections: [
              {
                id: 'detection:{x}',
                threatId: '123',
                threatName: 'Trojan:Win32/<b>Evil</b>',
                detectedAt: '2026-08-13T20:41:12.000Z',
                lastUpdatedAt: null,
                remediatedAt: null,
                status: 'active',
                statusLabel: 'Detected',
                action: 'quarantined',
                actionSuccess: null,
                severity: 'severe',
                category: 'Trojan',
                resources: [{ type: 'file', display: 'C:\\Users\\<user>\\evil.exe' }],
                processName: 'evil.exe',
                domainUser: null,
                threatExecuted: false,
                executionStatus: null,
                detectionSource: 'Real-time',
                active: true,
                source: 'Microsoft Defender',
                rawStatus: 1,
                rawAction: 2,
              },
            ],
          },
        }),
      },
      shell: { openExternal: async () => ({ success: true }) },
    };

    const buttons = [];
    const makeList = () => ({
      innerHTML: '',
      querySelectorAll: () => [],
    });
    const container = {
      querySelector: (selector) => {
        if (selector === '#defenderHistory') {
          if (!container._list) container._list = makeList();
          return container._list;
        }
        return null;
      },
      querySelectorAll: () => [],
    };

    return (async () => {
      await page.listDefenderHistory(container, false);
      const html = container._list.innerHTML;
      // Threat name is escaped, never raw HTML.
      assert.ok(html.includes('Trojan:Win32/&lt;b&gt;Evil&lt;/b&gt;'));
      assert.ok(!html.includes('<b>Evil</b>'));
      // Status pill text is present (not color-only).
      assert.ok(html.includes('defender.history.statusActive'));
      // Empty-state path renders the centered detail without a duplicate title.
      page._defenderDetections = [];
      page.renderDefenderHistory(container);
      assert.ok(container._list.innerHTML.includes('defender.history.emptyDetail'));
      assert.ok(!container._list.innerHTML.includes('defender.history.emptyTitle'));
      assert.match(container._list.innerHTML, /class="empty-state defender-empty-state"/);
      // Error path renders one centered error message without raw cmdlet text.
      global.window.soterios.defender.getThreatHistory = async () => ({ ok: false, code: 'unavailable' });
      await page.listDefenderHistory(container, true);
      const errorHtml = container._list.innerHTML;
      assert.ok(errorHtml.includes('defender.history.errorUnavailable'));
      assert.ok(!errorHtml.includes('defender.history.unavailableTitle'));
      assert.ok(!errorHtml.includes('Get-MpThreatDetection'));
    })();
  });

  it('fails cleanly when the narrow preload API is absent', async () => {
    const page = loadReportsPage();
    const t = (key) => key;
    if (!global.escapeHtml) {
      global.escapeHtml = (value) => String(value ?? '');
    }
    global.window.I18n = { t };
    global.window.soterios = undefined;
    global.window.api = undefined;
    const container = {
      _list: null,
      querySelector: (selector) => {
        if (selector === '#defenderHistory') {
          if (!container._list) container._list = { innerHTML: '', querySelectorAll: () => [] };
          return container._list;
        }
        return null;
      },
      querySelectorAll: () => [],
    };
    page._defenderDetections = [];
    page._defenderRendered = [];
    await page.listDefenderHistory(container, false);
    assert.ok(container._list.innerHTML.includes('defender.history.errorFailed'));
    assert.ok(!container._list.innerHTML.includes('defender.history.unavailableTitle'));
  });

  it('shows a truncation notice without implying completeness', async () => {
    const page = loadReportsPage();
    const t = (key, vars) => {
      if (vars && vars.shown !== undefined) return `${key}:${vars.shown}/${vars.total}`;
      return key;
    };
    if (!global.escapeHtml) {
      global.escapeHtml = (value) => String(value ?? '');
    }
    global.window.I18n = { t };
    global.window.soterios = {
      defender: {
        getThreatHistory: async () => ({
          ok: true,
          data: {
            detections: [
              {
                id: 'detection:{x}',
                threatId: '1',
                threatName: 'Trojan:Win32/X',
                detectedAt: '2026-08-13T20:41:12.000Z',
                lastUpdatedAt: null,
                remediatedAt: null,
                status: 'remediated',
                statusLabel: 'Removed',
                action: 'removed',
                actionSuccess: true,
                severity: 'high',
                category: 'Trojan',
                resources: [],
                processName: null,
                executionStatus: null,
                detectionSource: null,
                active: false,
                source: 'Microsoft Defender',
                rawStatus: 4,
                rawAction: 3,
              },
            ],
            truncated: true,
          },
        }),
      },
    };
    const container = {
      _list: null,
      querySelector: (selector) => {
        if (selector === '#defenderHistory') {
          if (!container._list) container._list = { innerHTML: '', querySelectorAll: () => [] };
          return container._list;
        }
        return null;
      },
      querySelectorAll: () => [],
    };
    page._defenderDetections = [];
    page._defenderRendered = [];
    page._defenderTruncated = false;
    await page.listDefenderHistory(container, true);
    assert.ok(container._list.innerHTML.includes('defender.history.truncatedNote'));
  });

  it('wires the Defender section without generic IPC fallbacks', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'reports.js'),
      'utf8'
    );
    const start = source.indexOf('// -- Defender threat history');
    const end = source.indexOf('showManualMaintenanceDetails', start);
    assert.ok(start !== -1 && end !== -1);
    const section = source.slice(start, end);
    assert.ok(!section.includes('window.api.invoke'), 'Defender paths must not use generic IPC');
    // The filter markup lives in render(), above the methods section.
    assert.ok(
      source.includes('<select id="defenderHistoryRange"') &&
        source.includes("aria-label=\"${escapeHtml(t('defender.history.rangeLabel'))}\""),
      'range select needs a dedicated accessible label'
    );
    assert.ok(section.includes("windowsdefender://threat/"));
  });

  it('opens detection details and offers Windows Security without raw errors', async () => {
    const page = loadReportsPage();
    const t = (key, vars) => {
      if (vars && vars.shown !== undefined) return `${key}:${vars.shown}/${vars.total}`;
      return key;
    };
    if (!global.escapeHtml) {
      global.escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    }
    global.window.I18n = { t };
    const opened = [];
    global.window.soterios = {
      shell: {
        openExternal: async (uri) => {
          opened.push(uri);
          return { success: true };
        },
      },
    };
    const makeEl = (id) => ({
      id,
      innerHTML: '',
      textContent: '',
      className: '',
      style: {},
      value: '',
      dataset: {},
      _listeners: {},
      setAttribute() {},
      getAttribute: () => null,
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      addEventListener(type, fn) {
        (this._listeners[type] = this._listeners[type] || []).push(fn);
      },
      querySelectorAll: () => [],
      click() {
        for (const fn of this._listeners.click || []) fn({ stopPropagation() {}, target: this });
      },
    });
    const elements = new Map();
    const container = {
      _elements: elements,
      querySelector: (selector) => {
        const id = String(selector).startsWith('#') ? String(selector).slice(1) : null;
        if (!id) return null;
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      querySelectorAll: () => [],
    };
    const detection = {
      id: 'detection:{x}',
      threatId: '2147512345',
      threatName: 'Trojan:Win32/<img src=x onerror=alert(1)>',
      detectedAt: '2026-08-13T20:41:12.000Z',
      lastUpdatedAt: '2026-08-13T20:43:11.000Z',
      remediatedAt: '2026-08-13T20:42:40.000Z',
      status: 'remediated',
      statusLabel: 'Quarantined',
      action: 'quarantined',
      actionSuccess: true,
      severity: 'severe',
      category: 'Trojan',
      resources: [{ type: 'file', display: 'C:\\Users\\<user>\\evil.exe' }],
      processName: 'evil.exe',
      executionStatus: 'Not executing',
      detectionSource: 'Real-time',
      active: false,
      source: 'Microsoft Defender',
      rawStatus: 3,
      rawAction: 2,
    };
    page.openDefenderDetails(container, detection);
    const viewerHtml = elements.get('reportResult').innerHTML;
    // The threat name travels through the safe title path (textContent),
    // never through innerHTML: no raw markup survives anywhere.
    assert.equal(elements.get('reportViewerTitle').textContent, detection.threatName);
    assert.ok(!viewerHtml.includes('<img src=x'));
    assert.ok(!viewerHtml.includes('onerror='));
    // Key facts render with labels, not color alone.
    assert.ok(viewerHtml.includes('defender.history.threatId'));
    assert.ok(viewerHtml.includes('2147512345'));
    assert.ok(viewerHtml.includes('defender.history.actionName.quarantined'));
    assert.ok(viewerHtml.includes('C:\\Users\\&lt;user&gt;\\evil.exe'));
    // No remediation affordances exist in the details view.
    assert.ok(!/Remove-MpThreat|delete threat|quarantine threat/i.test(viewerHtml));
    // The Windows Security button opens the fixed deep link.
    elements.get('openDefenderSecurity').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(opened, ['windowsdefender://threat/']);
  });
});
