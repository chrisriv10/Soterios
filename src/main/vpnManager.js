'use strict';

// Enumerates and controls Windows VPN connections using the built-in
// Get-VpnConnection / Start-VpnConnection / Stop-VpnConnection cmdlets, with
// rasdial as a fallback for profiles the cmdlets cannot dial. All traffic
// stays local; only Windows built-in VPN profiles are touched.

const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const { getEapConfigXml, getServerForProvider } = require('./vpnProviders');

const LIST_TTL_MS = 4000;
const CONNECT_TIMEOUT_MS = 90000;
const ADD_TIMEOUT_MS = 60000;
const REMOVE_TIMEOUT_MS = 30000;
const SOTERIOS_PROFILE_PREFIX = 'Soterios - ';

function powershellEscape(value) {
  return String(value || '').replace(/'/g, "''");
}

function defaultRunPowerShell(command, timeoutMs) {
  return execFilePromise(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: timeoutMs, windowsHide: true }
  );
}

const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$vpn = @(Get-VpnConnection)
if ($vpn.Count -gt 0) {
  $vpn | Select-Object Name, ConnectionStatus, ServerAddress, TunnelType | ConvertTo-Json -Compress
} else {
  Write-Output '[]'
}`;

function connectScript(name) {
  return `
$ErrorActionPreference = 'Stop'
try {
  Start-VpnConnection -Name '${powershellEscape(name)}' -ErrorAction Stop
  Write-Output 'OK'
} catch {
  Write-Output ('FAIL|' + $_.Exception.Message)
}`;
}

function connectFallbackScript(name) {
  return `
$ErrorActionPreference = 'Continue'
rasdial '${powershellEscape(name)}'
exit $LASTEXITCODE`;
}

function disconnectScript(name) {
  return `
$ErrorActionPreference = 'Stop'
try {
  Stop-VpnConnection -Name '${powershellEscape(name)}' -ErrorAction Stop
  Write-Output 'OK'
} catch {
  Write-Output ('FAIL|' + $_.Exception.Message)
}`;
}

function disconnectFallbackScript(name) {
  return `
$ErrorActionPreference = 'Continue'
rasdial '${powershellEscape(name)}' /d
exit $LASTEXITCODE`;
}

function removeVpnScript(name) {
  return `
$ErrorActionPreference = 'Stop'
try {
  Remove-VpnConnection -Name '${powershellEscape(name)}' -Force -ErrorAction Stop
  cmdkey /delete:"LegacyGeneric:target=${powershellEscape(name)}" | Out-Null
  Write-Output 'OK'
} catch {
  Write-Output ('FAIL|' + $_.Exception.Message)
}`;
}

function addVpnScript(profileName, serverAddress, username, password) {
  const eapXml = getEapConfigXml().replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
try {
  [xml]$eapXml = '${eapXml}'
  Add-VpnConnection -Name '${powershellEscape(profileName)}' -ServerAddress '${powershellEscape(serverAddress)}' -TunnelType IKEv2 -AuthenticationMethod Eap -EapConfigXmlStream $eapXml -RememberCredential -Force -ErrorAction Stop
  cmdkey /generic:"LegacyGeneric:target=${powershellEscape(profileName)}" /user:"${powershellEscape(username)}" /pass:"${powershellEscape(password)}" | Out-Null
  Write-Output 'OK'
} catch {
  Write-Output ('FAIL|' + $_.Exception.Message)
}`;
}

