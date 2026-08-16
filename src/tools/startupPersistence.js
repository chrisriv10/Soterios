const fs = require('fs');
const { makeRisk, recommendationForRisk } = require('../security/riskEngine');
const { getRegistryRunItems, getStartupFolders, getScheduledTasks, getServices, runJsonPowerShell, extractExecutablePath, suspiciousPathSignals, isExecutablePath } = require('../security/windowsChecks');

function buildSignals(item, signature) {
  const filePath = item.path || extractExecutablePath(item.command);
  const signals = suspiciousPathSignals(filePath);
  const command = String(item.command || '').toLowerCase();
  if (command.includes('powershell') || command.includes('wscript') || command.includes('mshta'))
    signals.push({ points: 25, message: 'Uses a script host often abused for persistence.' });
  if (command.includes('-encodedcommand') || command.includes('frombase64string'))
    signals.push({ points: 40, message: 'Contains encoded script execution.' });
  if (filePath && isExecutablePath(filePath) && fs.existsSync(filePath) && !['Valid', 'TrustedSystemPath'].includes(signature.status))
    signals.push({ points: 25, message: 'Executable is not digitally signed by a trusted publisher.' });
  if (item.source === 'Scheduled Task' && String(item.location || '').startsWith('\\Microsoft\\'))
    signals.push({ points: -10, message: 'Microsoft scheduled task path lowers risk.' });
  if (filePath && filePath.toLowerCase().includes('\\program files\\'))
    signals.push({ points: -8, message: 'Installed under Program Files.' });
  return signals.filter((s) => s.points > 0);
}

function enrichStartupItem(item, signatureByPath) {
  const filePath = item.path || extractExecutablePath(item.command);
  const signature = filePath
    ? (signatureByPath.get(String(filePath).toLowerCase()) || { status: 'Unknown', publisher: null })
    : { status: 'Unknown', publisher: null };
  const risk = makeRisk(buildSignals({ ...item, path: filePath }, signature));
  return {
    ...item, path: filePath, exePath: filePath, exists: filePath ? fs.existsSync(filePath) : false,
    publisher: signature.publisher, signatureStatus: signature.status, risk,
    recommendedAction: recommendationForRisk(risk, 'startup item')
  };
}

async function getSignatureBatch(items) {
  const paths = [...new Set(items.map((item) => item.path || extractExecutablePath(item.command)).filter((filePath) => filePath && fs.existsSync(filePath)))];
  const signatures = new Map();
  const external = [];
  for (const filePath of paths) {
    if (/^(?:%SystemRoot%|C:\\Windows\\)/i.test(filePath)) {
      signatures.set(filePath.toLowerCase(), { status: 'TrustedSystemPath', publisher: 'Microsoft Windows' });
    } else if (external.length < 80) {
      external.push(filePath);
    }
  }
  if (!external.length) return signatures;
  const literals = external.map((filePath) => `'${String(filePath).replace(/'/g, "''")}'`).join(',');
  const result = await runJsonPowerShell(`
    Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -Force -ErrorAction SilentlyContinue
    $out = foreach ($path in @(${literals})) {
      $sig = Get-AuthenticodeSignature -LiteralPath $path -ErrorAction SilentlyContinue
      $file = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
      [PSCustomObject]@{
        path = $path
        status = $(if ($sig) { $sig.Status.ToString() } else { 'Unknown' })
        publisher = $(if ($sig -and $sig.SignerCertificate) { $sig.SignerCertificate.Subject } elseif ($file) { [string]$file.VersionInfo.CompanyName } else { $null })
      }
    }
    $out
  `, [], 60000);
  const rows = Array.isArray(result.data) ? result.data : (result.data ? [result.data] : []);
  for (const row of rows) signatures.set(String(row.path).toLowerCase(), { status: row.status || 'Unknown', publisher: row.publisher || null });
  return signatures;
}

module.exports = {
  id: 'startup-persistence-scan', name: 'Startup Persistence Scanner',
  description: 'Inspect Run keys, startup folders, scheduled tasks, and services for risky persistence.',
  category: 'Security', icon: 'list-checks',
  run: async (args, ctx) => {
    const rawItems = [
      ...(await getRegistryRunItems()), ...(await getStartupFolders()),
      ...(await getScheduledTasks()), ...(await getServices())
    ];
    const deduped = [];
    const seen = new Set();
    for (const item of rawItems) {
      const key = `${item.source}|${item.name}|${item.command}`;
      if (!seen.has(key)) { seen.add(key); deduped.push(item); }
    }
    const limit = Number(args.limit || 350);
    const selected = deduped.slice(0, limit);
    ctx.sendProgress?.({ phase: 'signatures', pct: 45, count: 0, total: selected.length, currentActivity: 'Checking startup publishers in one local batch' });
    const signatureByPath = await getSignatureBatch(selected);
    const enriched = selected.map((item, index) => {
      if (index === 0 || (index + 1) % 25 === 0 || index + 1 === selected.length) {
        ctx.sendProgress?.({ phase: 'analyzing', pct: 45 + Math.round(((index + 1) / Math.max(selected.length, 1)) * 54), count: index + 1, total: selected.length, currentActivity: item.name });
      }
      return enrichStartupItem(item, signatureByPath);
    });
    enriched.sort((a, b) => b.risk.score - a.risk.score || String(a.name).localeCompare(String(b.name)));
    const summary = {
      total: enriched.length,
      registry: enriched.filter((i) => i.source === 'Registry Run').length,
      startupFolders: enriched.filter((i) => i.source === 'Startup Folder').length,
      scheduledTasks: enriched.filter((i) => i.source === 'Scheduled Task').length,
      services: enriched.filter((i) => i.source === 'Windows Service').length,
      risky: enriched.filter((i) => i.risk.score >= 35).length,
      highRisk: enriched.filter((i) => i.risk.score >= 60).length
    };
    if (ctx.appStore) ctx.appStore.addHistory('startup', { summary }, 20);
    return { scannedAt: new Date().toISOString(), summary, items: enriched };
  }
};

module.exports.getSignatureBatch = getSignatureBatch;
