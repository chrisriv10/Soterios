'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('crypto');
const { checkHibpPassword, sha1Hex } = require('../browser-extension/dist/test/credential.js');
const { inspectUrl, inspectCredentialDestination } = require('../browser-extension/dist/test/heuristics.js');
const { migrateSettings, providerEnabled } = require('../browser-extension/dist/test/settings.js');
const { pruneHistory } = require('../browser-extension/dist/test/history.js');
const { verifyFeedManifest, threatToken, domainThreatTokens } = require('../browser-extension/dist/test/feed.js');

beforeEach(() => {});

test('HIBP makes exactly one padded request and discards count-zero padding rows', async () => {
  const hash = await sha1Hex('completed password'); const suffix = hash.slice(5); const calls = [];
  const result = await checkHibpPassword('completed password', undefined, async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => `${suffix}:0\n${'A'.repeat(35)}:0` }; });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.headers['Add-Padding'], 'true'); assert.equal(result.found, false); assert.equal(result.count, 0);
});
test('HIBP reports exact prevalence from a validated response line', async () => { const hash = await sha1Hex('match me'); const suffix = hash.slice(5); const result = await checkHibpPassword('match me', undefined, async () => ({ ok: true, status: 200, text: async () => `${suffix}:41\nINVALID:999` })); assert.deepEqual(result, { found: true, count: 41 }); });

test('conservative URL heuristics produce advisories with exact reason codes', () => { assert.deepEqual(inspectUrl('http://127.0.0.1/login').map((item) => item.code), ['IP_LITERAL_HOST', 'INSECURE_CREDENTIAL_PATH']); assert.ok(inspectUrl('https://paypal.example.net/signin').some((item) => item.code === 'BRAND_IMPERSONATION')); assert.ok(inspectUrl('https://trusted.example@evil.example/login').some((item) => item.code === 'DECEPTIVE_USERINFO')); assert.equal(inspectCredentialDestination('https://example.com/login', 'https://collector.test/submit')[0].code, 'CROSS_SITE_CREDENTIAL_FORM'); });

test('official Microsoft Outlook and account hosts are not reported as brand impersonation', () => {
  const officialHosts = [
    'https://outlook.office.com/mail/',
    'https://outlook.live.com/mail/',
    'https://outlook.cloud.microsoft/mail/',
    'https://login.microsoftonline.com/common/oauth2/authorize',
    'https://account.microsoft.com/'
  ];
  for (const url of officialHosts) {
    assert.equal(inspectUrl(url).some((item) => item.code === 'BRAND_IMPERSONATION'), false, url);
  }
});

test('migration suspends all online requests until the new disclosure is confirmed', () => { const migration = migrateSettings({ privacyMode: false, reuseMap: { old: true }, safeBrowsingApiKey: 'local-key' }, { theme: 'aurora', safeBrowsingApiKey: 'sync-key' }); assert.equal(migration.settings.onboarding.confirmedAt, null); assert.equal(migration.settings.onlineServices.hibp, true); assert.equal(providerEnabled(migration.settings, 'hibp'), false); assert.equal(migration.settings.onboarding.reuseResetNoticePending, true); assert.equal(migration.display.theme, 'aurora'); assert.equal(migration.googleKey, 'local-key'); assert.ok(migration.deleteLocalKeys.includes('reuseMap')); assert.ok(migration.deleteSyncKeys.includes('safeBrowsingApiKey')); });

test('30-day findings retention removes old records and caps local history', () => { const now = Date.parse('2026-08-15T00:00:00Z'); const fresh = { id: '1', timestamp: '2026-08-14T00:00:00Z', category: 'phishing', severity: 'danger', domain: 'example.com', reasonCodes: ['X'], resolution: 'open' }; const old = { ...fresh, id: '2', timestamp: '2026-06-01T00:00:00Z' }; assert.deepEqual(pruneHistory([old, fresh], now).map((event) => event.id), ['1']); });

test('feed manifests require a valid Ed25519 signature and reject unsigned data', async () => { const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const manifest = { schema: 1, version: 7, generatedAt: '2026-08-15T00:00:00.000Z', expiresAt: '2026-08-16T00:00:00.000Z', shards: [{ id: 'ab', file: 'ab.json', sha256: 'a'.repeat(64), count: 1 }] }; const payload = Buffer.from(JSON.stringify({ schema: manifest.schema, version: manifest.version, generatedAt: manifest.generatedAt, expiresAt: manifest.expiresAt, shards: manifest.shards })); manifest.signature = sign(null, payload, privateKey).toString('base64'); const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); assert.equal(await verifyFeedManifest(manifest, spki), true); assert.equal(await verifyFeedManifest({ ...manifest, signature: undefined }, spki), false); });
test('feed tokens are 128-bit hashes of canonical URLs', async () => { const a = await threatToken('https://example.com/login?secret=1#x'); const b = await threatToken('https://example.com/login?other=2'); assert.match(a, /^[0-9a-f]{32}$/); assert.equal(a, b); });
test('domain feed tokens match an exact listed domain and its subdomains without matching the parent', async () => {
  const listed = await domainThreatTokens('https://login.example.com/');
  const child = await domainThreatTokens('https://deep.login.example.com/path');
  const parent = await domainThreatTokens('https://example.com/');
  assert.ok(child.includes(listed[0]));
  assert.ok(!parent.includes(listed[0]));
});
