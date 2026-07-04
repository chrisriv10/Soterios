/**
 * NetworkEnricher - Orchestrates network connection enrichment
 * Combines ProcessResolver, ReverseDns, ServiceNames, BlocklistService, and ScoringEngine
 * to enrich raw network connections with process names, hostnames, service names,
 * and security classifications
 * No external dependencies, no API keys required
 */

const { ReverseDns } = require('./ReverseDns');
const { ServiceNames } = require('./ServiceNames');
const { ScoringEngine } = require('./ScoringEngine');

class NetworkEnricher {
  constructor(processResolver, blocklistService) {
    this.processResolver = processResolver;
    this.blocklistService = blocklistService;
    this.reverseDns = new ReverseDns();
  }

  /**
   * Enrich a single network connection
   * @param {object} connection - Raw connection object
   * @returns {Promise<object>} Enriched connection object
   */
  async enrichConnection(connection) {
    const enriched = { ...connection };

    // Normalize field names (handle both PascalCase from PowerShell and camelCase)
    const pid = connection.pid ?? connection.OwningProcess;
    const remoteAddress = connection.remoteAddress ?? connection.RemoteAddress;
    const remotePort = connection.remotePort ?? connection.RemotePort;
    const localAddress = connection.localAddress ?? connection.LocalAddress;
    const localPort = connection.localPort ?? connection.LocalPort;
    const state = connection.state ?? connection.State;

    // Add normalized fields for UI compatibility
    if (pid !== undefined) enriched.pid = pid;
    if (remoteAddress !== undefined) enriched.remoteAddress = remoteAddress;
    if (remotePort !== undefined) enriched.remotePort = remotePort;
    if (localAddress !== undefined) enriched.localAddress = localAddress;
    if (localPort !== undefined) enriched.localPort = localPort;
    if (state !== undefined) enriched.state = state;

    // Add process name
    if (pid) {
      enriched.processName = await this.processResolver.getProcessName(pid);
    }

    // Add hostname (reverse DNS)
    if (remoteAddress) {
      enriched.hostname = await this.reverseDns.lookup(remoteAddress);
    }

    // Add service name
    if (remotePort) {
      enriched.serviceName = ServiceNames.getServiceName(remotePort);
    }

    // Add security classification
    const isBlocklisted = this.blocklistService.isListed(remoteAddress);
    enriched.classification = ScoringEngine.classify({ remoteAddress, remotePort }, isBlocklisted);
    enriched.isBlocklisted = isBlocklisted;

    return enriched;
  }

  /**
   * Enrich an array of network connections
   * @param {Array} connections - Array of raw connection objects
   * @returns {Promise<Array>} Array of enriched connection objects
   */
  async enrich(connections) {
    if (!Array.isArray(connections)) {
      return [];
    }

    // Enrich connections in parallel for better performance
    const enrichedConnections = await Promise.all(
      connections.map(conn => this.enrichConnection(conn))
    );

    return enrichedConnections;
  }

  /**
   * Clear all caches (DNS, process resolution)
   */
  clearCaches() {
    this.reverseDns.clearCache();
    this.processResolver.clearCache();
  }
}

module.exports = { NetworkEnricher };