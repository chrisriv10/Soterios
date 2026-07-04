const { exec } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const execPromise = util.promisify(exec);

class NetworkMonitor {
  async getConnections() {
    try {
      const { stdout } = await execPromise(`powershell.exe -NoProfile -NonInteractive -Command "Get-NetTCPConnection | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess | ConvertTo-Json -Compress"`);
      let connections = JSON.parse(stdout || '[]');
      if (!Array.isArray(connections)) connections = [connections];
      return connections;
    } catch (e) {
      console.error('Failed to get network connections', e);
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
        rxTotal: Math.round((s.rxBytes || 0) / (1024 * 1024) * 10) / 10,
        txTotal: Math.round((s.txBytes || 0) / (1024 * 1024) * 10) / 10
      }));

      // Use a script file to avoid PowerShell quoting issues
      const psScript = `$conns = Get-NetTCPConnection; $total = $conns.Count; $established = ($conns | Where-Object { $_.State -eq 'Established' }).Count; $listen = ($conns | Where-Object { $_.State -eq 'Listen' }).Count; $timeWait = ($conns | Where-Object { $_.State -eq 'TimeWait' }).Count; $closeWait = ($conns | Where-Object { $_.State -eq 'CloseWait' }).Count; Write-Output ($total, $established, $listen, $timeWait, $closeWait -join '|')`;
      const { stdout } = await execPromise(`powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`, { timeout: 10000 });
      const parts = stdout.trim().split('|');

      return {
        interfaces: interfaceStats,
        connections: {
          total: parseInt(parts[0]) || 0,
          established: parseInt(parts[1]) || 0,
          listen: parseInt(parts[2]) || 0,
          timeWait: parseInt(parts[3]) || 0,
          closeWait: parseInt(parts[4]) || 0
        }
      };
    } catch (e) {
      console.error('Failed to get network stats', e);
      return { interfaces: [], connections: { total: 0, established: 0, listen: 0, timeWait: 0, closeWait: 0 } };
    }
  }
}

module.exports = NetworkMonitor;