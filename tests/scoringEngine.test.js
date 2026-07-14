const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ScoringEngine } = require('../src/security/ScoringEngine');

describe('ScoringEngine.classify', () => {
  it('private IPv4 ranges are SAFE', () => {
    assert.equal(ScoringEngine.classify({ remoteAddress: '10.0.0.1', remotePort: 443 }), 'SAFE');
    assert.equal(ScoringEngine.classify({ remoteAddress: '172.16.0.1', remotePort: 443 }), 'SAFE');
    assert.equal(ScoringEngine.classify({ remoteAddress: '172.31.255.1', remotePort: 443 }), 'SAFE');
    assert.equal(ScoringEngine.classify({ remoteAddress: '192.168.0.1', remotePort: 443 }), 'SAFE');
  });

  it('loopback addresses are SAFE', () => {
    assert.equal(ScoringEngine.classify({ remoteAddress: '127.0.0.1', remotePort: 8080 }), 'SAFE');
    assert.equal(ScoringEngine.classify({ remoteAddress: '::1', remotePort: 8080 }), 'SAFE');
  });

  it('blocklisted IPs are MALICIOUS regardless of port', () => {
    assert.equal(ScoringEngine.classify({ remoteAddress: '8.8.8.8', remotePort: 443 }, true), 'MALICIOUS');
    assert.equal(ScoringEngine.classify({ remoteAddress: '8.8.8.8', remotePort: 4444 }, true), 'MALICIOUS');
  });

  it('public HTTPS with hostname is SAFE', () => {
    assert.equal(ScoringEngine.classify({
      remoteAddress: '93.184.216.34',
      remotePort: 443,
      hostname: 'example.com'
    }), 'SAFE');
  });

  it('public HTTPS without hostname is UNKNOWN', () => {
    assert.equal(ScoringEngine.classify({
      remoteAddress: '93.184.216.34',
      remotePort: 443
    }), 'UNKNOWN');
  });

  it('public IP on uncommon port is UNKNOWN', () => {
    assert.equal(ScoringEngine.classify({
      remoteAddress: '93.184.216.34',
      remotePort: 4444
    }), 'UNKNOWN');
  });
});

describe('ScoringEngine helper edge cases', () => {
  it('isPrivateIp handles null and empty input', () => {
    assert.equal(ScoringEngine.isPrivateIp(null), false);
    assert.equal(ScoringEngine.isPrivateIp(''), false);
  });

  it('isLoopback handles null and empty input', () => {
    assert.equal(ScoringEngine.isLoopback(null), false);
    assert.equal(ScoringEngine.isLoopback(''), false);
  });
});
