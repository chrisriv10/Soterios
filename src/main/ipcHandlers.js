const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const {
  isPathInScanReportsDir,
  isPathInAllowedReportDir,
  isPathInsideDir,
  securityReportsDir,
  threatsToCsv,
  securityReportToCsv,
  csvPathForJson,
  safeWriteFileSync,
  generatePdfFromHtml
} = require('../security/reportExport');
const updater = require('./updater');
const { getTrayHealthSummary } = require('./healthSummary');
const { MIN_INTERVAL_HOURS, MAX_INTERVAL_HOURS, ALLOWED_SCRIPT_IDS, SCHEDULE_PRESETS } = require('./maintenanceScheduler');
const { loadRegistry } = require('../scripts/scriptRunner');
const i18n = require('../i18n');

function isValidIp(ip) {
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const v6 = /^[0-9a-fA-F:]+$/;
  return v4.test(ip) || (v6.test(ip) && ip.includes(':'));
}

// Stricter than isValidIp above — the bandwidth-measurement feature only
// supports IPv4 (see measureConnectionBandwidth for why), so this rejects
// IPv6 and validates each octet is actually 0-255, not just digit-shaped.
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

// Real, live per-TCP-connection bandwidth via Windows' "Extended TCP
// Statistics" IP Helper API (GetPerTcpConnectionEStats / SetPerTcpConnectionEStats
// in iphlpapi.dll). There's no cmdlet for this — it's a raw Win32 API that
// tracks a smoothed bandwidth estimate per connection, computed by Windows
// itself. We enable tracking for this specific connection, give Windows ~2s
// to produce a reading, then read it back.
//
// IPv4 TCP only: IPv6 connections use a different row struct
// (MIB_TCP6ROW_LH) that isn't implemented here. UDP has no per-connection
// concept in this API at all.
async function measureConnectionBandwidth({ localAddress, localPort, remoteAddress, remotePort }) {
  if (!isValidIPv4(localAddress) || !isValidIPv4(remoteAddress)) {
    throw new Error('Per-connection bandwidth currently only supports IPv4 TCP connections.');
  }
  const lp = Number(localPort);
  const rp = Number(remotePort);
  if (!Number.isInteger(lp) || lp < 0 || lp > 65535 || !Number.isInteger(rp) || rp < 0 || rp > 65535) {
    throw new Error('Invalid port.');
  }

  // All values embedded below are pre-validated above (dotted-quad IPv4 /
  // integer ports only), so there's nothing here an attacker could use to
  // break out of the PowerShell command string.
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

# Sanity check using PowerShell's own (unquestionably correct) cmdlet before
# touching the low-level P/Invoke call, since Windows error 50
# (ERROR_NOT_SUPPORTED) from SetPerTcpConnectionEStats is ambiguous on its
# own — it fires both for a connection that's already gone, and for one
# that still exists but is no longer ESTABLISHED (TIME_WAIT, CLOSE_WAIT,
# etc. have no live data flow left to track).
$existing = Get-NetTCPConnection -LocalAddress '${localAddress}' -LocalPort ${lp} -RemoteAddress '${remoteAddress}' -RemotePort ${rp} -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Output "ERROR|This connection closed before it could be measured. Try again on one that's actively transferring data."
  exit 0
}
if ($existing.State -ne 'Established') {
  Write-Output "ERROR|This connection is $($existing.State), not Established, so there's no live data flow left to measure."
  exit 0
}

# TcpConnectionEstatsBandwidth = 7 in the TCP_ESTATS_TYPE enum.
# Rw/Rod buffers are deliberately over-allocated well beyond the documented
# struct sizes (8 / 40 bytes) as a safety margin — Windows only ever writes
# the real struct's bytes into them, so extra space is harmless, but an
# under-sized buffer risks a native memory-safety issue.
$rw = New-Object byte[] 32
$rw[0] = 1  # EnableCollectionOutbound = TcpBoolOptEnabled
$rw[4] = 1  # EnableCollectionInbound  = TcpBoolOptEnabled

$setResult = [SoteriosTcpEstats]::SetPerTcpConnectionEStats([ref]$row, 7, $rw, 0, 8, 0)
if ($setResult -ne 0) {
  Write-Output "ERROR|Could not enable bandwidth tracking for this connection (Windows error $setResult), even though it's still Established. This may be a Windows/driver quirk \u2014 please report it."
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
    console.error('Bandwidth measurement failed:', (e && e.message) || e);
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
    inboundKBps: inboundBitsPerSec / 8 / 1024
  };
}

