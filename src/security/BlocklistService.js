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

    // Free public blocklist sources
    this.sources = [
      {
        name: 'spamhaus-drop',
        url: 'https://www.spamhaus.org/drop/drop.txt',
        format: 'plain'
      },
      {
        name: 'spamhaus-edrop',
        url: 'https://www.spamhaus.org/drop/edrop.txt',
        format: 'plain'
      }
    ];

    // Load cached blocklists synchronously on startup
    this.loadFromCache();
  }

  /**
   * Load blocklists from database cache
   */
  loadFromCache() {
    for (const source of this.sources) {
      try {
        const cached = this.db.getBlocklistCache(source.name);
        if (cached && cached.raw_data) {
          this.parseAndStore(source.name, cached.raw_data);
        }
      } catch (err) {
        // If cache load fails, continue silently
      }
    }
  }

  /**
   * Parse raw blocklist data and store in memory
   * @param {string} source - Source name
   * @param {string} rawData - Raw blocklist data
   */
  parseAndStore(source, rawData) {
    // Spamhaus DROP/EDROP entries are CIDR blocks (e.g. "1.2.3.0/24"), not
    // single addresses. Store each as [networkInt, prefixLength] so isListed()
    // can do real range containment instead of an exact-string match against
    // just the network address (which would only ever match one IP per block).
    const ranges = [];
    const lines = rawData.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }
      const match = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?/);
      if (match) {
        const networkInt = BlocklistService.ipToInt(match[1]);
        const prefixLength = match[2] !== undefined ? parseInt(match[2], 10) : 32;
        if (networkInt !== null && prefixLength >= 0 && prefixLength <= 32) {
          ranges.push({ networkInt, prefixLength });
        }
      }
    }

    this.blocklists.set(source, ranges);
  }

  /**
   * Convert a dotted-quad IPv4 address to a 32-bit integer.
   * @param {string} ip
   * @returns {number|null}
   */
  static ipToInt(ip) {
    if (!ip || typeof ip !== 'string') return null;
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  /**
   * Fetch a single blocklist from a URL
   * @param {object} source - Source object with name and url
   * @returns {Promise<string>} Raw blocklist data
   */
  async fetchBlocklist(source) {
    return new Promise((resolve, reject) => {
      const req = https.get(source.url, {
        headers: {
          'User-Agent': 'Soterios',
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });
    });
  }

  /**
   * Refresh all blocklists
   * @returns {Promise<void>}
   */
  async refreshAll() {
    for (const source of this.sources) {
      try {
        const rawData = await this.fetchBlocklist(source);
        this.db.setBlocklistCache(source.name, rawData);
        this.parseAndStore(source.name, rawData);
      } catch (err) {
        // Log but continue with other sources
        console.error(`Failed to refresh ${source.name}:`, err.message);
      }
    }
  }

  /**
   * Check if an IP is listed in any blocklist
   * @param {string} ip - IP address to check
   * @returns {boolean} True if IP is in any blocklist
   */
  isListed(ip) {
    if (!ip || typeof ip !== 'string') return false;

    // Extract base IP (handle CIDR notation on the input itself, if present)
    const ipMatch = ip.match(/^(\d+\.\d+\.\d+\.\d+)/);
    if (!ipMatch) return false;
    const targetInt = BlocklistService.ipToInt(ipMatch[1]);
    if (targetInt === null) return false;

    for (const ranges of this.blocklists.values()) {
      for (const { networkInt, prefixLength } of ranges) {
        const mask = prefixLength === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLength)) >>> 0;
        if ((targetInt & mask) === (networkInt & mask)) return true;
      }
    }

    return false;
  }

  /**
   * Get blocklist statistics
   * @returns {object} Statistics about loaded blocklists
   */
  getStats() {
    const stats = {};
    for (const [source, ranges] of this.blocklists) {
      stats[source] = ranges.length;
    }
    return stats;
  }
}

module.exports = { BlocklistService };