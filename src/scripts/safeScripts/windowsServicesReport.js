'use strict';

const { execFile } = require('child_process');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim()));
      resolve(stdout);
    });
  });
}

function extractExecutable(command) {
  const value = String(command || '').trim();
  const quoted = value.match(/^"([^"]+\.(?:exe|sys|dll))"/i);
  if (quoted) return quoted[1];
  const unquoted = value.match(/^(.+?\.(?:exe|sys|dll))\b/i);
  return unquoted ? unquoted[1] : '';
}

function pathLooksRisky(pathName, signature = '') {
  if (!pathName) return { flagged: false, reason: null, risk: 'unknown' };
  const lower = pathName.toLowerCase();
  const riskyLocations = [
    ['\\windows\\temp\\', 'Runs from Windows Temp.'],
    ['\\appdata\\roaming\\', 'Runs from a user AppData Roaming folder.'],
    ['\\appdata\\local\\temp\\', 'Runs from a user Temp folder.'],
    ['\\users\\public\\', 'Runs from a shared, user-writable location.']
  ];
  for (const [pattern, reason] of riskyLocations) {
    if (lower.includes(pattern)) return { flagged: true, reason, risk: 'high' };
  }
  const trimmed = pathName.trim();
  if (!trimmed.startsWith('"')) {
    const exeIndex = trimmed.toLowerCase().indexOf('.exe');
    if (exeIndex !== -1 && trimmed.slice(0, exeIndex).includes(' ')) {
      return { flagged: true, reason: 'The executable path contains spaces but is not quoted, which can create a service path hijacking opportunity.', risk: 'medium' };
    }
  }
  if (signature && !['Valid', 'NotSupported'].includes(signature) && /\.(exe|sys|dll)/i.test(pathName)) {
    return { flagged: true, reason: `Executable signature status is ${signature}.`, risk: 'medium' };
  }
  return { flagged: false, reason: null, risk: 'low' };
}

function signatureLabel(value) {
  if (value === 0 || value === '0') return 'Valid';
  return value ? String(value) : 'Unknown';
}

module.exports = async function windowsServicesReport(_args = {}, onProgress) {
  if (process.platform !== 'win32') return { supported: false, message: 'Windows Services Report is only available on Windows.', services: [] };
  onProgress?.({ phase: 'collecting', label: 'Reading Windows services', pct: 5, cancelable: true });
  const script = `
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force -ErrorAction SilentlyContinue
$services = @(Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -or $_.State -eq 'Running' })
$out = foreach ($service in $services) {
  $command = [string]$service.PathName
  $exe = if ($command -match '^"([^"]+\\.(?:exe|sys|dll))"') { $Matches[1] } elseif ($command -match '^(.+?\\.(?:exe|sys|dll))\\b') { $Matches[1] } else { '' }
  $publisher = ''
  $product = ''
  $signature = ''
  if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
    $file = Get-Item -LiteralPath $exe
    $publisher = [string]$file.VersionInfo.CompanyName
    $product = [string]$file.VersionInfo.ProductName
    $signature = [string](Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction SilentlyContinue).Status
    if (-not $signature) { $signature = 'Unknown' }
  }
  [PSCustomObject]@{
    Name=[string]$service.Name; DisplayName=[string]$service.DisplayName
    Description=[string]$service.Description; State=[string]$service.State
    StartMode=[string]$service.StartMode; StartName=[string]$service.StartName
    PathName=$command; ExecutablePath=$exe; Publisher=$publisher
    ProductName=$product; Signature=$signature; ProcessId=[int]$service.ProcessId
  }
}
$out | ConvertTo-Json -Depth 5 -Compress
`;
  const stdout = await runPowerShell(script);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  const services = [];
  rows.forEach((service, index) => {
    if (seen.has(service.Name)) return;
    seen.add(service.Name);
    const signature = signatureLabel(service.Signature);
    const risk = pathLooksRisky(service.PathName, signature);
    services.push({
      id: service.Name,
      name: service.Name,
      displayName: service.DisplayName || service.Name,
      description: service.Description || '',
      state: service.State,
      startType: service.StartMode,
      account: service.StartName,
      pathName: service.PathName,
      executablePath: service.ExecutablePath || extractExecutable(service.PathName),
      publisher: service.Publisher || '',
      productName: service.ProductName || '',
      signature,
      processId: service.ProcessId || 0,
      ...risk,
      flagReason: risk.reason
    });
    onProgress?.({ phase: 'analyzing', label: 'Checking service paths and signatures', pct: 35 + Math.round(((index + 1) / Math.max(rows.length, 1)) * 64), count: index + 1, total: rows.length, cancelable: true });
  });
  return {
    autoStartCount: services.filter((service) => service.startType === 'Auto').length,
    serviceCount: services.length,
    flaggedCount: services.filter((service) => service.flagged).length,
    flagged: services.filter((service) => service.flagged),
    services
  };
};

module.exports.extractExecutable = extractExecutable;
module.exports.pathLooksRisky = pathLooksRisky;
module.exports.signatureLabel = signatureLabel;
