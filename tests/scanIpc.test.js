'use strict';

// NOTE: This test file requires `node --test --test-force-exit tests/scanIpc.test.js`
// when run in isolation, because requiring src/main/ipc/scan.js transitively loads
// logger/i18n which opens persistent Socket handles that prevent normal test-runner exit.
// The full suite runner (tests/node-test-runner.js) calls process.exit() explicitly.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const i18n = require('../src/i18n');

function loadScanModule() {
  let handlers = {};
  const electronPath = require.resolve('electron');
  const originalElectron = require.cache[electronPath];
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, fn) => { handlers[channel] = fn; },
      },
    },
    paths: [],
  };
  // Clear any cached scan module to get fresh definitionState
  const scanPath = require.resolve('../src/main/ipc/scan.js');
  delete require.cache[scanPath];
  const scanModule = require('../src/main/ipc/scan.js');
  require.cache[electronPath] = originalElectron;
  return { handlers, register: scanModule.register };
}

describe('scan IPC handlers', () => {
  it('blocks update while a user scan is active and returns translated error', async () => {
    let clamUpdateCalled = false;
    const { register, handlers } = loadScanModule();
    const deps = {
      db: {
        getSetting: (key, def) => (key === 'ui.language' ? 'en' : def),
        setSetting: () => {},
      },
      eventBus: { emit: () => {} },
      clamEngine: {
        updateDefinitions: async () => { clamUpdateCalled = true; return { success: true }; },
      },
      scanEngine: {
        getStatus: () => ({ isScanning: true, isFolderWatchScanning: false }),
        abortScan: async () => {},
      },
      reputationEngine: {},
    };
    register({ webContents: { send: () => {} } }, deps);
    const result = await handlers['scan:updateDefinitions']();
    assert.equal(result.success, false);
    assert.equal(result.error, 'Definitions can\'t be updated while a scan is in progress.');
    assert.equal(clamUpdateCalled, false);
  });

  it('aborts folder-watch scan and proceeds when folder-watch stops', async () => {
    let folderWatchActive = true;
    const { register, handlers } = loadScanModule();
    const deps = {
      db: {
        getSetting: (key, def) => (key === 'ui.language' ? 'en' : def),
        setSetting: () => {},
      },
      eventBus: { emit: () => {} },
      clamEngine: {
        updateDefinitions: async () => { return { success: true }; },
      },
      scanEngine: {
        getStatus: () => ({ isScanning: false, isFolderWatchScanning: folderWatchActive }),
        abortScan: async () => { folderWatchActive = false; },
      },
      reputationEngine: {},
      folderWatchAbortWaitMs: 100,
    };
    register({ webContents: { send: () => {} } }, deps);
    const result = await handlers['scan:updateDefinitions']();
    assert.equal(result.success, true);
  });

  it('returns blocked error when folder-watch cannot be stopped', async () => {
    let folderWatchActive = true;
    const { register, handlers } = loadScanModule();
    const deps = {
      db: {
        getSetting: (key, def) => (key === 'ui.language' ? 'en' : def),
        setSetting: () => {},
      },
      eventBus: { emit: () => {} },
      clamEngine: {
        updateDefinitions: async () => { return { success: true }; },
      },
      scanEngine: {
        getStatus: () => ({ isScanning: false, isFolderWatchScanning: folderWatchActive }),
        abortScan: async () => { folderWatchActive = true; },
      },
      reputationEngine: {},
      folderWatchAbortWaitMs: 50,
    };
    register({ webContents: { send: () => {} } }, deps);
    const result = await handlers['scan:updateDefinitions']();
    assert.equal(result.success, false);
    assert.equal(result.error, 'Definitions can\'t be updated while a scan is in progress.');
  });

  it('rejects a second concurrent update while one is in progress', async () => {
    const { register, handlers } = loadScanModule();
    const deps = {
      db: {
        getSetting: (key, def) => (key === 'ui.language' ? 'en' : def),
        setSetting: () => {},
      },
      eventBus: { emit: () => {} },
      clamEngine: {
        updateDefinitions: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { success: true };
        },
      },
      scanEngine: {
        getStatus: () => ({ isScanning: false, isFolderWatchScanning: false }),
        abortScan: async () => {},
      },
      reputationEngine: {},
    };
    register({ webContents: { send: () => {} } }, deps);
    const promise1 = handlers['scan:updateDefinitions']();
    await new Promise((r) => setTimeout(r, 2));
    const result2 = await handlers['scan:updateDefinitions']();
    assert.equal(result2.success, false);
    assert.equal(result2.error, 'Definitions can\'t be updated while a scan is in progress.');
    await promise1;
  });
});