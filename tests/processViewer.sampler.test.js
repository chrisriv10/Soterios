'use strict';

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const PROCESS_VIEWER = path.join(__dirname, '..', 'src', 'tools', 'processViewer.js');

test('processViewer maps IO rates by PID from the PS1 sampler output', async (t) => {
  const si = require('systeminformation');
  const cp = require('child_process');

  const realExec = cp.exec;
  let execCallCount = 0;
  // PS1 emits "pid|name|readBytesPerSec|writeBytesPerSec|otherBytesPerSec"
  const ioStdout = [
    '100|procA|5000|7000|300',
    '101|procB#1|1000|2000|50',
    '102|procB#2|2000|4000|100',
    '103|chrome|9000|1000|100000'
  ].join('\n');
  cp.exec = (cmd, opts, cb) => {
    execCallCount++;
    cb(null, { stdout: ioStdout, stderr: '' });
  };

  const realProcesses = si.processes;
  const realCurrentLoad = si.currentLoad;
  const realMem = si.mem;
  si.processes = async () => ({
    list: [
      { pid: 100, name: 'procA', path: 'C:\\procA.exe', command: 'procA', cpu: 1, mem: 2 },
      { pid: 101, name: 'procB.exe', path: 'C:\\procB.exe', command: 'procB', cpu: 0.5, mem: 1 },
      { pid: 102, name: 'procB.exe', path: 'C:\\procB.exe', command: 'procB', cpu: 0.5, mem: 1 }
    ]
  });
  si.currentLoad = async () => ({ currentLoad: 12 });
  si.mem = async () => ({ total: 1000, available: 500 });

  // Re-require so the module captures the mocked exec
  delete require.cache[PROCESS_VIEWER];
  const viewer = require(PROCESS_VIEWER);

  try {
    const result = await viewer.run({}, {});
    assert.ok(execCallCount >= 1, 'PS1 sampler should be invoked');

    // Each PID gets its own exact numbers - procB instances are NOT summed.
    const byPid = new Map(result.processes.map((p) => [p.pid, p]));
    assert.ok(byPid.has(100), 'procA present');
    assert.ok(byPid.has(101), 'procB#1 present');
    assert.ok(byPid.has(102), 'procB#2 present');

    // diskIo = read + write, networkIo = other
    assert.strictEqual(byPid.get(100).diskIo, 12000, 'diskIo = read + write');
    assert.strictEqual(byPid.get(100).networkIo, 300, 'networkIo = other');
    assert.strictEqual(byPid.get(101).diskIo, 3000);
    assert.strictEqual(byPid.get(102).diskIo, 6000, 'same-name processes keep separate totals');
    assert.strictEqual(byPid.get(102).networkIo, 100);

    // Totals should reflect every sampled process once.
    assert.strictEqual(result.totalDiskIO, Math.min(100, 31000 / (1024 * 1024)));
    assert.strictEqual(result.totalNetworkIO, Math.min(100, 100450 / (1024 * 1024)));
  } finally {
    cp.exec = realExec;
    si.processes = realProcesses;
    si.currentLoad = realCurrentLoad;
    si.mem = realMem;
    delete require.cache[PROCESS_VIEWER];
  }
});

test('processViewer falls back to empty IO maps when the sampler fails', async (t) => {
  const si = require('systeminformation');
  const cp = require('child_process');

  const realExec = cp.exec;
  cp.exec = (cmd, opts, cb) => {
    const err = new Error('powershell failed');
    err.killed = false;
    cb(err, { stdout: '', stderr: 'boom' });
  };

  const realProcesses = si.processes;
  const realCurrentLoad = si.currentLoad;
  const realMem = si.mem;
  si.processes = async () => ({
    list: [{ pid: 100, name: 'procA', path: 'C:\\procA.exe', command: 'procA', cpu: 1, mem: 2 }]
  });
  si.currentLoad = async () => ({ currentLoad: 12 });
  si.mem = async () => ({ total: 1000, available: 500 });

  delete require.cache[PROCESS_VIEWER];
  const viewer = require(PROCESS_VIEWER);

  try {
    const result = await viewer.run({}, {});
    assert.strictEqual(result.processes[0].diskIo, 0, 'missing IO degrades to 0, does not throw');
    assert.strictEqual(result.processes[0].networkIo, 0);
    assert.strictEqual(result.totalDiskIO, 0);
  } finally {
    cp.exec = realExec;
    si.processes = realProcesses;
    si.currentLoad = realCurrentLoad;
    si.mem = realMem;
    delete require.cache[PROCESS_VIEWER];
  }
});

