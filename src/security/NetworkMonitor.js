const logger = require('../utils/logger');
const { execFile } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const execFilePromise = util.promisify(execFile);

const POWERSHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

function runPowerShell(script, timeout = 15000) {
  return execFilePromise('powershell.exe', [...POWERSHELL_ARGS, script], {
    timeout,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

// Suppress repeated PowerShell/Get-NetTCPConnection warnings and optionally
// enable extra debug output with SOTERIOS_DEBUG_NET=1
let netPsWarned = false;
let lastNetPsFailedAt = 0;
const netPsCooldownMs = 60 * 1000; // 60s
const debugNet = process.env.SOTERIOS_DEBUG_NET === '1';

class NetworkMonitor {
  async getConnections() {
    try {
      const { stdout } = await runPowerShell('Get-NetTCPConnection -ErrorAction Stop | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess | ConvertTo-Json -Compress');
      let connections = JSON.parse(stdout || '[]');
      if (!Array.isArray(connections)) connections = [connections];
      return connections;
    } catch (e) {
      logger.error('Failed to get network connections', e);
      return [];
    }
  }

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

      // Try to get connection stats via PowerShell
      let connections = { total: 0, established: 0, listen: 0, timeWait: 0, closeWait: 0 };
      // Only attempt the PowerShell method if we haven't recently failed
      if (Date.now() - lastNetPsFailedAt < netPsCooldownMs) {
        if (debugNet) logger.info('NetworkMonitor: skipping Get-NetTCPConnection due to recent failure cooldown');
      } else {
        try {
          const psScript = `$conns = Get-NetTCPConnection -ErrorAction SilentlyContinue; if ($conns) { $total = $conns.Count; $established = ($conns | Where-Object { $_.State -eq 'Established' }).Count; $listen = ($conns | Where-Object { $_.State -eq 'Listen' }).Count; $timeWait = ($conns | Where-Object { $_.State -eq 'TimeWait' }).Count; $closeWait = ($conns | Where-Object { $_.State -eq 'CloseWait' }).Count; Write-Output ($total, $established, $listen, $timeWait, $closeWait -join '|') } else { Write-Output '0|0|0|0|0' }`;
          const { stdout } = await runPowerShell(psScript);
          netPsWarned = false;
          const parts = stdout.trim().split('|');
          connections = {
            total: parseInt(parts[0]) || 0,
            established: parseInt(parts[1]) || 0,
            listen: parseInt(parts[2]) || 0,
            timeWait: parseInt(parts[3]) || 0,
            closeWait: parseInt(parts[4]) || 0
          };
        } catch (psError) {
          lastNetPsFailedAt = Date.now();
          if (!netPsWarned) {
            logger.warn('Get-NetTCPConnection failed, using fallback', psError.message);
            netPsWarned = true;
          } else if (debugNet) {
            logger.info('NetworkMonitor: Get-NetTCPConnection failed again; suppressed warning');
          }

          // Fallback: use netstat if Get-NetTCPConnection is not available
          try {
            const { stdout } = await execFilePromise('netstat.exe', ['-an'], { timeout: 10000, windowsHide: true });
            const lines = stdout.split('\n');
            let total = 0, established = 0, listen = 0, timeWait = 0, closeWait = 0;
            for (const line of lines) {
              if (line.includes('TCP')) {
                total++;
                if (line.includes('ESTABLISHED')) established++;
                else if (line.includes('LISTENING')) listen++;
                else if (line.includes('TIME_WAIT')) timeWait++;
                else if (line.includes('CLOSE_WAIT')) closeWait++;
              }
            }
            connections = { total, established, listen, timeWait, closeWait };
          } catch (netstatError) {
            if (!netPsWarned) {
              logger.warn('netstat fallback also failed', netstatError.message);
              netPsWarned = true;
            } else if (debugNet) {
              logger.info('NetworkMonitor: netstat fallback also failed; suppressed warning');
            }
          }
        }
      }

      return {
        interfaces: interfaceStats,
        connections
      };
    } catch (e) {
      logger.error('Failed to get network stats', e);
      return { interfaces: [], connections: { total: 0, established: 0, listen: 0, timeWait: 0, closeWait: 0 } };
    }
  }
}

module.exports = NetworkMonitor;
