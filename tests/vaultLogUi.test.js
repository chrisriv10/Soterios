'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'tools.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
const systemIpcSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'system.js'), 'utf8');

describe('File Vault history removal controls', () => {
  it('renders a log-removal action only for completed records', () => {
    assert.match(toolsSource, /\['purged', 'restored'\]\.includes\(item\.status\)/);
    assert.match(toolsSource, /data-action="delete-vault-log" data-vault-id="\$\{this\.e\(item\.id\)\}"/);
    assert.match(toolsSource, /async _deleteVaultLog\(id\)/);
  });

  it('exposes the history-removal IPC route through preload and the main handler', () => {
    assert.match(preloadSource, /deleteLog:\s*\(id\)\s*=> ipcRenderer\.invoke\('vault:deleteLog', id\)/);
    assert.match(systemIpcSource, /ipcMain\.handle\('vault:deleteLog'/);
    assert.match(systemIpcSource, /maintenanceSafetyVault\.deleteLog\(String\(id \|\| ''\)\)/);
  });
});
