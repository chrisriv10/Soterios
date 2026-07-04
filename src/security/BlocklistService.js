/**
 * BlocklistService - Manages free IP blocklists with caching
 * Fetches and caches free blocklists from public sources
 */

const https = require('https');

class BlocklistService {
  constructor(db) {
    this.db = db;
    this.blocklists = new Map();
    this.refreshInterval = 12 * 60 * 60 * 1000; // 12 hours

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
    const ips = new Set();
    const lines = rawData.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }
      // Extract IP address (handle CIDR notation)
      const ipMatch = trimmed.match(/^(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch) {
        ips.add(ipMatch[1]);
      }
    }

    this.blocklists.set(source, ips);
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
          'User-Agent': 'Soterios-System-Tools'
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

    // Extract base IP (handle CIDR notation)
    const ipMatch = ip.match(/^(\d+\.\d+\.\d+\.\d+)/);
    if (!ipMatch) return false;
    const baseIp = ipMatch[1];

    // Check all blocklists
    for (const blocklist of this.blocklists.values()) {
      if (blocklist.has(baseIp)) {
        return true;
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
    for (const [source, ips] of this.blocklists) {
      stats[source] = ips.size;
    }
    return stats;
  }
}

module.exports = { BlocklistService };
