const logger = require('../utils/logger');
const { execFile } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const path = require('path');
const fs = require('fs');
const execFilePromise = util.promisify(execFile);
const { NotFoundError } = require('../utils/errors');

const PS_SCRIPTS_DIR = path.join(__dirname, 'scripts');

/**
 * Execute a PowerShell helper script from the security scripts directory.
 *
 * @param {string} scriptName - Script filename (e.g. `network-connections.ps1`).
 * @returns {Promise<string>} stdout from the script.
 * @throws {NotFoundError} When the script file does not exist.
 */
async function runPs1(scriptName) {
  const scriptPath = path.join(PS_SCRIPTS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new NotFoundError(`PowerShell script not found: ${scriptPath}`);
  }
  const { stdout } = await execFilePromise('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
  ], { timeout: 15000, windowsHide: true });
  return stdout;
}

/**
 * Reads Windows network connections and interface statistics.
 *
 * Connection data comes from a PowerShell helper script; interface stats
 * come from `systeminformation`.
 */
class NetworkMonitor {
  /**
   * Get active network connections.
   * @returns {Promise<Array<Object>>}
   */
  async getConnections() {
    try {
      const stdout = await runPs1('network-connections.ps1');
      let connections = JSON.parse(stdout || '[]');
      if (!Array.isArray(connections)) connections = [connections];
      return connections;
    } catch (e) {
      logger.error('Failed to get network connections', { error: e.message || String(e) });
      return [];
    }
  }

  /**
   * Get network interface stats and connection summary.
   * @returns {Promise<{interfaces:Array, connections:Object}>}
   */
  async getStats() {
    try {
      const netStats = await si.networkStats();
      const interfaceStats = (netStats || []).map(s => ({
        iface: s.iface,
        rxSec: Math.round((s.rx_sec || 0) / 1024 * 10) / 10,
        txSec: Math.round((s.tx_sec || 0) / 1024 * 10) / 10,
        rxTotal: Math.round((s.rx_bytes || 0) / (1024 * 1024) * 10) / 10,
        txTotal: Math.round((s.tx_bytes || 0) / (1024 * 1024) * 10) / 10
      }));

      const stdout = await runPs1('network-stats.ps1');
      const data = JSON.parse(stdout || '{}');
      const conn = data.connections || {};

      return {
        interfaces: interfaceStats,
        connections: {
          total: parseInt(conn.total, 10) || 0,
          established: parseInt(conn.established, 10) || 0,
          listen: parseInt(conn.listen, 10) || 0,
          timeWait: parseInt(conn.timeWait, 10) || 0,
          closeWait: parseInt(conn.closeWait, 10) || 0
        }
      };
    } catch (e) {
      logger.error('Failed to get network stats', { error: e.message || String(e) });
      return { interfaces: [], connections: { total: 0, established: 0, listen: 0, timeWait: 0, closeWait: 0 } };
    }
  }
}

module.exports = NetworkMonitor;
