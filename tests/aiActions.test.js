'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ActionMarkerStream,
  ACTION_LABELS,
  actionListText,
  executeAction,
  extractActionMarkers,
  summarizeScanResult,
} = require('../src/main/aiActions');

describe('aiActions - ActionMarkerStream', () => {
  it('strips a complete marker from a single delta', () => {
    const stream = new ActionMarkerStream();
    const out = stream.push('Starting a quick scan for you.\n[[action:scan-quick]]');
    assert.equal(out.text, 'Starting a quick scan for you.\n');
    assert.deepEqual(out.markers, ['[[action:scan-quick]]']);
  });

  it('reassembles a marker split across many deltas', () => {
    const stream = new ActionMarkerStream();
    let text = '';
    for (const piece of ['Starti', 'ng now.\n[[act', 'ion:scan-', 'quick]]']) {
      text += stream.push(piece).text;
    }
    assert.equal(text, 'Starting now.\n');
    assert.deepEqual(stream.markers, ['[[action:scan-quick]]']);
  });

  it('holds a trailing partial marker and releases it on flush', () => {
    const stream = new ActionMarkerStream();
    assert.equal(stream.push('Hello [[action:he').text, 'Hello ');
    assert.equal(stream.push('alth-score]]').text, '');
    assert.deepEqual(stream.markers, ['[[action:health-score]]']);
    assert.equal(stream.flush(), '');
  });

  it('passes text that cannot start a marker straight through', () => {
    const stream = new ActionMarkerStream();
    assert.equal(stream.push('See you later [[)').text, 'See you later [[)');
    assert.deepEqual(stream.markers, []);
    assert.equal(stream.flush(), '');
  });

  it('does not treat plain bracketed text as a marker', () => {
    const stream = new ActionMarkerStream();
    const out = stream.push('Use [[brackets]] in code like [[x]]');
    assert.equal(out.text, 'Use [[brackets]] in code like [[x]]');
    assert.deepEqual(out.markers, []);
  });

  it('captures a marker with an argument', () => {
    const stream = new ActionMarkerStream();
    const out = stream.push('On it.\n[[action:password-generator:16]]');
    assert.equal(out.text, 'On it.\n');
    assert.deepEqual(out.markers, ['[[action:password-generator:16]]']);
  });

  it('handles multiple markers in one reply', () => {
    const stream = new ActionMarkerStream();
    const out = stream.push('[[action:scan-quick]]\n[[action:health-score]]');
    assert.equal(out.text, '\n');
    assert.deepEqual(out.markers, ['[[action:scan-quick]]', '[[action:health-score]]']);
  });
});

describe('aiActions - extractActionMarkers', () => {
  it('returns markers and cleaned text', () => {
    const { markers, text } = extractActionMarkers('Doing it.\n[[action:system-monitor]] done');
    assert.deepEqual(markers, ['[[action:system-monitor]]']);
    assert.equal(text, 'Doing it.\n done');
  });

  it('returns empty for plain text', () => {
    const { markers, text } = extractActionMarkers('No actions here');
    assert.deepEqual(markers, []);
    assert.equal(text, 'No actions here');
  });
});

describe('aiActions - summarizeScanResult', () => {
  it('summarizes a completed scan', () => {
    const summary = summarizeScanResult('scan-quick', {
      success: true,
      status: 'completed',
      filesScanned: 12384,
      threatsFound: 0,
      durationMs: 84000,
    });
    assert.match(summary, /Quick scan completed/);
    assert.match(summary, /12,384 files scanned/);
    assert.match(summary, /0 threats found/);
    assert.match(summary, /84s/);
  });

  it('names found threats', () => {
    const summary = summarizeScanResult('scan-quick', {
      success: true,
      status: 'completed',
      filesScanned: 10,
      threatsFound: 2,
      threats: [{ name: 'EICAR-Test' }, { name: 'Other' }],
      durationMs: 5000,
    });
    assert.match(summary, /2 threats found/);
    assert.match(summary, /EICAR-Test/);
    assert.match(summary, /quarantine/);
  });

  it('reports a failed scan', () => {
    const summary = summarizeScanResult('scan-full', {
      success: false,
      status: 'failed',
      filesScanned: 5,
      threatsFound: 0,
      errors: ['Access denied on C:\\x'],
      durationMs: 1000,
    });
    assert.match(summary, /Full scan failed/);
    assert.match(summary, /Access denied/);
  });
});

describe('aiActions - executeAction', () => {
  function makeCtx(overrides = {}) {
    return {
      db: {},
      scanEngine: overrides.scanEngine,
      onUpdate: overrides.onUpdate,
      toolRegistry: overrides.toolRegistry || {
        run: async () => ({ ok: true, data: { score: 88 } }),
      },
      ...overrides,
    };
  }

  it('runs a fast tool action successfully', async () => {
    const result = await executeAction('health-score', makeCtx());
    assert.equal(result.ok, true);
    assert.equal(result.started, undefined);
    assert.equal(result.label, ACTION_LABELS['health-score']);
    assert.ok(result.summary);
  });

  it('reports tool failures', async () => {
    const ctx = makeCtx({
      toolRegistry: { run: async () => ({ ok: false, error: 'Not implemented yet.' }) },
    });
    const result = await executeAction('health-score', ctx);
    assert.equal(result.ok, false);
    assert.match(result.error, /Not implemented/);
  });

  it('rejects unknown action ids', async () => {
    const ctx = makeCtx({
      toolRegistry: { run: async () => ({ ok: false, error: 'Unknown tool: nope' }) },
    });
    const result = await executeAction('nope', ctx);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('starts a scan in the background and reports completion via onUpdate', async () => {
    let resolveScan;
    const scanPromise = new Promise((resolve) => { resolveScan = resolve; });
    let updated = null;
    const ctx = makeCtx({
      onUpdate: (_ctx, payload) => { updated = payload; },
      scanEngine: {
        runQuickScan: () => scanPromise,
      },
    });
    const result = await executeAction('scan-quick', ctx);
    assert.equal(result.ok, true);
    assert.equal(result.started, true);
    assert.equal(updated, null);

    resolveScan({
      success: true,
      status: 'completed',
      filesScanned: 50,
      threatsFound: 0,
      durationMs: 3000,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(updated);
    assert.equal(updated.ok, true);
    assert.equal(updated.completed, true);
    assert.match(updated.summary, /Quick scan completed/);
  });

  it('surfaces an already-running scan error via onUpdate', async () => {
    let updated = null;
    const ctx = makeCtx({
      onUpdate: (_ctx, payload) => { updated = payload; },
      scanEngine: {
        runQuickScan: async () => ({ error: 'Scan already in progress' }),
      },
    });
    const result = await executeAction('scan-quick', ctx);
    assert.equal(result.ok, true);
    assert.equal(result.started, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(updated);
    assert.equal(updated.ok, false);
    assert.match(updated.error, /already in progress/);
  });

  it('fails when the scan engine is missing', async () => {
    const result = await executeAction('scan-full', makeCtx({ scanEngine: null }));
    assert.equal(result.ok, false);
    assert.match(result.error, /not available/);
  });
});

describe('aiActions - action list', () => {
  it('lists every available action with a label', () => {
    const text = actionListText();
    for (const id of Object.keys(ACTION_LABELS)) {
      assert.ok(text.includes(`[[action:${id}]]`), `missing ${id}`);
    }
  });
});
