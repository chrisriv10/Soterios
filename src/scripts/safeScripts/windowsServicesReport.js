const { execFile } = require('child_process');

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || error.message)); return; }
      resolve(stdout);
    });
  });
}

function pathLooksRisky(pathName) {
  if (!pathName) return { flagged: false, reason: null };
  const lower = pathName.toLowerCase();

  // Only flag genuinely suspicious locations, rather than the previous
  // approach of treating "not in Windows/Program Files" as risky. That
  // blanket exclusion caught Windows Defender's own service (which
  // legitimately runs from C:\ProgramData\Microsoft\Windows Defender\...)
  // along with any other software installed to ProgramData, per-user
  // AppData\Local\Programs, or any other normal non-Program-Files location.
  const riskyLocations = [
    { pattern: '\\windows\\temp\\', reason: 'Runs from Windows Temp.' },
    { pattern: '\\appdata\\roaming\\', reason: 'Runs from a user AppData Roaming folder (unusual for a system service).' },
    { pattern: '\\appdata\\local\\temp\\', reason: 'Runs from a user Temp folder.' },
    { pattern: '\\users\\public\\', reason: 'Runs from a shared, world-writable location.' }
  ];
  for (const { pattern, reason } of riskyLocations) {
    if (lower.includes(pattern)) return { flagged: true, reason };
  }

  // Unquoted service path containing a space is a well-known Windows
  // privilege-escalation vector (Windows can try each space-delimited
  // segment as a candidate executable when launching the service). This is
  // a distinct, lower-severity concern from "runs from a malware-like
  // location" above -- flagged separately so it isn't confused with an
  // actual suspicious-location hit.
  const trimmed = pathName.trim();
  if (!trimmed.startsWith('"')) {
    const exeIndex = trimmed.toLowerCase().indexOf('.exe');
    if (exeIndex !== -1 && trimmed.slice(0, exeIndex).includes(' ')) {
      return { flagged: true, reason: 'Unquoted service path containing a space in the folder name -- a known (if often low-impact) privilege-escalation pattern. Consider quoting the path.' };
    }
  }

  return { flagged: false, reason: null };
}

module.exports = async function windowsServicesReport() {
  if (process.platform !== 'win32') return { supported: false, message: 'Windows Services Report is only available on Windows.' };
  const script = ['Get-CimInstance Win32_Service', 'Where-Object { $_.StartMode -eq "Auto" }', 'Select-Object Name, DisplayName, State, StartName, PathName', 'ConvertTo-Json -Depth 3'].join(' | ');
  const stdout = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const services = Array.isArray(parsed) ? parsed : [parsed];
  const normalized = services.map((s) => {
    const risk = pathLooksRisky(s.PathName);
    return { name: s.Name, displayName: s.DisplayName, state: s.State, startName: s.StartName, pathName: s.PathName, flagged: risk.flagged, flagReason: risk.reason };
  });
  return { autoStartCount: normalized.length, flaggedCount: normalized.filter((s) => s.flagged).length, flagged: normalized.filter((s) => s.flagged).slice(0, 40), services: normalized.slice(0, 120) };
};