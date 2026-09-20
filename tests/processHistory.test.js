'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DatabaseService = require('../src/core/database');
const { ProcessHistoryRecorder, historyKey, TOUCH_INTERVAL_MS } = require('../src/main/processHistory');
const { processKeyString } = require('../src/main/processService');

const tempPaths = [];
const openServices = [];

afterEach(() => {
  while (openServices.length) {
    try { openServices.pop().db.close(); } catch (_) {}
  }
  while (tempPaths.length) {
    const p = tempPaths.pop();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { fs.rmSync(`${p}${suffix}`, { force: true }); } catch (_) {}
    }
  }
});

function tempDb() {
  const p = path.join(os.tmpdir(), `soterios-prochist-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  tempPaths.push(p);
  const service = new DatabaseService(p);
  openServices.push(service);
  return service;
}

function record(key, overrides = {}) {
  const [pidText] = String(key).split('@');
  return {
    processKey: key,
    pid: Number(pidText),
    startedAt: '2026-09-20T10:00:00.000Z',
    processName: `app-${pidText}.exe`,
    exeBasename: `app-${pidText}.exe`,
    parentPid: 4,
    publisher: null,
    signatureStatus: null,
    riskScore: 10,
    riskLevel: 'no-concerns',
    firstSeen: '2026-09-20T10:00:00.000Z',
    lastSeen: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function stubDb(overrides = {}) {
  const calls = { upsert: [], exit: [], enrich: [], reopen: [], query: 0, txn: 0 };
  return {
    calls,
    getSetting: () => false,
    upsertProcessHistory: (row) => { calls.upsert.push(row); return { changes: 1 }; },
    markProcessHistoryExit: (key, patch) => { calls.exit.push([key, patch]); return { changes: 1 }; },
    updateProcessHistoryEnrichment: (key, patch) => { calls.enrich.push([key, patch]); return { changes: 1 }; },
    reopenProcessHistory: (key) => { calls.reopen.push(key); return { changes: 0 }; },
    runInTransaction: (fn) => { calls.txn += 1; return fn(); },
    queryProcessHistory: (filters) => { calls.query += 1; return { rows: [], total: 0 }; },
    getProcessHistoryRetentionDays: () => 7,
    setProcessHistoryRetentionDays: () => {},
    clearProcessHistory: () => ({ changes: 0 }),
    pruneProcessHistory: () => ({ timeDeleted: 0, rowDeleted: 0 }),
    ...overrides,
  };
}

function sampleProc(pid, startedAt, overrides = {}) {
  return {
    pid,
    ppid: 4,
    startedAt,
    key: { pid, startedAt },
    name: `app-${pid}.exe`,
    path: `C:\\Program Files\\App\\app-${pid}.exe`,
    risk: { score: 10, severity: 'no-concerns' },
    ...overrides,
  };
}

describe('process_history schema', () => {
  it('creates the table and indexes on fresh and existing databases', () => {
    const p = path.join(os.tmpdir(), `soterios-prochist-${Date.now()}-reopen.db`);
    tempPaths.push(p);
    const first = new DatabaseService(p);
    first.upsertProcessHistory(record('100@2026-09-20T10:00:00.000Z'));
    first.db.close();
    const second = new DatabaseService(p);
    openServices.push(second);
    assert.equal(second.getProcessHistoryRow('100@2026-09-20T10:00:00.000Z').process_name, 'app-100.exe');
    const indexes = second.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'process_history'").all().map((row) => row.name);
    assert.ok(indexes.includes('idx_process_history_last_seen'));
    assert.ok(indexes.includes('idx_process_history_name'));
    assert.ok(indexes.includes('idx_process_history_risk'));
  });

  it('stores only non-sensitive lifecycle fields', () => {
    const db = tempDb();
    const columns = db.db.prepare('PRAGMA table_info(process_history)').all().map((col) => col.name);
    for (const forbidden of ['command_line', 'commandline', 'arguments', 'environment', 'username', 'user', 'full_path', 'exe_path', 'network_address']) {
      assert.ok(!columns.includes(forbidden), `sensitive column present: ${forbidden}`);
    }
  });
});

describe('process_history lifecycle', () => {
  it('inserts and reads back a lifecycle record', () => {
    const db = tempDb();
    db.upsertProcessHistory(record('200@2026-09-20T10:00:00.000Z'));
    const row = db.getProcessHistoryRow('200@2026-09-20T10:00:00.000Z');
    assert.equal(row.pid, 200);
    assert.equal(row.process_name, 'app-200.exe');
    assert.equal(row.exe_basename, 'app-200.exe');
    assert.equal(row.exit_time, null);
    assert.equal(row.terminated_by_user, 0);
  });

  it('updates last_seen without rewriting origin or exit state', () => {
    const db = tempDb();
    db.upsertProcessHistory(record('201@2026-09-20T10:00:00.000Z'));
    db.markProcessHistoryExit('201@2026-09-20T10:00:00.000Z', { exitTime: '2026-09-20T10:05:00.000Z' });
    db.upsertProcessHistory(record('201@2026-09-20T10:00:00.000Z', { lastSeen: '2026-09-20T10:06:00.000Z' }));
    const row = db.getProcessHistoryRow('201@2026-09-20T10:00:00.000Z');
    assert.equal(row.first_seen, '2026-09-20T10:00:00.000Z');
    assert.equal(row.last_seen, '2026-09-20T10:06:00.000Z');
    assert.equal(row.exit_time, '2026-09-20T10:05:00.000Z');
  });

  it('marks exits with termination attribution exactly once', () => {
    const db = tempDb();
    db.upsertProcessHistory(record('202@2026-09-20T10:00:00.000Z'));
    db.markProcessHistoryExit('202@2026-09-20T10:00:00.000Z', { exitTime: '2026-09-20T10:05:00.000Z', terminatedByUser: true });
    db.markProcessHistoryExit('202@2026-09-20T10:00:00.000Z', { exitTime: '2026-09-20T10:06:00.000Z' });
    const row = db.getProcessHistoryRow('202@2026-09-20T10:00:00.000Z');
    assert.equal(row.exit_time, '2026-09-20T10:05:00.000Z');
    assert.equal(row.terminated_by_user, 1);
  });

  it('keeps separate records for PID reuse', () => {
    const db = tempDb();
    db.upsertProcessHistory(record('300@2026-09-20T10:00:00.000Z', { processName: 'first.exe', exeBasename: 'first.exe' }));
    db.upsertProcessHistory(record('300@2026-09-20T11:00:00.000Z', { processName: 'second.exe', exeBasename: 'second.exe' }));
    assert.equal(db.getProcessHistoryRow('300@2026-09-20T10:00:00.000Z').process_name, 'first.exe');
    assert.equal(db.getProcessHistoryRow('300@2026-09-20T11:00:00.000Z').process_name, 'second.exe');
  });

  it('uses the same lifecycle key semantics as the live service', () => {
    for (const fixture of [
      { pid: 42, startedAt: '2026-09-20T10:00:00.000Z' },
      { pid: 42, startedAt: null },
      { pid: 0, startedAt: '' },
    ]) {
      assert.equal(historyKey(fixture.pid, fixture.startedAt), processKeyString({ pid: fixture.pid, startedAt: fixture.startedAt }));
    }
    assert.ok(TOUCH_INTERVAL_MS >= 60 * 1000);
  });
});

describe('process_history queries', () => {
  function seeded() {
    const db = tempDb();
    const rows = [
      ['1@2026-09-20T08:00:00.000Z', { processName: 'alpha.exe', exeBasename: 'alpha.exe', riskScore: 80, riskLevel: 'high-concern', firstSeen: '2026-09-20T08:00:00.000Z', lastSeen: '2026-09-20T08:30:00.000Z' }],
      ['2@2026-09-20T08:10:00.000Z', { processName: 'beta.exe', exeBasename: 'beta.exe', riskScore: 40, riskLevel: 'review-recommended', firstSeen: '2026-09-20T08:10:00.000Z', lastSeen: '2026-09-20T08:40:00.000Z' }],
      ['3@2026-09-20T08:20:00.000Z', { processName: 'gamma tool.exe', exeBasename: 'gamma tool.exe', publisher: 'Gamma Corp', riskScore: 5, riskLevel: 'no-concerns', firstSeen: '2026-09-20T08:20:00.000Z', lastSeen: '2026-09-20T08:50:00.000Z' }],
      ['4@2026-09-20T08:30:00.000Z', { processName: 'hundred%.exe', exeBasename: 'hundred%.exe', riskScore: 0, riskLevel: 'unverified', firstSeen: '2026-09-20T08:30:00.000Z', lastSeen: '2026-09-20T09:00:00.000Z' }],
      ['5@2026-09-20T08:40:00.000Z', { processName: 'delta.exe', exeBasename: 'delta.exe', riskScore: 90, riskLevel: 'high-concern', firstSeen: '2026-09-20T08:40:00.000Z', lastSeen: '2026-09-20T09:10:00.000Z' }],
    ];
    for (const [key, overrides] of rows) db.upsertProcessHistory(record(key, overrides));
    db.markProcessHistoryExit('1@2026-09-20T08:00:00.000Z', { exitTime: '2026-09-20T08:30:00.000Z' });
    return db;
  }

  it('paginates newest-first with totals', () => {
    const db = seeded();
    const first = db.queryProcessHistory({ limit: 2, offset: 0 });
    assert.equal(first.total, 5);
    assert.equal(first.rows.length, 2);
    assert.equal(first.rows[0].processName, 'delta.exe');
    const second = db.queryProcessHistory({ limit: 2, offset: 2 });
    assert.equal(second.rows.length, 2);
    assert.deepEqual(second.rows.map((row) => row.processName), ['gamma tool.exe', 'beta.exe']);
  });

  it('searches names and publishers without wildcard injection', () => {
    const db = seeded();
    assert.deepEqual(db.queryProcessHistory({ search: 'gamma' }).rows.map((row) => row.processName), ['gamma tool.exe']);
    assert.deepEqual(db.queryProcessHistory({ search: 'Gamma Corp' }).rows.map((row) => row.processName), ['gamma tool.exe']);
    // A literal % must match the literal name, not act as a wildcard.
    assert.deepEqual(db.queryProcessHistory({ search: 'hundred%' }).rows.map((row) => row.processName), ['hundred%.exe']);
    assert.equal(db.queryProcessHistory({ search: 'no-such-process-xyz' }).total, 0);
  });

  it('filters by risk level and status', () => {
    const db = seeded();
    const high = db.queryProcessHistory({ riskLevels: ['high-concern'] });
    assert.equal(high.total, 2);
    const exited = db.queryProcessHistory({ status: 'exited' });
    assert.deepEqual(exited.rows.map((row) => row.processName), ['alpha.exe']);
    const active = db.queryProcessHistory({ status: 'unknown-exit' });
    assert.equal(active.total, 4);
  });

  it('filters by date range and sorts safely', () => {
    const db = seeded();
    const ranged = db.queryProcessHistory({ from: '2026-09-20T08:45:00.000Z', to: '2026-09-20T09:05:00.000Z' });
    assert.deepEqual(ranged.rows.map((row) => row.processName), ['hundred%.exe', 'gamma tool.exe']);
    const byRisk = db.queryProcessHistory({ sort: 'risk_desc', limit: 1 });
    assert.equal(byRisk.rows[0].processName, 'delta.exe');
    // Sort injection falls back to the default ordering; the table survives.
    const injected = db.queryProcessHistory({ sort: 'last_seen DESC; DROP TABLE process_history; --' });
    assert.equal(injected.rows[0].processName, 'delta.exe');
    assert.equal(db.queryProcessHistory({}).total, 5);
  });

  it('rejects or bounds hostile query arguments', () => {
    const db = seeded();
    assert.throws(() => db.queryProcessHistory({ riskLevels: ['everything'] }), /risk filter/);
    assert.throws(() => db.queryProcessHistory({ status: 'sometimes' }), /status filter/);
    assert.throws(() => db.queryProcessHistory({ search: 'bad\nquery' }), /search/);
    assert.throws(() => db.queryProcessHistory({ from: 'not-a-date' }), /date range/);
    const clamped = db.queryProcessHistory({ limit: 5000 });
    assert.ok(clamped.rows.length <= 200);
    const sliced = db.queryProcessHistory({ search: `${'a'.repeat(500)}` });
    assert.equal(sliced.total, 0);
    const negative = db.queryProcessHistory({ offset: -50 });
    assert.equal(negative.offset, 0);
  });
});

describe('process_history retention', () => {
  it('returns the default and round-trips valid values', () => {
    const db = tempDb();
    assert.equal(db.getProcessHistoryRetentionDays(), 7);
    db.setProcessHistoryRetentionDays(30);
    assert.equal(db.getProcessHistoryRetentionDays(), 30);
    assert.throws(() => db.setProcessHistoryRetentionDays(0), /Retention/);
    assert.throws(() => db.setProcessHistoryRetentionDays(366), /Retention/);
    assert.throws(() => db.setProcessHistoryRetentionDays('forever'), /Retention/);
  });

  it('falls back to the default for malformed stored values', () => {
    const db = tempDb();
    db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('processHistoryRetentionDays', 'not-json-at-all{{{')").run();
    assert.equal(db.getProcessHistoryRetentionDays(), 7);
    db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('processHistoryRetentionDays', '5000')").run();
    assert.equal(db.getProcessHistoryRetentionDays(), 7);
  });

  it('deletes only expired rows', () => {
    const db = tempDb();
    const old = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const fresh = new Date().toISOString();
    db.upsertProcessHistory(record(`1@${old}`, { firstSeen: old, lastSeen: old }));
    db.upsertProcessHistory(record(`2@${fresh}`, { firstSeen: fresh, lastSeen: fresh }));
    const result = db.pruneProcessHistory(7, 100000);
    assert.equal(result.timeDeleted, 1);
    assert.equal(db.getProcessHistoryRow(`1@${old}`), null);
    assert.ok(db.getProcessHistoryRow(`2@${fresh}`));
  });

  it('enforces the hard row-count bound on oldest rows', () => {
    const db = tempDb();
    const base = Date.now() - 105 * 60000;
    const stamps = [];
    for (let i = 0; i < 105; i += 1) {
      const stamp = new Date(base + i * 60000).toISOString();
      stamps.push(stamp);
      db.upsertProcessHistory(record(`${1000 + i}@${stamp}`, { firstSeen: stamp, lastSeen: stamp }));
    }
    const result = db.pruneProcessHistory(365, 100);
    assert.equal(result.rowDeleted, 5);
    assert.equal(db.queryProcessHistory({ limit: 200 }).total, 100);
    assert.equal(db.getProcessHistoryRow(`1000@${stamps[0]}`), null);
    assert.ok(db.getProcessHistoryRow(`1104@${stamps[104]}`));
  });

  it('reopens a transiently omitted lifecycle instead of contradicting it', () => {
    const db = tempDb();
    const key = '400@2026-09-20T10:00:00.000Z';
    db.upsertProcessHistory(record(key));
    db.markProcessHistoryExit(key, { exitTime: '2026-09-20T10:05:00.000Z', terminatedByUser: true });
    const reopened = db.reopenProcessHistory(key, '2026-09-20T10:06:00.000Z');
    assert.equal(reopened.changes, 1);
    const row = db.getProcessHistoryRow(key);
    assert.equal(row.exit_time, null);
    assert.equal(row.terminated_by_user, 0);
    assert.equal(row.first_seen, '2026-09-20T10:00:00.000Z');
    assert.equal(row.last_seen, '2026-09-20T10:06:00.000Z');
    assert.equal(db.reopenProcessHistory(key).changes, 0);
    assert.equal(db.reopenProcessHistory('missing@2026-09-20T10:00:00.000Z').changes, 0);
  });

  it('runs batches in one transaction with rollback on failure', () => {
    const db = tempDb();
    const result = db.runInTransaction(() => {
      db.upsertProcessHistory(record('401@2026-09-20T10:00:00.000Z'));
      return 'batched';
    });
    assert.equal(result, 'batched');
    assert.ok(db.getProcessHistoryRow('401@2026-09-20T10:00:00.000Z'));
    assert.throws(() => db.runInTransaction(() => {
      db.upsertProcessHistory(record('402@2026-09-20T10:00:00.000Z'));
      throw new Error('mid-batch failure');
    }), /mid-batch failure/);
    assert.equal(db.getProcessHistoryRow('402@2026-09-20T10:00:00.000Z'), null);
    assert.throws(() => db.runInTransaction(null), /callback/);
  });

  it('clears history without touching unrelated data', () => {
    const db = tempDb();
    db.upsertProcessHistory(record('9@2026-09-20T10:00:00.000Z'));
    db.setSetting('unrelated.flag', true);
    const result = db.clearProcessHistory();
    assert.equal(result.changes, 1);
    assert.equal(db.queryProcessHistory({}).total, 0);
    assert.equal(db.getSetting('unrelated.flag', false), true);
  });
});

describe('ProcessHistoryRecorder', () => {
  function sample(collectedAt, procs) {
    return { processes: procs, previousByKey: new Map(), delta: { started: procs, exited: [] }, collectedAt };
  }

  it('records starts once and ignores repeated samples until the touch interval', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db, touchIntervalMs: 3600000 });
    const procs = [sampleProc(10, '2026-09-20T10:00:00.000Z')];
    const first = recorder.recordSample(sample('2026-09-20T10:00:01.000Z', procs));
    assert.equal(first.started, 1);
    const second = recorder.recordSample(sample('2026-09-20T10:00:02.000Z', procs));
    assert.equal(second.started, 0);
    assert.equal(second.touched, 0);
    assert.equal(db.calls.upsert.length, 1);
    assert.equal(db.calls.upsert[0].exeBasename, 'app-10.exe');
  });

  it('refreshes last_seen after the touch interval and on risk change', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db, touchIntervalMs: 3600000 });
    const key = '11@2026-09-20T10:00:00.000Z';
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [sampleProc(11, '2026-09-20T10:00:00.000Z')]));
    recorder._touch.get(key).at = 0;
    const touched = recorder.recordSample(sample('2026-09-20T10:00:02.000Z', [sampleProc(11, '2026-09-20T10:00:00.000Z')]));
    assert.equal(touched.touched, 1);
    const risky = sampleProc(11, '2026-09-20T10:00:00.000Z', { risk: { score: 90, severity: 'high-concern' } });
    const changed = recorder.recordSample(sample('2026-09-20T10:00:03.000Z', [risky]));
    assert.equal(changed.touched, 1);
    assert.equal(db.calls.upsert.length, 3);
  });

  it('marks exits with prior enrichment and user termination', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db });
    const proc = sampleProc(12, '2026-09-20T10:00:00.000Z', { risk: { score: 55, severity: 'review-recommended' } });
    const bystander = sampleProc(999, '2026-09-20T09:00:00.000Z');
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [proc, bystander]));
    recorder.markUserTerminated('12@2026-09-20T10:00:00.000Z');
    const outcome = recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([['12@2026-09-20T10:00:00.000Z', proc], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 12, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
      collectedAt: '2026-09-20T10:05:00.000Z',
    });
    assert.equal(outcome.exited, 1);
    assert.deepEqual(db.calls.exit[0][0], '12@2026-09-20T10:00:00.000Z');
    assert.equal(db.calls.exit[0][1].exitTime, '2026-09-20T10:05:00.000Z');
    assert.equal(db.calls.exit[0][1].riskScore, 55);
    assert.equal(db.calls.exit[0][1].terminatedByUser, true);
  });

  it('records details enrichment without sensitive fields', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db });
    const result = recorder.recordEnrichment('13@2026-09-20T10:00:00.000Z', {
      publisher: 'Example Corp',
      signatureStatus: 'Valid',
      riskScore: 20,
      riskLevel: 'unverified',
    });
    assert.equal(result.skipped, false);
    assert.deepEqual(db.calls.enrich[0][1].publisher, 'Example Corp');
  });

  it('never throws on database failure', () => {
    const db = stubDb({ upsertProcessHistory: () => { throw new Error('disk is gone'); } });
    const recorder = new ProcessHistoryRecorder({ db });
    const outcome = recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [sampleProc(14, '2026-09-20T10:00:00.000Z')]));
    assert.match(outcome.error, /disk is gone/);
    assert.equal(recorder.recordingEnabled(), true);
  });

  it('writes nothing while Privacy Mode is on but keeps history readable', () => {
    const db = stubDb({ getSetting: () => true });
    const recorder = new ProcessHistoryRecorder({ db });
    assert.equal(recorder.recordingEnabled(), false);
    const outcome = recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [sampleProc(15, '2026-09-20T10:00:00.000Z')]));
    assert.equal(outcome.skipped, true);
    assert.equal(db.calls.upsert.length, 0);
    assert.equal(recorder.recordEnrichment('15@x', {}).skipped, true);
    recorder.query({ limit: 5 });
    assert.equal(db.calls.query, 1);
  });

  it('resumes recording after Privacy Mode is disabled', () => {
    let privacy = true;
    const db = stubDb({ getSetting: () => privacy });
    const recorder = new ProcessHistoryRecorder({ db });
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [sampleProc(16, '2026-09-20T10:00:00.000Z')]));
    assert.equal(db.calls.upsert.length, 0);
    privacy = false;
    recorder.recordSample(sample('2026-09-20T10:00:02.000Z', [sampleProc(16, '2026-09-20T10:00:00.000Z')]));
    assert.equal(db.calls.upsert.length, 1);
  });

  it('fails closed when the privacy check itself errors', () => {
    const db = stubDb({ getSetting: () => { throw new Error('corrupt'); } });
    const recorder = new ProcessHistoryRecorder({ db });
    assert.equal(recorder.recordingEnabled(), false);
  });

  it('expires stale termination attributions instead of mislabeling natural exits', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db, terminatedTtlMs: 60000 });
    const key = '18@2026-09-20T10:00:00.000Z';
    const proc = sampleProc(18, '2026-09-20T10:00:00.000Z');
    const bystander = sampleProc(999, '2026-09-20T09:00:00.000Z');
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [proc, bystander]));
    recorder.markUserTerminated(key);
    // The action was an hour ago; the exit observed now was not caused by it.
    recorder._terminatedKeys.set(key, Date.now() - 3600000);
    recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([[key, proc], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 18, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T11:00:00.000Z' }] },
      collectedAt: '2026-09-20T11:00:00.000Z',
    });
    assert.equal(db.calls.exit[0][1].terminatedByUser, false);
    assert.ok(!recorder._terminatedKeys.has(key));
  });

  it('reopens a reappearing precise identity and leaves imprecise exits closed', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db });
    const precise = '19@2026-09-20T10:00:00.000Z';
    const proc = sampleProc(19, '2026-09-20T10:00:00.000Z');
    const bystander = sampleProc(999, '2026-09-20T09:00:00.000Z');
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [proc, bystander]));
    const reopenAfterStart = db.calls.reopen.length;
    recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([[precise, proc], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 19, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
      collectedAt: '2026-09-20T10:05:00.000Z',
    });
    assert.equal(db.calls.reopen.length, reopenAfterStart);
    recorder.recordSample(sample('2026-09-20T10:06:00.000Z', [proc, bystander]));
    assert.deepEqual(db.calls.reopen.slice(reopenAfterStart), [precise]);
    // A null-startedAt identity cannot prove re-observation: no reopen.
    const vague = sampleProc(20, null);
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [vague, bystander]));
    const reopenCount = db.calls.reopen.length;
    recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([['20@', vague], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 20, startedAt: null }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
      collectedAt: '2026-09-20T10:05:00.000Z',
    });
    recorder.recordSample(sample('2026-09-20T10:06:00.000Z', [vague, bystander]));
    assert.equal(db.calls.reopen.length, reopenCount);
  });

  it('skips exit recording for empty glitch samples', () => {
    const db = stubDb();
    const recorder = new ProcessHistoryRecorder({ db });
    const proc = sampleProc(21, '2026-09-20T10:00:00.000Z');
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [proc]));
    const upserts = db.calls.upsert.length;
    const outcome = recorder.recordSample({
      processes: [],
      previousByKey: new Map([['21@2026-09-20T10:00:00.000Z', proc]]),
      delta: { started: [], exited: [{ key: { pid: 21, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T10:01:00.000Z' }] },
      collectedAt: '2026-09-20T10:01:00.000Z',
    });
    assert.equal(outcome.skippedEmpty, true);
    assert.equal(db.calls.upsert.length, upserts);
    assert.equal(db.calls.exit.length, 0);
  });

  it('commits each sample batch in a single transaction', () => {
    let insideTxn = 0;
    let maxInside = 0;
    const db = stubDb({
      runInTransaction: (fn) => { insideTxn += 1; try { return fn(); } finally { insideTxn -= 1; } },
      upsertProcessHistory: (row) => { maxInside = Math.max(maxInside, insideTxn); return { changes: 1 }; },
      markProcessHistoryExit: () => { maxInside = Math.max(maxInside, insideTxn); return { changes: 1 }; },
    });
    const recorder = new ProcessHistoryRecorder({ db });
    const procs = [sampleProc(22, '2026-09-20T10:00:00.000Z'), sampleProc(23, '2026-09-20T10:00:00.000Z')];
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', procs));
    assert.equal(maxInside, 1);
  });

  it('retries rolled-back inserts and attributions after a batch failure', () => {
    const db = tempDb();
    const procC = sampleProc(30, '2026-09-20T10:00:00.000Z');
    const procB = sampleProc(31, '2026-09-20T10:00:00.000Z');
    const service = { recorder: new ProcessHistoryRecorder({ db, touchIntervalMs: 3600000 }) };
    const recorder = service.recorder;
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [procB]));
    recorder.markUserTerminated('31@2026-09-20T10:00:00.000Z');
    const realMarkExit = db.markProcessHistoryExit.bind(db);
    let failNext = true;
    db.markProcessHistoryExit = (...args) => {
      if (failNext) { failNext = false; throw new Error('simulated batch failure'); }
      return realMarkExit(...args);
    };
    try {
      const bad = recorder.recordSample({
        processes: [procC],
        previousByKey: new Map([['30@2026-09-20T10:00:00.000Z', procC], ['31@2026-09-20T10:00:00.000Z', procB]]),
        delta: { started: [procC], exited: [{ key: { pid: 31, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
        collectedAt: '2026-09-20T10:05:00.000Z',
      });
      assert.match(bad.error, /simulated batch failure/);
      assert.equal(db.getProcessHistoryRow('30@2026-09-20T10:00:00.000Z'), null);
      const retry = recorder.recordSample({
        processes: [procC],
        previousByKey: new Map([['30@2026-09-20T10:00:00.000Z', procC], ['31@2026-09-20T10:00:00.000Z', procB]]),
        delta: { started: [], exited: [{ key: { pid: 31, startedAt: '2026-09-20T10:00:00.000Z' }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
        collectedAt: '2026-09-20T10:05:00.000Z',
      });
      assert.equal(retry.error, undefined);
      assert.ok(db.getProcessHistoryRow('30@2026-09-20T10:00:00.000Z'));
      assert.equal(db.getProcessHistoryRow('31@2026-09-20T10:00:00.000Z').terminated_by_user, 1);
    } finally {
      db.markProcessHistoryExit = realMarkExit;
    }
  });

  it('synthesizes a distinct lifecycle for imprecise PID reuse after an exit', () => {
    const db = tempDb();
    const recorder = new ProcessHistoryRecorder({ db, touchIntervalMs: 3600000 });
    const procA = sampleProc(40, null, { name: 'old.exe', path: 'C:\\Old\\old.exe' });
    const bystander = sampleProc(999, '2026-09-20T09:00:00.000Z');
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [procA, bystander]));
    recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([['40@', procA], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 40, startedAt: null }, exitedAt: '2026-09-20T10:05:00.000Z' }] },
      collectedAt: '2026-09-20T10:05:00.000Z',
    });
    // Empty current would trigger the glitch guard, so re-observe with a bystander.
    const procB = sampleProc(40, null, { name: 'new.exe', path: 'C:\\New\\new.exe' });
    const outcome = recorder.recordSample(sample('2026-09-20T10:06:00.000Z', [procB, bystander]));
    assert.equal(outcome.started, 1);
    const oldRow = db.getProcessHistoryRow('40@');
    assert.equal(oldRow.process_name, 'old.exe');
    assert.equal(oldRow.exit_time, '2026-09-20T10:05:00.000Z');
    const rows = db.queryProcessHistory({ search: 'new.exe' }).rows;
    assert.equal(rows.length, 1);
    assert.match(rows[0].processKey, /^40@unknown-/);
    assert.equal(rows[0].exitTime, null);
    // The new lifecycle exits on its own row; the old row is untouched.
    recorder.recordSample({
      processes: [bystander],
      previousByKey: new Map([[rows[0].processKey, procB], ['999@2026-09-20T09:00:00.000Z', bystander]]),
      delta: { started: [], exited: [{ key: { pid: 40, startedAt: null }, exitedAt: '2026-09-20T10:07:00.000Z' }] },
      collectedAt: '2026-09-20T10:07:00.000Z',
    });
    assert.equal(db.getProcessHistoryRow(rows[0].processKey).exit_time, '2026-09-20T10:07:00.000Z');
    assert.equal(db.getProcessHistoryRow('40@').exit_time, '2026-09-20T10:05:00.000Z');
  });

  it('continues the open row for an imprecise identity instead of fragmenting', () => {
    const db = tempDb();
    const recorder = new ProcessHistoryRecorder({ db, touchIntervalMs: 3600000 });
    const proc = sampleProc(41, null, { name: 'steady.exe', path: 'C:\\S\\steady.exe' });
    recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [proc]));
    // Simulate an app restart: touch state is gone but the row stays open.
    recorder._touch.clear();
    recorder.recordSample(sample('2026-09-20T10:06:00.000Z', [proc]));
    assert.equal(db.queryProcessHistory({}).total, 1);
    assert.equal(db.getProcessHistoryRow('41@').exit_time, null);
  });

  it('no-ops without a database', () => {
    const recorder = new ProcessHistoryRecorder({ db: null });
    assert.equal(recorder.recordingEnabled(), false);
    const outcome = recorder.recordSample(sample('2026-09-20T10:00:01.000Z', [sampleProc(17, '2026-09-20T10:00:00.000Z')]));
    assert.equal(outcome.skipped, true);
    assert.throws(() => recorder.query({}), /unavailable/);
    assert.deepEqual(recorder.runCleanup(), { skipped: true });
  });
});

describe('ProcessService persistent history integration', () => {
  const { ProcessService } = require('../src/main/processService');

  class FakeCollector {
    constructor(samples) {
      this.samples = samples;
      this.index = 0;
      this.capabilities = { provider: 'test', intervalFloorMs: 500 };
    }

    async start() {}

    async stop() {}

    async sample() {
      const sample = this.samples[Math.min(this.index, this.samples.length - 1)];
      this.index += 1;
      return structuredClone(sample);
    }
  }

  function rawSnapshot(collectedAt, procs) {
    return {
      protocolVersion: 1,
      collectedAt,
      capabilities: { provider: 'test', intervalFloorMs: 500 },
      totals: {},
      processes: procs.map(([pid, startedAt]) => ({
        pid,
        ppid: 4,
        startedAt,
        name: `app-${pid}.exe`,
        path: `C:\\Program Files\\App\\app-${pid}.exe`,
      })),
    };
  }

  function serviceWithHistory(samples, db) {
    return new ProcessService({
      collector: new FakeCollector(samples),
      db,
      auxMetricsEnabled: false,
      historyTouchIntervalMs: 3600000,
    });
  }

  it('creates one history entry per process and no duplicates on resample', async () => {
    const db = tempDb();
    const service = serviceWithHistory([
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [101, '2026-09-20T09:30:00.000Z']]),
    ], db);
    await service.sample();
    assert.equal(db.queryProcessHistory({}).total, 2);
    await service.sample();
    await service.sample();
    assert.equal(db.queryProcessHistory({}).total, 2);
    await service.stop();
  });

  it('marks the correct record on exit with the last observed risk', async () => {
    const db = tempDb();
    const service = serviceWithHistory([
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [101, '2026-09-20T09:30:00.000Z']]),
      rawSnapshot('2026-09-20T10:01:00.000Z', [[101, '2026-09-20T09:30:00.000Z']]),
    ], db);
    await service.sample();
    await service.sample();
    const exited = db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z');
    assert.equal(exited.exit_time, '2026-09-20T10:01:00.000Z');
    assert.equal(typeof exited.risk_score, 'number');
    assert.equal(db.getProcessHistoryRow('101@2026-09-20T09:30:00.000Z').exit_time, null);
    await service.stop();
  });

  it('attributes user termination on the observed exit', async () => {
    const db = tempDb();
    const service = serviceWithHistory([
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
      rawSnapshot('2026-09-20T10:01:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
    ], db);
    await service.sample();
    service.processHistory.markUserTerminated('100@2026-09-20T09:00:00.000Z');
    await service.sample();
    await service.sample();
    assert.equal(db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z').terminated_by_user, 1);
    await service.stop();
  });

  it('keeps live monitoring working when history persistence fails', async () => {
    const failing = stubDb({ upsertProcessHistory: () => { throw new Error('no disk'); } });
    const service = serviceWithHistory([
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z']]),
    ], failing);
    const snapshot = await service.sample();
    assert.equal(snapshot.processes.length, 1);
    assert.equal(service.snapshot.processes.length, 1);
    await service.stop();
  });

  it('records nothing while Privacy Mode is on and resumes after', async () => {
    const db = tempDb();
    db.setSetting('feature.privacyMode', true);
    const service = serviceWithHistory([
      rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z']]),
    ], db);
    await service.sample();
    assert.equal(db.queryProcessHistory({}).total, 0);
    db.setSetting('feature.privacyMode', false);
    await service.sample();
    assert.equal(db.queryProcessHistory({}).total, 1);
    await service.stop();
  });

  it('never attributes a natural exit after a failed terminate', async () => {
    const db = tempDb();
    const denied = new Error('Access is denied');
    denied.stderr = 'Access is denied';
    const service = new ProcessService({
      collector: new FakeCollector([
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:01:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
      ]),
      db,
      auxMetricsEnabled: false,
      historyTouchIntervalMs: 3600000,
      execFileImpl: async () => { throw denied; },
    });
    await service.sample();
    const result = await service.performAction({
      processKey: { pid: 100, startedAt: '2026-09-20T09:00:00.000Z' },
      action: 'terminate',
    });
    assert.equal(result.success, false);
    await service.sample();
    const row = db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z');
    assert.equal(row.exit_time, '2026-09-20T10:01:00.000Z');
    assert.equal(row.terminated_by_user, 0);
    await service.stop();
  });

  it('attributes the exit after a successful terminate', async () => {
    const db = tempDb();
    const service = new ProcessService({
      collector: new FakeCollector([
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:01:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
      ]),
      db,
      auxMetricsEnabled: false,
      historyTouchIntervalMs: 3600000,
      execFileImpl: async () => ({ stdout: '', stderr: '' }),
    });
    await service.sample();
    const result = await service.performAction({
      processKey: { pid: 100, startedAt: '2026-09-20T09:00:00.000Z' },
      action: 'terminate',
    });
    assert.equal(result.success, true);
    await service.sample();
    assert.equal(db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z').terminated_by_user, 1);
    await service.stop();
  });

  it('attributes the kill when restart destroys the process but relaunch fails', async () => {
    const db = tempDb();
    const withRealPath = (snapshot) => {
      const proc = snapshot.processes.find((item) => item.pid === 100);
      if (proc) proc.path = process.execPath;
      return snapshot;
    };
    const eperm = new Error('denied');
    eperm.code = 'EPERM';
    const service = new ProcessService({
      collector: new FakeCollector([
        withRealPath(rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']])),
        withRealPath(rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']])),
        rawSnapshot('2026-09-20T10:01:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
      ]),
      db,
      auxMetricsEnabled: false,
      historyTouchIntervalMs: 3600000,
      execFileImpl: async () => ({ stdout: '', stderr: '' }),
      spawnImpl: () => { throw eperm; },
    });
    await service.sample();
    const result = await service.performAction({
      processKey: { pid: 100, startedAt: '2026-09-20T09:00:00.000Z' },
      action: 'restart',
    });
    assert.equal(result.success, false);
    await service.sample();
    // The user killed the old process even though relaunch failed.
    assert.equal(db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z').terminated_by_user, 1);
    await service.stop();
  });

  it('keeps termination attribution on the correct lifecycle across PID reuse', async () => {
    const db = tempDb();
    const service = new ProcessService({
      collector: new FakeCollector([
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:00:00.000Z', [[100, '2026-09-20T09:00:00.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:01:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:02:00.000Z', [[100, '2026-09-20T10:01:30.000Z'], [999, '2026-09-20T09:00:00.000Z']]),
        rawSnapshot('2026-09-20T10:03:00.000Z', [[999, '2026-09-20T09:00:00.000Z']]),
      ]),
      db,
      auxMetricsEnabled: false,
      historyTouchIntervalMs: 3600000,
      execFileImpl: async () => ({ stdout: '', stderr: '' }),
    });
    await service.sample();
    const result = await service.performAction({
      processKey: { pid: 100, startedAt: '2026-09-20T09:00:00.000Z' },
      action: 'terminate',
    });
    assert.equal(result.success, true);
    await service.sample();
    await service.sample();
    await service.sample();
    assert.equal(db.getProcessHistoryRow('100@2026-09-20T09:00:00.000Z').terminated_by_user, 1);
    const reused = db.getProcessHistoryRow('100@2026-09-20T10:01:30.000Z');
    assert.equal(reused.exit_time, '2026-09-20T10:03:00.000Z');
    assert.equal(reused.terminated_by_user, 0);
    await service.stop();
  });
});

describe('process history IPC and UI surface', () => {
  it('registers a narrow validated history API in IPC and preload', () => {
    const ipcSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'process.js'), 'utf8');
    for (const channel of ['process:history:query', 'process:history:retention:get', 'process:history:retention:set', 'process:history:clear']) {
      assert.match(ipcSource, new RegExp(`ipcMain\\.handle\\('${channel}'`));
    }
    assert.match(ipcSource, /asObject\(filters, 'history query'\)/);
    const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
    for (const call of ['queryHistory', 'getHistoryRetention', 'setHistoryRetention', 'clearHistory']) {
      assert.match(preload, new RegExp(`\\b${call}\\b`));
    }
    assert.ok(!/process:history:[a-z:]*\$\{|`process:history/.test(ipcSource), 'no dynamic channel names');
  });

  it('renders Live/History views with escaped history rows and dialogs', () => {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'processes.js'), 'utf8');
    for (const id of ['data-view="live"', 'data-view="history"', '#phSearch', '#phRisk', '#phStatus', '#phRange', '#phRetention', '#phRefresh', '#phClear', '#phMore', '#phRows', '#phDetails']) {
      assert.ok(ui.includes(id), `missing history UI hook: ${id}`);
    }
    assert.match(ui, /window\.confirm\(this\.t\('processes\.historyClearConfirm'\)\)/);
    assert.match(ui, /queryHistory\(this\._historyFilters/);
    // Every history interpolation passes through esc().
    for (const snippet of ['this.esc(row.processName', 'this.esc(this._historyWhenText', 'this.esc(this._historyStatusText', 'this.esc(error.message']) {
      assert.ok(ui.includes(snippet), `unescaped history render: ${snippet}`);
    }
    // Risk pills carry real localized labels, never the no-concerns fallback.
    assert.match(ui, /'high-concern': this\.t\('processes\.statusHigh'\)/);
    assert.match(ui, /'review-recommended': this\.t\('processes\.statusReview'\)/);
    assert.match(ui, /unverified: this\.t\('processes\.statusUnverified'\)/);
    // History rows are keyboard-operable like live rows.
    assert.match(ui, /#phViewport'\)\.addEventListener\('keydown'/);
    assert.match(ui, /_handleHistoryKeyboard\(event\)/);
    // Stale in-flight responses are discarded; filter changes reload.
    assert.match(ui, /_historyRequestId/);
    assert.match(ui, /requestId !== this\._historyRequestId/);
    const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'css', 'style.css'), 'utf8');
    assert.match(styles, /\.pi-history\s*\{[\s\S]*flex-direction:\s*column;/);
    assert.match(styles, /\.pi-history\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  it('uses only localized strings for history UI', () => {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'processes.js'), 'utf8');
    const used = new Set([...ui.matchAll(/this\.t\('(processes\.[A-Za-z0-9]+)'/g)].map((match) => match[1]));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', 'en.json'), 'utf8'));
    const missing = [...used].filter((key) => !(key in en));
    assert.deepEqual(missing, []);
    const historyKeys = [...used].filter((key) => key.startsWith('processes.history') || key.startsWith('processes.retention'));
    assert.ok(historyKeys.length >= 30, `expected history i18n keys, found ${historyKeys.length}`);
  });

  it('never labels an unknown exit as running', () => {
    const locales = fs.readdirSync(path.join(__dirname, '..', 'src', 'i18n', 'locales')).filter((file) => file.endsWith('.json'));
    assert.ok(locales.length >= 15);
    for (const file of locales) {
      const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', file), 'utf8'));
      assert.equal(strings['processes.historyStatusActive'], 'Exit unknown', file);
    }
    const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'processes.js'), 'utf8');
    // "Running now" is only reachable behind an independent live-identity check.
    assert.match(ui, /if \(row\.processKey && this\._processes\.has\(row\.processKey\)\) return this\.t\('processes\.historyRunningNow'\)/);
    // Exit-unknown rows are explicitly marked as such in both row modes.
    assert.ok((ui.match(/historyUnknownExit/g) || []).length >= 2);
  });
});
