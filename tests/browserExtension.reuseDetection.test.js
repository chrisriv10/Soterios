'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { registrableDomain, canonicalSiteToken, isIpLiteral } = require('../browser-extension/dist/test/domains.js');
const { credentialReuseToken, checkAndRememberReuse, analyzePassword, generateCredential } = require('../browser-extension/dist/test/credential.js');

let values;
beforeEach(() => {
  values = {};
  global.chrome = { storage: { local: { get: async (key) => typeof key === 'string' ? { [key]: values[key] } : { ...values }, set: async (patch) => Object.assign(values, patch) } } };
});
afterEach(() => { delete global.chrome; });

test('registrable-domain comparison groups ordinary subdomains', () => { assert.equal(registrableDomain('login.accounts.example.com'), 'example.com'); assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk'); assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1'); });
test('URL canonicalization removes fragments, queries, duplicate slashes, and a trailing slash', () => { assert.equal(canonicalSiteToken('HTTPS://Example.COM//login/?token=secret#x'), 'https://example.com/login'); assert.equal(isIpLiteral('[2001:db8::1]'), true); });
test('reuse tokens are keyed per install and never equal a raw SHA-256 hash', async () => { const first = await credentialReuseToken('same password'); assert.match(first, /^[0-9A-F]{64}$/); values = {}; const second = await credentialReuseToken('same password'); assert.notEqual(first, second); });
test('reuse detection compares registrable sites, not raw hostnames', async () => { assert.equal((await checkAndRememberReuse('secret value', 'login.example.com')).reused, false); assert.equal((await checkAndRememberReuse('secret value', 'account.example.com')).reused, false); const result = await checkAndRememberReuse('secret value', 'other.test'); assert.equal(result.reused, true); assert.deepEqual(result.domains, ['example.com']); });
test('offline strength and generators require no network service', () => { assert.ok(analyzePassword('correct horse battery staple').score >= 3); assert.ok(analyzePassword('password123').score <= 1); assert.match(generateCredential({ mode: 'password', length: 24 }), /^.{24}$/); assert.equal(generateCredential({ mode: 'passphrase', words: 5 }).split('-').length, 5); });
