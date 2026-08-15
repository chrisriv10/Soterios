const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  HIBP_API,
  sha1Hex,
  runHibpCheck,
  runThreatChecks
} = require('../browser-extension/src/threatChecks.js');

function mockFetch(text, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => text });
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