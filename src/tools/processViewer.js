const si = require('systeminformation');
const { makeRisk } = require('../security/riskEngine');
const { suspiciousPathSignals } = require('../security/windowsChecks');

// Well-known Windows system process names that should only ever run from a
// specific expected system directory. A process using one of these names
// but running from anywhere else is one of the strongest and most classic
// malware indicators there is (e.g. a fake "svch0st.exe"-style masquerade
// or a genuinely-named copy planted outside its real location).
const PROTECTED_SYSTEM_NAMES = new Set([
  'svchost.exe', 'explorer.exe', 'lsass.exe', 'csrss.exe',
  'winlogon.exe', 'services.exe', 'smss.exe', 'wininit.exe'
]);
const SYSTEM_DIR_PATTERNS = ['\\windows\\system32\\', '\\windows\\syswow64\\', '\\windows\\'];

function isMasquerading(name, lowerPath) {
  if (!PROTECTED_SYSTEM_NAMES.has(name)) return false;
  if (!lowerPath) return false; // can't confirm location either way -- don't guess
  return !SYSTEM_DIR_PATTERNS.some((p) => lowerPath.includes(p));
}

function processSignals(proc) {
  const signals = [];
  const lowerPath = String(proc.path || '').toLowerCase().replace(/\//g, '\\');
  const cmd = String(proc.cmd || '').toLowerCase();
  const name = (proc.name || '').toLowerCase();

  signals.push(...suspiciousPathSignals(proc.path));

  // Process masquerading -- a core system process name running from
  // somewhere other than its real system directory.
  if (isMasquerading(name, lowerPath))
    signals.push({ points: 60, message: `Named like a core Windows process ("${proc.name}") but not running from its expected system directory -- a classic masquerading technique.` });

  // PowerShell abuse patterns
  if (cmd.includes('-encodedcommand') || cmd.includes('frombase64string'))
    signals.push({ points: 45, message: 'Command line contains encoded script execution.' });
  if (name === 'powershell.exe' && cmd.includes('downloadstring'))
    signals.push({ points: 35, message: 'PowerShell download/execute indicators.' });

  // Other "living off the land" binaries commonly abused to fetch or
  // execute payloads while appearing to be legitimate, signed Windows tools.
  if (name === 'mshta.exe' && /https?:\/\//.test(cmd))
    signals.push({ points: 45, message: 'mshta.exe invoked with a remote URL -- commonly used to execute malicious HTA payloads.' });
  if (name === 'regsvr32.exe' && cmd.includes('/i:') && /https?:\/\//.test(cmd))
    signals.push({ points: 45, message: 'regsvr32.exe invoked with a remote URL (the "Squiblydoo" technique) -- used to bypass application whitelisting.' });
  if (name === 'rundll32.exe' && /https?:\/\//.test(cmd))
    signals.push({ points: 40, message: 'rundll32.exe invoked with a remote URL -- unusual and commonly associated with payload execution.' });
  if (name === 'certutil.exe' && (cmd.includes('-urlcache') || cmd.includes('-decode')))
    signals.push({ points: 40, message: 'certutil.exe used with download/decode flags -- a known technique for smuggling payloads via a trusted signed tool.' });
  if (name === 'bitsadmin.exe' && cmd.includes('/transfer'))
    signals.push({ points: 35, message: 'bitsadmin.exe used to transfer files -- a known technique for downloading payloads via a trusted signed tool.' });

  // Running from a non-system drive or a network share is a much milder
  // signal on its own (plenty of legitimate portable software does this),
  // so it's weighted lower than the patterns above.
  if (lowerPath) {
    const isUncPath = lowerPath.startsWith('\\\\');
    const driveLetter = /^([a-z]):\\/.exec(lowerPath);
    const isNonSystemDrive = driveLetter && driveLetter[1] !== 'c';
    if (isUncPath) {
      signals.push({ points: 20, message: 'Runs from a network share (UNC path) rather than a local drive.' });
    } else if (isNonSystemDrive) {
      signals.push({ points: 10, message: 'Runs from a drive other than the system drive.' });
    }
  }

  return signals;
}

function recommendationForRisk(risk) {
  if (risk.score >= 50) return 'Immediate termination recommended.';
  if (risk.score >= 35) return 'Review process path and command line arguments.';
  return 'Safe process';
}

module.exports = {
  id: 'process-viewer', name: 'Process Viewer',
  description: 'List running processes with CPU/memory and suspicious process scoring.',
  category: 'System', icon: 'list',
  run: async () => {
    try {
      const [procData, loadData, memData] = await Promise.all([
        si.processes(),
        si.currentLoad(),
        si.mem()
      ]);
      const processList = procData.list || [];

      const processes = processList.slice(0, 400).map((p) => {
        const item = {
          pid: p.pid,
          ppid: p.parentPid || null,
          name: p.name || 'unknown',
          cmd: p.command || null,
          path: p.path || null,
          cpu: p.cpu !== undefined ? +(p.cpu).toFixed(1) : null,
          memory: p.mem !== undefined ? +(p.mem).toFixed(1) : null
        };
        item.risk = makeRisk(processSignals(item));
        item.locationReasons = (item.risk.signals || [])
          .map((s) => s.message)
          .filter((msg) => /appdata|temporary|recycle bin|writable windows location|double extension/i.test(msg || ''));
        item.suspicious = item.locationReasons.length > 0;
        item.suspiciousReasons = (item.risk.signals || []).map((s) => s.message).filter(Boolean);
        item.recommendedAction = recommendationForRisk(item.risk);
        return item;
      }).sort((a, b) => {
        const riskDelta = b.risk.score - a.risk.score;
        if (riskDelta !== 0) return riskDelta;
        const usageA = (a.cpu || 0) + (a.memory || 0);
        const usageB = (b.cpu || 0) + (b.memory || 0);
        return usageB - usageA;
      });

      const totalMemory = memData.total > 0 ? ((memData.total - memData.available) / memData.total) * 100 : 0;

      return {
        totalCpu: loadData.currentLoad,
        totalMemory: +(totalMemory.toFixed(1)),
        processes
      };
    } catch (err) {
      console.error('Failed to get processes:', err);
      return { totalCpu: 0, totalMemory: 0, processes: [] };
    }
  }
};