// Windows Firewall only has these three profiles — reject anything else so a
// renderer bug (or a compromised renderer) can't smuggle arbitrary strings
// into a shell/PowerShell command built from this value.
const VALID_FIREWALL_PROFILES = ['Domain', 'Private', 'Public'];
function isValidFirewallProfile(name) {
  return typeof name === 'string' && VALID_FIREWALL_PROFILES.includes(name);
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Soterios',
        ...options.headers
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

function deleteFileIfSafe(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) { }
}

function registerIpcHandlers(mainWindow, services) {
  const {
    db,
    eventBus,
    clamEngine,
    scanEngine,
    quarantineManager,
    realtimeWatcher,
    processInspector,
    reputationEngine,
    toolRegistry,
    maintenanceScheduler
  } = services;

  // -- System --
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    isAdmin: true // We requested admin rights
  }));

  // -- Launch at Startup --
  // Reads/writes the real OS-level login item via Electron's app API, rather
  // than just a saved preference flag -- a saved-only flag wouldn't actually
  // make Windows launch the app. This also stays accurate if the user
  // changes it outside the app (e.g. Windows Settings > Startup Apps).
  ipcMain.handle('app:getLaunchAtStartup', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('app:setLaunchAtStartup', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  // -- Database / Settings --
  ipcMain.handle('db:getScanHistory', (_event, limit) => db.getScanHistory(limit));
  ipcMain.handle('db:getQuarantineList', () => db.getQuarantineList());
  ipcMain.handle('db:getUnreadAlerts', () => db.getUnreadAlerts());
  ipcMain.handle('db:markAlertRead', (_event, id) => db.markAlertRead(id));
  ipcMain.handle('db:getSetting', (_event, key, def) => db.getSetting(key, def));
  ipcMain.handle('db:setSetting', (_event, key, value) => db.setSetting(key, value));
  ipcMain.handle('i18n:getCatalog', (_event, locale) => i18n.loadCatalog(locale));
  ipcMain.handle('i18n:normalizeLocale', (_event, locale) => i18n.normalizeLocale(locale));
  ipcMain.handle('i18n:listLocales', () => i18n.listLocales());
  ipcMain.handle('i18n:isRtlLocale', (_event, locale) => i18n.isRtlLocale(locale));
  ipcMain.handle('i18n:getSystemLocale', () => app.getLocale());
  ipcMain.handle('warnings:ignore', (_event, warning) => db.ignoreWarning(warning));
  ipcMain.handle('warnings:unignore', (_event, id) => db.unignoreWarning(id));
  ipcMain.handle('warnings:listIgnored', () => db.getIgnoredWarnings());

  // -- Scanning Engine --
  ipcMain.handle('scan:status', () => {
    const scanStatus = scanEngine.getStatus();
    if (scanStatus.currentScan && scanStatus.currentScan.scanType === 'folderwatch') {
      return {
        engine: clamEngine.getStatus(),
        scan: { isScanning: false, currentScan: null }
      };
    }
    return {
      engine: clamEngine.getStatus(),
      scan: scanStatus
    };
  });

  ipcMain.handle('scan:updateDefinitions', async () => {
    const result = await clamEngine.updateDefinitions((progress) => {
      eventBus.emit('scan:progress', { scanType: 'definitions', pct: 10, message: 'Updating ClamAV definitions...' });
      if (progress && progress.text) {
        const match = progress.text.match(/(\d+)%/);
        if (match) {
          eventBus.emit('scan:progress', { scanType: 'definitions', pct: Math.min(95, Number(match[1])), message: 'Updating ClamAV definitions...' });
        }
      }
    });
    eventBus.emit('scan:complete', {
      scanType: 'definitions',
      status: result.success ? 'completed' : 'failed',
      filesScanned: 0,
      threatsFound: 0,
      errors: result.success ? [] : [result.error || 'Definition update failed'],
      error: result.error
    });
    return result;
  });

  ipcMain.handle('scan:quick', async () => {
    return scanEngine.runQuickScan();
  });

  ipcMain.handle('scan:full', async () => {
    return scanEngine.runFullScan();
  });

  ipcMain.handle('scan:custom', async (_event, targetPaths) => {
    return scanEngine.runCustomScan(targetPaths);
  });

  ipcMain.handle('scan:abort', () => {
    const status = scanEngine.getStatus();
    if (status.currentScan && status.currentScan.scanType === 'folderwatch') {
      return { success: false, canceled: false, error: 'No user scan in progress' };
    }
    return scanEngine.abortScan();
  });

  ipcMain.handle('reputation:addHash', async (_event, hash, verdict, note) => {
    return reputationEngine.addHash(hash, verdict, note);
  });

  ipcMain.handle('reputation:removeHash', async (_event, hash) => {
    return reputationEngine.removeHash(hash);
  });

  ipcMain.handle('reputation:listHashes', async (_event, limit) => {
    return reputationEngine.listHashes(limit);
  });

  ipcMain.handle('reputation:checkHash', async (_event, hash) => {
    return reputationEngine.checkHash(hash);
  });

  // -- Scheduled Scans --
  const SCHEDULE_SETTING_KEY = 'schedule.config';
  const DEFAULT_SCHEDULE = { enabled: false, scanType: 'quick', customPath: null, intervalHours: 24, lastRun: null };

  function loadScheduleConfig() {
    const stored = db.getSetting(SCHEDULE_SETTING_KEY, null);
    return { ...DEFAULT_SCHEDULE, ...(stored || {}) };
  }

  function saveScheduleConfig(partial) {
    const merged = { ...loadScheduleConfig(), ...partial };
    db.setSetting(SCHEDULE_SETTING_KEY, merged);
    return merged;
  }

  ipcMain.handle('schedule:get', () => loadScheduleConfig());

  ipcMain.handle('schedule:set', (_event, config) => {
    return saveScheduleConfig(config || {});
  });

  // Runs in the main process, independent of any open renderer page, so the
  // schedule keeps working even if the user isn't looking at the Scanner tab.
  let scheduledScanRunning = false;
  async function runScheduledScanIfDue() {
    if (scheduledScanRunning) return;
    const config = loadScheduleConfig();
    if (!config.enabled) return;
    if (config.scanType === 'custom' && !config.customPath) return;

    const engineStatus = scanEngine.getStatus();
    if (engineStatus && (engineStatus.isScanning || engineStatus.isFolderWatchScanning)) return; // don't collide with any scan

    const intervalMs = Math.max(1, Number(config.intervalHours) || 24) * 60 * 60 * 1000;
    const lastRunMs = config.lastRun ? new Date(config.lastRun).getTime() : 0;
    if (Date.now() - lastRunMs < intervalMs) return;

    scheduledScanRunning = true;
    saveScheduleConfig({ lastRun: new Date().toISOString() });
    try {
      if (config.scanType === 'full') {
        await scanEngine.runFullScan();
      } else if (config.scanType === 'custom') {
        await scanEngine.runCustomScan([config.customPath]);
      } else {
        await scanEngine.runQuickScan();
      }
    } catch (e) {
      console.error('Scheduled scan failed', e);
    } finally {
      scheduledScanRunning = false;
    }
  }

  // Check once a minute whether a scan is due, plus a check shortly after
  // startup in case one was missed while the app was closed.
  setInterval(() => { runScheduledScanIfDue(); }, 60 * 1000);
  setTimeout(() => { runScheduledScanIfDue(); }, 15 * 1000);

  // -- Quarantine --
  ipcMain.handle('quarantine:restore', async (_event, id) => {
    return quarantineManager.restore(id);
  });

  ipcMain.handle('quarantine:delete', async (_event, id) => {
    return quarantineManager.delete(id);
  });

  // -- Real-Time Protection --
  ipcMain.handle('rtp:status', async () => {
    const result = await realtimeWatcher.getStatus();
    return result.ok ? result.enabled : false;
  });

  ipcMain.handle('rtp:toggle', async (_event, enable) => {
    const result = enable ? await realtimeWatcher.start() : await realtimeWatcher.stop();
    if (!result.ok) throw new Error(result.error || 'Unable to update real-time protection.');
    return result.enabled;
  });

  // -- Folder Watch --
  ipcMain.handle('folderwatch:status', async () => {
    return (services.folderWatcher && services.folderWatcher.getStatus()) || { running: false };
  });

  ipcMain.handle('folderwatch:toggle', async (_event, enable) => {
    if (!services.folderWatcher) throw new Error('Folder watcher is unavailable.');
    return enable ? services.folderWatcher.start() : services.folderWatcher.stop();
  });

  // -- Network suspicious-connection alerts --
  ipcMain.handle('network-alerts:status', async () => {
    return (services.networkAlertMonitor && services.networkAlertMonitor.getStatus()) || { running: false };
  });

  ipcMain.handle('network-alerts:toggle', async (_event, enable) => {
    if (!services.networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return enable ? services.networkAlertMonitor.start() : services.networkAlertMonitor.stop();
  });

  ipcMain.handle('network-traffic-history:toggle', async (_event, enable) => {
    if (!services.startNetworkStatsTimer || !services.stopNetworkStatsTimer) {
      throw new Error('Network stats timer control unavailable.');
    }
    return enable ? services.startNetworkStatsTimer() : services.stopNetworkStatsTimer();
  });

  ipcMain.handle('network-alerts:ignore', async (_event, key) => {
    if (!services.networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return services.networkAlertMonitor.ignore(key);
  });

  ipcMain.handle('network-alerts:kill', async (_event, pid) => {
    if (!services.networkAlertMonitor) throw new Error('Network alert monitor is unavailable.');
    return services.networkAlertMonitor.kill(pid);
  });

  ipcMain.handle('network:history', async (_event, options = {}) => {
    const hours = Math.min(168, Math.max(1, Number(options.hours) || 24));
    const iface = options.iface || null;
    return db.getNetworkStatsHistory(hours, iface);
  });

  // -- Process Inspector --
  ipcMain.handle('process:list', async () => {
    return processInspector.getProcesses();
  });

  ipcMain.handle('process:kill', async (_event, pid) => {
    return processInspector.killProcess(pid);
  });

  // -- Audit & Firewall & Network --
  ipcMain.handle('audit:run', async (event) => {
    return services.systemAudit.runAudit((label) => {
      event.sender.send('audit:progress', label);
    });
  });

  ipcMain.handle('firewall:status', async () => {
    return services.firewallManager.getStatus();
  });

  ipcMain.handle('firewall:rules', async () => {
    return services.firewallManager.getRules();
  });

  // -- Firewall Rule Management (used by the Network Perimeter UI) --
  ipcMain.handle('firewall:listRules', async () => {
    return services.firewallManager.listRules();
  });

  ipcMain.handle('firewall:createRule', async (_event, spec) => {
    return services.firewallManager.createRule(spec);
  });

  ipcMain.handle('firewall:deleteRule', async (_event, name) => {
    return services.firewallManager.deleteRule(name);
  });

  ipcMain.handle('firewall:setRuleEnabled', async (_event, { name, enabled }) => {
    return services.firewallManager.setRuleEnabled(name, enabled);
  });

  // -- Firewall Profile Toggle (Domain/Private/Public on/off) --
  ipcMain.handle('firewall:setProfileEnabled', async (_event, { profile, enabled }) => {
    if (!isValidFirewallProfile(profile)) throw new Error(`Invalid firewall profile: ${profile}`);
    return services.firewallManager.setProfileEnabled(profile, !!enabled);
  });

  ipcMain.handle('firewall:exportRules', async () => {
    const data = await services.firewallManager.exportRules();
    const result = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      title: 'Export Soterios firewall rules',
      defaultPath: 'soterios-firewall-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: result.filePath, count: data.rules.length };
  });

  ipcMain.handle('firewall:importRules', async (_event, options = {}) => {
    const onConflict = ['skip', 'overwrite', 'rename'].includes(options && options.onConflict)
      ? options.onConflict
      : 'skip';
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      title: 'Import Soterios firewall rules',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const filePath = result.filePaths[0];
    const stat = await fs.promises.stat(filePath);
    const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new Error('Import file is too large (limit 2 MB).');
    }
    let payload;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      payload = JSON.parse(raw);
    } catch (e) {
      throw new Error('Could not parse import file as JSON.');
    }
    const summary = await services.firewallManager.importRules(payload, { onConflict });
    return { ...summary, path: filePath };
  });

  // -- Trusted connections (local marker only — does not create a firewall
  // rule, just tells the perimeter UI to treat this remote address as safe) --
  const TRUSTED_IPS_KEY = 'firewall.trustedIps';

  ipcMain.handle('firewall:getTrusted', () => {
    return db.getSetting(TRUSTED_IPS_KEY, []);
  });

  ipcMain.handle('firewall:trustConnection', (_event, ip) => {
    if (!ip || !isValidIp(ip)) throw new Error('Invalid address.');
    const current = db.getSetting(TRUSTED_IPS_KEY, []);
    if (!current.includes(ip)) current.push(ip);
    db.setSetting(TRUSTED_IPS_KEY, current);
    return current;
  });

  ipcMain.handle('firewall:untrustConnection', (_event, ip) => {
    const current = (db.getSetting(TRUSTED_IPS_KEY, []) || []).filter((x) => x !== ip);
    db.setSetting(TRUSTED_IPS_KEY, current);
    return current;
  });

  // -- WHOIS lookup (no API key required) --
  ipcMain.handle('network:whois', async (_event, ip) => {
    if (!ip || !isValidIp(ip)) throw new Error('Invalid address.');
    const res = await requestText(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (res.statusCode !== 200) throw new Error(`WHOIS lookup failed (${res.statusCode}).`);
    const data = JSON.parse(res.body || '{}');
    if (data.success === false) return { found: false };
    return {
      found: true,
      ip: data.ip,
      country: data.country,
      region: data.region,
      city: data.city,
      org: (data.connection && data.connection.org) || data.org || null,
      isp: (data.connection && data.connection.isp) || null,
      asn: (data.connection && data.connection.asn) || null
    };
  });

  ipcMain.handle('network:connections', async (event) => {
    const raw = await services.networkMonitor.getConnections();
    return services.networkEnricher.enrich(raw, (completed, total) => {
      event.sender.send('network:connections:progress', { completed, total });
    });
  });

  ipcMain.handle('network:geo', async (_event, ips) => {
    if (!db.getSetting('feature.geoLookup', true)) return {};
    const results = {};
    for (const ip of ips) {
      const geo = await services.geoLocationService.lookup(ip);
      if (geo) {
        results[ip] = geo;
      }
    }
    return results;
  });

  ipcMain.handle('network:stats', async () => {
    return services.networkMonitor.getStats();
  });

  // -- Per-connection bandwidth (on-demand, IPv4 TCP only — see
  // measureConnectionBandwidth's comment for why) --
  ipcMain.handle('network:measureBandwidth', async (_event, spec) => {
    return measureConnectionBandwidth(spec || {});
  });

  // -- Reports --
  const os = require('os');
  ipcMain.handle('reports:list', async () => {
    const dir = path.join(os.homedir(), '.soterios', 'reports');
    try {
      const fs = require('fs');
      const all = fs.readdirSync(dir).filter(f => f.endsWith('.html') || f.endsWith('.json'));
      const jsonBases = new Set(all.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/i, '')));
      const files = all.filter(f => f.endsWith('.json') || !jsonBases.has(f.replace(/\.html$/i, '')));
      return files.sort().reverse().slice(0, 50).map(f => ({
        name: f, path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.toISOString()
      }));
    } catch { return []; }
  });

  ipcMain.handle('scanReports:list', async (_event, limit) => {
    return db.getScanReports(limit || 25);
  });

  ipcMain.handle('scanReports:latest', async () => {
    return db.getLatestScanReport();
  });

  ipcMain.handle('scanReports:delete', async (_event, id) => {
    const row = db.deleteScanReport(id);
    if (!row) return { success: false, error: 'Report not found.' };
    deleteFileIfSafe(row.html_path);
    deleteFileIfSafe(row.json_path);
    deleteFileIfSafe(row.html_path && row.html_path.replace(/\.html$/i, '.pdf'));
    deleteFileIfSafe(row.json_path && row.json_path.replace(/\.json$/i, '.csv'));
    return { success: true };
  });

  ipcMain.handle('report:exportPDF', async (_event, reportId, reportType = 'scan') => {
    try {
      if (reportType === 'security') {
        // Security report export - reportId is the JSON file path
        const jsonPath = path.resolve(reportId || '');
        if (!isPathInsideDir(jsonPath, securityReportsDir()) ||
            path.extname(jsonPath).toLowerCase() !== '.json') {
          return { success: false, error: 'Invalid report path.' };
        }
        const htmlPath = jsonPath.replace(/\.json$/i, '.html');
        if (!fs.existsSync(htmlPath)) return { success: false, error: 'Report HTML file not found.' };
        const pdfPath = await generatePdfFromHtml(htmlPath);
        return { success: true, path: pdfPath };
      }
      // Scan report export
      const row = db.getScanReport(Number(reportId));
      if (!row) return { success: false, error: 'Report not found.' };
      if (!row.html_path || !fs.existsSync(row.html_path)) {
        return { success: false, error: 'Report HTML file not found.' };
      }
      if (!isPathInScanReportsDir(row.html_path)) {
        return { success: false, error: 'Invalid report path.' };
      }
      const pdfPath = await generatePdfFromHtml(row.html_path);
      return { success: true, path: pdfPath };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('report:exportCSV', async (_event, reportId, reportType = 'scan') => {
    try {
      if (reportType === 'security') {
        // Security report export - reportId is the file path
        const resolved = path.resolve(reportId || '');
        if (!isPathInsideDir(resolved, securityReportsDir()) ||
            path.extname(resolved).toLowerCase() !== '.json') {
          return { success: false, error: 'Invalid report path.' };
        }
        if (!fs.existsSync(resolved)) return { success: false, error: 'Report file not found.' };
        const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        const csvPath = resolved.replace(/\.json$/i, '.csv');
        safeWriteFileSync(csvPath, securityReportToCsv(report), 'utf8');
        return { success: true, path: csvPath };
      }
      // Scan report export
      const row = db.getScanReport(Number(reportId));
      if (!row) return { success: false, error: 'Report not found.' };
      if (!row.json_path || !fs.existsSync(row.json_path)) {
        return { success: false, error: 'Report JSON file not found.' };
      }
      if (!isPathInScanReportsDir(row.json_path)) {
        return { success: false, error: 'Invalid report path.' };
      }
      const report = JSON.parse(fs.readFileSync(row.json_path, 'utf8'));
      const csvPath = csvPathForJson(row.json_path);
      safeWriteFileSync(csvPath, threatsToCsv(report), 'utf8');
      return { success: true, path: csvPath };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('reports:delete', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInsideDir(resolved, securityReportsDir())) return { success: false, error: 'Invalid report path.' };
    deleteFileIfSafe(resolved);
    const sidecar = resolved.toLowerCase().endsWith('.json')
      ? resolved.replace(/\.json$/i, '.html')
      : resolved.replace(/\.html$/i, '.json');
    if (sidecar !== resolved) deleteFileIfSafe(sidecar);
    return { success: true };
  });

  ipcMain.handle('reports:read', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInsideDir(resolved, securityReportsDir())) return { success: false, error: 'Invalid report path.' };
    if (!fs.existsSync(resolved)) return { success: false, error: 'Report not found.' };
    if (resolved.toLowerCase().endsWith('.json')) {
      return { success: true, type: 'json', data: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
    }
    if (resolved.toLowerCase().endsWith('.html')) {
      const html = fs.readFileSync(resolved, 'utf8');
      const text = html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { success: true, type: 'html', text };
    }
    return { success: false, error: 'Unsupported report type.' };
  });

  ipcMain.handle('hibp:password', async (_event, password) => {
    if (!password) return { found: false, count: 0 };
    if (!db.getSetting('feature.externalLookups', true)) throw new Error('External lookups are disabled in Settings.');
    const sha = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha.slice(0, 5);
    const suffix = sha.slice(5);
    const res = await requestText(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }
    });
    if (res.statusCode !== 200) throw new Error(`HIBP password check failed (${res.statusCode}).`);
    const line = res.body.split(/\r?\n/).find(row => row.split(':')[0] === suffix);
    const count = line ? Number(line.split(':')[1] || 0) : 0;
    return { found: count > 0, count };
  });

  ipcMain.handle('xon:email', async (_event, email) => {
    if (!email) return { found: false, breaches: [] };
    if (!db.getSetting('feature.externalLookups', true)) throw new Error('External lookups are disabled in Settings.');
    const encoded = encodeURIComponent(email);
    const res = await requestText(`https://api.xposedornot.com/v1/check-email/${encoded}?details=true`);
    if (res.statusCode === 404) return { found: false, breaches: [] };
    if (res.statusCode === 429) throw new Error('XposedOrNot rate limit reached. Try again in a moment.');
    if (res.statusCode !== 200) throw new Error(`XposedOrNot email check failed (${res.statusCode}).`);
    const body = JSON.parse(res.body || '{}');
    if (body.Error || body.error) return { found: false, breaches: [] };
    const raw = body.breaches || body.Breaches || body.breach_details || body.BreachMetrics?.breaches_details || [];
    const breaches = Array.isArray(raw) ? raw.flat(Infinity).filter(Boolean) : Object.values(raw || {});
    return { found: breaches.length > 0, breaches };
  });

  ipcMain.handle('health:score', async () => {
    const latest = db.getLatestScanReport();
    const passwordScore = db.getSetting('feature.lastPasswordScore', null);
    const result = await services.toolRegistry.run('health-score', {
      lastScanMatches: latest ? latest.threats_found : null,
      passwordScore: passwordScore === null ? null : Number(passwordScore)
    }, { db });
    if (!result.ok) throw new Error(result.error || 'Unable to calculate health score');
    return result.data;
  });

  // -- Dialogs & Shell --
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('shell:showItemInFolder', (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('shell:openPath', async (_event, filePath) => {
    const resolved = path.resolve(filePath || '');
    if (!isPathInAllowedReportDir(resolved)) {
      return { success: false, error: 'Invalid file path.' };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'File not found.' };
    }
    const errorMessage = await shell.openPath(resolved);
    return errorMessage ? { success: false, error: errorMessage } : { success: true };
  });

  // -- Scheduled maintenance (#71) --
  ipcMain.handle('maintenance:get', () => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    return { ok: true, data: maintenanceScheduler.loadConfig() };
  });

  ipcMain.handle('maintenance:set', (_event, partial) => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const next = { ...(partial || {}) };
    if (Object.prototype.hasOwnProperty.call(next, 'intervalHours')) {
      const hours = Number(next.intervalHours);
      if (!Number.isFinite(hours) || hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) {
        return {
          ok: false,
          error: `Interval must be between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS} hours.`
        };
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'schedulePreset')) {
      if (!SCHEDULE_PRESETS[next.schedulePreset]) {
        return { ok: false, error: 'Invalid schedule preset.' };
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, 'scriptIds')) {
      if (!Array.isArray(next.scriptIds)) {
        return { ok: false, error: 'scriptIds must be an array.' };
      }
      next.scriptIds = next.scriptIds.filter((id) => ALLOWED_SCRIPT_IDS.has(id));
      if (!next.scriptIds.length) {
        return { ok: false, error: 'Select at least one maintenance script.' };
      }
    }
    return { ok: true, data: maintenanceScheduler.saveConfig(next) };
  });

  ipcMain.handle('maintenance:getScripts', () => {
    const scripts = loadRegistry()
      .filter((entry) => ALLOWED_SCRIPT_IDS.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, description: entry.description }));
    return { ok: true, data: scripts };
  });

  ipcMain.handle('maintenance:getHistory', () => ({ ok: true, data: db.getMaintenanceHistory(25) }));

  ipcMain.handle('maintenance:runNow', async () => {
    if (!maintenanceScheduler) return { ok: false, error: 'Maintenance scheduler unavailable.' };
    const result = await maintenanceScheduler.runNow({ dryRunCleanup: false, manual: true });
    if (result.skipped) {
      return {
        ok: false,
        error: result.reason === 'already-running'
          ? 'Maintenance is already running.'
          : `Maintenance skipped: ${result.reason || 'unknown'}.`,
        data: result
      };
    }
    return { ok: true, data: result };
  });

  // -- Auto-updater (#69) --
  ipcMain.handle('update:check', () => updater.checkForUpdates());
  ipcMain.handle('update:status', () => updater.getUpdateStatus());
  ipcMain.handle('update:install', () => updater.quitAndInstall());

  // -- System tray mini dashboard (#67) --
  ipcMain.handle('tray:getSummary', async () => getTrayHealthSummary(db, toolRegistry));

  ipcMain.handle('tray:openMain', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.handle('tray:quit', () => app.quit());
}

module.exports = { registerIpcHandlers };