'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const FirewallManager = require('../src/security/FirewallManager');

class FakeFirewallManager extends FirewallManager {
  constructor(existing = []) {
    super();
    this._existing = existing.map((r) => ({ ...r }));
    this.deleted = [];
    this.created = [];
  }

  async listRules() {
    return this._existing.slice();
  }

  async createRule(spec) {
    const name = spec.name.startsWith('Soterios - ') ? spec.name : `Soterios - ${spec.name}`;
    if (this._existing.some((r) => r.name === name)) {
      throw new Error('already exists');
    }
    const rule = {
      name,
      direction: spec.direction,
      action: spec.action,
      enabled: true,
      managedByApp: true,
      program: spec.program || null,
      protocol: spec.protocol || null,
      localPort: spec.localPort || null,
      remotePort: spec.remotePort || null,
      remoteAddress: spec.remoteAddress || null
    };
    this._existing.push(rule);
    this.created.push(spec);
    return { success: true, name };
  }

  async deleteRule(name) {
    this.deleted.push(name);
    this._existing = this._existing.filter((r) => r.name !== name);
    return { success: true };
  }

  async setRuleEnabled() {
    return { success: true };
  }
}

describe('FirewallManager import/export validation', () => {
  let mgr;

  beforeEach(() => {
    mgr = new FakeFirewallManager([
      {
        name: 'Soterios - Block IP 1.2.3.4 (Out)',
        direction: 'Outbound',
        action: 'Block',
        enabled: true,
        managedByApp: true
      }
    ]);
  });

  it('rejects malformed payloads and unsupported versions', async () => {
    await assert.rejects(() => mgr.importRules(null), /JSON object/);
    await assert.rejects(() => mgr.importRules({ version: 2, rules: [] }), /Unsupported firewall export version/);
    await assert.rejects(() => mgr.importRules({ rules: 'nope' }), /rules" array/);
  });

  it('validates rule fields before creating anything', async () => {
    const result = await mgr.importRules({
      version: 1,
      rules: [{ name: 'Bad', direction: 'Sideways', action: 'Block' }]
    });
    assert.equal(result.success, false);
    assert.equal(mgr.created.length, 0);
    assert.match(result.errors[0], /invalid direction/i);
  });

  it('rejects invalid ports and protocols', async () => {
    const badPort = await mgr.importRules({
      version: 1,
      rules: [{ name: 'Porty', direction: 'Outbound', action: 'Block', remotePort: '99999' }]
    });
    assert.equal(badPort.success, false);
    assert.match(badPort.errors[0], /Invalid port|Unsupported port/);

    const rangePort = await mgr.importRules({
      version: 1,
      rules: [{ name: 'Range', direction: 'Outbound', action: 'Block', remotePort: '1-65535' }]
    });
    assert.equal(rangePort.success, false);
    assert.match(rangePort.errors[0], /Unsupported port expression/);
    assert.equal(mgr.created.length, 0);

    const badProto = await mgr.importRules({
      version: 1,
      rules: [{ name: 'Proto', direction: 'Outbound', action: 'Block', protocol: 'FTP; rm -rf' }]
    });
    assert.equal(badProto.success, false);
    assert.match(badProto.errors[0], /Unsupported protocol/);
  });

  it('skips existing rules when onConflict=skip', async () => {
    const result = await mgr.importRules({
      version: 1,
      rules: [{
        name: 'Soterios - Block IP 1.2.3.4 (Out)',
        direction: 'Outbound',
        action: 'Block'
      }]
    }, { onConflict: 'skip' });
    assert.equal(result.skipped, 1);
    assert.equal(result.created, 0);
    assert.equal(mgr.created.length, 0);
  });

  it('renames on conflict without double-counting created', async () => {
    const result = await mgr.importRules({
      version: 1,
      rules: [{
        name: 'Soterios - Block IP 1.2.3.4 (Out)',
        direction: 'Outbound',
        action: 'Block',
        remoteAddress: '8.8.8.8'
      }]
    }, { onConflict: 'rename' });
    assert.equal(result.success, true);
    assert.equal(result.renamed, 1);
    assert.equal(result.created, 0);
    assert.equal(mgr.created.length, 1);
    assert.match(mgr.created[0].name, /\(2\)$/);
  });

  it('overwrites only after a successful recreate', async () => {
    const result = await mgr.importRules({
      version: 1,
      rules: [{
        name: 'Soterios - Block IP 1.2.3.4 (Out)',
        direction: 'Outbound',
        action: 'Block',
        remoteAddress: '9.9.9.9'
      }]
    }, { onConflict: 'overwrite' });
    assert.equal(result.success, true);
    assert.equal(result.overwritten, 1);
    assert.equal(result.created, 0);
    assert.deepEqual(mgr.deleted, ['Soterios - Block IP 1.2.3.4 (Out)']);
  });

  it('reports recreate failure clearly when overwrite create fails', async () => {
    mgr.createRule = async () => {
      throw new Error('boom');
    };
    const result = await mgr.importRules({
      version: 1,
      rules: [{
        name: 'Soterios - Block IP 1.2.3.4 (Out)',
        direction: 'Outbound',
        action: 'Block'
      }]
    }, { onConflict: 'overwrite' });
    assert.equal(result.success, false);
    assert.match(result.errors[0], /removed during overwrite/);
  });

  it('exportRules only includes managed rules', async () => {
    mgr._existing.push({
      name: 'Windows Defender Firewall',
      direction: 'Inbound',
      action: 'Allow',
      managedByApp: false
    });
    const exported = await mgr.exportRules();
    assert.equal(exported.version, 1);
    assert.equal(exported.rules.length, 1);
    assert.equal(exported.rules[0].name, 'Soterios - Block IP 1.2.3.4 (Out)');
  });
});

describe('FirewallManager enableAllProfiles', () => {
  class FakePowerShellFirewallManager extends FakeFirewallManager {
    constructor(opts = {}) {
      super();
      this.opts = opts;
      this.powerShellCalls = [];
    }

    async runPowerShell(command) {
      this.powerShellCalls.push(command);
      const failFor = this.opts.failFor;
      if (failFor && command.includes(`-Name ${failFor} `)) {
        throw new Error(`${failFor} went boom`);
      }
    }
  }

  it('enables all three profiles', async () => {
    const mgr = new FakePowerShellFirewallManager();
    const result = await mgr.enableAllProfiles();
    assert.equal(result.success, true);
    assert.deepEqual(result.enabled, ['Domain', 'Private', 'Public']);
    assert.deepEqual(result.errors, []);
    assert.equal(mgr.powerShellCalls.length, 3);
    assert.match(mgr.powerShellCalls.join('\n'), /-Name Domain .*-Enabled True/);
    assert.match(mgr.powerShellCalls.join('\n'), /-Name Public .*-Enabled True/);
  });

  it('reports partial failure without swallowing the other profiles', async () => {
    const mgr = new FakePowerShellFirewallManager({ failFor: 'Public' });
    const result = await mgr.enableAllProfiles();
    assert.equal(result.success, false);
    assert.deepEqual(result.enabled, ['Domain', 'Private']);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].profile, 'Public');
    assert.equal(typeof result.errors[0].error, 'string');
    assert.equal(mgr.powerShellCalls.length, 3, 'all profiles are attempted even when one fails');
  });
});

