'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EmergencyLockdown = require('../src/security/EmergencyLockdown');

// Mirrors the REAL DatabaseService settings API (getSetting/setSetting).
// Previously this double exposed get()/set() methods that the real class
// does not have, so the suite passed while production calls threw TypeError.
class FakeDatabase {
  constructor() {
    this.data = {};
  }

  getSetting(key, defaultValue = null) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : defaultValue;
  }

  setSetting(key, value) {
    this.data[key] = value;
    return { changes: 1 };
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
      assert.deepStrictEqual(db.getSetting(EmergencyLockdown.SETTINGS_KEY), newAllowlist);
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
      db.setSetting(EmergencyLockdown.SETTINGS_KEY, {
        interfaces: ['ethernet0'],
        services: ['spooler'],
        ips: ['192.168.1.1']
      });

      const newLockdown = new EmergencyLockdown(db, eventBus, notify);
      const allowlist = newLockdown.getAllowlist();
      assert.strictEqual(allowlist.interfaces.length, 1);
      assert.strictEqual(allowlist.interfaces[0], 'ethernet0');
    });

    it('should persist allowlist across service instances using the real settings API', () => {
      // Regression for #140: set an allowlist, then re-instantiate the service
      // against the same database (simulating an app restart) and assert the
      // allowlist survives.
      const first = new EmergencyLockdown(db, eventBus, notify);
      first.setAllowlist({
        interfaces: ['Ethernet0'],
        services: ['Spooler'],
        ips: ['10.0.0.0/8']
      });

      const second = new EmergencyLockdown(db, eventBus, notify);
      assert.deepStrictEqual(second.getAllowlist(), {
        interfaces: ['Ethernet0'],
        services: ['Spooler'],
        ips: ['10.0.0.0/8']
      });
    });

    it('should surface persistence failures instead of silently reporting success', () => {
      // Regression for #140: a failed write must throw so the caller (IPC
      // handler) can surface it, not be swallowed and reported as success.
      const failingDb = new FakeDatabase();
      failingDb.setSetting = () => {
        throw new Error('disk full');
      };
      const svc = new EmergencyLockdown(failingDb, eventBus, notify);
      assert.throws(
        () => svc.setAllowlist({ interfaces: ['Ethernet0'], services: [], ips: [] }),
        /disk full/
      );
    });

    it('should reject invalid IP addresses', () => {
      assert.throws(
        () => lockdown.addToAllowlist('ips', '999.999.999.999'),
        /Invalid IP address/
      );
      assert.throws(
        () => lockdown.addToAllowlist('ips', 'not-an-ip'),
        /Invalid IP address/
      );
      const allowlist = lockdown.getAllowlist();
      assert.strictEqual(allowlist.ips.length, 0);
    });

    it('should accept valid IPv4, IPv4 with CIDR, and IPv6 addresses', () => {
      lockdown.addToAllowlist('ips', '192.168.1.42');
      lockdown.addToAllowlist('ips', '10.0.0.0/8');
      lockdown.addToAllowlist('ips', 'fe80::1');
      const allowlist = lockdown.getAllowlist();
      assert.deepStrictEqual(allowlist.ips, ['192.168.1.42', '10.0.0.0/8', 'fe80::1']);
    });

    it('should validate IP format via _isValidIp', () => {
      assert.strictEqual(lockdown._isValidIp('192.168.1.1'), true);
      assert.strictEqual(lockdown._isValidIp('255.255.255.255'), true);
      assert.strictEqual(lockdown._isValidIp('0.0.0.0'), true);
      assert.strictEqual(lockdown._isValidIp('256.0.0.1'), false);
      assert.strictEqual(lockdown._isValidIp('192.168.1'), false);
      assert.strictEqual(lockdown._isValidIp('10.0.0.0/24'), true);
      assert.strictEqual(lockdown._isValidIp('2001:db8::1'), true);
      assert.strictEqual(lockdown._isValidIp('abc'), false);
    });

    it('should get local IPs (non-internal interfaces)', () => {
      const ips = lockdown.getLocalIPs();
      assert.ok(Array.isArray(ips));
      for (const entry of ips) {
        assert.ok(typeof entry.ip === 'string' && entry.ip.length > 0);
        assert.ok(entry.family === 'IPv4' || entry.family === 'IPv6');
        assert.ok(typeof entry.interface === 'string');
      }
    });
  });

  describe('Network interface operations', () => {
    // Deterministic command fakes: unit tests must never invoke real netsh
    // on the host (GitHub runners may lack adapters; admin actions must
    // never run from tests).
    const NETSH_LIST_STDOUT = '\r\nAdmin State    State          Type             Interface Name\r\n-------------------------------------------------------------------------\r\nEnabled        Connected      Dedicated        Wi-Fi\r\nEnabled        Disconnected   Dedicated        Ethernet 2\r\n';

    function fakeRunners({ asyncImpl, syncImpl } = {}) {
      const commands = [];
      const execAsync = asyncImpl || (async (command, options) => {
        commands.push({ kind: 'async', command, options });
        return { stdout: '', stderr: '' };
      });
      const execFileSync = syncImpl || ((file, args, options) => {
        commands.push({ kind: 'sync', file, args, options });
        return Buffer.from('');
      });
      const service = new EmergencyLockdown(db, eventBus, notify, { execAsync, execFileSync });
      return { service, commands };
    }

    it('should get network interfaces without invoking real netsh', async () => {
      const { service, commands } = fakeRunners({
        asyncImpl: async (command, options) => {
          commands.push({ kind: 'async', command, options });
          return { stdout: NETSH_LIST_STDOUT, stderr: '' };
        }
      });
      const interfaces = await service.getNetworkInterfaces();
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].command, 'netsh interface show interface');
      assert.strictEqual(commands[0].options.timeout, 5000);
      assert.strictEqual(interfaces.length, 2);
      assert.strictEqual(interfaces[0].name, 'Wi-Fi');
      assert.strictEqual(interfaces[0].state, 'connected');
      assert.strictEqual(interfaces[1].name, 'Ethernet 2');
      assert.strictEqual(interfaces[1].state, 'disconnected');
    });

    it('should wrap async interface-list failures with a useful prefix', async () => {
      const { service } = fakeRunners({
        asyncImpl: async () => { throw new Error('command timed out'); }
      });
      await assert.rejects(
        async () => await service.getNetworkInterfaces(),
        (err) => {
          assert.ok(err.message.includes('Failed to get network interfaces'));
          assert.ok(err.message.includes('command timed out'));
          return true;
        }
      );
    });

    it('should parse modern netsh output with CRLF line endings', () => {
      const stdout = '\r\nAdmin State    State          Type             Interface Name\r\n-------------------------------------------------------------------------\r\nEnabled        Connected      Dedicated        Wi-Fi\r\nEnabled        Disconnected   Dedicated        Ethernet 2\r\n';
      const interfaces = EmergencyLockdown.parseNetworkInterfaces(stdout);
      assert.strictEqual(interfaces.length, 2);
      assert.strictEqual(interfaces[0].name, 'Wi-Fi');
      assert.strictEqual(interfaces[0].state, 'connected');
      assert.strictEqual(interfaces[0].adminState, 'Enabled');
      assert.strictEqual(interfaces[1].name, 'Ethernet 2');
      assert.strictEqual(interfaces[1].state, 'disconnected');
    });

    it('should parse legacy netsh output', () => {
      const stdout = 'Name                State           Type        Connectivity\r\nLocal Area Connection   connected     Dedicated   Internet\r\n';
      const interfaces = EmergencyLockdown.parseNetworkInterfaces(stdout);
      assert.strictEqual(interfaces.length, 1);
      assert.strictEqual(interfaces[0].name, 'Local Area Connection');
      assert.strictEqual(interfaces[0].state, 'connected');
      assert.strictEqual(interfaces[0].connectivity, 'Internet');
    });

    it('should ignore headers and separators in netsh output', () => {
      const stdout = 'Admin State    State          Type             Interface Name\r\n-------------------------------------------------------------------------\r\n';
      const interfaces = EmergencyLockdown.parseNetworkInterfaces(stdout);
      assert.strictEqual(interfaces.length, 0);
    });

    it('should throw error when disabling interface fails', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execFileSync: (file, args, options) => {
          commands.push({ file, args, options });
          throw Object.assign(new Error('synthetic command failure'), { code: 'SYNTHETIC' });
        }
      });
      await assert.rejects(
        async () => await service.disableInterface('Example Adapter'),
        (err) => {
          assert.ok(err.message.includes('Failed to disable'));
          return true;
        }
      );
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].file, 'netsh');
      assert.deepStrictEqual(commands[0].args, ['interface', 'set', 'interface', 'Example Adapter', 'admin=disable']);
      assert.strictEqual(commands[0].options.timeout, 10000);
    });

    it('should throw error when enabling interface fails', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execFileSync: (file, args, options) => {
          commands.push({ file, args, options });
          throw Object.assign(new Error('synthetic command failure'), { code: 'SYNTHETIC' });
        }
      });
      await assert.rejects(
        async () => await service.enableInterface('Example Adapter'),
        (err) => {
          assert.ok(err.message.includes('Failed to enable'));
          return true;
        }
      );
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].file, 'netsh');
      assert.deepStrictEqual(commands[0].args, ['interface', 'set', 'interface', 'Example Adapter', 'admin=enable']);
      assert.strictEqual(commands[0].options.timeout, 10000);
    });

    it('should disable and enable interfaces through the injected runner', async () => {
      const { service, commands } = fakeRunners();
      assert.deepStrictEqual(await service.disableInterface('Wi-Fi'), { success: true, interface: 'Wi-Fi' });
      assert.deepStrictEqual(await service.enableInterface('Wi-Fi'), { success: true, interface: 'Wi-Fi' });
      assert.strictEqual(commands.length, 2);
      assert.ok(commands.every((call) => call.kind === 'sync' && call.file === 'netsh'));
    });
  });

  describe('Service operations', () => {
    const SC_LIST_STDOUT = [
      'SERVICE_NAME: Spooler',
      'DISPLAY_NAME: Print Spooler',
      '        TYPE               : 30  WIN32_SHARE_PROCESS  ',
      '        STATE              : 4  RUNNING ',
      '',
      'SERVICE_NAME: BITS',
      'DISPLAY_NAME: Background Intelligent Transfer Service',
      '        TYPE               : 20  WIN32_OWN_PROCESS  ',
      '        STATE              : 1  STOPPED ',
      ''
    ].join('\r\n');

    it('should get non-essential services without invoking real sc', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execAsync: async (command, options) => {
          commands.push({ command, options });
          return { stdout: SC_LIST_STDOUT, stderr: '' };
        }
      });
      const services = await service.getNonEssentialServices();
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].command, 'sc query type= service state= all');
      assert.strictEqual(commands[0].options.timeout, 10000);
      assert.deepStrictEqual(services.map((entry) => entry.name), ['Spooler']);
      assert.strictEqual(services[0].state, 'RUNNING');
    });

    it('should wrap async service-list failures with a useful prefix', async () => {
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execAsync: async () => { throw new Error('command timed out'); }
      });
      await assert.rejects(
        async () => await service.getNonEssentialServices(),
        (err) => {
          assert.ok(err.message.includes('Failed to get services'));
          assert.ok(err.message.includes('command timed out'));
          return true;
        }
      );
    });

    it('should parse sc query output with CRLF line endings and filter non-essential running services', () => {
      const stdout = [
        'SERVICE_NAME: Spooler',
        'DISPLAY_NAME: Print Spooler',
        '        TYPE               : 30  WIN32_SHARE_PROCESS  ',
        '        STATE              : 4  RUNNING ',
        '        WIN32_EXIT_CODE    : 0  (0x0)',
        '',
        'SERVICE_NAME: WSearch',
        'DISPLAY_NAME: Windows Search',
        '        TYPE               : 20  WIN32_OWN_PROCESS  ',
        '        STATE              : 4  RUNNING ',
        '        WIN32_EXIT_CODE    : 0  (0x0)',
        '',
        'SERVICE_NAME: BITS',
        'DISPLAY_NAME: Background Intelligent Transfer Service',
        '        TYPE               : 20  WIN32_OWN_PROCESS  ',
        '        STATE              : 1  STOPPED ',
        '        WIN32_EXIT_CODE    : 1077  (0x435)',
        '',
        'SERVICE_NAME: AppXSvc',
        'DISPLAY_NAME: AppX Deployment Service',
        '        TYPE               : 30  WIN32_SHARE_PROCESS  ',
        '        STATE              : 1  STOPPED ',
        '        WIN32_EXIT_CODE    : 0  (0x0)',
        ''
      ].join('\r\n');

      const services = EmergencyLockdown.parseScQueryServices(stdout);
      const names = services.map(s => s.name);
      assert.deepStrictEqual(names, ['Spooler', 'WSearch']);
      assert.strictEqual(services[0].displayName, 'Print Spooler');
      assert.strictEqual(services[0].state, 'RUNNING');
      assert.strictEqual(services[1].state, 'RUNNING');
    });

    it('should throw error when stopping service fails', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execFileSync: (file, args, options) => {
          commands.push({ file, args, options });
          throw Object.assign(new Error('synthetic command failure'), { code: 'SYNTHETIC' });
        }
      });
      await assert.rejects(
        async () => await service.stopService('ExampleService'),
        (err) => {
          assert.ok(err.message.includes('Failed to stop'));
          return true;
        }
      );
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].file, 'sc');
      assert.deepStrictEqual(commands[0].args, ['stop', 'ExampleService']);
      assert.strictEqual(commands[0].options.timeout, 15000);
    });

    it('should throw error when starting service fails', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execFileSync: (file, args, options) => {
          commands.push({ file, args, options });
          throw Object.assign(new Error('synthetic command failure'), { code: 'SYNTHETIC' });
        }
      });
      await assert.rejects(
        async () => await service.startService('ExampleService'),
        (err) => {
          assert.ok(err.message.includes('Failed to start'));
          return true;
        }
      );
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].file, 'sc');
      assert.deepStrictEqual(commands[0].args, ['start', 'ExampleService']);
      assert.strictEqual(commands[0].options.timeout, 15000);
    });

    it('should stop and start services through the injected runner', async () => {
      const commands = [];
      const service = new EmergencyLockdown(db, eventBus, notify, {
        execFileSync: (file, args, options) => {
          commands.push({ file, args, options });
          return Buffer.from('');
        }
      });
      assert.deepStrictEqual(await service.stopService('ExampleService'), { success: true, service: 'ExampleService' });
      assert.deepStrictEqual(await service.startService('ExampleService'), { success: true, service: 'ExampleService' });
      assert.strictEqual(commands.length, 2);
    });
  });

  describe('Lockdown status', () => {
    it('preserves 3-argument production construction with real command defaults', () => {
      const svc = new EmergencyLockdown(db, eventBus, notify);
      assert.equal(typeof svc._execAsync, 'function');
      assert.equal(typeof svc._execFileSync, 'function');
    });

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
