const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  HIBP_API,
  sha1Hex,
  runHibpCheck,
  runThreatChecks,
  runSafeBrowsingCheck,
  urlHashPrefix
} = require('../browser-extension/src/threatChecks.js');

function mockFetch(text, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => text });
}

function jsonFetch(data, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => data });
}

function countingFetch(inner) {
  const calls = [];
  const wrapped = async (url) => {
    calls.push(url);
    return inner(url);
  };
  wrapped.calls = calls;
  return wrapped;
}

function baseConfig(overrides) {
  return Object.assign({
    privacyMode: false,
    hibpEnabled: true,
    safeBrowsingEnabled: true,
    safeBrowsingApiKey: 'test-key'
  }, overrides || {});
}

test('privacy mode on blocks the HIBP check without calling the API', async () => {
  const fetchFn = countingFetch(mockFetch(''));
  const checks = await runThreatChecks({
    password: 'hunter2',
    config: baseConfig({ privacyMode: true }),
    fetchFn
  });
  assert.strictEqual(checks.hibp.error, 'Disabled by Privacy Mode');
  assert.strictEqual(fetchFn.calls.length, 0);
});

test('privacy mode on blocks the Safe Browsing check without calling the API', async () => {
  const fetchFn = countingFetch(mockFetch(''));
  const checks = await runThreatChecks({
    password: 'hunter2',
    url: 'https://example.com/login',
    config: baseConfig({ privacyMode: true }),
    fetchFn
  });
  assert.strictEqual(checks.safeBrowsing.status, 'disabled');
  assert.strictEqual(checks.safeBrowsing.reason, 'Privacy Mode');
  assert.strictEqual(fetchFn.calls.length, 0);
});

test('privacy mode off preserves current HIBP behavior', async () => {
  const hash = await sha1Hex('test123');
  const suffix = hash.slice(5);
  const fetchFn = countingFetch(mockFetch(`${suffix}:42`));
  const checks = await runThreatChecks({
    password: 'test123',
    config: baseConfig(),
    fetchFn
  });
  assert.strictEqual(checks.hibp.pwned, true);
  assert.strictEqual(checks.hibp.count, 42);
  assert.ok(fetchFn.calls[0].startsWith(HIBP_API));
});

test('hibpEnabled off disables HIBP only, keeping other checks unchanged', async () => {
  const fetchFn = countingFetch(mockFetch(''));
  const checks = await runThreatChecks({
    password: 'test123',
    url: 'https://example.com',
    config: baseConfig({ hibpEnabled: false, safeBrowsingApiKey: undefined }),
    fetchFn
  });
  assert.strictEqual(checks.hibp.error, 'HIBP checks disabled');
  assert.strictEqual(checks.safeBrowsing.status, 'not_configured');
  assert.strictEqual(fetchFn.calls.length, 0);
});

test('runHibpCheck returns pwned when suffix matches', async () => {
  const hash = await sha1Hex('pwnedpass');
  const suffix = hash.slice(5);
  const result = await runHibpCheck({ password: 'pwnedpass', fetchFn: mockFetch(`${suffix}:7`) });
  assert.strictEqual(result.pwned, true);
  assert.strictEqual(result.count, 7);
});

test('runHibpCheck returns safe when suffix is absent', async () => {
  const result = await runHibpCheck({ password: 'freshpass', fetchFn: mockFetch('AAAAAAAA:1\nBBBBBBBB:2') });
  assert.strictEqual(result.pwned, false);
  assert.strictEqual(result.count, 0);
});

test('runHibpCheck returns an error result on API failure', async () => {
  const result = await runHibpCheck({ password: 'test123', fetchFn: async () => { throw new Error('network down'); } });
  assert.strictEqual(result.error, 'network down');
});

test('runSafeBrowsingCheck returns safe when no hash matches', async () => {
  const now = Date.now();
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com/login',
    apiKey: 'test-key',
    fetchFn: jsonFetch({ hashes: [] }),
    now
  });
  assert.strictEqual(result.status, 'safe');
  assert.strictEqual(result.expiresAt, now + 30 * 60 * 1000);
});

test('runSafeBrowsingCheck returns unsafe on matching full hash', async () => {
  const now = Date.now();
  const { fullB64 } = await urlHashPrefix('https://evil.example.com/payload?x=1');
  const result = await runSafeBrowsingCheck({
    url: 'https://evil.example.com/payload?x=1',
    apiKey: 'test-key',
    fetchFn: jsonFetch({
      hashes: [{
        fullHash: fullB64,
        hashList: 'social-engineering',
        expireTime: new Date(now + 10 * 60 * 1000).toISOString(),
        cacheDuration: '60s'
      }]
    }),
    now
  });
  assert.strictEqual(result.status, 'unsafe');
  assert.strictEqual(result.threatType, 'social-engineering');
  assert.ok(result.expiresAt > now + 9 * 60 * 1000 && result.expiresAt <= now + 10 * 60 * 1000 + 1000);
});

test('runSafeBrowsingCheck caps verdict freshness at 30 minutes', async () => {
  const now = Date.now();
  const { fullB64 } = await urlHashPrefix('https://fresh.example.com');
  const result = await runSafeBrowsingCheck({
    url: 'https://fresh.example.com',
    apiKey: 'test-key',
    fetchFn: jsonFetch({
      hashes: [{ fullHash: fullB64, hashList: 'malware', expireTime: new Date(now + 60 * 60 * 1000).toISOString() }]
    }),
    now
  });
  assert.strictEqual(result.status, 'unsafe');
  assert.ok(Math.abs(result.expiresAt - (now + 30 * 60 * 1000)) <= 1000);
});

test('runSafeBrowsingCheck returns unknown on stale threat data', async () => {
  const now = Date.now();
  const { fullB64 } = await urlHashPrefix('https://stale.example.com');
  const result = await runSafeBrowsingCheck({
    url: 'https://stale.example.com',
    apiKey: 'test-key',
    fetchFn: jsonFetch({
      hashes: [{ fullHash: fullB64, hashList: 'malware', expireTime: new Date(now - 60 * 1000).toISOString() }]
    }),
    now
  });
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.reason, 'stale threat data');
});

test('runSafeBrowsingCheck returns unknown on HTTP error', async () => {
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com',
    apiKey: 'test-key',
    fetchFn: jsonFetch({}, 500),
    now: Date.now()
  });
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.reason, 'HTTP 500');
});

test('runSafeBrowsingCheck returns unknown when rate limited', async () => {
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com',
    apiKey: 'test-key',
    fetchFn: jsonFetch({}, 429),
    now: Date.now()
  });
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.reason, 'rate limited');
});

test('runSafeBrowsingCheck returns unknown on network failure', async () => {
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com',
    apiKey: 'test-key',
    fetchFn: async () => { throw new Error('offline'); },
    now: Date.now()
  });
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.reason, 'offline');
});

test('runSafeBrowsingCheck aborts and returns unknown on timeout', async () => {
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com',
    apiKey: 'test-key',
    timeoutMs: 50,
    now: Date.now(),
    fetchFn: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
  });
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.reason, 'timeout');
});

test('runSafeBrowsingCheck returns not_configured without an API key', async () => {
  const result = await runSafeBrowsingCheck({
    url: 'https://example.com',
    fetchFn: async () => { throw new Error('should not be called'); },
    now: Date.now()
  });
  assert.strictEqual(result.status, 'not_configured');
});