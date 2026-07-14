/**
 * BlocklistService - Manages free IP blocklists with caching
 * Fetches and caches free blocklists from public sources
 */

const https = require('https');

/** How often (ms) blocklists are refreshed from their upstream sources. */
const BLOCKLIST_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

class BlocklistService {
  constructor(db) {
    this.db = db;
    this.blocklists = new Map();
    this.refreshInterval = BLOCKLIST_REFRESH_INTERVAL_MS;

    this.sources = [
      {
        name: 'spamhaus-drop',
        url: 'https://www.spamhaus.org/drop/drop.txt',
        format: 'plain',
        version: 4
      },
      {
        name: 'spamhaus-edrop',
        url: 'https://www.spamhaus.org/drop/edrop.txt',
        format: 'plain',
        version: 4
      },
      {
        name: 'spamhaus-drop6',
        url: 'https://www.spamhaus.org/drop/dropv6.txt',
        format: 'plain',
        version: 6
      }
    ];

    this.loadFromCache();
  }

  loadFromCache() {
    for (const source of this.sources) {
      try {
        const cached = this.db.getBlocklistCache(source.name);
        if (cached && cached.raw_data) {
          this.parseAndStore(source.name, cached.raw_data, source.version);
        }
      } catch (_) {}
    }
  }

  parseAndStore(source, rawData, defaultVersion = 4) {
    const ranges = [];
    const lines = rawData.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }

      const v4Match = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?/);
      if (v4Match) {
        const networkInt = BlocklistService.ipToInt(v4Match[1]);
        const prefixLength = v4Match[2] !== undefined ? parseInt(v4Match[2], 10) : 32;
        if (networkInt !== null && prefixLength >= 0 && prefixLength <= 32) {
          ranges.push({ version: 4, networkInt, prefixLength });
        }
        continue;
      }

      if (defaultVersion === 6 || trimmed.includes(':')) {
        const v6Match = trimmed.match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
        if (v6Match) {
          const networkBytes = BlocklistService.ipv6ToBytes(v6Match[1]);
          const prefixLength = parseInt(v6Match[2], 10);
          if (networkBytes && prefixLength >= 0 && prefixLength <= 128) {
            ranges.push({ version: 6, networkBytes, prefixLength });
          }
        }
      }
    }

    this.blocklists.set(source, ranges);
  }

  static ipToInt(ip) {
    if (!ip || typeof ip !== 'string') return null;
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  static ipv6ToBytes(ip) {
    if (!ip || typeof ip !== 'string') return null;

    const trimmed = ip.trim().toLowerCase();
    if (!trimmed.includes(':')) return null;

    const mappedMatch = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedMatch) {
      const v4Int = BlocklistService.ipToInt(mappedMatch[1]);
      if (v4Int === null) return null;
      const buf = Buffer.alloc(16);
      buf.writeUInt16BE(0xffff, 8);
      buf.writeUInt32BE(v4Int, 12);
      return buf;
    }

    let working = trimmed;
    if (working.includes('.')) {
      const embedded = working.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
      if (!embedded) return null;
      const octets = embedded[2].split('.').map(Number);
      if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
      const hexTail = ((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0')
        + ':'
        + ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0');
      working = embedded[1] + hexTail;
    }

    const parts = working.split('::');
    if (parts.length > 2) return null;

    let head = [];
    let tail = [];
    if (parts.length === 2) {
      head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
      tail = parts[1] ? parts[1].split(':').filter(Boolean) : [];
    } else {
      head = working.split(':').filter(Boolean);
    }

    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;

    const groups = [...head, ...Array(missing).fill('0'), ...tail];
    if (groups.length !== 8) return null;

    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      const value = parseInt(groups[i], 16);
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
      buf.writeUInt16BE(value, i * 2);
    }
    return buf;
  }

  static isIPv4Mapped(bytes) {
    return bytes
      && bytes.length === 16
      && bytes.readUInt32BE(0) === 0
      && bytes.readUInt16BE(4) === 0
      && bytes.readUInt16BE(6) === 0
      && bytes.readUInt16BE(8) === 0xffff;
  }

  static ipv4FromMappedBytes(bytes) {
    if (!BlocklistService.isIPv4Mapped(bytes)) return null;
    return [bytes[12], bytes[13], bytes[14], bytes[15]].join('.');
  }

  static bytesMatchCidr(targetBytes, networkBytes, prefixLength) {
    for (let i = 0; i < 16; i++) {
      const bitOffset = i * 8;
      if (prefixLength <= bitOffset) break;
      const bitsInByte = Math.min(8, prefixLength - bitOffset);
      const mask = bitsInByte === 8 ? 0xff : (0xff << (8 - bitsInByte)) & 0xff;
      if ((targetBytes[i] & mask) !== (networkBytes[i] & mask)) return false;
    }
    return true;
  }

  async fetchBlocklist(source) {
    return new Promise((resolve, reject) => {
      const req = https.get(source.url, {
        headers: { 'User-Agent': 'Soterios' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });
    });
  }

  async refreshAll() {
    for (const source of this.sources) {
      try {
        const rawData = await this.fetchBlocklist(source);
        this.db.setBlocklistCache(source.name, rawData);
        this.parseAndStore(source.name, rawData, source.version);
      } catch (err) {
        console.error(`Failed to refresh ${source.name}:`, err.message);
      }
    }
  }

  isListed(ip) {
    if (!ip || typeof ip !== 'string') return false;

    if (ip.includes(':')) {
      const targetBytes = BlocklistService.ipv6ToBytes(ip.split('/')[0]);
      if (!targetBytes) return false;

      const mappedV4 = BlocklistService.ipv4FromMappedBytes(targetBytes);
      if (mappedV4) return this.isListed(mappedV4);

      for (const ranges of this.blocklists.values()) {
        for (const range of ranges) {
          if (range.version !== 6 || !range.networkBytes) continue;
          if (BlocklistService.bytesMatchCidr(targetBytes, range.networkBytes, range.prefixLength)) {
            return true;
          }
        }
      }
      return false;
    }

    const ipMatch = ip.match(/^(\d+\.\d+\.\d+\.\d+)/);
    if (!ipMatch) return false;
    const targetInt = BlocklistService.ipToInt(ipMatch[1]);
    if (targetInt === null) return false;

    for (const ranges of this.blocklists.values()) {
      for (const range of ranges) {
        if (range.version !== 4) continue;
        const mask = range.prefixLength === 0 ? 0 : (0xFFFFFFFF << (32 - range.prefixLength)) >>> 0;
        if ((targetInt & mask) === (range.networkInt & mask)) return true;
      }
    }

    return false;
  }

  getStats() {
    const stats = {};
    for (const [source, ranges] of this.blocklists) {
      stats[source] = ranges.length;
    }
    return stats;
  }
}

module.exports = { BlocklistService };
