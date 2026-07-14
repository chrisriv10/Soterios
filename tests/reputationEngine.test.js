const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const DatabaseService = require('../src/core/database');
const ReputationEngine = require('../src/security/ReputationEngine');

const SAMPLE_HASH = 'a'.repeat(64);

describe('ReputationEngine', () => {
  let db;
  let engine;

  beforeEach(() => {
    db = new DatabaseService(':memory:');
    engine = new ReputationEngine(db);
  });

  it('returns null for unknown hashes', async () => {
    const result = await engine.checkHash(SAMPLE_HASH);
    assert.equal(result, null);
  });

  it('stores and returns safe verdicts', async () => {
    const added = await engine.addHash(SAMPLE_HASH, 'safe', 'Trusted installer');
    assert.equal(added.success, true);

    const result = await engine.checkHash(SAMPLE_HASH);
    assert.equal(result.verdict, 'safe');
    assert.equal(result.note, 'Trusted installer');
  });

  it('stores and returns malicious verdicts', async () => {
    const hash = 'b'.repeat(64);
    await engine.addHash(hash, 'malicious', 'Known malware sample');

    const result = await engine.checkHash(hash);
    assert.equal(result.verdict, 'malicious');
  });

  it('rejects invalid hash input', async () => {
    const result = await engine.addHash('not-a-hash', 'safe');
    assert.equal(result.success, false);
  });

  it('removes stored hashes', async () => {
    await engine.addHash(SAMPLE_HASH, 'safe');
    const removed = await engine.removeHash(SAMPLE_HASH);
    assert.equal(removed.success, true);
    assert.equal(await engine.checkHash(SAMPLE_HASH), null);
  });

  it('lists stored hashes', async () => {
    await engine.addHash(SAMPLE_HASH, 'safe');
    const rows = await engine.listHashes();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hash, SAMPLE_HASH);
  });
});