test('processViewer returns within the hash budget and marks only completed hashes', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const si = require('systeminformation');
  const cp = require('child_process');

  const hashUtilsPath = path.join(__dirname, '..', 'src', 'security', 'hashUtils.js');
  const realHashUtils = require(hashUtilsPath);
  const realCacheEntry = require.cache[hashUtilsPath];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-budget-'));
  const paths = [];
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, `p${i}.exe`);
    fs.writeFileSync(p, crypto.randomBytes(64));
    paths.push(p);
  }

  const realExec = cp.exec;
  cp.exec = (cmd, opts, cb) => {
    const err = new Error('sampler disabled');
    err.killed = false;
    cb(err, { stdout: '', stderr: '' });
  };

  const realProcesses = si.processes;
  const realCurrentLoad = si.currentLoad;
  const realMem = si.mem;
  si.processes = async () => ({
    list: paths.map((p, i) => ({ pid: 100 + i, name: `p${i}.exe`, path: p, command: `p${i}`, cpu: 1, mem: 2 }))
  });
  si.currentLoad = async () => ({ currentLoad: 12 });
  si.mem = async () => ({ total: 1000, available: 500 });

  // Simulate a slow cold-cache hash pass: each file takes 120ms but the
  // budget is 40ms, so the tool must return promptly with a partial set.
  process.env.SOTERIOS_PROCESS_HASH_BUDGET_MS = '40';
  require.cache[hashUtilsPath] = {
    exports: {
      ...realHashUtils,
      hashFileStreaming: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return 'deadbeef';
      }
    }
  };
  delete require.cache[PROCESS_VIEWER];
  const viewer = require(PROCESS_VIEWER);
  const context = { db: { getTrustedHashes: () => [{ hash: 'deadbeef' }] } };

  const started = Date.now();
  try {
    const result = await viewer.run({}, context);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `tool returned promptly within budget (${elapsed}ms)`);
    assert.strictEqual(result.processes.length, 12);
    const trustedCount = result.processes.filter((p) => p.trusted).length;
    assert.ok(trustedCount > 0 && trustedCount < 12,
      `partial hashing within budget (${trustedCount}/12 trusted)`);
  } finally {
    delete process.env.SOTERIOS_PROCESS_HASH_BUDGET_MS;
    if (realCacheEntry) require.cache[hashUtilsPath] = realCacheEntry;
    else delete require.cache[hashUtilsPath];
    cp.exec = realExec;
    si.processes = realProcesses;
    si.currentLoad = realCurrentLoad;
    si.mem = realMem;
    delete require.cache[PROCESS_VIEWER];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('processViewer marks trusted processes (matching hash) with risk 0', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const si = require('systeminformation');
  const cp = require('child_process');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-trust-'));
  const exePath = path.join(dir, 'trusted.exe');
  fs.writeFileSync(exePath, crypto.randomBytes(4096));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');

  const realExec = cp.exec;
  cp.exec = (cmd, opts, cb) => {
    const err = new Error('sampler disabled');
    err.killed = false;
    cb(err, { stdout: '', stderr: '' });
  };

  const realProcesses = si.processes;
  const realCurrentLoad = si.currentLoad;
  const realMem = si.mem;
  si.processes = async () => ({
    list: [
      { pid: 100, name: 'trusted.exe', path: exePath, command: 'trusted', cpu: 1, mem: 2 },
      { pid: 101, name: 'other.exe', path: 'C:\\other.exe', command: 'other', cpu: 1, mem: 2 }
    ]
  });
  si.currentLoad = async () => ({ currentLoad: 12 });
  si.mem = async () => ({ total: 1000, available: 500 });

  delete require.cache[PROCESS_VIEWER];
  const viewer = require(PROCESS_VIEWER);
  const context = { db: { getTrustedHashes: () => [{ hash }] } };

  try {
    const result = await viewer.run({}, context);
    const byPid = new Map(result.processes.map((p) => [p.pid, p]));

    const trusted = byPid.get(100);
    assert.strictEqual(trusted.trusted, true, 'matching hash marks process trusted');
    assert.strictEqual(trusted.hash, hash);
    assert.strictEqual(trusted.risk.score, 0, 'trusted process gets risk 0');
    assert.strictEqual(trusted.risk.level, 'none');

    const other = byPid.get(101);
    assert.strictEqual(other.trusted, false, 'missing executable is not trusted');
  } finally {
    cp.exec = realExec;
    si.processes = realProcesses;
    si.currentLoad = realCurrentLoad;
    si.mem = realMem;
    delete require.cache[PROCESS_VIEWER];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
