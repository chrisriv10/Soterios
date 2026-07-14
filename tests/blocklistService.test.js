const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BlocklistService } = require('../src/security/BlocklistService');

function makeService() {
  return new BlocklistService({ getBlocklistCache: () => null });
}

describe('BlocklistService.ipToInt', () => {
  it('converts 0.0.0.0 to 0', () => {
    assert.equal(BlocklistService.ipToInt('0.0.0.0'), 0);
  });

  it('converts 255.255.255.255 to 4294967295', () => {
    assert.equal(BlocklistService.ipToInt('255.255.255.255'), 4294967295);
  });

  it('converts 192.168.1.1 correctly', () => {
    assert.equal(BlocklistService.ipToInt('192.168.1.1'), 3232235777);
  });

  it('returns null for invalid input', () => {
    assert.equal(BlocklistService.ipToInt(null), null);
    assert.equal(BlocklistService.ipToInt(''), null);
    assert.equal(BlocklistService.ipToInt('not-an-ip'), null);
    assert.equal(BlocklistService.ipToInt('256.0.0.1'), null);
    assert.equal(BlocklistService.ipToInt('1.2.3'), null);
  });
});

describe('BlocklistService.isListed', () => {
  let service;

  beforeEach(() => {
    service = makeService();
  });

  it('/24 range matches addresses inside the subnet', () => {
    service.parseAndStore('test', '192.168.1.0/24\n');
    assert.equal(service.isListed('192.168.1.50'), true);
  });

  it('/24 range does not match addresses outside the subnet', () => {
    service.parseAndStore('test', '192.168.1.0/24\n');
    assert.equal(service.isListed('192.168.2.1'), false);
  });

  it('/32 matches only the exact host', () => {
    service.parseAndStore('test', '10.0.0.5/32\n');
    assert.equal(service.isListed('10.0.0.5'), true);
    assert.equal(service.isListed('10.0.0.6'), false);
  });

  it('/0 matches every IPv4 address', () => {
    service.parseAndStore('test', '0.0.0.0/0\n');
    assert.equal(service.isListed('8.8.8.8'), true);
    assert.equal(service.isListed('203.0.113.1'), true);
  });

  it('IPv6 input returns false without throwing', () => {
    service.parseAndStore('test', '192.168.1.0/24\n');
    assert.equal(service.isListed('2001:db8::1'), false);
    assert.equal(service.isListed('::1'), false);
  });
});
