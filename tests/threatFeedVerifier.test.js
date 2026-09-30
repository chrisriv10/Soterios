'use strict';

// Regression coverage for tools/verify-threat-feed.mjs. Every test builds a
// temporary signed feed (temporary Ed25519 keys, never production material)
// and executes the REAL verifier CLI via spawnSync. No fixtures are
// committed and no network access occurs.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VERIFIER = path.join(REPO_ROOT, 'tools', 'verify-threat-feed.mjs');
const BUILDER = path.join(REPO_ROOT, 'tools', 'build-threat-feed.mjs');

function runVerifier(feedDir, keyFile, extraArgs = []) {
  const result = spawnSync(process.execPath, [VERIFIER, feedDir, keyFile, ...extraArgs], {
    cwd: REPO_ROOT, shell: false, encoding: 'utf8'
  });
  return { status: result.status, output: `${result.stdout || ''}\n${result.stderr || ''}` };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeKeys() {
  return crypto.generateKeyPairSync('ed25519');
}

function writePublicKey(dir, publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const keyFile = path.join(dir, 'feed-public-key.json');
  fs.writeFileSync(keyFile, JSON.stringify({ spkiBase64: spki }));
  return keyFile;
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function sha256hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function signManifest(manifest, privateKey) {
  let projected;
  try {
    projected = {
      schema: manifest.schema,
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      expiresAt: manifest.expiresAt,
      shards: manifest.shards.map(({ id, file, sha256, count }) => ({ id, file, sha256, count }))
    };
  } catch (_) {
    projected = { unshaped: true };
  }
  manifest.signature = crypto.sign(null, Buffer.from(JSON.stringify(projected)), privateKey).toString('base64');
}

// shards: [{ id, file, tokens }] written to dir; mutateManifest adjusts the
// manifest object after descriptors are built but before signing.
function buildSignedFeed({ dir, keys, shards, mutateManifest = null, version = 7, generatedAt = null, expiresAt = null, signWith = null }) {
  const descriptors = shards.map(({ id, file, tokens, rawBody = null }) => {
    const body = rawBody !== null ? Buffer.from(rawBody) : Buffer.from(`${JSON.stringify({ schema: 1, id, tokens })}\n`);
    const shardPath = path.join(dir, file);
    fs.mkdirSync(path.dirname(shardPath), { recursive: true });
    fs.writeFileSync(shardPath, body);
    return { id, file, sha256: sha256hex(body), count: Object.keys(tokens).length };
  });
  const now = new Date();
  const manifest = {
    schema: 1,
    version,
    generatedAt: generatedAt || now.toISOString(),
    expiresAt: expiresAt || new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
    shards: descriptors
  };
  if (mutateManifest) mutateManifest(manifest, descriptors);
  signManifest(manifest, signWith || keys.privateKey);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, descriptors };
}

function withTempRoot(fn) {
  return async () => {
    const root = tempDir('soterios-feed-');
    try {
      await fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe('threat-feed verifier valid feed control', () => {
  it('accepts a valid signed feed and reports version without stale warnings', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    buildSignedFeed({ dir: feedDir, keys, shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'phishing' } }], version: 7 });
    const result = runVerifier(feedDir, keyFile);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /feed 7/);
    assert.match(result.output, /1 shards/);
    assert.doesNotMatch(result.output, /stale/i);
  }));

  it('rejects an unsigned feed and a wrong-key feed', withTempRoot(async (root) => {
    const keys = makeKeys();
    const other = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const otherKeyFile = writePublicKey(root, other.publicKey);
    fs.renameSync(otherKeyFile, path.join(root, 'other-key.json'));
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    const { manifest } = buildSignedFeed({ dir: feedDir, keys, shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'malware' } }] });
    delete manifest.signature;
    fs.writeFileSync(path.join(feedDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const unsigned = runVerifier(feedDir, keyFile);
    assert.notEqual(unsigned.status, 0);
    assert.match(unsigned.output, /signature/i);
    buildSignedFeed({ dir: feedDir, keys, shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'malware' } }] });
    const wrongKey = runVerifier(feedDir, path.join(root, 'other-key.json'));
    assert.notEqual(wrongKey.status, 0);
    assert.match(wrongKey.output, /signature/i);
  }));

  it('fails clearly when the manifest is missing', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not found/i);
  }));
});

