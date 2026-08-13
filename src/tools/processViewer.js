const si = require('systeminformation');
const { makeRisk, recommendationForRisk } = require('../security/riskEngine');
const { suspiciousPathSignals } = require('../security/windowsChecks');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

function processSignals(proc, isTrusted = false) {
  const signals = [];
  const lowerPath = String(proc.path || '').toLowerCase().replace(/\//g, '\\');
  const cmd = String(proc.cmd || '').toLowerCase();
  const name = (proc.name || '').toLowerCase();

  // If process is trusted, skip all risk signals
  if (isTrusted) {
    return signals;
  }

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

  // Hidden/stealth indicators - process name mimicry and character substitutions
  const legitNames = ['svchost.exe', 'explorer.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'wininit.exe'];
  for (const legit of legitNames) {
    if (name !== legit && name.replace(/[^a-z]/g, '') === legit.replace(/[^a-z]/g, '')) {
      signals.push({ points: 35, message: `Process name closely mimics legitimate Windows process "${legit}".` });
      break;
    }
  }

  // Check for obvious character substitutions (zero for O, etc.)
  if (name.includes('svch0st') || name.includes('expl0rer') || (name.includes('csrss') && name !== 'csrss.exe')) {
    signals.push({ points: 35, message: 'Process name contains character substitutions typical of masquerading.' });
  }

  return signals;
}

async function getProcessIOStats() {
  try {
    // Use Windows Performance Counters for reliable per-process IO data
    const scriptPath = path.join(__dirname, '../scripts/process-io-counter.ps1')
      .replace('app.asar', 'app.asar.unpacked');
    
    // Verify script exists before executing
    let scriptExists = false;
    try { fs.accessSync(scriptPath); scriptExists = true; } catch (_) {}
    if (!scriptExists) {
      console.warn('process-io-counter.ps1 not found at', scriptPath);
      return { diskIOMap: new Map(), networkIOMap: new Map() };
    }
    
    const { stdout: ioStdout } = await execPromise(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 20000 });

    // Each line is "pid|name|readBytesPerSec|writeBytesPerSec|otherBytesPerSec".
    // Disk IO = read + write; "other" IO (named pipes, sockets, devices) is the
    // closest per-process approximation of network traffic the perf counters
    // expose. Keyed by PID so every process gets its own exact numbers.
    const diskIOMap = new Map();
    const networkIOMap = new Map();
    if (ioStdout) {
      ioStdout.trim().split('\n').forEach((line) => {
        const parts = line.split('|');
        if (parts.length < 5) return;
        const pid = parseInt(parts[0], 10);
        const read = parseFloat(parts[2]) || 0;
        const write = parseFloat(parts[3]) || 0;
        const other = parseFloat(parts[4]) || 0;
        if (!Number.isFinite(pid)) return;
        diskIOMap.set(pid, read + write);
        networkIOMap.set(pid, other);
      });
    }

    return { diskIOMap, networkIOMap };
  } catch (err) {
    // I/O data is optional -- never fail the whole tool because of it
    console.warn('Failed to read per-process IO counters:', err.message || err);
    return { diskIOMap: new Map(), networkIOMap: new Map() };
  }
}

module.exports = {
  id: 'process-viewer', name: 'Process Viewer',
  description: 'List running processes with CPU/memory and suspicious process scoring.',
  category: 'System', icon: 'list',
  run: async (args, context) => {
    const db = context && context.db;
    // Get all trusted hashes once (fast database lookup)
    const trustedHashes = new Set();
    if (db && typeof db.getTrustedHashes === 'function') {
      try {
        const trusted = db.getTrustedHashes();
        if (Array.isArray(trusted)) {
          trusted.forEach(t => trustedHashes.add(t.hash));
        }
      } catch (err) {
        // Ignore database errors
      }
    }
    
    try {
      const [procData, loadData, memData, ioStats] = await Promise.all([
        si.processes(),
        si.currentLoad(),
        si.mem(),
        getProcessIOStats()
      ]);
      const processList = procData.list || [];
      const { diskIOMap, networkIOMap } = ioStats;

      // Calculate total I/O for percentage calculation
      const totalDiskIO = Array.from(diskIOMap.values()).reduce((sum, val) => sum + val, 0);
      const totalNetworkIO = Array.from(networkIOMap.values()).reduce((sum, val) => sum + val, 0);
      
      // Convert I/O bytes/sec to MB/sec for display
      const diskMBps = totalDiskIO / (1024 * 1024);
      const networkMBps = totalNetworkIO / (1024 * 1024);
      
      // Use MB/sec as a percentage-like value (0-100 scale where 100 = 100 MB/sec)
      const diskPercentage = Math.min(100, diskMBps);
      const networkPercentage = Math.min(100, networkMBps);

      const processes = processList.map((p) => {
        const diskIO = diskIOMap.get(p.pid) || 0;
        const networkIO = networkIOMap.get(p.pid) || 0;

        const item = {
          pid: p.pid,
          ppid: p.parentPid || null,
          name: p.name || 'unknown',
          cmd: p.command || null,
          path: p.path || null,
          cpu: p.cpu !== undefined ? +(p.cpu).toFixed(1) : null,
          memory: p.mem !== undefined ? +(p.mem).toFixed(1) : null,
          diskIo: Math.round(diskIO),
          networkIo: Math.round(networkIO),
          hash: null,
          trusted: false
        };
        
        // Check if this process is trusted by calculating its hash
        // Only do this if we have trusted hashes to check against
        if (trustedHashes.size > 0 && p.path && fs.existsSync(p.path)) {
          try {
            const hash = crypto.createHash('sha256');
            const data = fs.readFileSync(p.path);
            hash.update(data);
            item.hash = hash.digest('hex');
            item.trusted = trustedHashes.has(item.hash);
          } catch (err) {
            // Ignore hash calculation errors (file locks, etc.)
          }
        }
        
        item.risk = makeRisk(processSignals(item, item.trusted));
        item.locationReasons = (item.risk.signals || [])
          .map((s) => s.message)
          .filter((msg) => /appdata|temporary|recycle bin|writable windows location|double extension/i.test(msg || ''));
        item.suspicious = item.locationReasons.length > 0;
        item.suspiciousReasons = (item.risk.signals || []).map((s) => s.message).filter(Boolean);
        item.recommendedAction = recommendationForRisk(item.risk, 'process');
        return item;
      });
      processes.sort((a, b) => {
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
        totalDiskIO: diskPercentage,
        totalNetworkIO: networkPercentage,
        processes
      };
    } catch (err) {
      console.error('Failed to get processes:', err);
      return { totalCpu: 0, totalMemory: 0, totalDiskIO: 0, totalNetworkIO: 0, processes: [] };
    }
  }
};