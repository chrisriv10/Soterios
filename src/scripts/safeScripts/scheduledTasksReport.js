const { execFile } = require('child_process');

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || error.message)); return; }
      resolve(stdout);
    });
  });
}

function actionLooksRisky(execPath) {
  if (!execPath) return { flagged: false, reason: null };
  const lower = execPath.toLowerCase();

  // Same style of narrow, high-confidence location checks used for the
  // Windows Services Report -- scheduled tasks are one of the most common
  // persistence mechanisms for malware, so flag actions that point at
  // world-writable or temp-style locations rather than anything installed
  // under Program Files / Windows / a normal per-user Programs folder.
  // ProgramData is deliberately absent: Windows Defender and most
  // third-party updater tasks legitimately run from there.
  const riskyLocations = [
    { pattern: '\\windows\\temp\\', reason: 'Task action runs from Windows Temp.' },
    { pattern: '\\appdata\\roaming\\', reason: 'Task action runs from a user AppData Roaming folder.' },
    { pattern: '\\appdata\\local\\temp\\', reason: 'Task action runs from a user Temp folder.' },
    { pattern: '\\users\\public\\', reason: 'Task action runs from a shared, world-writable location.' }
  ];
  for (const { pattern, reason } of riskyLocations) {
    if (lower.includes(pattern)) return { flagged: true, reason };
  }

  // Script hosts / LOLBins are only flagged when the arguments look like
  // obfuscated or remote execution. Merely invoking PowerShell is normal
  // for plenty of legitimate maintenance tasks; the technique that matters
  // is hiding what the payload does ("powershell -enc <base64>",
  // "mshta http://...", "rundll32 javascript:...", "regsvr32 /i:http://").
  const lolbins = ['powershell.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'wscript.exe', 'cscript.exe'];
  const hasLolbin = lolbins.some((bin) => lower.includes(bin));
  if (hasLolbin && /-(enc|encodedcommand)|frombase64|downloadstring|https?:\/\/|javascript:/i.test(execPath)) {
    return { flagged: true, reason: 'Action invokes a script host/LOLBin with obfuscated or remote-execution arguments -- commonly used to execute hidden payloads.' };
  }

  return { flagged: false, reason: null };
}

module.exports = async function scheduledTasksReport() {
  if (process.platform !== 'win32') return { supported: false, message: 'Scheduled Tasks Report is only available on Windows.' };

  const script = [
    'Get-ScheduledTask',
    'Where-Object { $_.State -ne "Disabled" -and $_.TaskPath -notlike "\\Microsoft\\*" }',
    'ForEach-Object { [PSCustomObject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; State = $_.State.ToString(); Author = $(if ($_.Principal) { $_.Principal.UserId } else { "" }); RunLevel = $(if ($_.Principal) { $_.Principal.RunLevel.ToString() } else { "" }); Actions = ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join " | " } }',
    'ConvertTo-Json -Depth 4'
  ].join(' | ');

  const stdout = await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const tasks = Array.isArray(parsed) ? parsed : [parsed];

  const normalized = tasks.map((t) => {
    const risk = actionLooksRisky(t.Actions);
    return {
      name: t.TaskName,
      path: t.TaskPath,
      state: t.State,
      author: t.Author,
      runLevel: t.RunLevel,
      actions: t.Actions,
      flagged: risk.flagged,
      flagReason: risk.reason
    };
  });

  return {
    taskCount: normalized.length,
    flaggedCount: normalized.filter((t) => t.flagged).length,
    flagged: normalized.filter((t) => t.flagged).slice(0, 40),
    tasks: normalized.slice(0, 150)
  };
};

module.exports.actionLooksRisky = actionLooksRisky;