describe('threat-feed verifier malformed manifests', () => {
  const cases = [
    ['schema', (m) => { m.schema = 2; }, /schema/],
    ['version-zero', (m) => { m.version = 0; }, /version/],
    ['version-float', (m) => { m.version = 1.5; }, /version/],
    ['version-string', (m) => { m.version = '7'; }, /version/],
    ['version-unsafe', (m) => { m.version = 2 ** 53; }, /version/],
    ['generatedAt', (m) => { m.generatedAt = 'not-a-date'; }, /generatedAt/],
    ['expiresAt', (m) => { m.expiresAt = 'not-a-date'; }, /expiresAt/],
    ['order', (m) => { m.expiresAt = m.generatedAt; }, /expiresAt/],
    ['shards-not-array', (m) => { m.shards = {}; }, /shards must be an array/],
    ['null-manifest', () => null, /must be an object/],
    ['bad-id', (m) => { m.shards[0].id = 'xyz'; }, /shard id/],
    ['bad-sha', (m) => { m.shards[0].sha256 = 'z'.repeat(64); }, /sha256/],
    ['short-sha', (m) => { m.shards[0].sha256 = 'ab'; }, /sha256/],
    ['negative-count', (m) => { m.shards[0].count = -1; }, /count/],
    ['huge-count', (m) => { m.shards[0].count = 5_000_001; }, /count/],
    ['float-count', (m) => { m.shards[0].count = 1.5; }, /count/],
    ['unsafe-file', (m) => { m.shards[0].file = '../outside.json'; }, /unsafe/],
  ];
  for (const [name, mutate, pattern] of cases) {
    it(`rejects malformed manifest: ${name}`, withTempRoot(async (root) => {
      const keys = makeKeys();
      const feedDir = path.join(root, 'feed');
      fs.mkdirSync(feedDir, { recursive: true });
      const keyFile = writePublicKey(root, keys.publicKey);
      const token = randomToken();
      if (name === 'null-manifest') {
        fs.writeFileSync(path.join(feedDir, 'manifest.json'), 'null');
      } else {
        buildSignedFeed({
          dir: feedDir, keys,
          shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'phishing' } }],
          mutateManifest: (manifest) => mutate(manifest)
        });
      }
      const result = runVerifier(feedDir, keyFile);
      assert.notEqual(result.status, 0, `expected failure for ${name}: ${result.output}`);
      assert.match(result.output, pattern, `expected ${pattern} for ${name}: ${result.output}`);
    }));
  }

  it('rejects more than 512 shards', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const shards = [];
    for (let i = 0; i < 513; i += 1) {
      const id = i.toString(16).padStart(2, '0');
      shards.push({ id, file: `shards/${id}.json`, tokens: {} });
    }
    buildSignedFeed({ dir: feedDir, keys, shards });
    // Remove the written shard bodies: shape validation must fail first.
    fs.rmSync(path.join(feedDir, 'shards'), { recursive: true, force: true });
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /512/);
  }));

  it('rejects an oversized manifest before parsing', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    fs.writeFileSync(path.join(feedDir, 'manifest.json'), `{"padding": "${'x'.repeat(600 * 1024)}"}`);
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /size limit/);
  }));
});

