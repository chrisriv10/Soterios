'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeEnvelope, encodeFrame, createFrameDecoder, MAX_FRAME_BYTES, getPipeName } = require('../src/native-host/protocol');
const installer = require('../src/extension/installer');
const { spawnSync } = require('child_process');

const dist = path.join(__dirname, '..', 'browser-extension', 'dist', 'chromium');

describe('Soterios extension 2.0 public and privacy contracts', () => {
  it('ships a least-privilege generated MV3 manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '2.0.0');
    assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'activeTab', 'scripting']);
    assert.deepEqual(manifest.optional_permissions, ['nativeMessaging']);
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
    assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://api.pwnedpasswords.com/*'));
  });

  it('contains every generated UI/runtime entry and no telemetry SDK reference', () => {
    for (const file of ['background.js', 'content.js', 'popup.js', 'options.js', 'onboarding.js', 'activity.js', 'popup.html', 'options.html', 'onboarding.html', 'activity.html']) assert.ok(fs.existsSync(path.join(dist, file)), file);
    const scripts = fs.readdirSync(dist).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(dist, name), 'utf8')).join('\n');
    assert.doesNotMatch(scripts, /google-analytics|mixpanel|segment\.com|amplitude|posthog|sentry\.io/i);
    assert.doesNotMatch(scripts, /credential-leak:notify/);
  });

  it('validates the staged extension before desktop installation', () => {
    const manifest = installer.validateExtensionDirectory(dist);
    assert.equal(manifest.version, '2.0.0');
    assert.match(installer.predictExtensionId(installer.getNativeHostDir()), /^[a-p]{32}$/);
  });

  it('refuses to open a folder that does not exist', () => {
    const os = require('node:os');
    const missing = path.join(os.tmpdir(), `soterios-missing-ext-${process.pid}`, 'extension');
    assert.equal(fs.existsSync(path.dirname(missing)), false);
    const result = installer.openExtensionFolder(missing);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Extension folder does not exist yet');
  });
});

describe('NativeEnvelopeV2 framing and validation', () => {
  it('accepts a minimal finding and strips undeclared fields', () => {
    const result = normalizeEnvelope({ protocol: 2, requestId: 'request_12345678', type: 'REPORT_FINDING', payload: { category: 'phishing', severity: 'danger', domain: 'example.com', fullUrl: 'https://example.com/secret', password: 'never' } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.envelope.payload, { category: 'phishing', severity: 'danger', domain: 'example.com' });
  });

  it('explicitly rejects plaintext credential compatibility messages', () => {
    const result = normalizeEnvelope({ type: 'CREDENTIAL_LEAK', password: 'plaintext', domain: 'example.com', count: 2 });
    assert.deepEqual(result, { ok: false, error: 'PLAINTEXT_CREDENTIAL_REJECTED' });
  });

  it('supports old non-plaintext message names for one release', () => {
    const result = normalizeEnvelope({ type: 'THREAT_DETECTED', domain: 'bad.example', threatType: 'malware' });
    assert.equal(result.ok, true); assert.equal(result.legacy, true); assert.equal(result.envelope.payload.category, 'malware');
  });

  it('decodes fragmented correlated frames and rejects oversize output', () => {
    const values = []; const errors = []; const frame = encodeFrame({ protocol: 2, requestId: 'request_12345678', type: 'PING', payload: {} });
    const decode = createFrameDecoder((value) => values.push(value), (error) => errors.push(error)); decode(frame.subarray(0, 3)); decode(frame.subarray(3));
    assert.equal(values.length, 1); assert.equal(errors.length, 0); assert.throws(() => encodeFrame({ value: 'x'.repeat(MAX_FRAME_BYTES) }));
  });

  it('uses a stable per-user pipe name without sensitive data', () => {
    const a = getPipeName({ LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' }, 'Alice'); const b = getPipeName({ LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' }, 'Alice');
    assert.equal(a, b); assert.match(a, /^\\\\\.\\pipe\\soterios-browser-v2-[0-9a-f]{20}$/); assert.doesNotMatch(a, /alice/i);
  });

  it('runs as a standalone executable and reports desktop state with a correlated response', { skip: process.platform !== 'win32' }, () => {
    const executable = path.join(__dirname, '..', 'build', 'native-host', 'SoteriosNativeHost.exe');
    assert.ok(fs.existsSync(executable), 'run npm run native-host:build first');
    const request = { protocol: 2, requestId: 'request_standalone_123', type: 'PING', payload: {} };
    const result = spawnSync(executable, [], { input: encodeFrame(request), timeout: 15_000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.ok(result.stdout.length >= 4);
    const length = result.stdout.readUInt32LE(0); const response = JSON.parse(result.stdout.subarray(4, 4 + length).toString('utf8'));
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'DESKTOP_NOT_RUNNING');
  });
});
