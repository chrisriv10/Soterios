'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadUpdater(checkForUpdates) {
  const listeners = new Map();
  const autoUpdater = {
    on(event, listener) {
      const group = listeners.get(event) || [];
      group.push(listener);
      listeners.set(event, group);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) || []) listener(...args);
    },
    checkForUpdates,
  };
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'electron') return { app: { isPackaged: true } };
      if (name === 'electron-updater') return { autoUpdater };
      if (name === '../utils/logger') return { warn() {} };
      throw new Error(`Unexpected require: ${name}`);
    },
    Promise,
    Object,
    Set,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(read('src/main/updater.js'), sandbox, {
    filename: path.join(__dirname, '..', 'src', 'main', 'updater.js'),
  });
  return { updater: module.exports, autoUpdater };
}

it('clears the stale checking translation when an updater event fails', async () => {
  const failure = new Error('GitHub release feed request failed');
  let autoUpdater;
  const loaded = loadUpdater(() => {
    autoUpdater.emit('checking-for-update');
    autoUpdater.emit('error', failure);
    return Promise.reject(failure);
  });
  autoUpdater = loaded.autoUpdater;

  loaded.updater.initAutoUpdater();
  const status = await loaded.updater.checkForUpdates();
  assert.equal(status.status, 'error');
  assert.equal(status.message, failure.message);
  assert.equal(status.messageKey, null);

  const settings = read('src/ui/js/pages/settings.js');
  const start = settings.indexOf('function translateUpdateStatus(status) {');
  const end = settings.indexOf('\n}\n\nwindow.Pages', start) + 2;
  assert.ok(start >= 0 && end > start);
  const translateStatus = vm.runInNewContext(`(${settings.slice(start, end)})`, {
    window: { I18n: { t: (key) => key === 'settings.updates.checking' ? 'Checking for updates...' : key } },
  });
  assert.equal(translateStatus(status), failure.message);

  autoUpdater.emit('update-not-available');
  assert.equal(loaded.updater.getUpdateStatus().messageKey, 'settings.updates.upToDate');
});