describe('threat-feed verifier shards', () => {
  it('rejects an oversized shard before parsing', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const bigBody = Buffer.alloc(9 * 1024 * 1024, 'a');
    const file = 'shards/ab.json';
    fs.mkdirSync(path.join(feedDir, 'shards'), { recursive: true });
    fs.writeFileSync(path.join(feedDir, file), bigBody);
    const manifest = {
      schema: 1, version: 7,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      shards: [{ id: 'ab', file, sha256: sha256hex(bigBody), count: 0 }]
    };
    signManifest(manifest, keys.privateKey);
    fs.writeFileSync(path.join(feedDir, 'manifest.json'), JSON.stringify(manifest));
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /size limit/);
  }));

  it('rejects a checksum mismatch while the signature stays valid', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    const id = token.slice(0, 2);
    buildSignedFeed({ dir: feedDir, keys, shards: [{ id, file: `shards/${id}.json`, tokens: { [token]: 'phishing' } }] });
    fs.writeFileSync(path.join(feedDir, `shards/${id}.json`), JSON.stringify({ schema: 1, id, tokens: { [token]: 'phishing' }, tampered: true }));
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Checksum mismatch/);
  }));

  it('rejects invalid shard schema, id, tokens, and categories', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    const id = token.slice(0, 2);
    const variants = [
      ['bad-schema', JSON.stringify({ schema: 2, id, tokens: {} }), /invalid schema/],
      ['bad-id', JSON.stringify({ schema: 1, id: 'zz', tokens: {} }), /invalid schema/],
      ['bad-token', JSON.stringify({ schema: 1, id, tokens: { [token]: 'phishing', ['x'.repeat(32)]: 'malware' } }), /invalid indicators/],
      ['bad-category', JSON.stringify({ schema: 1, id, tokens: { [token]: 'spam' } }), /invalid indicators/],
    ];
    for (const [name, rawBody, pattern] of variants) {
      const sub = path.join(feedDir, name);
      fs.mkdirSync(sub, { recursive: true });
      const body = Buffer.from(rawBody);
      const file = 'shards/ab.json';
      fs.mkdirSync(path.join(sub, 'shards'), { recursive: true });
      fs.writeFileSync(path.join(sub, file), body);
      const manifest = {
        schema: 1, version: 7,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        shards: [{ id, file, sha256: sha256hex(body), count: Object.keys(JSON.parse(rawBody).tokens).length }]
      };
      signManifest(manifest, keys.privateKey);
      fs.writeFileSync(path.join(sub, 'manifest.json'), JSON.stringify(manifest));
      const result = runVerifier(sub, keyFile);
      assert.notEqual(result.status, 0, `expected failure for ${name}: ${result.output}`);
      assert.match(result.output, pattern, `expected ${pattern} for ${name}`);
    }
  }));

  it('accepts uppercase SHA descriptors and uppercase tokens like the extension', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken().toUpperCase();
    const id = token.slice(0, 2).toLowerCase();
    const body = Buffer.from(JSON.stringify({ schema: 1, id, tokens: { [token]: 'malware' } }));
    const file = `shards/${id}.json`;
    fs.mkdirSync(path.join(feedDir, 'shards'), { recursive: true });
    fs.writeFileSync(path.join(feedDir, file), body);
    const manifest = {
      schema: 1, version: 7,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      shards: [{ id, file, sha256: sha256hex(body).toUpperCase(), count: 1 }]
    };
    signManifest(manifest, keys.privateKey);
    fs.writeFileSync(path.join(feedDir, 'manifest.json'), JSON.stringify(manifest));
    const result = runVerifier(feedDir, keyFile);
    assert.equal(result.status, 0, result.output);
  }));
});

describe('threat-feed verifier traversal containment', () => {
  it('rejects descriptor escape paths and never reads outside the feed', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const sentinelPath = path.join(root, 'outside.json');
    const sentinelBody = JSON.stringify({ schema: 1, id: 'ou', tokens: {} });
    fs.writeFileSync(sentinelPath, sentinelBody);
    const before = fs.readFileSync(sentinelPath, 'utf8');
    for (const escape of ['../outside.json', 'shards/../../outside.json']) {
      const manifest = {
        schema: 1, version: 7,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        shards: [{ id: 'ab', file: escape, sha256: sha256hex(Buffer.from(sentinelBody)), count: 0 }]
      };
      signManifest(manifest, keys.privateKey);
      fs.writeFileSync(path.join(feedDir, 'manifest.json'), JSON.stringify(manifest));
      const result = runVerifier(feedDir, keyFile);
      assert.notEqual(result.status, 0, `expected failure for ${escape}`);
      assert.match(result.output, /unsafe|escapes/, `expected path error for ${escape}: ${result.output}`);
    }
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), before, 'outside sentinel is untouched');
    assert.deepEqual(fs.readdirSync(root).sort(), ['feed', 'feed-public-key.json', 'outside.json'], 'no files created outside the feed');
  }));

  it('rejects shards that escape through a symlinked feed subdirectory', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    const id = token.slice(0, 2);
    // Build a fully valid feed first, then swing the shards directory to an
    // outside location: semantic validation still passes, so only the
    // containment layer can stop the read.
    buildSignedFeed({ dir: feedDir, keys, shards: [{ id, file: `shards/${id}.json`, tokens: { [token]: 'phishing' } }] });
    const outside = path.join(root, 'real-shards');
    fs.mkdirSync(outside, { recursive: true });
    fs.renameSync(path.join(feedDir, 'shards', `${id}.json`), path.join(outside, `${id}.json`));
    fs.rmdirSync(path.join(feedDir, 'shards'));
    fs.symlinkSync(outside, path.join(feedDir, 'shards'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = fs.readFileSync(path.join(outside, `${id}.json`), 'utf8');
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /escapes/);
    assert.equal(fs.readFileSync(path.join(outside, `${id}.json`), 'utf8'), before, 'outside file is untouched');
  }));
});

