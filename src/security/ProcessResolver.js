/**
 * ProcessResolver - Resolves process names from PIDs
 * Wraps ProcessInspector to provide process name resolution for network connections
 */

class ProcessResolver {
  constructor(processInspector) {
    this.processInspector = processInspector;
    this.cache = new Map();
    this.cacheTtl = 30 * 1000; // 30 seconds
    this._inFlightFetch = null;
  }

  /**
   * Fetches the full process list once and populates the cache for every
   * PID it contains. If a fetch is already in progress, concurrent callers
   * share that same promise instead of each triggering their own full
   * process enumeration -- without this, N connections with N different
   * uncached PIDs would fire N redundant getProcesses() calls at once.
   * @returns {Promise<void>}
   */
  async _refreshProcessList() {
    if (this._inFlightFetch) return this._inFlightFetch;

    this._inFlightFetch = (async () => {
      try {
        const processes = await this.processInspector.getProcesses();
        const now = Date.now();
        for (const p of processes) {
          this.cache.set(p.pid, { processName: p.name || null, timestamp: now });
        }
      } finally {
        this._inFlightFetch = null;
      }
    })();

    return this._inFlightFetch;
  }

  /**
   * Get process name for a PID
   * @param {number} pid - Process ID
   * @returns {Promise<string|null>} Process name or null if not found
   */
  async getProcessName(pid) {
    if (!pid || typeof pid !== 'number') return null;

    // Check cache first
    const cached = this.cache.get(pid);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.processName;
    }

    try {
      await this._refreshProcessList();
    } catch (err) {
      // Fetch failed -- cache a negative result for this pid so repeated
      // calls in the same batch don't keep retrying a failing enumeration.
      this.cache.set(pid, { processName: null, timestamp: Date.now() });
      return null;
    }

    // The refresh populates entries for every PID that's actually running.
    // If this PID still isn't present, it's genuinely gone (process
    // exited) -- cache that negative result too, rather than re-fetching
    // the whole list again on every subsequent call for it within the TTL.
    if (!this.cache.has(pid)) {
      this.cache.set(pid, { processName: null, timestamp: Date.now() });
    }

    return this.cache.get(pid).processName;
  }

  /**
   * Clear the process cache
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

module.exports = { ProcessResolver };