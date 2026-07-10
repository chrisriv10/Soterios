const fs = require('fs');
const { makeRisk, recommendationForRisk } = require('../security/riskEngine');
const { getRegistryRunItems, getStartupFolders, getScheduledTasks, getServices, getSignatureInfo, extractExecutablePath, suspiciousPathSignals, isExecutablePath } = require('../security/windowsChecks');

function buildSignals(item, signature) {
  const filePath = item.path || extractExecutablePath(item.command);
  const signals = suspiciousPathSignals(filePath);
  const command = String(item.command || '').toLowerCase();
  if (command.includes('powershell') || command.includes('wscript') || command.includes('mshta'))
    signals.push({ points: 25, message: 'Uses a script host often abused for persistence.' });
  if (command.includes('-encodedcommand') || command.includes('frombase64string'))
    signals.push({ points: 40, message: 'Contains encoded script execution.' });
  if (filePath && isExecutablePath(filePath) && fs.existsSync(filePath) && signature.status !== 'Valid')
    signals.push({ points: 25, message: 'Executable is not digitally signed by a trusted publisher.' });
  if (item.source === 'Scheduled Task' && String(item.location || '').startsWith('\\Microsoft\\'))
    signals.push({ points: -10, message: 'Microsoft scheduled task path lowers risk.' });
  if (filePath && filePath.toLowerCase().includes('\\program files\\'))
    signals.push({ points: -8, message: 'Installed under Program Files.' });
  return signals.filter((s) => s.points > 0);
}

async function enrichStartupItem(item) {
  const filePath = item.path || extractExecutablePath(item.command);
  const signature = filePath ? await getSignatureInfo(filePath) : { status: 'Unknown', publisher: null };
  const risk = makeRisk(buildSignals({ ...item, path: filePath }, signature));
  return {
    ...item, path: filePath, exePath: filePath, exists: filePath ? fs.existsSync(filePath) : false,
    publisher: signature.publisher, signatureStatus: signature.status, risk,
    recommendedAction: recommendationForRisk(risk, 'startup item')
  };
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
    const enriched = [];
    for (const item of deduped.slice(0, limit)) enriched.push(await enrichStartupItem(item));
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
