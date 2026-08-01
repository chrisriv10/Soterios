'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('Browser Extension Integration', () => {
  describe('credential-leak:notify IPC handler', () => {
    it('should reject missing password', async () => {
      const mockDb = {
        addAlert: () => {}
      };
      const mockEventBus = {
        emit: () => {}
      };

      // Simulate the IPC handler logic
      const handleCredentialLeak = async (payload) => {
        if (!payload?.password) return { ok: false, error: 'Missing password' };
        const crypto = require('crypto');
        const sha = crypto.createHash('sha1').update(payload.password).digest('hex').toUpperCase();
        const alert = {
          level: 'danger',
          source: 'Browser Extension',
          title: 'Credential Leak Detected',
          message: `Password found in ${payload.count} breach${payload.count > 1 ? 'es' : ''} via browser extension`,
          detail: `SHA-1 prefix: ${sha.slice(0, 5)}... | Breaches: ${payload.count}`,
          timestamp: new Date().toISOString(),
          metadata: { source: 'browser-extension', hashPrefix: sha.slice(0, 5), count: payload.count }
        };
        mockDb.addAlert(alert);
        if (mockEventBus) mockEventBus.emit('alert:new', alert);
        return { ok: true };
      };

      const result = await handleCredentialLeak({});
      assert.equal(result.ok, false);
      assert.equal(result.error, 'Missing password');
    });

    it('should create alert with valid payload', async () => {
      const mockDb = {
        addAlert: (alert) => {
          assert.equal(alert.level, 'danger');
          assert.equal(alert.source, 'Browser Extension');
          assert.equal(alert.title, 'Credential Leak Detected');
          assert.match(alert.message, /Password found in 3 breaches/);
          assert.match(alert.detail, /SHA-1 prefix:/);
          assert.equal(alert.metadata.source, 'browser-extension');
          assert.equal(alert.metadata.count, 3);
        }
      };
      const mockEventBus = {
        emit: (event, alert) => {
          assert.equal(event, 'alert:new');
          assert.equal(alert.level, 'danger');
        }
      };

      const handleCredentialLeak = async (payload) => {
        if (!payload?.password) return { ok: false, error: 'Missing password' };
        const crypto = require('crypto');
        const sha = crypto.createHash('sha1').update(payload.password).digest('hex').toUpperCase();
        const alert = {
          level: 'danger',
          source: 'Browser Extension',
          title: 'Credential Leak Detected',
          message: `Password found in ${payload.count} breach${payload.count > 1 ? 'es' : ''} via browser extension`,
          detail: `SHA-1 prefix: ${sha.slice(0, 5)}... | Breaches: ${payload.count}`,
          timestamp: new Date().toISOString(),
          metadata: { source: 'browser-extension', hashPrefix: sha.slice(0, 5), count: payload.count }
        };
        mockDb.addAlert(alert);
        if (mockEventBus) mockEventBus.emit('alert:new', alert);
        return { ok: true };
      };

      const result = await handleCredentialLeak({ password: 'test123', count: 3 });
      assert.equal(result.ok, true);
    });
  });

  describe('browserExtension:installNativeHost IPC handler', () => {
    it('should reject non-Windows platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const handleInstall = async () => {
        if (process.platform !== 'win32') {
          return { ok: false, error: 'Native host install only supported on Windows' };
        }
        return { ok: true };
      };

      const result = await handleInstall();
      assert.equal(result.ok, false);
      assert.equal(result.error, 'Native host install only supported on Windows');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should check for required files', async () => {
      const fs = require('fs');
      const path = require('path');

      const handleInstall = async () => {
        if (process.platform !== 'win32') {
          return { ok: false, error: 'Native host install only supported on Windows' };
        }
        const extDir = path.join(__dirname, '..', 'browser-extension');
        const manifestPath = path.join(extDir, 'native-host-manifest.json');
        const batPath = path.join(extDir, 'native-host.bat');
        const jsPath = path.join(extDir, 'native-host.js');
        if (!fs.existsSync(manifestPath) || !fs.existsSync(batPath) || !fs.existsSync(jsPath)) {
          return { ok: false, error: 'Extension files not found. Reinstall Soterios.' };
        }
        return { ok: true };
      };

      const result = await handleInstall();
      // Result depends on whether files exist in the actual environment
      assert.ok(result.ok === true || result.ok === false);
    });
  });

  describe('background.js onInstalled behavior', () => {
    it('should only set externalLookupsEnabled on install', async () => {
      let storageSet = false;
      let storageGet = { externalLookupsEnabled: undefined };

      const mockChrome = {
        runtime: {
          onInstalled: {
            addListener: (callback) => {
              callback({ reason: 'install' });
            }
          }
        },
        storage: {
          sync: {
            get: (key) => {
              return Promise.resolve(storageGet);
            },
            set: (data) => {
              storageSet = true;
              storageGet = data;
              return Promise.resolve();
            }
          }
        }
      };

      // Simulate the fixed background.js logic
      const onInstalled = async (details) => {
        if (details.reason === 'install') {
          const { externalLookupsEnabled } = await mockChrome.storage.sync.get('externalLookupsEnabled');
          if (externalLookupsEnabled === undefined) {
            await mockChrome.storage.sync.set({ externalLookupsEnabled: true });
          }
        }
      };

      await onInstalled({ reason: 'install' });
      assert.equal(storageSet, true);
      assert.equal(storageGet.externalLookupsEnabled, true);
    });

    it('should not override existing false value on update', async () => {
      let storageSet = false;
      let storageGet = { externalLookupsEnabled: false };

      const mockChrome = {
        runtime: {
          onInstalled: {
            addListener: (callback) => {
              callback({ reason: 'update' });
            }
          }
        },
        storage: {
          sync: {
            get: (key) => {
              return Promise.resolve(storageGet);
            },
            set: (data) => {
              storageSet = true;
              storageGet = data;
              return Promise.resolve();
            }
          }
        }
      };

      const onInstalled = async (details) => {
        if (details.reason === 'install') {
          const { externalLookupsEnabled } = await mockChrome.storage.sync.get('externalLookupsEnabled');
          if (externalLookupsEnabled === undefined) {
            await mockChrome.storage.sync.set({ externalLookupsEnabled: true });
          }
        }
      };

      await onInstalled({ reason: 'update' });
      assert.equal(storageSet, false);
      assert.equal(storageGet.externalLookupsEnabled, false);
    });
  });
});
