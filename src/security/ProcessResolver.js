/**
 * ProcessResolver - Resolves process names from PIDs
 * Wraps ProcessInspector to provide process name resolution for network connections
 */

class ProcessResolver {
  constructor(processInspector) {
    this.processInspector = processInspector;
    this.cache = new Map();
    this.cacheTtl = 30 * 1000; // 30 seconds
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
      const processes = await this.processInspector.getProcesses();
      const process = processes.find(p => p.pid === pid);
      const processName = process ? process.name : null;

      // Cache the result
      this.cache.set(pid, {
        processName,
        timestamp: Date.now()
      });

      return processName;
    } catch (err) {
      // Process lookup failed - cache the failure
      this.cache.set(pid, {
        processName: null,
        timestamp: Date.now()
      });
      return null;
    }
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
