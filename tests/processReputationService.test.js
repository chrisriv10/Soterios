'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProcessReputationService } = require('../src/main/processReputationService');

function fixtureDb() {
  const settings = new Map();
  const cache = new Map();
  return {
    settings,
    cache,
    getSetting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
    setSetting: (key, value) => settings.set(key, value),
    getProcessReputationCache: (hash) => cache.get(hash) || null,
    setProcessReputationCache: (hash, counts) => cache.set(hash, {
      ...counts,
      last_checked: new Date().toISOString(),
    }),
  };
}

function fakeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
  };
}

describe('explicit hash-only reputation checks', () => {
  it('is disabled by default and requires affirmative consent to configure', () => {
    const db = fixtureDb();
    const service = new ProcessReputationService({ db, safeStorage: fakeStorage(), processService: {} });

    assert.equal(service.status().enabled, false);
    assert.throws(() => service.configure('A'.repeat(64), false), /Explicit.*consent/i);
    service.configure('A'.repeat(64), true);
    assert.equal(service.status().enabled, true);
    assert.notEqual(db.settings.get('process.reputationApiKeyEncrypted'), 'A'.repeat(64));
  });

  it('disables all lookups in Privacy Mode', async () => {
    const db = fixtureDb();
    db.setSetting('feature.privacyMode', true);
    db.setSetting('process.reputationEnabled', true);
    const service = new ProcessReputationService({ db, safeStorage: fakeStorage(), processService: {} });

    await assert.rejects(service.check({ pid: 1, startedAt: 'fixture' }), /Privacy Mode/i);
  });

  it('sends only the SHA-256 in the VirusTotal URL and reuses the seven-day cache', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-reputation-'));
    const executable = path.join(root, 'fixture.exe');
    fs.writeFileSync(executable, 'fixture executable bytes');
    const expectedHash = crypto.createHash('sha256').update('fixture executable bytes').digest('hex');
    const db = fixtureDb();
    const applied = [];
    const processService = {
      getProcessByKey: async () => ({ path: executable, hash: null }),
      rememberHash: () => {},
      applyReputation: (_key, value) => applied.push(value),
    };
    const requests = [];
    const service = new ProcessReputationService({
      db,
      safeStorage: fakeStorage(),
      processService,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 1, suspicious: 2, undetected: 60 } } } }),
        };
      },
    });
    service.configure('B'.repeat(64), true);

    try {
      const first = await service.check({ pid: 90, startedAt: 'fixture' });
      const second = await service.check({ pid: 90, startedAt: 'fixture' });

      assert.equal(first.cached, false);
      assert.equal(second.cached, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `https://www.virustotal.com/api/v3/files/${expectedHash}`);
      assert.equal(requests[0].options.method, 'GET');
      assert.deepEqual(Object.keys(requests[0].options.headers).sort(), ['accept', 'x-apikey']);
      assert.equal(JSON.stringify(requests[0]).includes(executable), false);
      assert.equal(JSON.stringify(requests[0]).includes('fixture executable bytes'), false);
      assert.equal(applied.length, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
