'use strict';

// Enumerates and controls Windows VPN connections using the built-in
// Get-VpnConnection / Start-VpnConnection / Stop-VpnConnection cmdlets, with
// rasdial as a fallback for profiles the cmdlets cannot dial. All traffic
// stays local; only Windows built-in VPN profiles are touched.

const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const LIST_TTL_MS = 4000;
const CONNECT_TIMEOUT_MS = 90000;

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

class VpnManager {
  constructor(options = {}) {
    this._run = options.runPowerShell || defaultRunPowerShell;
    this._listCache = { at: 0, result: null };
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
}

module.exports = { VpnManager };
