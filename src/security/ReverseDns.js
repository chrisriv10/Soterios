/**
 * ReverseDns - Simple reverse DNS lookup with caching
 * No external dependencies, no API keys required
 * Uses Node.js built-in dns module
 */

const dns = require('dns').promises;

const LOOKUP_TIMEOUT_MS = 2000;

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
      // dns.reverse() has no built-in timeout -- an unreachable or
      // non-responding DNS server can otherwise hang indefinitely, which
      // would stall the entire Promise.all() enrichment batch (and make the
      // progress bar look permanently stuck) waiting on just one IP. Note
      // this only enforces an application-level timeout; the underlying
      // lookup itself isn't cancelled, it just gets ignored once it's too
      // late -- Node's dns module doesn't expose a cancellable request here.
      const hostnames = await Promise.race([
        dns.reverse(ip),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Reverse DNS lookup timed out')), LOOKUP_TIMEOUT_MS))
      ]);
      const hostname = hostnames && hostnames.length > 0 ? hostnames[0] : null;

      // Cache the result
      this.cache.set(ip, {
        hostname,
        timestamp: Date.now()
      });

      return hostname;
    } catch (err) {
      // DNS lookup failed or timed out - cache the failure to avoid
      // repeated slow attempts against the same unreachable/non-resolving IP.
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