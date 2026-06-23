const { execFile } = require('child_process');

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// Flag service paths that don't live under standard system directories,
// or that are rooted in locations commonly abused by malware.
function pathLooksRisky(pathName) {
  if (!pathName) return false;
  const lower = pathName.toLowerCase();

  // Explicitly suspicious locations
  if (
    lower.includes('\\temp\\') ||
    lower.includes('\\appdata\\roaming\\') ||
    lower.includes('\\users\\public\\')
  ) {
    return true;
  }

  // Not under any recognised safe root → flag it
  const safeRoots = ['\\windows\\', '\\program files\\', '\\program files (x86)\\'];
  return !safeRoots.some((root) => lower.includes(root));
}

module.exports = async function windowsServicesReport() {
  if (process.platform !== 'win32') {
    return { supported: false, message: 'Windows Services Report is only available on Windows.' };
  }

  const script = [
    'Get-CimInstance Win32_Service',
    'Where-Object { $_.StartMode -eq "Auto" }',
    'Select-Object Name, DisplayName, State, StartName, PathName',
    'ConvertTo-Json -Depth 3'
  ].join(' | ');

  const stdout = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const services = Array.isArray(parsed) ? parsed : [parsed];

  const normalized = services.map((service) => ({
    name: service.Name,
    displayName: service.DisplayName,
    state: service.State,
    startName: service.StartName,
    pathName: service.PathName,
    flagged: pathLooksRisky(service.PathName)
  }));

  return {
    autoStartCount: normalized.length,
    flaggedCount: normalized.filter((s) => s.flagged).length,
    flagged: normalized.filter((s) => s.flagged).slice(0, 40),
    services: normalized.slice(0, 120)
  };
};
