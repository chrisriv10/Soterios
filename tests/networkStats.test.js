'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DatabaseService = require('../src/core/database');

describe('DatabaseService network_stats', () => {
  const temps = [];

  afterEach(() => {
    while (temps.length) {
      const p = temps.pop();
      try { fs.unlinkSync(p); } catch (_) {}
    }
  });

  function tempDb() {
    const p = path.join(os.tmpdir(), `soterios-netstats-${Date.now()}-${Math.random()}.db`);
    temps.push(p);
    return p;
  }

  it('creates network_stats table and stores samples', () => {
    const service = new DatabaseService(tempDb());
    const tables = service.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('network_stats'));
    const firstAt = new Date(Date.now() - 3600 * 1000).toISOString();
    const secondAt = new Date(Date.now() - 1800 * 1000).toISOString();
    service.addNetworkStatsSample('eth0', 12.5, 3.2, firstAt);
    service.addNetworkStatsSample('eth0', 20, 5, secondAt);
    const rows = service.getNetworkStatsHistory(24, 'eth0');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rx_sec, 12.5);
    service.db.close();
  });

  it('prunes samples older than retention window', () => {
    const service = new DatabaseService(tempDb());
    const old = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const recent = new Date().toISOString();
    service.addNetworkStatsSample('wlan0', 1, 1, old);
    service.addNetworkStatsSample('wlan0', 2, 2, recent);
    service.pruneNetworkStats(7);
    const rows = service.getNetworkStatsHistory(24 * 14);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rx_sec, 2);
    service.db.close();
  });
});
