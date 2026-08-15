const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAX_REUSE_ENTRIES,
  computeSha256,
  checkReuse,
  storeReuse
} = require('../browser-extension/src/reuseMap.js');

test('computeSha256 returns a 64-char hex digest', async () => {
  const hash = await computeSha256('hunter2');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hash, await computeSha256('hunter3'));
});

test('checkReuse flags same hash under a different hostname', async () => {
  const hash = await computeSha256('hunter2');
  const map = { 'github.com': { hash, lastSeen: 1000 } };
  const reuse = checkReuse(map, hash, 'stackoverflow.com');
  assert.strictEqual(reuse.reused, true);
  assert.strictEqual(reuse.otherDomain, 'github.com');
});

test('local reuse detection is unaffected by privacy mode', async () => {
  const hash = await computeSha256('hunter2');
  let map = storeReuse({}, hash, 'github.com', 1000);
  map = storeReuse(map, hash, 'stackoverflow.com', 2000);
  const reuse = checkReuse(map, hash, 'stackoverflow.com');
  assert.strictEqual(reuse.reused, true);
  assert.strictEqual(reuse.otherDomain, 'github.com');
  assert.strictEqual(Object.keys(map).length, 2);
});

test('checkReuse does not flag same hash on the same hostname', async () => {
  const hash = await computeSha256('hunter2');
  const map = { 'github.com': { hash, lastSeen: 1000 } };
  const reuse = checkReuse(map, hash, 'github.com');
  assert.strictEqual(reuse.reused, false);
  assert.strictEqual(reuse.otherDomain, null);
});

test('checkReuse does not flag different hashes', async () => {
  const a = await computeSha256('one');
  const b = await computeSha256('two');
  const map = { 'github.com': { hash: a, lastSeen: 1000 } };
  const reuse = checkReuse(map, b, 'stackoverflow.com');
  assert.strictEqual(reuse.reused, false);
  assert.strictEqual(reuse.otherDomain, null);
});

test('checkReuse ignores malformed entries', async () => {
  const hash = await computeSha256('x');
  const map = { 'broken.com': null };
  const reuse = checkReuse(map, hash, 'other.com');
  assert.strictEqual(reuse.reused, false);
});

test('storeReuse evicts the oldest entry when over the cap', async () => {
  const hash = await computeSha256('x');
  let map = {};
  for (let i = 0; i < MAX_REUSE_ENTRIES; i += 1) {
    map = storeReuse(map, hash + i, `domain${i}.com`, 1000 + i);
  }
  assert.strictEqual(Object.keys(map).length, MAX_REUSE_ENTRIES);
  map = storeReuse(map, hash + 'new', 'overflow.com', 1000 + MAX_REUSE_ENTRIES);
  assert.strictEqual(Object.keys(map).length, MAX_REUSE_ENTRIES);
  assert.strictEqual(map['domain0.com'], undefined);
  assert.ok(map['overflow.com']);
});

test('storeReuse keeps the most recently used entry after eviction', async () => {
  const hash = await computeSha256('x');
  let map = {};
  for (let i = 0; i < MAX_REUSE_ENTRIES; i += 1) {
    map = storeReuse(map, hash + i, `domain${i}.com`, 1000 + i);
  }
  map = storeReuse(map, hash + 'keep', 'domain9.com', 9999);
  map = storeReuse(map, hash + 'new', 'overflow.com', 10000);
  assert.strictEqual(map['domain9.com'].hash, hash + 'keep');
  assert.strictEqual(map['domain0.com'], undefined);
});

test('storeReuse refreshes lastSeen without flagging same-domain updates', async () => {
  const hash = await computeSha256('x');
  let map = storeReuse({}, hash, 'a.com', 100);
  map = storeReuse(map, hash, 'b.com', 200);
  map = storeReuse(map, hash, 'a.com', 300);
  assert.strictEqual(map['a.com'].lastSeen, 300);
  assert.strictEqual(map['b.com'].lastSeen, 200);
  assert.strictEqual(Object.keys(map).length, 2);
});

test('storeReuse never drops the domain being stored', async () => {
  const hash = await computeSha256('x');
  let map = {};
  for (let i = 0; i < MAX_REUSE_ENTRIES; i += 1) {
    map = storeReuse(map, hash + i, `domain${i}.com`, 1000 + i);
  }
  map = storeReuse(map, hash + 'current', 'domain5.com', 2000);
  map = storeReuse(map, hash + 'new', 'domain5.com', 5000);
  assert.strictEqual(map['domain5.com'].hash, hash + 'new');
  assert.strictEqual(Object.keys(map).length, MAX_REUSE_ENTRIES);
});