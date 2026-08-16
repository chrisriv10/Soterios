'use strict';

const { execFile } = require('child_process');
const path = require('path');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 25 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim()));
      resolve(stdout);
    });
  });
}

function words(value) {
  return String(value || '')
    .replace(/[_{-]?[0-9a-f]{8}-[0-9a-f-]{27,}[}_-]?/ig, ' ')
    .replace(/-S-1-\d+(?:-\d+)+$/i, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function friendlyTaskName(task = {}) {
  const raw = String(task.TaskName || task.rawName || 'Scheduled task');
  const description = String(task.Description || task.description || '').trim();
  const author = String(task.Author || task.author || '');
  if (/^OneDrive Reporting Task-/i.test(raw)) return 'Microsoft OneDrive — Reporting';
  if (/^OneDrive Startup Task-/i.test(raw)) return 'Microsoft OneDrive — Startup';
  if (/SoftLandingDeferralTask/i.test(raw)) return 'Microsoft Windows — Soft Landing Deferral';
  if (/UpdateModelTask/i.test(raw)) return 'Microsoft Windows — Update Model';
  const cleaned = words(raw) || raw;
  const product = task.ProductName || task.productName || (/Microsoft/i.test(author) ? 'Microsoft Windows' : '');
  if (description && description.length <= 90) return product ? `${product} — ${description}` : description;
  return product && !cleaned.toLowerCase().includes(String(product).toLowerCase()) ? `${product} — ${cleaned}` : cleaned;
}

function actionLooksRisky(action) {
  const combined = typeof action === 'string'
    ? action
    : `${action?.execute || ''} ${action?.arguments || ''} ${action?.data || ''}`.trim();
  if (!combined) return { flagged: false, reason: null, risk: 'unknown' };
  const lower = combined.toLowerCase();
  const riskyLocations = [
    ['\\windows\\temp\\', 'Task action runs from Windows Temp.'],
    ['\\appdata\\local\\temp\\', 'Task action runs from a user Temp folder.'],
    ['\\appdata\\roaming\\', 'Task action runs from AppData Roaming.'],
    ['\\users\\public\\', 'Task action runs from a shared, user-writable location.']
  ];
  for (const [pattern, reason] of riskyLocations) {
    if (lower.includes(pattern)) return { flagged: true, reason, risk: 'high' };
  }
  if (/(powershell|pwsh|mshta|rundll32|regsvr32|wscript|cscript)(\.exe)?/i.test(lower)
    && /-(enc|encodedcommand)|frombase64|downloadstring|invoke-webrequest|https?:\/\/|javascript:/i.test(combined)) {
    return { flagged: true, reason: 'A script host or living-off-the-land binary uses encoded or remote content.', risk: 'high' };
  }
  return { flagged: false, reason: null, risk: 'low' };
}

async function enrichActionMetadata(rows) {
  const actionRows = rows.flatMap((task) => Array.isArray(task.Actions) ? task.Actions : (task.Actions ? [task.Actions] : []));
  const paths = [...new Set(actionRows.map((action) => action.Execute).filter(Boolean))];
  const external = paths.filter((filePath) => !/^(?:%SystemRoot%|C:\\Windows\\)/i.test(filePath)).slice(0, 25);
  const metadata = new Map();
  for (const filePath of paths.filter((value) => !external.includes(value))) {
    metadata.set(filePath.toLowerCase(), { Publisher: 'Microsoft Windows', ProductName: 'Windows component', Signature: 'Not checked (system path)' });
  }
  if (!external.length) return metadata;
  const literals = external.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(',');
  try {
    const stdout = await runPowerShell(`
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force -ErrorAction SilentlyContinue
$out = foreach ($path in @(${literals})) {
  $publisher=''; $product=''; $signature='Missing'
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $file = Get-Item -LiteralPath $path
    $publisher = [string]$file.VersionInfo.CompanyName
    $product = [string]$file.VersionInfo.ProductName
    $signature = [string](Get-AuthenticodeSignature -LiteralPath $path -ErrorAction SilentlyContinue).Status
    if (-not $signature) { $signature = 'Unknown' }
  }
  [PSCustomObject]@{ Path=$path; Publisher=$publisher; ProductName=$product; Signature=$signature }
}
$out | ConvertTo-Json -Depth 4 -Compress
`);
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    for (const row of (Array.isArray(parsed) ? parsed : [parsed])) metadata.set(String(row.Path).toLowerCase(), row);
  } catch (_) {}
  return metadata;
}

module.exports = async function scheduledTasksReport(_args = {}, onProgress) {
  if (process.platform !== 'win32') {
    return { supported: false, message: 'Scheduled Tasks Report is only available on Windows.', tasks: [] };
  }
  onProgress?.({ phase: 'collecting', label: 'Reading Task Scheduler', pct: 5, cancelable: true });
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$tasks = @(Get-ScheduledTask)
$out = foreach ($task in $tasks) {
  $info = $task | Get-ScheduledTaskInfo
  $actions = @($task.Actions | ForEach-Object {
    $kind = $_.CimClass.CimClassName
    $execute = [string]$_.Execute
    [PSCustomObject]@{
      Type = $kind
      Execute = $execute
      Arguments = [string]$_.Arguments
      WorkingDirectory = [string]$_.WorkingDirectory
      ClassId = [string]$_.ClassId
      Data = [string]$_.Data
      Publisher = ''
      ProductName = ''
      Signature = ''
    }
  })
  $triggers = @($task.Triggers | ForEach-Object {
    [PSCustomObject]@{
      Type = $_.CimClass.CimClassName
      StartBoundary = [string]$_.StartBoundary
      EndBoundary = [string]$_.EndBoundary
      Enabled = [bool]$_.Enabled
      Delay = [string]$_.Delay
      UserId = [string]$_.UserId
    }
  })
  [PSCustomObject]@{
    TaskName = [string]$task.TaskName
    TaskPath = [string]$task.TaskPath
    Description = [string]$task.Description
    Author = [string]$task.Author
    State = [string]$task.State
    Principal = [string]$task.Principal.UserId
    RunLevel = [string]$task.Principal.RunLevel
    Actions = $actions
    Triggers = $triggers
    LastRunTime = $(if ($info.LastRunTime) { $info.LastRunTime.ToString('o') } else { '' })
    NextRunTime = $(if ($info.NextRunTime) { $info.NextRunTime.ToString('o') } else { '' })
    LastTaskResult = [int64]$info.LastTaskResult
    MissedRuns = [int]$info.NumberOfMissedRuns
  }
}
$out | ConvertTo-Json -Depth 8 -Compress
`;
  const stdout = await runPowerShell(script);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const metadata = await enrichActionMetadata(rows);
  onProgress?.({ phase: 'analyzing', label: 'Analyzing scheduled task actions', pct: 75, count: 0, total: rows.length, cancelable: true });
  const tasks = rows.map((task, index) => {
    const actionRows = Array.isArray(task.Actions) ? task.Actions : (task.Actions ? [task.Actions] : []);
    const actions = actionRows.map((action) => {
      const risk = actionLooksRisky(action);
      const fileMeta = metadata.get(String(action.Execute || '').toLowerCase()) || {};
      return {
        type: action.Type || 'Unknown action',
        execute: action.Execute || '',
        arguments: action.Arguments || '',
        workingDirectory: action.WorkingDirectory || '',
        classId: action.ClassId || '',
        data: action.Data || '',
        publisher: fileMeta.Publisher || action.Publisher || '',
        productName: fileMeta.ProductName || action.ProductName || '',
        signature: fileMeta.Signature || action.Signature || 'Unknown',
        ...risk
      };
    });
    const publisher = actions.find((action) => action.publisher)?.publisher || task.Author || '';
    const productName = actions.find((action) => action.productName)?.productName || '';
    const taskRisk = actions.find((action) => action.flagged);
    const taskPath = task.TaskPath || '\\';
    const trustedMicrosoft = taskPath.toLowerCase().startsWith('\\microsoft\\')
      && (/microsoft/i.test(publisher) || actions.every((action) => !action.execute || /^(C:\\Windows|%SystemRoot%)/i.test(action.execute)))
      && !taskRisk;
    onProgress?.({ phase: 'analyzing', label: 'Analyzing scheduled task actions', pct: 75 + Math.round(((index + 1) / Math.max(rows.length, 1)) * 24), count: index + 1, total: rows.length, cancelable: true });
    return {
      id: `${taskPath}${task.TaskName}`,
      name: friendlyTaskName({ ...task, ProductName: productName }),
      rawName: task.TaskName,
      path: taskPath,
      description: task.Description || '',
      purpose: words(task.TaskName),
      state: task.State,
      author: task.Author || '',
      principal: task.Principal || '',
      runLevel: task.RunLevel || '',
      publisher,
      productName,
      actions,
      triggers: Array.isArray(task.Triggers) ? task.Triggers : (task.Triggers ? [task.Triggers] : []),
      lastRunTime: task.LastRunTime || null,
      nextRunTime: task.NextRunTime || null,
      lastResult: task.LastTaskResult,
      missedRuns: task.MissedRuns || 0,
      trustedMicrosoft,
      flagged: !!taskRisk,
      risk: taskRisk?.risk || (trustedMicrosoft ? 'trusted' : 'low'),
      flagReason: taskRisk?.reason || null,
      fileLocation: actions.find((action) => action.execute)?.execute ? path.dirname(actions.find((action) => action.execute).execute) : null
    };
  });
  onProgress?.({ phase: 'complete', label: 'Scheduled task report ready', pct: 100, count: tasks.length, total: tasks.length, cancelable: false });
  return {
    taskCount: tasks.length,
    visibleByDefaultCount: tasks.filter((task) => !task.trustedMicrosoft).length,
    trustedMicrosoftCount: tasks.filter((task) => task.trustedMicrosoft).length,
    flaggedCount: tasks.filter((task) => task.flagged).length,
    flagged: tasks.filter((task) => task.flagged),
    tasks
  };
};

module.exports.actionLooksRisky = actionLooksRisky;
module.exports.friendlyTaskName = friendlyTaskName;
