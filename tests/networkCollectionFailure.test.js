'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const read = file => process.env.SOTERIOS_TEST_BASE
  ? execFileSync('git', ['show', `${process.env.SOTERIOS_TEST_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');

function monitorHarness() {
  let now = 100000, fail = false, interfacesFail = false, rows = [{ State: 'Established', RemoteAddress: '203.0.113.1' }], calls = 0;
  const sandbox = { module: { exports: {} }, process: { env: {} }, Date: { now: () => now },
    require(name) {
      if (name === '../utils/logger') return { info() {}, warn() {}, error() {} };
      if (name === 'systeminformation') return { networkStats: async () => { if (interfacesFail) throw new Error('interfaces denied'); return []; } };
      if (name === 'util') return { promisify: fn => fn };
      if (name === 'child_process') return { execFile: async (_exe, args) => {
        calls++; if (fail) throw new Error('collector denied');
        return { stdout: args.join(' ').includes('$conns =') ? '0|0|0|0|0' : JSON.stringify(rows) };
      } };
      throw new Error(name);
    },
  };
  vm.runInNewContext(read('src/security/NetworkMonitor.js'), sandbox);
  return { monitor: new sandbox.module.exports(), advance: () => { now += 6000; }, fail: () => { fail = true; }, recover: () => { fail = false; }, empty: () => { rows = []; }, failInterfaces: () => { interfacesFail = true; }, calls: () => calls };
}

describe('network collection failures', () => {
  it('uses fresh cache but rejects expired-cache failures instead of returning stale rows', async () => {
    const h = monitorHarness();
    const first = await h.monitor.getConnections();
    assert.equal(first.length, 1);
    assert.equal(await h.monitor.getConnections(), first); assert.equal(h.calls(), 1);
    h.advance(); h.fail();
    await assert.rejects(h.monitor.getConnections(), /collector denied/);
    await assert.rejects(h.monitor.getConnections(), /collector denied/);
    h.recover(); h.empty();
    assert.equal((await h.monitor.getConnections()).length, 0);
  });
  it('rejects collection failure without any cache', async () => {
    const h = monitorHarness(); h.fail();
    await assert.rejects(h.monitor.getConnections(), /collector denied/);
  });
  it('does not invent zero connection counts on failed collection or cooldown', async () => {
    const h = monitorHarness(); h.fail();
    assert.equal((await h.monitor.getStats()).connections, null);
    assert.equal((await h.monitor.getStats()).connections, null);
  });
  it('preserves successful empty statistics and propagates interface failure', async () => {
    const h = monitorHarness();
    assert.equal((await h.monitor.getStats()).connections.total, 0);
    h.failInterfaces(); await assert.rejects(h.monitor.getStats(), /interfaces denied/);
  });
});

describe('firewall status collection', () => {
  it('propagates collection and malformed-output failures rather than returning an empty success', async () => {
    const sandbox = { module: { exports: {} }, require: name => name === '../utils/logger' ? { error() {} } : require(name) };
    vm.runInNewContext(read('src/security/FirewallManager.js'), sandbox);
    const manager = new sandbox.module.exports();
    manager.runPowerShell = async () => { throw new Error('Access is denied'); };
    await assert.rejects(manager.getStatus(), /Access denied/);
    manager.runPowerShell = async () => 'invalid JSON';
    await assert.rejects(manager.getStatus(), /Could not read firewall status/);
    manager.runPowerShell = async () => '[]';
    assert.equal((await manager.getStatus()).length, 0);
  });
});
