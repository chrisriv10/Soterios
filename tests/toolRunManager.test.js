'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ToolRunManager = require('../src/main/toolRunManager');

function fakeDb() {
  const rows = [];
  return {
    rows,
    startToolRun(row) { rows.push({ ...row, status: 'running' }); },
    finishToolRun(row) { Object.assign(rows.find((item) => item.runId === row.runId), row); },
    getToolHistory() { return rows; }
  };
}

describe('ToolRunManager', () => {
  it('starts immediately, forwards monotonic progress, and persists completion', async () => {
    const db = fakeDb();
    const registry = {
      async run(_id, _args, ctx) {
        ctx.sendProgress({ phase: 'indexing', pct: 40, count: 4 });
        ctx.sendProgress({ phase: 'indexing', pct: 20, count: 5 });
        return { ok: true, data: { count: 5 } };
      }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    const progress = [];
    manager.on('progress', (event) => progress.push(event));
    const started = manager.start('run-script', { scriptId: 'fixture-tool' });
    assert.equal(started.toolId, 'fixture-tool');
    const completion = await manager.wait(started.runId);
    assert.equal(completion.status, 'completed');
    assert.equal(completion.result.count, 5);
    assert.deepEqual(progress.filter((event) => event.phase === 'indexing').map((event) => event.pct), [40, 40]);
    assert.equal(db.rows[0].status, 'completed');
    assert.equal(manager.getActive().length, 0);
  });

  it('cancels an active run through AbortSignal', async () => {
    const db = fakeDb();
    const registry = {
      run(_id, _args, ctx) {
        return new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => resolve({ ok: false, error: 'Task canceled' }), { once: true });
        });
      }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    const started = manager.start('run-script', { scriptId: 'slow-tool' });
    assert.equal(manager.cancel(started.runId), true);
    const completion = await manager.wait(started.runId);
    assert.equal(completion.status, 'canceled');
    assert.equal(db.rows[0].status, 'canceled');
  });

  it('settles cleanly when history persistence fails during finish', async () => {
    // Simulates teardown with a closing database: finishToolRun throws after
    // the tool itself completed. The completion must still resolve (and the
    // run must leave the active set) instead of escaping as a rejection.
    const db = fakeDb();
    db.finishToolRun = () => { throw new Error('database is closed'); };
    const registry = {
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true, data: { count: 1 } };
      }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    const started = manager.start('run-script', { scriptId: 'slow-tool' });
    const completion = await manager.wait(started.runId);
    assert.equal(completion.status, 'completed');
    assert.equal(completion.result.count, 1);
    assert.equal(manager.getActive().length, 0);
  });

  it('shutdown cancels active runs and never hangs on uncooperative tools', async () => {
    const db = fakeDb();
    const registry = {
      run() { return new Promise(() => {}); }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    const started = manager.start('run-script', { scriptId: 'stuck-tool' });
    // Let the tool invocation actually get going: shutting down on the same
    // tick would win the race before the tool starts (also fine), which does
    // not exercise the mid-flight path this test targets.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.getActive().length, 1);
    const before = Date.now();
    const outcome = await manager.shutdown(50);
    const elapsed = Date.now() - before;
    assert.equal(outcome.settled, false);
    assert.equal(outcome.pending, 1);
    assert.equal(manager.getActive().length, 1);
    assert.ok(elapsed < 5000, `shutdown took ${elapsed}ms`);
    const empty = await new ToolRunManager({ db, toolRegistry: registry }).shutdown(10);
    assert.deepEqual(empty, { settled: true, pending: 0 });
  });

  it('refuses new runs once shutdown begins', async () => {
    const db = fakeDb();
    const registry = {
      async run() { return { ok: true, data: {} }; }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    await manager.shutdown(10);
    assert.throws(() => manager.start('run-script', { scriptId: 'late-tool' }), /shutdown/);
    assert.equal(manager.getActive().length, 0);
  });

  it('late completions after shutdown do not touch persistence', async () => {
    const writes = [];
    const db = fakeDb();
    db.finishToolRun = (row) => { writes.push(row.status); };
    let release;
    const registry = {
      run() { return new Promise((resolve) => { release = () => resolve({ ok: true, data: { count: 2 } }); }); }
    };
    const manager = new ToolRunManager({ db, toolRegistry: registry });
    const started = manager.start('run-script', { scriptId: 'slow-tool' });
    await new Promise((resolve) => setImmediate(resolve));
    const outcome = await manager.shutdown(30);
    assert.equal(outcome.settled, false);
    // Capture the completion promise before releasing: wait() after settle
    // returns null by design, since finished runs leave the active set.
    const pendingCompletion = manager.wait(started.runId);
    release();
    const completion = await pendingCompletion;
    // The run was aborted during shutdown, so even though the tool ignored
    // the signal and answered, the settlement is honestly labeled canceled.
    assert.equal(completion.status, 'canceled');
    assert.match(completion.error || '', /cancel/i);
    assert.deepEqual(writes, []);
    assert.equal(manager.getActive().length, 0);
  });
});

