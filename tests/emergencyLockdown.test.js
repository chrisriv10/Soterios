'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EmergencyLockdown = require('../src/security/EmergencyLockdown');

class FakeDatabase {
  constructor() {
    this.data = {};
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }
}

class FakeEventBus {
  constructor() {
    this.events = [];
  }

  emit(event, data) {
    this.events.push({ event, data });
  }
}

class FakeNotifier {
  constructor() {
    this.notifications = [];
  }

  notify(title, message, type) {
    this.notifications.push({ title, message, type });
  }
}

describe('EmergencyLockdown', () => {
  let db, eventBus, notify, lockdown;

  beforeEach(() => {
    db = new FakeDatabase();
    eventBus = new FakeEventBus();
    notify = new FakeNotifier();
    lockdown = new EmergencyLockdown(db, eventBus, notify);
  });

  describe('Allowlist management', () => {
    it('should return default empty allowlist', () => {
      const allowlist = lockdown.getAllowlist();
      assert.deepStrictEqual(allowlist, { interfaces: [], services: [], ips: [] });
    });

    it('should set allowlist', () => {
      const newAllowlist = {
        interfaces: ['Ethernet0', 'Wi-Fi'],
        services: ['Spooler'],
        ips: ['192.168.1.1']
      };
      const result = lockdown.setAllowlist(newAllowlist);
      assert.deepStrictEqual(result, newAllowlist);
      assert.deepStrictEqual(db.get('lockdown_allowlist'), newAllowlist);
    });

    it('should add to allowlist', () => {
      lockdown.addToAllowlist('interfaces', 'Ethernet0');
      lockdown.addToAllowlist('services', 'Spooler');
      lockdown.addToAllowlist('ips', '192.168.1.1');

      const allowlist = lockdown.getAllowlist();
      assert.strictEqual(allowlist.interfaces.length, 1);
      assert.strictEqual(allowlist.interfaces[0], 'ethernet0');
      assert.strictEqual(allowlist.services.length, 1);
      assert.strictEqual(allowlist.services[0], 'spooler');
      assert.strictEqual(allowlist.ips.length, 1);
      assert.strictEqual(allowlist.ips[0], '192.168.1.1');
    });

    it('should not add duplicate entries to allowlist', () => {
      lockdown.addToAllowlist('interfaces', 'Ethernet0');
      lockdown.addToAllowlist('interfaces', 'Ethernet0');

      const allowlist = lockdown.getAllowlist();
      assert.strictEqual(allowlist.interfaces.length, 1);
    });

    it('should remove from allowlist', () => {
      lockdown.addToAllowlist('interfaces', 'Ethernet0');
      lockdown.addToAllowlist('interfaces', 'Wi-Fi');
      lockdown.removeFromAllowlist('interfaces', 'Ethernet0');

      const allowlist = lockdown.getAllowlist();
      assert.strictEqual(allowlist.interfaces.length, 1);
      assert.strictEqual(allowlist.interfaces[0], 'wi-fi');
    });

    it('should load allowlist from database on initialization', () => {
      db.set('lockdown_allowlist', {
        interfaces: ['ethernet0'],
        services: ['spooler'],
        ips: ['192.168.1.1']
      });

      const newLockdown = new EmergencyLockdown(db, eventBus, notify);
      const allowlist = newLockdown.getAllowlist();
      assert.strictEqual(allowlist.interfaces.length, 1);
      assert.strictEqual(allowlist.interfaces[0], 'ethernet0');
    });
  });

  describe('Network interface operations', () => {
    it('should get network interfaces', async () => {
      const interfaces = await lockdown.getNetworkInterfaces();
      assert.ok(Array.isArray(interfaces));
    });

    it('should throw error when disabling interface fails', async () => {
      await assert.rejects(
        async () => await lockdown.disableInterface('NonExistent'),
        (err) => {
          assert.ok(err.message.includes('Failed to disable'));
          return true;
        }
      );
    });

    it('should throw error when enabling interface fails', async () => {
      await assert.rejects(
        async () => await lockdown.enableInterface('NonExistent'),
        (err) => {
          assert.ok(err.message.includes('Failed to enable'));
          return true;
        }
      );
    });
  });

  describe('Service operations', () => {
    it('should get non-essential services', async () => {
      const services = await lockdown.getNonEssentialServices();
      assert.ok(Array.isArray(services));
    });

    it('should throw error when stopping service fails', async () => {
      await assert.rejects(
        async () => await lockdown.stopService('NonExistentService'),
        (err) => {
          assert.ok(err.message.includes('Failed to stop'));
          return true;
        }
      );
    });

    it('should throw error when starting service fails', async () => {
      await assert.rejects(
        async () => await lockdown.startService('NonExistentService'),
        (err) => {
          assert.ok(err.message.includes('Failed to start'));
          return true;
        }
      );
    });
  });

  describe('Lockdown status', () => {
    it('should return initial status as not locked down', () => {
      const status = lockdown.getStatus();
      assert.strictEqual(status.isLockedDown, false);
      assert.strictEqual(status.savedNetworkState, null);
      assert.strictEqual(status.savedServicesState, null);
    });

    it('should prevent double lockdown', async () => {
      lockdown.isLockedDown = true;
      const result = await lockdown.lockdown();
      assert.deepStrictEqual(result, { success: false, message: 'Already in lockdown mode' });
    });

    it('should prevent restore when not locked down', async () => {
      const result = await lockdown.restore();
      assert.deepStrictEqual(result, { success: false, message: 'Not in lockdown mode' });
    });
  });

  describe('Lockdown and restore flow', () => {
    it('should handle lockdown errors gracefully', async () => {
      // Mock the getNetworkInterfaces to fail
      const originalGetNetworkInterfaces = lockdown.getNetworkInterfaces;
      lockdown.getNetworkInterfaces = async () => {
        throw new Error('Network command failed');
      };

      try {
        await assert.rejects(
          async () => await lockdown.lockdown(),
          (err) => {
            assert.ok(err.message.includes('Lockdown failed'));
            assert.strictEqual(lockdown.isLockedDown, false);
            return true;
          }
        );
      } finally {
        lockdown.getNetworkInterfaces = originalGetNetworkInterfaces;
      }
    });

    it('should handle restore when not locked down', async () => {
      const result = await lockdown.restore();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, 'Not in lockdown mode');
    });
  });
});