describe('threat-feed verifier rollback baseline', () => {
  it('rejects lower, allows equal, allows newer versions', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    buildSignedFeed({ dir: feedDir, keys, version: 7, shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'phishing' } }] });
    const lower = runVerifier(feedDir, keyFile, ['--current-version', '8']);
    assert.notEqual(lower.status, 0);
    assert.match(lower.output, /rollback/);
    const equal = runVerifier(feedDir, keyFile, ['--current-version', '7']);
    assert.equal(equal.status, 0, equal.output);
    const newer = runVerifier(feedDir, keyFile, ['--current-version', '6']);
    assert.equal(newer.status, 0, newer.output);
  }));

  it('rejects a non-integer baseline value', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const result = runVerifier(feedDir, keyFile, ['--current-version', 'abc']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /current-version/);
  }));
});

describe('threat-feed verifier expiry semantics', () => {
  it('passes a well-formed expired feed with an explicit stale warning', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    buildSignedFeed({
      dir: feedDir, keys,
      generatedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T01:00:00.000Z',
      shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'malware' } }]
    });
    const result = runVerifier(feedDir, keyFile);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /stale/i);
    assert.match(result.output, /\(stale\)/);
  }));

  it('still rejects malformed timestamp ordering instead of reporting stale', withTempRoot(async (root) => {
    const keys = makeKeys();
    const feedDir = path.join(root, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    const keyFile = writePublicKey(root, keys.publicKey);
    const token = randomToken();
    buildSignedFeed({
      dir: feedDir, keys,
      generatedAt: '2020-01-01T01:00:00.000Z',
      expiresAt: '2020-01-01T00:00:00.000Z',
      shards: [{ id: token.slice(0, 2), file: `shards/${token.slice(0, 2)}.json`, tokens: { [token]: 'phishing' } }]
    });
    const result = runVerifier(feedDir, keyFile);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /expiresAt/);
  }));
});

describe('threat-feed builder to verifier compatibility', () => {
  it('accepts output built by the current builder without signature changes', async () => {
    const root = tempDir('soterios-feed-compat-');
    try {
      const keys = makeKeys();
      const inputDir = path.join(root, 'input');
      const outDir = path.join(root, 'feed');
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, 'domains.txt'), 'example.test\n');
      fs.writeFileSync(path.join(inputDir, 'urlhaus.json'), JSON.stringify({
        urls: [{ url: 'http://example.test/malware-path', url_status: 'online' }]
      }));
      const keyFile = writePublicKey(root, keys.publicKey);
      const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
      const build = spawnSync(process.execPath, [
        BUILDER, '--certpl', path.join(inputDir, 'domains.txt'),
        '--urlhaus', path.join(inputDir, 'urlhaus.json'),
        '--output', outDir
      ], {
        cwd: REPO_ROOT, shell: false, encoding: 'utf8',
        env: { ...process.env, THREAT_FEED_PRIVATE_KEY: privatePem }
      });
      assert.equal(build.status, 0, build.stderr || build.stdout);
      const result = runVerifier(outDir, keyFile);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /shards/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
