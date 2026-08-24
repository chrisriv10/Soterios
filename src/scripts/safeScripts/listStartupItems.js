'use strict';

const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const REGISTRY_LOCATIONS = [
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
];

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true, timeout: 45000, maxBuffer: 15 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim()));
      resolve(stdout);
    });
  });
}

function extractExe(command) {
  const value = String(command || '').trim();
  const quoted = value.match(/^"([^"]+\.(?:exe|com|bat|cmd|ps1|vbs|js))"/i);
  if (quoted) return quoted[1];
  const unquoted = value.match(/^(.+?\.(?:exe|com|bat|cmd|ps1|vbs|js))\b/i);
  return unquoted ? unquoted[1] : null;
}

function stableId(item) {
  return crypto.createHash('sha256')
    .update(`${item.source}|${item.location}|${item.valueName || item.name}`.toLowerCase())
    .digest('hex');
}

function signatureLabel(value) {
  if (value === 0 || value === '0') return 'Valid';
  return value ? String(value) : 'Unknown';
}

module.exports = async function listStartupItems(_args = {}, onProgress) {
  if (process.platform !== 'win32') return { supported: false, message: 'Startup Items is available on Windows 10 and 11.', items: [] };
  onProgress?.({ phase: 'collecting', label: 'Reading startup registry values', pct: 5, cancelable: true });
  const keyLiteral = REGISTRY_LOCATIONS.map((key) => `'${key}'`).join(',');
  const script = `
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force -ErrorAction SilentlyContinue
$items = @()
$keys = @(${keyLiteral})
foreach ($key in $keys) {
  if (-not (Test-Path -LiteralPath $key)) { continue }
  $registryKey = Get-Item -LiteralPath $key
  foreach ($name in $registryKey.GetValueNames()) {
    $command = [string]$registryKey.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
    $type = [string]$registryKey.GetValueKind($name)
    $items += [PSCustomObject]@{ Source='registry'; Location=$key; Scope=$(if ($key -like 'HKCU:*') {'Current user'} else {'All users'}); ValueName=$name; Name=$name; Command=$command; RegistryType=$type; StartupPath='' }
  }
}
$folders = @(
  [PSCustomObject]@{ Scope='Current user'; Path=[Environment]::GetFolderPath('Startup') },
  [PSCustomObject]@{ Scope='All users'; Path=[Environment]::GetFolderPath('CommonStartup') }
)
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in $folders) {
  if (-not (Test-Path -LiteralPath $folder.Path)) { continue }
  Get-ChildItem -LiteralPath $folder.Path -File -Force | ForEach-Object {
    $command = $_.FullName
    if ($_.Extension -eq '.lnk') {
      $shortcut = $shell.CreateShortcut($_.FullName)
      $command = ('"' + $shortcut.TargetPath + '" ' + $shortcut.Arguments).Trim()
    }
    $items += [PSCustomObject]@{ Source='startup-folder'; Location=$folder.Path; Scope=$folder.Scope; ValueName=''; Name=$_.Name; Command=$command; RegistryType=''; StartupPath=$_.FullName }
  }
}
$out = foreach ($item in $items) {
  $command = [string]$item.Command
  $exe = if ($command -match '^"([^"]+\\.(?:exe|com|bat|cmd|ps1|vbs|js))"') { $Matches[1] } elseif ($command -match '^(.+?\\.(?:exe|com|bat|cmd|ps1|vbs|js))\\b') { $Matches[1] } else { '' }
  $publisher=''; $product=''; $description=''; $signature='Unknown'
  if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
    $file = Get-Item -LiteralPath $exe
    $publisher = [string]$file.VersionInfo.CompanyName
    $product = [string]$file.VersionInfo.ProductName
    $description = [string]$file.VersionInfo.FileDescription
    $signature = [string](Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction SilentlyContinue).Status
    if (-not $signature) { $signature = 'Unknown' }
  }
  [PSCustomObject]@{
    Source=$item.Source; Location=$item.Location; Scope=$item.Scope
    ValueName=$item.ValueName; Name=$item.Name; Command=$command
    RegistryType=$item.RegistryType; StartupPath=$item.StartupPath
    ExePath=$exe; Publisher=$publisher; ProductName=$product
    Description=$description; Signature=$signature
  }
}
$out | ConvertTo-Json -Depth 5 -Compress
`;
  const stdout = await runPowerShell(script);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const items = rows.map((row, index) => {
    const item = {
      source: row.Source,
      location: row.Location,
      scope: row.Scope,
      valueName: row.ValueName || null,
      name: row.Name,
      friendlyName: row.ProductName || row.Description || row.Name,
      command: row.Command,
      registryType: row.RegistryType || null,
      startupPath: row.StartupPath || null,
      exePath: row.ExePath || extractExe(row.Command),
      publisher: row.Publisher || '',
      productName: row.ProductName || '',
      description: row.Description || '',
      signature: signatureLabel(row.Signature),
      enabled: true
    };
    item.id = stableId(item);
    item.risk = item.signature === 'Valid' ? 'low' : (/\\temp\\|\\users\\public\\|\\appdata\\roaming\\/i.test(item.command) ? 'high' : 'medium');
    item.riskReason = item.risk === 'high' ? 'Runs from a commonly abused user-writable location.'
      : (item.risk === 'medium' ? `Signature status is ${item.signature}.` : 'Digitally signed startup item.');
    onProgress?.({ phase: 'enriching', label: 'Checking startup item publishers', pct: 40 + Math.round(((index + 1) / Math.max(rows.length, 1)) * 59), count: index + 1, total: rows.length, cancelable: true });
    return item;
  });
  return {
    supported: true,
    platform: 'win32',
    itemCount: items.length,
    registryCount: items.filter((item) => item.source === 'registry').length,
    startupFolderCount: items.filter((item) => item.source === 'startup-folder').length,
    items
  };
};

module.exports.REGISTRY_LOCATIONS = REGISTRY_LOCATIONS;
module.exports.extractExe = extractExe;
module.exports.stableId = stableId;
module.exports.signatureLabel = signatureLabel;