function getStatusScript(name) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$vpn = Get-VpnConnection -Name '${powershellEscape(name)}' -ErrorAction SilentlyContinue
if ($vpn) {
  @{ Name = $vpn.Name; Connected = $vpn.ConnectionStatus -eq 'Connected'; ServerAddress = $vpn.ServerAddress; TunnelType = $vpn.TunnelType } | ConvertTo-Json -Compress
} else {
  Write-Output 'NOTFOUND'
}`;
}

class VpnManager {
  constructor(options = {}) {
    this._run = options.runPowerShell || defaultRunPowerShell;
    this._listCache = { at: 0, result: null };
    this._db = options.db || null;
  }

  setDb(db) {
    this._db = db;
  }

  _clearCache() {
    this._listCache = { at: 0, result: null };
  }

  async list(force = false) {
    const now = Date.now();
    if (!force && this._listCache.result && now - this._listCache.at < LIST_TTL_MS) {
      return this._listCache.result;
    }
    let stdout = '';
    try {
      const result = await this._run(LIST_SCRIPT, 20000);
      stdout = result.stdout || '';
    } catch (err) {
      const error = (err && err.message) ? err.message : String(err);
      const result = { ok: false, vpns: [], error: `Could not enumerate VPN connections: ${error}` };
      this._listCache = { at: now, result };
      return result;
    }
    let parsed = [];
    try {
      const rows = JSON.parse(stdout.trim() || '[]');
      parsed = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
        name: row.Name || 'Unknown',
        managed: String(row.Name || '').startsWith(SOTERIOS_PROFILE_PREFIX),
        connected: String(row.ConnectionStatus || '').toLowerCase() === 'connected',
        serverAddress: row.ServerAddress || '',
        tunnelType: row.TunnelType || '',
      }));
    } catch (_) {
      const result = { ok: false, vpns: [], error: 'Unexpected response while enumerating VPN connections.' };
      this._listCache = { at: now, result };
      return result;
    }
    const result = { ok: true, vpns: parsed };
    this._listCache = { at: now, result };
    return result;
  }

  async connect(name) {
    this._clearCache();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: 'No VPN selected.' };
    }
    const trimmed = name.trim();
    try {
      const result = await this._run(connectScript(trimmed), CONNECT_TIMEOUT_MS);
      const line = String(result.stdout || '').trim().split(/\r?\n/).pop() || '';
      if (line === 'OK') return { ok: true };
      if (line.startsWith('FAIL|')) {
        return this._connectFallback(trimmed, line.slice(5));
      }
    } catch (err) {
      return this._connectFallback(trimmed, (err && err.message) ? err.message : String(err));
    }
    return this._connectFallback(trimmed, 'Connection failed.');
  }

  async _connectFallback(name, primaryError) {
    try {
      await this._run(connectFallbackScript(name), CONNECT_TIMEOUT_MS);
      return { ok: true };
    } catch (err) {
      const code = err && err.code;
      const detail = code !== undefined && code !== null
        ? `rasdial exit code ${code}`
        : ((err && err.message) ? err.message : String(err));
      const reason = /not recognized|not available|not exist|could not be found/i.test(String(primaryError))
        ? detail
        : (primaryError || detail);
      return { ok: false, error: `Could not connect to "${name}": ${reason}` };
    }
  }

  async disconnect(name) {
    this._clearCache();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: 'No VPN selected.' };
    }
    const trimmed = name.trim();
    try {
      const result = await this._run(disconnectScript(trimmed), 20000);
      const line = String(result.stdout || '').trim().split(/\r?\n/).pop() || '';
      if (line === 'OK') return { ok: true };
      if (line.startsWith('FAIL|')) {
        return this._disconnectFallback(trimmed, line.slice(5));
      }
    } catch (err) {
      return this._disconnectFallback(trimmed, (err && err.message) ? err.message : String(err));
    }
    return this._disconnectFallback(trimmed, 'Disconnect failed.');
  }

  async remove(name) {
    this._clearCache();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: 'No VPN selected.' };
    }
    const trimmed = name.trim();
    if (!trimmed.startsWith(SOTERIOS_PROFILE_PREFIX)) {
      return { ok: false, error: 'Only Soterios-created VPN profiles can be removed.' };
    }
    try {
      const result = await this._run(removeVpnScript(trimmed), REMOVE_TIMEOUT_MS);
      const line = String(result.stdout || '').trim().split(/\r?\n/).pop() || '';
      if (line === 'OK') {
        if (this._db && this._db.getSetting('vpn.lastProfile') === trimmed) this._db.setSetting('vpn.lastProfile', '');
        return { ok: true };
      }
      if (line.startsWith('FAIL|')) return { ok: false, error: line.slice(5) };
    } catch (err) {
      const error = (err && err.message) ? err.message : String(err);
      return { ok: false, error: `Failed to remove VPN profile: ${error}` };
    }
    return { ok: false, error: 'Failed to remove VPN profile.' };
  }

  async _disconnectFallback(name, primaryError) {
    try {
      await this._run(disconnectFallbackScript(name), 20000);
      return { ok: true };
    } catch (err) {
      const code = err && err.code;
      const detail = code !== undefined && code !== null
        ? `rasdial exit code ${code}`
        : ((err && err.message) ? err.message : String(err));
      return { ok: false, error: `Could not disconnect "${name}": ${primaryError || detail}` };
    }
  }

  // Get connection status for a specific VPN profile
  async getStatus(name) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: 'No VPN selected.' };
    }
    const trimmed = name.trim();
    try {
      const result = await this._run(getStatusScript(trimmed), 10000);
      const stdout = String(result.stdout || '').trim();
      if (stdout === 'NOTFOUND') {
        return { ok: false, error: 'VPN profile not found.' };
      }
      const parsed = JSON.parse(stdout);
      return {
        ok: true,
        name: parsed.Name,
        connected: parsed.Connected === true,
        serverAddress: parsed.ServerAddress || '',
        tunnelType: parsed.TunnelType || '',
      };
    } catch (err) {
      const error = (err && err.message) ? err.message : String(err);
      return { ok: false, error: `Could not get VPN status: ${error}` };
    }
  }

  // Connect to the last used VPN profile
  async connectLast() {
    if (!this._db) {
      return { ok: false, error: 'Database not available for last profile lookup.' };
    }
    const lastProfile = this._db.getSetting('vpn.lastProfile');
    if (!lastProfile) {
      return { ok: false, error: 'No last VPN profile recorded.' };
    }
    return this.connect(lastProfile);
  }

  // Disconnect the last used VPN profile
  async disconnectLast() {
    if (!this._db) {
      return { ok: false, error: 'Database not available for last profile lookup.' };
    }
    const lastProfile = this._db.getSetting('vpn.lastProfile');
    if (!lastProfile) {
      return { ok: false, error: 'No last VPN profile recorded.' };
    }
    return this.disconnect(lastProfile);
  }

  // Toggle last VPN profile (connect if disconnected, disconnect if connected)
  async toggleLast() {
    if (!this._db) {
      return { ok: false, error: 'Database not available for last profile lookup.' };
    }
    const lastProfile = this._db.getSetting('vpn.lastProfile');
    if (!lastProfile) {
      return { ok: false, error: 'No last VPN profile recorded.' };
    }
    const status = await this.getStatus(lastProfile);
    if (!status.ok) {
      return status;
    }
    return status.connected ? this.disconnect(lastProfile) : this.connect(lastProfile);
  }

  // Add a new VPN profile from provider
  async addFromProvider(providerId, serverId, username, password) {
    if (!providerId || !serverId || !username || !password) {
      return { ok: false, error: 'Missing required parameters.' };
    }

    const server = getServerForProvider(providerId, serverId);
    const provider = require('./vpnProviders').getProvider(providerId);
    if (!provider) {
      return { ok: false, error: 'Invalid provider.' };
    }

    // Built-in providers ship no server lists; the UI sends a pasted hostname
    // as serverId. Fall back to using it directly as the server address.
    const useServer = server || { id: serverId, name: serverId, host: serverId };

    const profileName = `Soterios - ${provider.name} - ${useServer.name}`;
    const serverAddress = useServer.host;

    this._clearCache();

    try {
      const result = await this._run(addVpnScript(profileName, serverAddress, username, password), ADD_TIMEOUT_MS);
      const line = String(result.stdout || '').trim().split(/\r?\n/).pop() || '';
      if (line === 'OK') {
        // Store as last profile for future auto-connect
        if (this._db) {
          this._db.setSetting('vpn.lastProfile', profileName);
        }
        return { ok: true, profileName };
      }
      if (line.startsWith('FAIL|')) {
        return { ok: false, error: line.slice(5) };
      }
    } catch (err) {
      const error = (err && err.message) ? err.message : String(err);
      return { ok: false, error: `Failed to add VPN profile: ${error}` };
    }
    return { ok: false, error: 'Failed to add VPN profile.' };
  }
}

module.exports = { VpnManager };
