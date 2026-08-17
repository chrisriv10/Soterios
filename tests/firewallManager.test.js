'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const FirewallManager = require('../src/security/FirewallManager');

/**
 * Fake firewall manager used for import/export validation tests.
 */
class FakeFirewallManager extends FirewallManager {
  /**
   * Creates a FakeFirewallManager instance.
   *
   * @param {Array<Object>} [existing=[]] - Pre-existing rules.
   */
  constructor(existing = []) {
    super();
    this._existing = existing.map((r) => ({ ...r }));
    this.deleted = [];
    this.created = [];
  }

  /**
   * Lists current rules.
   *
   * @returns {Promise<Array<Object>>} Current rules.
   */
  async listRules() {
    return this._existing.slice();
  }

  /**
   * Creates a new firewall rule.
   *
   * @param {Object} spec - Rule specification.
   * @returns {Promise<{success: boolean, name: string}>} Creation result.
   */
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

  /**
   * Deletes a firewall rule by name.
   *
   * @param {string} name - Rule name.
   * @returns {Promise<{success: boolean}>} Deletion result.
   */
  async deleteRule(name) {
    this.deleted.push(name);
    this._existing = this._existing.filter((r) => r.name !== name);
    return { success: true };
  }

  /**
   * Enables or disables a firewall rule.
   *
   * @param {string} _name - Rule name (unused in fake).
   * @param {boolean} _enabled - Desired enabled state (unused in fake).
   * @returns {Promise<{success: boolean}>} Update result.
   */
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
