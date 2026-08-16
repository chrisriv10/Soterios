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
});