describe('FirewallManager batch rule operations', () => {
  it('deleteRules deletes multiple rules and reports success', async () => {
    const mgr = new FakeFirewallManager([
      { name: 'Soterios - Block IP 1.2.3.4 (Out)', direction: 'Outbound', action: 'Block', enabled: true, managedByApp: true },
      { name: 'Soterios - Block IP 1.2.3.4 (In)', direction: 'Inbound', action: 'Block', enabled: true, managedByApp: true },
      { name: 'Soterios - Block IP 5.6.7.8 (Out)', direction: 'Outbound', action: 'Block', enabled: true, managedByApp: true }
    ]);
    const res = await mgr.deleteRules([
      'Soterios - Block IP 1.2.3.4 (Out)',
      'Soterios - Block IP 1.2.3.4 (In)',
      'Soterios - Block IP 5.6.7.8 (Out)'
    ]);
    assert.equal(res.success, true);
    assert.equal(res.deleted.length, 3);
    assert.equal(res.failed.length, 0);
    assert.deepEqual(mgr.deleted, [
      'Soterios - Block IP 1.2.3.4 (Out)',
      'Soterios - Block IP 1.2.3.4 (In)',
      'Soterios - Block IP 5.6.7.8 (Out)'
    ]);
  });

  it('deleteRules aggregates per-rule failures without aborting the rest', async () => {
    const mgr = new FakeFirewallManager([
      { name: 'Soterios - Block IP 1.2.3.4 (Out)', direction: 'Outbound', action: 'Block', enabled: true, managedByApp: true },
      { name: 'Soterios - Block IP 9.9.9.9 (Out)', direction: 'Outbound', action: 'Block', enabled: true, managedByApp: true }
    ]);
    mgr.deleteRule = async (name) => {
      if (name.includes('9.9.9.9')) throw new Error('access is denied');
      mgr.deleted.push(name);
      mgr._existing = mgr._existing.filter((r) => r.name !== name);
      return { success: true };
    };
    const res = await mgr.deleteRules([
      'Soterios - Block IP 1.2.3.4 (Out)',
      'Soterios - Block IP 9.9.9.9 (Out)'
    ]);
    assert.equal(res.success, false);
    assert.deepEqual(res.deleted, ['Soterios - Block IP 1.2.3.4 (Out)']);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].name, 'Soterios - Block IP 9.9.9.9 (Out)');
    assert.equal(typeof res.failed[0].error, 'string');
  });

  it('deleteRules rejects non-array input', async () => {
    const mgr = new FakeFirewallManager();
    await assert.rejects(() => mgr.deleteRules('nope'), /array/i);
  });

  it('deleteRules isolates foreign (non-app) rules as failures via the per-rule guard', async () => {
    const mgr = new FakeFirewallManager([]);
    mgr.deleteRule = async (name) => {
      if (!name || !name.startsWith('Soterios - ')) {
        throw new Error('Only rules created in this app can be deleted here.');
      }
      return { success: true };
    };
    const res = await mgr.deleteRules(['Windows Defender Firewall']);
    assert.equal(res.success, false);
    assert.equal(res.deleted.length, 0);
    assert.equal(res.failed.length, 1);
    assert.match(res.failed[0].error, /Only rules created in this app/);
  });

  it('setRulesEnabled updates multiple rules and reports success', async () => {
    const mgr = new FakeFirewallManager([
      { name: 'Soterios - Block IP 1.2.3.4 (Out)', direction: 'Outbound', action: 'Block', enabled: true, managedByApp: true },
      { name: 'Soterios - Block IP 1.2.3.4 (In)', direction: 'Inbound', action: 'Block', enabled: true, managedByApp: true }
    ]);
    const calls = [];
    mgr.setRuleEnabled = async (name, enabled) => { calls.push({ name, enabled }); return { success: true }; };
    const res = await mgr.setRulesEnabled([
      'Soterios - Block IP 1.2.3.4 (Out)',
      'Soterios - Block IP 1.2.3.4 (In)'
    ], false);
    assert.equal(res.success, true);
    assert.equal(res.updated.length, 2);
    assert.equal(res.failed.length, 0);
    assert.deepEqual(calls, [
      { name: 'Soterios - Block IP 1.2.3.4 (Out)', enabled: false },
      { name: 'Soterios - Block IP 1.2.3.4 (In)', enabled: false }
    ]);
  });

  it('setRulesEnabled aggregates per-rule failures', async () => {
    const mgr = new FakeFirewallManager([]);
    mgr.setRuleEnabled = async (name) => {
      if (name.includes('(In)')) throw new Error('boom');
      return { success: true };
    };
    const res = await mgr.setRulesEnabled([
      'Soterios - Block IP 1.2.3.4 (Out)',
      'Soterios - Block IP 1.2.3.4 (In)'
    ], false);
    assert.equal(res.success, false);
    assert.equal(res.updated.length, 1);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].name, 'Soterios - Block IP 1.2.3.4 (In)');
  });
});
