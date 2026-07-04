/**
 * ReverseDns - Simple reverse DNS lookup with caching
 * No external dependencies, no API keys required
 * Uses Node.js built-in dns module
 */

const dns = require('dns').promises;

class ReverseDns {
  constructor() {
    this.cache = new Map();
    this.cacheTtl = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Perform reverse DNS lookup for an IP address
   * @param {string} ip - IP address to lookup
   * @returns {Promise<string|null>} Hostname or null if lookup fails
   */
  async lookup(ip) {
    if (!ip || typeof ip !== 'string') return null;

    // Check cache first
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.hostname;
    }

    try {
      const hostnames = await dns.reverse(ip);
      const hostname = hostnames && hostnames.length > 0 ? hostnames[0] : null;
      
      // Cache the result
      this.cache.set(ip, {
        hostname,
        timestamp: Date.now()
      });

      return hostname;
    } catch (err) {
      // DNS lookup failed - cache the failure to avoid repeated attempts
      this.cache.set(ip, {
        hostname: null,
        timestamp: Date.now()
      });
      return null;
    }
  }

  /**
   * Clear the DNS cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache size (for debugging)
   * @returns {number}
   */
  getCacheSize() {
    return this.cache.size;
  }
}

module.exports = { ReverseDns };
