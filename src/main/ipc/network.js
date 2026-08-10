const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const logger = require('../../utils/logger');
const featureFlags = require('../../core/featureFlags');


function isValidIPv4(ip) {
  if (typeof ip !== 'string') return false;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
}

async function runPowerShellRaw(command) {
  const { stdout } = await execFilePromise(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: 20000, windowsHide: true }
  );
  return stdout;
}

async function measureConnectionBandwidth({ localAddress, localPort, remoteAddress, remotePort }) {
  if (!isValidIPv4(localAddress) || !isValidIPv4(remoteAddress)) {
    throw new Error('Per-connection bandwidth currently only supports IPv4 TCP connections.');
  }
  const lp = Number(localPort);
  const rp = Number(remotePort);
  if (!Number.isInteger(lp) || lp < 0 || lp > 65535 || !Number.isInteger(rp) || rp < 0 || rp > 65535) {
    throw new Error('Invalid port.');
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Net;
using System.Runtime.InteropServices;

public static class SoteriosTcpEstats {
    [StructLayout(LayoutKind.Sequential)]
    public struct MIB_TCPROW_LH {
        public uint state;
        public uint localAddr;
        public uint localPort;
        public uint remoteAddr;
        public uint remotePort;
    }

    [DllImport("iphlpapi.dll", SetLastError = true)]
    public static extern uint SetPerTcpConnectionEStats(
        ref MIB_TCPROW_LH Row, int EstatsType,
        byte[] Rw, uint RwVersion, uint RwSize, uint Offset);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    public static extern uint GetPerTcpConnectionEStats(
        ref MIB_TCPROW_LH Row, int EstatsType,
        byte[] Rw, uint RwVersion, uint RwSize,
        byte[] Ros, uint RosVersion, uint RosSize,
        byte[] Rod, uint RodVersion, uint RodSize);

    public static uint ToRowPort(int port) {
        return (uint)(ushort)IPAddress.HostToNetworkOrder((short)port);
    }

    public static uint ToRowAddr(string ip) {
        return BitConverter.ToUInt32(IPAddress.Parse(ip).GetAddressBytes(), 0);
    }
}
"@

$row = New-Object SoteriosTcpEstats+MIB_TCPROW_LH
$row.state = 0
$row.localAddr = [SoteriosTcpEstats]::ToRowAddr('${localAddress}')
$row.localPort = [SoteriosTcpEstats]::ToRowPort(${lp})
$row.remoteAddr = [SoteriosTcpEstats]::ToRowAddr('${remoteAddress}')
$row.remotePort = [SoteriosTcpEstats]::ToRowPort(${rp})

$existing = Get-NetTCPConnection -LocalAddress '${localAddress}' -LocalPort ${lp} -RemoteAddress '${remoteAddress}' -RemotePort ${rp} -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Output "ERROR|This connection closed before it could be measured. Try again on one that's actively transferring data."
  exit 0
}
if ($existing.State -ne 'Established') {
  Write-Output "ERROR|This connection is $($existing.State), not Established, so there's no live data flow left to measure."
  exit 0
}

$rw = New-Object byte[] 32
$rw[0] = 1  # EnableCollectionOutbound = TcpBoolOptEnabled
$rw[4] = 1  # EnableCollectionInbound  = TcpBoolOptEnabled

$setResult = [SoteriosTcpEstats]::SetPerTcpConnectionEStats([ref]$row, 7, $rw, 0, 8, 0)
if ($setResult -ne 0) {
  Write-Output "ERROR|Could not enable bandwidth tracking for this connection (Windows error $setResult), even though it's still Established. This may be a Windows/driver quirk — please report it."
  exit 0
}

Start-Sleep -Milliseconds 2000

$rod = New-Object byte[] 64
$getResult = [SoteriosTcpEstats]::GetPerTcpConnectionEStats([ref]$row, 7, $null, 0, 0, $null, 0, 0, $rod, 0, 40)
if ($getResult -ne 0) {
  Write-Output "ERROR|Could not read bandwidth data for this connection (Windows error $getResult). It may have closed during measurement."
  exit 0
}

$outBitsPerSec = [BitConverter]::ToUInt64($rod, 0)
$inBitsPerSec  = [BitConverter]::ToUInt64($rod, 8)
Write-Output "OK|$outBitsPerSec|$inBitsPerSec"
`;

  let stdout;
  try {
    stdout = await runPowerShellRaw(script);
  } catch (e) {
    logger.error('Bandwidth measurement failed:', (e && e.message) || e);
    throw new Error('Bandwidth measurement failed. This requires administrator privileges and Windows 10/11.');
  }

  const line = stdout.trim().split(/\r?\n/).pop() || '';
  const parts = line.split('|');
  if (parts[0] === 'ERROR') {
    throw new Error(parts.slice(1).join('|') || 'Bandwidth measurement failed.');
  }
  if (parts[0] !== 'OK') {
    throw new Error('Unexpected response from bandwidth measurement.');
  }
  const outboundBitsPerSec = Number(parts[1]) || 0;
  const inboundBitsPerSec = Number(parts[2]) || 0;
  return {
    outboundKBps: outboundBitsPerSec / 8 / 1024,
    inboundKBps: inboundBitsPerSec / 8 / 1024,
  };
}

function register(mainWindow, { db, eventBus, networkMonitor, networkEnricher, networkAlertMonitor, geoLocationService, vpnManager, startNetworkStatsTimer, stopNetworkStatsTimer }) {
  // -- Network suspicious-connection alerts --
  ipcMain.handle('network-alerts:status', async () => {
    return (networkAlertMonitor && networkAlertMonitor.getStatus()) || { running: false };
  });

  ipcMain.handle('network-alerts:toggle', async (_event, enable) => {
    if (!networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return enable ? networkAlertMonitor.start() : networkAlertMonitor.stop();
  });

  ipcMain.handle('network-traffic-history:toggle', async (_event, enable) => {
    if (!startNetworkStatsTimer || !stopNetworkStatsTimer) {
      throw new Error('Network stats timer control unavailable.');
    }
    return enable ? startNetworkStatsTimer() : stopNetworkStatsTimer();
  });

  ipcMain.handle('network-alerts:ignore', async (_event, key) => {
    if (!networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return networkAlertMonitor.ignore(key);
  });

  ipcMain.handle('network-alerts:kill', async (_event, pid) => {
    if (!networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return networkAlertMonitor.kill(pid);
  });

  ipcMain.handle('network:history', async (_event, options = {}) => {
    const hours = Math.min(168, Math.max(1, Number(options.hours) || 24));
    const iface = options.iface || null;
    return db.getNetworkStatsHistory(hours, iface);
  });

  ipcMain.handle('network:connections', async (event) => {
    const raw = await networkMonitor.getConnections();
    return networkEnricher.enrich(raw, (completed, total) => {
      event.sender.send('network:connections:progress', { completed, total });
    });
  });

  ipcMain.handle('network:geo', async (_event, ips) => {
    if (!featureFlags.getFlag(db, 'geoLookup', true)) return {};
    const results = {};
    for (const ip of ips) {
      const geo = await geoLocationService.lookup(ip);
      if (geo) {
        results[ip] = geo;
      }
    }
    return results;
  });

  ipcMain.handle('network:stats', async () => {
    return networkMonitor.getStats();
  });

  // -- Per-connection bandwidth (on-demand, IPv4 TCP only -- see
  // measureConnectionBandwidth's comment for why) --
  ipcMain.handle('network:measureBandwidth', async (_event, spec) => {
    return measureConnectionBandwidth(spec || {});
  });

  // -- Windows VPN control --
  ipcMain.handle('network:vpn:list', async () => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.list(false);
  });

  ipcMain.handle('network:vpn:connect', async (_event, name) => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.connect(name);
  });

  ipcMain.handle('network:vpn:disconnect', async (_event, name) => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.disconnect(name);
  });

  ipcMain.handle('network:vpn:add', async (_event, { providerId, serverId, username, password }) => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.addFromProvider(providerId, serverId, username, password);
  });

  ipcMain.handle('network:vpn:status', async (_event, name) => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.getStatus(name);
  });

  ipcMain.handle('network:vpn:toggleLast', async () => {
    if (!vpnManager) throw new Error('VPN manager is unavailable.');
    return vpnManager.toggleLast();
  });

  ipcMain.handle('network:vpn:getProviders', async () => {
    const { getAllProviders } = require('../../main/vpnProviders');
    return getAllProviders();
  });

  ipcMain.handle('network:vpn:getServers', async (_event, providerId) => {
    const { getProvider } = require('../../main/vpnProviders');
    const provider = getProvider(providerId);
    if (!provider) return [];
    return provider.servers;
  });
}

module.exports = { register };