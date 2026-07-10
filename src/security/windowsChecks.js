const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll', '.sys', '.scr', '.com', '.msi']);

function runPowerShell(script, timeout = 20000) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'Windows checks are only available on Windows.' });
  }
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout, stderr) => {
        if (error) { resolve({ ok: false, error: stderr || error.message }); return; }
        resolve({ ok: true, stdout });
      });
  });
}

async function runJsonPowerShell(script, fallback = null, timeout) {
  const wrapped = `${script} | ConvertTo-Json -Depth 6`;
  const result = await runPowerShell(wrapped, timeout);
  if (!result.ok) return { ok: false, error: result.error, data: fallback };
  try {
    const trimmed = result.stdout.trim();
    if (!trimmed) return { ok: true, data: fallback };
    return { ok: true, data: JSON.parse(trimmed) };
  } catch (err) {
    return { ok: false, error: err.message, data: fallback };
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function getDefenderStatus() {
  if (process.platform !== 'win32') return { available: false, error: 'Not Windows' };

  // Strategy 1: Get-MpComputerStatus (works when WinDefend service is running)
  const r1 = await runJsonPowerShell(`
    $status = Get-MpComputerStatus -ErrorAction Stop
    [PSCustomObject]@{
      available                 = $true
      antivirusEnabled          = [bool]$status.AntivirusEnabled
      realTimeProtectionEnabled = [bool]$status.RealTimeProtectionEnabled
      antispywareEnabled        = [bool]$status.AntispywareEnabled
      signaturesAge             = $status.AntivirusSignatureAge
      engineVersion             = $status.AMEngineVersion
      signatureVersion          = $status.AntivirusSignatureVersion
    }
  `, null, 15000);
  if (r1.data && r1.data.available) return r1.data;

  // Strategy 2: WMI SecurityCenter2 — works for standard users in most Windows 10/11 builds
  const r2 = await runJsonPowerShell(`
    $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop |
          Where-Object { $_.displayName -like '*Windows Defender*' -or $_.displayName -like '*Microsoft Defender*' } |
          Select-Object -First 1
    if ($av) {
      $state = [int]$av.productState
      # productState encodes enabled/updated as bit fields
      $rtEnabled  = (($state -shr 12) -band 0xF) -eq 1
      $avEnabled  = $rtEnabled
      $upToDate   = (($state -shr 4)  -band 0xF) -ne 0
      [PSCustomObject]@{
        available                 = $true
        antivirusEnabled          = $avEnabled
        realTimeProtectionEnabled = $rtEnabled
        antispywareEnabled        = $avEnabled
        signaturesAge             = if ($upToDate) { 0 } else { 99 }
        engineVersion             = $null
        signatureVersion          = $null
      }
    } else { $null }
  `, null, 15000);
  if (r2.data && r2.data.available) return r2.data;

  // Strategy 3: Registry key — read-only, no special perms needed
  const r3 = await runJsonPowerShell(`
    $regPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender'
    if (Test-Path $regPath) {
      $rtKey   = Get-ItemProperty -Path "$regPath\\Real-Time Protection" -ErrorAction SilentlyContinue
      $sigPath = "$regPath\\Signature Updates"
      $sigKey  = Get-ItemProperty -Path $sigPath -ErrorAction SilentlyContinue
      $rtOn    = if ($rtKey) { [bool]($rtKey.DisableRealtimeMonitoring -eq 0) } else { $true }
      $avOn    = if ($rtKey) { [bool]($rtKey.DisableAntiSpyware -ne 1) }        else { $true }
      $sigAge  = if ($sigKey -and $sigKey.SignatureUpdateLastUsedtime) {
                   [int]((Get-Date) - [datetime]::FromFileTime($sigKey.SignatureUpdateLastUsedtime)).TotalDays
                 } else { $null }
      [PSCustomObject]@{
        available                 = $true
        antivirusEnabled          = $avOn
        realTimeProtectionEnabled = $rtOn
        antispywareEnabled        = $avOn
        signaturesAge             = $sigAge
        engineVersion             = $null
        signatureVersion          = $null
      }
    } else { $null }
  `, null, 10000);
  if (r3.data && r3.data.available) return r3.data;

  return { available: false, error: 'All Defender query strategies failed' };
}

async function getFirewallStatus() {
  const result = await runJsonPowerShell(
    'Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction',
    []
  );
  return asArray(result.data).map((p) => ({
    name: p.Name, enabled: !!p.Enabled,
    defaultInboundAction: p.DefaultInboundAction, defaultOutboundAction: p.DefaultOutboundAction
  }));
}

async function getUpdateStatus() {
  if (process.platform !== 'win32') return { pendingCount: null, error: 'Not Windows' };

  // Strategy 1: WUA COM object — works for standard users on most builds but can be slow
  const r1 = await runJsonPowerShell(`
    $session  = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop
    $searcher = $session.CreateUpdateSearcher()
    $pending  = $searcher.Search('IsInstalled=0 and IsHidden=0')
    $historyCount = $searcher.GetTotalHistoryCount()
    $last = $null
    if ($historyCount -gt 0) { $last = $searcher.QueryHistory(0,1)[0] }
    [PSCustomObject]@{
      pendingCount   = $pending.Updates.Count
      lastUpdateDate = if ($last) { [string]$last.Date } else { $null }
      lastUpdateTitle= if ($last) { [string]$last.Title } else { $null }
    }
  `, null, 30000);
  if (r1.data && r1.data.pendingCount !== null && r1.data.pendingCount !== undefined) return r1.data;

  // Strategy 2: Registry — read last install date and reboot-pending flag (no COM, no elevation)
  const r2 = await runJsonPowerShell(`
    $wu      = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate'
    $auto    = "$wu\\Auto Update"
    $results = "$auto\\Results\\Install"
    $reboot  = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
    $reboot2 = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager'

    $lastDate = $null
    if (Test-Path $results) {
      $p = Get-ItemProperty -Path $results -ErrorAction SilentlyContinue
      if ($p.LastSuccessTime) { $lastDate = [string]$p.LastSuccessTime }
    }

    $rebootNeeded = (Test-Path $reboot)
    if (-not $rebootNeeded -and (Test-Path $reboot2)) {
      $smKey = Get-ItemProperty -Path $reboot2 -ErrorAction SilentlyContinue
      $rebootNeeded = ($smKey.PendingFileRenameOperations -ne $null)
    }

    # Pending count not available without COM; use reboot flag as a proxy
    [PSCustomObject]@{
      pendingCount    = if ($rebootNeeded) { 1 } else { 0 }
      lastUpdateDate  = $lastDate
      lastUpdateTitle = if ($rebootNeeded) { 'Updates installed — reboot pending' } else { $null }
      source          = 'registry'
    }
  `, null, 10000);
  if (r2.data && r2.data.pendingCount !== null) return r2.data;

  return { pendingCount: null, error: 'All Windows Update query strategies failed' };
}

async function getSignatureInfo(filePath) {
  if (!filePath || !fs.existsSync(filePath) || process.platform !== 'win32') {
    return { status: 'Unknown', publisher: null };
  }
  const escaped = filePath.replace(/'/g, "''");
  const result = await runJsonPowerShell(`
    $sig = Get-AuthenticodeSignature -LiteralPath '${escaped}' -ErrorAction SilentlyContinue
    [PSCustomObject]@{
      status = if ($sig) { [string]$sig.Status } else { 'Unknown' }
      publisher = if ($sig -and $sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
    }
  `, { status: 'Unknown', publisher: null }, 10000);
  return result.data || { status: 'Unknown', publisher: null };
}

function isExecutablePath(filePath) {
  return EXECUTABLE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function suspiciousPathSignals(filePath) {
  const signals = [];
  const normalized = String(filePath || '').toLowerCase();
  if (!normalized) { return signals; }
  if (normalized.includes('\\appdata\\roaming\\') || normalized.includes('\\appdata\\local\\temp\\'))
    signals.push({ points: 25, message: 'Runs from a user AppData or temporary location.' });
  if (normalized.includes('\\windows\\temp\\') || normalized.includes('\\users\\public\\'))
    signals.push({ points: 20, message: 'Runs from a commonly abused writable Windows location.' });
  if (/\.(jpg|png|pdf|docx?|xlsx?)\.(exe|scr|js|vbs|bat|cmd|ps1)$/i.test(normalized))
    signals.push({ points: 45, message: 'Uses a double extension commonly used to disguise malware.' });
  return signals;
}

async function getStartupFolders() {
  const folders = [
    path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')
  ];
  const items = [];
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      const filePath = path.join(folder, name);
      items.push({ source: 'Startup Folder', name, command: filePath, location: folder, path: filePath });
    }
  }
  return items;
}

async function getRegistryRunItems() {
  const result = await runJsonPowerShell(`
    $keys = @(
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
    )
    foreach ($key in $keys) {
      if (Test-Path $key) {
        $props = Get-ItemProperty -Path $key
        foreach ($p in $props.PSObject.Properties) {
          if ($p.Name -notmatch '^PS') {
            [PSCustomObject]@{ source='Registry Run'; name=$p.Name; command=[string]$p.Value; location=$key; path=$null }
          }
        }
      }
    }
  `, []);
  return asArray(result.data);
}

async function getScheduledTasks() {
  const result = await runJsonPowerShell(`
    Get-ScheduledTask |
      Where-Object { $_.State -ne 'Disabled' } |
      ForEach-Object {
        $action = $_.Actions | Select-Object -First 1
        [PSCustomObject]@{
          source='Scheduled Task'; name=$_.TaskName
          command=($action.Execute + ' ' + $action.Arguments).Trim()
          location=$_.TaskPath; path=$action.Execute; state=[string]$_.State
        }
      }
  `, [], 30000);
  return asArray(result.data);
}

async function getServices() {
  const result = await runJsonPowerShell(`
    Get-CimInstance Win32_Service |
      Where-Object { $_.StartMode -eq 'Auto' -or $_.State -eq 'Running' } |
      Select-Object Name, DisplayName, PathName, StartMode, State
  `, [], 30000);
  return asArray(result.data).map((svc) => ({
    source: 'Windows Service', name: svc.DisplayName || svc.Name, serviceName: svc.Name,
    command: svc.PathName, location: svc.StartMode,
    path: extractExecutablePath(svc.PathName), state: svc.State
  }));
}

function extractExecutablePath(command) {
  if (!command) return null;
  const trimmed = String(command).trim();
  const quoted = trimmed.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  const exe = trimmed.match(/^(.+?\.exe)\b/i);
  return exe ? exe[1] : trimmed.split(/\s+/)[0];
}

module.exports = {
  asArray, runPowerShell, runJsonPowerShell, getDefenderStatus, getFirewallStatus, getUpdateStatus,
  getSignatureInfo, getRegistryRunItems, getStartupFolders, getScheduledTasks, getServices,
  extractExecutablePath, isExecutablePath, suspiciousPathSignals
};
