'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const path = require('path');

const {
  HISTORY_WINDOW_MS,
  ProcessService,
  processKeyString,
  spawnDetachedVerified,
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

function fakeChild(emitSpawn = true) {
  const child = new EventEmitter();
  child.unrefCalled = false;
  child.unref = () => {
    child.unrefCalled = true;
  };
  if (emitSpawn) queueMicrotask(() => child.emit('spawn'));
  return child;
}

function decodeEncodedPowerShell(args) {
  const index = args.indexOf('-EncodedCommand');
  return Buffer.from(args[index + 1], 'base64').toString('utf16le');
}

describe('spawnDetachedVerified', () => {
  it('resolves only after the child emits spawn, then unrefs it', async () => {
    const calls = [];
    const spawnImpl = (file, args, options) => {
      calls.push({ file, args, options });
      return fakeChild();
    };

    const child = await spawnDetachedVerified('C:\\app.exe', ['--flag'], { cwd: 'C:\\' }, spawnImpl);

    assert.equal(child.unrefCalled, true);
    assert.equal(calls[0].file, 'C:\\app.exe');
    assert.deepEqual(calls[0].args, ['--flag']);
    assert.equal(calls[0].options.detached, true);
    assert.equal(calls[0].options.stdio, 'ignore');
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.cwd, 'C:\\');
  });

  it('rejects when the child emits an error', async () => {
    await assert.rejects(
      spawnDetachedVerified('C:\\app.exe', [], {}, () => {
        const child = fakeChild(false);
        queueMicrotask(() => child.emit('error', Object.assign(new Error('launch denied'), { code: 'EPERM' })));
        return child;
      }),
      (error) => error.code === 'EPERM',
    );
  });

  it('rejects when spawn throws synchronously', async () => {
    await assert.rejects(
      spawnDetachedVerified('C:\\app.exe', [], {}, () => {
        throw new Error('boom');
      }),
      /boom/,
    );
  });
});

describe('process affinity and priority actions', () => {
  function makeService(execFileImpl) {
    return new ProcessService({
      collector: new FakeCollector([snapshot(new Date().toISOString(), [proc(401, 'start-401')])]),
      execFileImpl,
    });
  }

  it('rejects invalid affinity masks before invoking PowerShell', async () => {
    const service = makeService(async () => {
      throw new Error('must not be called');
    });
    for (const bad of [0, -1, 1.5, NaN, 'abc', '12x', '', '0', '18446744073709551616', null, undefined]) {
      await assert.rejects(service._setAffinity(401, bad), /Invalid processor affinity mask/);
    }
    await service.stop();
  });

  it('interpolates only decimal digits into the affinity PowerShell script', async () => {
    let script = '';
    const service = makeService(async (_file, args) => {
      script = decodeEncodedPowerShell(args);
      return { stdout: '' };
    });

    await service._setAffinity(401, '9223372036854775808');

    assert.match(script, /\$p = Get-Process -Id 401 -ErrorAction Stop/);
    const maskRegion = script.match(/\[uint64\]([^\s;)]+)/)[1];
    assert.equal(maskRegion, '9223372036854775808');
    assert.match(maskRegion, /^\d+$/);
    assert.match(script, /\[BitConverter\]::GetBytes\(\$mask\)/);
    assert.match(script, /\[System\.IntPtr\]::new\(\[BitConverter\]::ToInt64\(\$maskBytes, 0\)\)/);
    await service.stop();
  });

  it('returns an actionable error when Windows rejects an affinity change', async () => {
    const service = makeService(async () => {
      throw new Error('Cannot convert the "255" value of type "System.UInt64" to type "System.IntPtr".');
    });

    await assert.rejects(
      service._setAffinity(401, 3),
      /could not apply this CPU affinity selection.*selected CPUs may be unavailable/i,
    );
    await service.stop();
  });

  it('returns the echoed mask or falls back to the requested one', async () => {
    const echoed = makeService(async () => ({ stdout: '3' }));
    assert.deepEqual(await echoed._setAffinity(401, 3), { success: true, effectiveAffinityMask: '3' });
    await echoed.stop();

    const fallback = makeService(async () => ({ stdout: '' }));
    assert.deepEqual(await fallback._setAffinity(401, 3), { success: true, effectiveAffinityMask: '3' });
    await fallback.stop();
  });

  it('validates priority against the allowlist and echoes the effective class', async () => {
    const service = makeService(async (_file, args) => {
      assert.match(decodeEncodedPowerShell(args), /\$p\.PriorityClass = 'High'/);
      return { stdout: 'High' };
    });
    assert.deepEqual(await service._setPriority(401, 'High'), { success: true, effectivePriority: 'High' });
    await assert.rejects(service._setPriority(401, 'max'), /Invalid priority class/);
    await service.stop();

    const fallback = makeService(async () => ({ stdout: '' }));
    assert.deepEqual(await fallback._setPriority(401, 'Normal'), { success: true, effectivePriority: 'Normal' });
    await fallback.stop();
  });

  it('dispatches setPriority with renderer-supplied options through performAction', async () => {
    const service = new ProcessService({
      collector: new FakeCollector([snapshot('2026-08-15T12:00:01.000Z', [proc(401, 'start-401')])]),
      execFileImpl: async () => ({ stdout: 'High' }),
    });

    const result = await service.performAction({
      processKey: { pid: 401, startedAt: 'start-401' },
      action: 'setPriority',
      options: { priority: 'High' },
    });

    assert.deepEqual(result, { success: true, effectivePriority: 'High' });
    await service.stop();
  });
});

describe('process restart relaunch', () => {
  const startedAt = '2026-08-15T12:00:01.000Z';

  function makeService({ targetPath, spawnImpl }) {
    return new ProcessService({
      collector: new FakeCollector([snapshot('2026-08-15T12:00:02.000Z', [proc(401, startedAt, { path: targetPath })])]),
      execFileImpl: async () => ({ stdout: '' }),
      spawnImpl,
    });
  }

  it('terminates then relaunches the resolved executable in its own directory', async () => {
    const calls = [];
    const service = makeService({
      targetPath: __filename,
      spawnImpl: (file, args, options) => {
        calls.push({ file, args, options });
        return fakeChild();
      },
    });

    const result = await service.performAction({ processKey: { pid: 401, startedAt }, action: 'restart' });

    assert.deepEqual(result, { success: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, __filename);
    assert.deepEqual(calls[0].args, []);
    assert.equal(calls[0].options.cwd, path.dirname(__filename));
    await service.stop();
  });

  it('surfaces a friendly error when Windows denies the relaunch', async () => {
    const service = makeService({
      targetPath: __filename,
      spawnImpl: () => {
        const child = fakeChild(false);
        queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })));
        return child;
      },
    });

    const result = await service.performAction({ processKey: { pid: 401, startedAt }, action: 'restart' });

    assert.equal(result.success, false);
    assert.match(result.error, /denied relaunching this process/);
    await service.stop();
  });

  it('refuses to restart when the executable path is unavailable', async () => {
    const calls = [];
    const service = makeService({
      targetPath: 'C:\\missing\\fixture-401.exe',
      spawnImpl: (file, args, options) => {
        calls.push({ file, args, options });
        return fakeChild();
      },
    });

    const result = await service.performAction({ processKey: { pid: 401, startedAt }, action: 'restart' });

    assert.equal(result.success, false);
    assert.match(result.error, /Executable path is unavailable/);
    assert.equal(calls.length, 0);
    await service.stop();
  });
});
