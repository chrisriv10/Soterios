'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildTracePayload, encryptTrace } = require('../src/main/processTrace');

function fixture() {
  return {
    protocolVersion: 1,
    capabilities: { provider: 'test' },
    processes: [{
      pid: 42,
      name: 'fixture.exe',
      user: 'Alice',
      path: 'C:\\Users\\Alice\\Downloads\\fixture.exe',
      commandLine: '"C:\\Users\\Alice\\Downloads\\fixture.exe" --token secret',
      connections: [{ localAddress: '192.168.1.2', remoteAddress: '203.0.113.20' }],
    }],
  };
}

describe('process trace privacy', () => {
  it('strictly redacts user, command arguments, personal paths, and addresses', () => {
    const payload = buildTracePayload(fixture(), new Map(), { redaction: 'strict' });
    const encoded = JSON.stringify(payload);

    assert.equal(encoded.includes('Alice'), false);
    assert.equal(encoded.includes('--token secret'), false);
    assert.equal(encoded.includes('203.0.113.20'), false);
    assert.equal(payload.snapshot.processes[0].user, '<user>');
    assert.equal(payload.snapshot.processes[0].commandLine, 'fixture.exe');
  });

  it('encrypts with the declared Argon2id and AES-256-GCM format', async () => {
    const payload = buildTracePayload(fixture(), new Map(), { redaction: 'standard' });
    const encoded = await encryptTrace(payload, 'correct horse battery staple');
    const envelope = JSON.parse(encoded.toString('utf8'));

    assert.equal(envelope.cipher, 'AES-256-GCM');
    assert.equal(envelope.kdf.name, 'Argon2id');
    assert.equal(typeof envelope.ciphertext, 'string');
    assert.equal(encoded.includes(Buffer.from('fixture.exe')), false);
    assert.equal(Buffer.from(envelope.nonce, 'base64').length, 12);
    assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
  });

  it('requires a meaningful passphrase', async () => {
    await assert.rejects(encryptTrace({ hello: 'world' }, 'short'), /between 10 and 256/);
  });
});
