'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  HISTORY_WINDOW_MS,
  ProcessService,
  processKeyString,
  validateProcessKey,
} = require('../src/main/processService');

class FakeCollector {
  constructor(samples) {
    this.samples = samples;
    this.index = 0;
    this.capabilities = { provider: 'test', intervalFloorMs: 500, details: true };
  }

  async start() {}
  async stop() {}

  async sample() {
    const sample = this.samples[Math.min(this.index, this.samples.length - 1)];
    this.index += 1;
    return structuredClone(sample);
  }

  async getDetails(_key, sections) {
    return { sections: Object.fromEntries(sections.map((name) => [name, { available: true }])), capabilityErrors: {} };
  }
}

function snapshot(at, processes) {
  return {
    protocolVersion: 1,
    collectedAt: at,
    capabilities: { provider: 'test', intervalFloorMs: 500 },
    totals: {
      cpuPercent: 12,
      memoryPercent: 34,
      diskReadBytesPerSec: null,
      diskWriteBytesPerSec: null,
      networkReceiveBytesPerSec: null,
      networkSendBytesPerSec: null,
    },
    processes,
  };
}

function proc(pid, startedAt, overrides = {}) {
  return {
    pid,
    ppid: 4,
    startedAt,
    name: `fixture-${pid}.exe`,
    path: `C:\\Program Files\\Fixture\\fixture-${pid}.exe`,
    commandLine: `fixture-${pid}.exe`,
    cpu: 1,
    memoryPercent: 2,
    workingSetBytes: 4096,
    diskReadBytesPerSec: null,
    diskWriteBytesPerSec: null,
    networkReceiveBytesPerSec: null,
    networkSendBytesPerSec: null,
    ...overrides,
  };
}

describe('ProcessService snapshots and deltas', () => {
  it('uses PID plus creation time as the stable identity and retains RAM-only history', async () => {
    const startedAt = '2026-08-15T12:00:00.000Z';
    const service = new ProcessService({
      collector: new FakeCollector([
        snapshot('2026-08-15T12:00:01.000Z', [proc(401, startedAt)]),
        snapshot('2026-08-15T12:00:02.000Z', [proc(401, startedAt, { cpu: 7 })]),
      ]),
    });

    await service.sample();
    await service.sample();
    const current = service.snapshot.processes[0];
    const history = service.histories.get(processKeyString(current.key));

    assert.deepEqual(current.key, { pid: 401, startedAt });
    assert.equal(history.length, 2);
    assert.equal(history[1].cpu, 7);
    assert.equal(service.getStatus().historyWindowMs, HISTORY_WINDOW_MS);
    assert.equal(service.snapshot.totalDiskIO, null, 'unavailable counters are never presented as zero');
    const diagnostics = service.getDiagnosticBundle();
    assert.equal(diagnostics.privacy.includesProcesses, false);
    assert.equal(diagnostics.performance.sampleCount, 2);
    assert.equal(JSON.stringify(diagnostics).includes('fixture-401.exe'), false);
    await service.stop();
  });

  it('emits compact upserts, starts, and exits rather than rebuilding the list', async () => {
    const firstStart = '2026-08-15T12:00:00.000Z';
    const reusedStart = '2026-08-15T12:00:05.000Z';
    const service = new ProcessService({
      collector: new FakeCollector([
        snapshot('2026-08-15T12:00:01.000Z', [proc(501, firstStart), proc(502, firstStart)]),
        snapshot('2026-08-15T12:00:06.000Z', [proc(501, reusedStart), proc(503, reusedStart)]),
      ]),
    });
    const deltas = [];
    service.on('delta', (delta) => deltas.push(delta));

    await service.sample();
    await service.sample();
    const delta = deltas[1];

    assert.equal(delta.started.length, 2, 'PID reuse is a new process identity');
    assert.equal(delta.exited.length, 2);
    assert.equal(delta.upserts.length, 2);
    assert.equal(delta.removed.length, 2);
    await service.stop();
  });

  it('delivers a full snapshot once when a renderer subscribes', async () => {
    const service = new ProcessService({
      collector: new FakeCollector([snapshot('2026-08-15T12:00:01.000Z', [proc(601, 'start-601')])]),
    });
    const sender = new EventEmitter();
    sender.id = 9;
    sender.isDestroyed = () => false;
    const sent = [];
    sender.send = (channel, payload) => sent.push({ channel, payload });

    const status = await service.startSubscription(sender, { intervalMs: 1000 });

    assert.equal(status.intervalMs, 1000);
    assert.equal(sent.filter((item) => item.channel === 'process:fullSnapshot').length, 1);
    assert.equal(sent[0].payload.processes[0].pid, 601);
    service.stopSubscription(sender);
    await service.stop();
  });

  it('rejects stale ProcessKeys before an action can target a reused PID', async () => {
    const originalStart = '2026-08-15T12:00:00.000Z';
    const service = new ProcessService({
      collector: new FakeCollector([
        snapshot('2026-08-15T12:00:01.000Z', [proc(701, originalStart)]),
        snapshot('2026-08-15T12:00:02.000Z', [proc(701, '2026-08-15T12:00:02.000Z')]),
      ]),
    });
    await service.sample();

    await assert.rejects(
      service.performAction({ processKey: { pid: 701, startedAt: originalStart }, action: 'terminate' }),
      /PID has been reused/i,
    );
    await service.stop();
  });

  it('validates renderer-supplied process identities and structured task requests', async () => {
    assert.throws(() => validateProcessKey({ pid: -1, startedAt: 'x' }), /Invalid process ID/);
    assert.throws(() => validateProcessKey({ pid: 10, startedAt: 'x'.repeat(81) }), /Invalid process start time/);

    const service = new ProcessService({ collector: new FakeCollector([snapshot(new Date().toISOString(), [])]) });
    await assert.rejects(service.runTask('calc.exe'), /structured executable request/i);
    await assert.rejects(service.runTask({ executable: 'calc.exe' }), /absolute path/i);
    await service.stop();
  });
});
