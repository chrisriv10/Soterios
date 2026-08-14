const fs = require('fs');
const os = require('os');
const path = require('path');

// Modifying the hosts file to silently redirect or block security/update
// domains is a well-known technique for disabling antivirus updates and
// definition downloads, so entries that touch these keywords get flagged
// with higher severity than an arbitrary custom entry.
const SECURITY_KEYWORDS = [
  'windowsupdate', 'update.microsoft', 'microsoft.com', 'defender',
  'symantec', 'norton', 'mcafee', 'avast', 'avg.com', 'kaspersky',
  'malwarebytes', 'bitdefender', 'eset', 'sophos', 'virustotal', 'clamav'
];

function getHostsPath() {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    return path.join(systemRoot, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

function isDefaultEntry(ip, host) {
  const h = host.toLowerCase();
  if ((ip === '127.0.0.1' || ip === '::1') && (h === 'localhost' || h === 'localhost.localdomain')) return true;
  if (ip === '255.255.255.255' && h === 'broadcasthost') return true;
  if (ip === 'fe80::1%lo0' && h === 'localhost') return true;
  return false;
}

function parseHostsFile(content) {
  const entries = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    // Strip inline comments, then split on whitespace: "<ip> <host1> [host2 ...]"
    const withoutComment = trimmed.split('#')[0].trim();
    const parts = withoutComment.split(/\s+/);
    if (parts.length < 2) return;
    const [ip, ...hosts] = parts;

    hosts.forEach((host) => {
      if (isDefaultEntry(ip, host)) return;
      const flaggedSecurity = SECURITY_KEYWORDS.some((kw) => host.toLowerCase().includes(kw));
      entries.push({
        line: idx + 1,
        ip,
        host,
        flagged: flaggedSecurity,
        flagReason: flaggedSecurity ? 'Redirects a security/update-related domain -- a common technique for blocking antivirus updates or telemetry.' : null
      });
    });
  });
  return entries;
}

module.exports = async function hostsFileCheck(hostsPathOverride) {
  const hostsPath = hostsPathOverride || getHostsPath();
  if (!fs.existsSync(hostsPath)) {
    return { supported: false, message: `Hosts file not found at ${hostsPath}.` };
  }

  const raw = fs.readFileSync(hostsPath, 'utf-8');
  const entries = parseHostsFile(raw);

  return {
    platform: os.platform(),
    hostsPath,
    entryCount: entries.length,
    flaggedCount: entries.filter((e) => e.flagged).length,
    flagged: entries.filter((e) => e.flagged),
    entries: entries.slice(0, 500)
  };
};

module.exports.parseHostsFile = parseHostsFile;