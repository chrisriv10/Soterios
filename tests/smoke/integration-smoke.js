'use strict';

/**
 * Integration smoke checks for maintenance, tray health summary, and updater
 * without a full Electron UI session.
 * Run: npm run smoke:integration
 */

const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const DatabaseService = require('../../src/core/database');
const { MaintenanceScheduler } = require('../../src/main/maintenanceScheduler');
const { getTrayHealthSummary } = require('../../src/main/healthSummary');
const { loadPlugins } = require('../../src/core/pluginLoader');
const toolRegistry = require('../../src/core/toolRegistry');
const updater = require('../../src/main/updater');

async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-smoke-'));
  const dbPath = path.join(dir, 'soterios.db');
  const db = new DatabaseService(dbPath);
  try {
    await fn(db);
  } finally {
    if (db.db && typeof db.db.close === 'function') db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testMaintenanceRunScript() {
  await withTempDb(async (db) => {
    loadPlugins();
    const scheduler = new MaintenanceScheduler({ db, toolRegistry, log: () => {} });
    scheduler.saveConfig({ enabled: true, scriptIds: ['disk-space-report'] });
    const result = await scheduler.runNow({ dryRunCleanup: false, manual: true });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].scriptId, 'disk-space-report');
    assert.equal(result.results[0].ok, true, result.results[0].error || 'script failed');
  });
  console.log('PASS maintenance run-script integration');
}

async function testTrayHealthSummary() {
  await withTempDb(async (db) => {
    const summary = await getTrayHealthSummary(db, toolRegistry);
    assert.ok(summary);
    assert.ok(typeof summary.detail === 'string');
    assert.ok(summary.score === null || typeof summary.score === 'number');
  });
  console.log('PASS tray health summary');
}

async function testUpdaterDevBuild() {
  const status = await updater.checkForUpdates();
  assert.equal(status.status, 'unsupported');
  assert.match(status.message, /packaged builds/i);
  console.log('PASS updater unsupported in dev build');
}

async function main() {
  await testMaintenanceRunScript();
  await testTrayHealthSummary();
  await testUpdaterDevBuild();
  console.log('All integration smoke checks passed.');
}

main().catch((err) => {
  console.error('Integration smoke check failed:', err);
  process.exit(1);
});
