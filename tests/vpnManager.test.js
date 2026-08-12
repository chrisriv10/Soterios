'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VpnManager } = require('../src/main/vpnManager');

function fakeRun(handler) {
  let calls = [];
  const run = async (command, timeoutMs) => {
    calls.push({ command, timeoutMs });
    return handler(command, timeoutMs);
  };
  run.calls = calls;
  return run;
}

describe('vpnManager - list', () => {
  it('parses a single VPN profile', async () => {
    const run = fakeRun(() => ({
      stdout: JSON.stringify([{ Name: 'Work VPN', ConnectionStatus: 'Disconnected', ServerAddress: 'vpn.example.com', TunnelType: 'IKEv2' }]),
    }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.list();
    assert.equal(result.ok, true);
    assert.equal(result.vpns.length, 1);
    assert.equal(result.vpns[0].name, 'Work VPN');
    assert.equal(result.vpns[0].connected, false);
    assert.equal(result.vpns[0].serverAddress, 'vpn.example.com');
  });

  it('flags a connected profile', async () => {
    const run = fakeRun(() => ({
      stdout: JSON.stringify([{ Name: 'Home VPN', ConnectionStatus: 'Connected', ServerAddress: 'home.vpn', TunnelType: 'SSTP' }]),
    }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.list();
    assert.equal(result.ok, true);
    assert.equal(result.vpns[0].connected, true);
  });

  it('returns an empty list when no profiles exist', async () => {
    const run = fakeRun(() => ({ stdout: '[]' }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.list();
    assert.equal(result.ok, true);
    assert.deepEqual(result.vpns, []);
  });

  it('reports a parse failure as an error', async () => {
    const run = fakeRun(() => ({ stdout: 'not json at all' }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.list();
    assert.equal(result.ok, false);
    assert.match(result.error, /Unexpected response/);
  });

  it('reports a powershell failure as an error', async () => {
    const run = fakeRun(() => { throw new Error('command not found'); });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.list();
    assert.equal(result.ok, false);
    assert.match(result.error, /Could not enumerate/);
    assert.match(result.error, /command not found/);
  });

  it('caches results within the TTL and bypasses with force', async () => {
    let count = 0;
    const run = fakeRun(() => {
      count += 1;
      return { stdout: '[]' };
    });
    const manager = new VpnManager({ runPowerShell: run });
    await manager.list();
    await manager.list();
    assert.equal(count, 1);
    await manager.list(true);
    assert.equal(count, 2);
  });
});

describe('vpnManager - connect', () => {
  it('connects when Start-VpnConnection reports OK', async () => {
    const run = fakeRun(() => ({ stdout: 'OK' }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.connect('Work VPN');
    assert.equal(result.ok, true);
    assert.match(run.calls[0].command, /Start-VpnConnection -Name 'Work VPN'/);
  });

  it('falls back to rasdial when the cmdlet fails', async () => {
    let callIndex = 0;
    const run = fakeRun(() => {
      callIndex += 1;
      if (callIndex === 1) return { stdout: 'FAIL|No such connection' };
      return { stdout: 'Command completed successfully.' };
    });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.connect('Office VPN');
    assert.equal(result.ok, true);
    assert.match(run.calls[1].command, /rasdial 'Office VPN'/);
  });

  it('reports failure when both methods fail', async () => {
    let callIndex = 0;
    const run = fakeRun(() => {
      callIndex += 1;
      if (callIndex === 1) return { stdout: 'FAIL|Access denied' };
      const err = new Error('rasdial exited with an error');
      err.code = 691;
      throw err;
    });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.connect('Office VPN');
    assert.equal(result.ok, false);
    assert.match(result.error, /Office VPN/);
    assert.match(result.error, /Access denied/);
  });

  it('falls back to rasdial when the cmdlet throws entirely', async () => {
    let callIndex = 0;
    const run = fakeRun(() => {
      callIndex += 1;
      if (callIndex === 1) throw new Error('timeout');
      const err = new Error('rasdial failed');
      err.code = 691;
      throw err;
    });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.connect('Legacy VPN');
    assert.equal(result.ok, false);
    assert.match(result.error, /Legacy VPN/);
    assert.match(result.error, /timeout/);
    assert.equal(callIndex, 2);
  });

  it('rejects an empty name', async () => {
    const manager = new VpnManager({ runPowerShell: fakeRun(() => ({ stdout: '' })) });
    const result = await manager.connect('   ');
    assert.equal(result.ok, false);
    assert.match(result.error, /No VPN selected/);
  });

  it('escapes single quotes in profile names', async () => {
    const run = fakeRun(() => ({ stdout: 'OK' }));
    const manager = new VpnManager({ runPowerShell: run });
    await manager.connect("Bob's VPN");
    assert.match(run.calls[0].command, /-Name 'Bob''s VPN'/);
  });
});

describe('vpnManager - disconnect', () => {
  it('disconnects via Stop-VpnConnection', async () => {
    const run = fakeRun(() => ({ stdout: 'OK' }));
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.disconnect('Work VPN');
    assert.equal(result.ok, true);
    assert.match(run.calls[0].command, /Stop-VpnConnection -Name 'Work VPN'/);
  });

  it('falls back to rasdial when the cmdlet fails', async () => {
    let callIndex = 0;
    const run = fakeRun(() => {
      callIndex += 1;
      if (callIndex === 1) return { stdout: 'FAIL|Not connected' };
      return { stdout: 'Command completed successfully.' };
    });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.disconnect('Office VPN');
    assert.equal(result.ok, true);
    assert.match(run.calls[1].command, /rasdial 'Office VPN' \/d/);
  });

  it('reports failure when both methods fail', async () => {
    let callIndex = 0;
    const run = fakeRun(() => {
      callIndex += 1;
      if (callIndex === 1) return { stdout: 'FAIL|boom' };
      throw new Error('rasdial failed');
    });
    const manager = new VpnManager({ runPowerShell: run });
    const result = await manager.disconnect('Office VPN');
    assert.equal(result.ok, false);
    assert.match(result.error, /Office VPN/);
  });

  it('rejects missing parameters for addFromProvider', async () => {
    const manager = new VpnManager({ runPowerShell: fakeRun(() => ({ stdout: '' })) });
    
    const result1 = await manager.addFromProvider('', 'server1', 'user', 'pass');
    assert.equal(result1.ok, false);
    assert.match(result1.error, /Missing required parameters/);
    
    const result2 = await manager.addFromProvider('provider', '', 'user', 'pass');
    assert.equal(result2.ok, false);
    
    const result3 = await manager.addFromProvider('provider', 'server', '', 'pass');
    assert.equal(result3.ok, false);
    
    const result4 = await manager.addFromProvider('provider', 'server', 'user', '');
    assert.equal(result4.ok, false);
  });
});
