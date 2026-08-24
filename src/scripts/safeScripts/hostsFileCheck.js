'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { execFile } = require('child_process');

const SECURITY_KEYWORDS = [
  'windowsupdate', 'update.microsoft', 'microsoft.com', 'defender',
  'symantec', 'norton', 'mcafee', 'avast', 'avg.com', 'kaspersky',
  'malwarebytes', 'bitdefender', 'eset', 'sophos', 'virustotal', 'clamav'
];

function getHostsPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

function isDefaultEntry(ip, host) {
  const normalized = host.toLowerCase();
  return ((ip === '127.0.0.1' || ip === '::1') && (normalized === 'localhost' || normalized === 'localhost.localdomain'))
    || (ip === '255.255.255.255' && normalized === 'broadcasthost')
    || (ip === 'fe80::1%lo0' && normalized === 'localhost');
}

function validHost(host) {
  return /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)
    || host.toLowerCase() === 'localhost';
}

function severityFor(ip, host) {
  const securityDomain = SECURITY_KEYWORDS.some((keyword) => host.toLowerCase().includes(keyword));
  const blocking = ip === '0.0.0.0' || ip === '::' || ip === '127.0.0.1' || ip === '::1';
  if (securityDomain && blocking) {
    return { severity: 'high', flagged: true, flagReason: 'Blocks a security or update domain locally.' };
  }
  if (securityDomain) {
    return { severity: 'high', flagged: true, flagReason: 'Redirects a security or update domain to another destination.' };
  }
  if (!blocking) {
    return { severity: 'medium', flagged: true, flagReason: 'Redirects a domain to a non-local destination.' };
  }
  return { severity: 'info', flagged: false, flagReason: 'Local blocking entry.' };
}

function analyzeHostsContent(content) {
  const entries = [];
  const malformed = [];
  const duplicates = [];
  const seenHosts = new Map();
  const lines = String(content || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const withoutComment = trimmed.split('#')[0].trim();
    const parts = withoutComment.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      malformed.push({ line: index + 1, text: line, reason: 'Expected an IP address followed by at least one host name.' });
      return;
    }
    const [ip, ...hosts] = parts;
    if (!net.isIP(ip.replace(/%.+$/, ''))) {
      malformed.push({ line: index + 1, text: line, reason: 'Invalid IP address.' });
      return;
    }
    for (const host of hosts) {
      if (!validHost(host)) {
        malformed.push({ line: index + 1, text: line, reason: `Invalid host name: ${host}` });
        continue;
      }
      if (isDefaultEntry(ip, host)) continue;
      const normalizedHost = host.toLowerCase();
      if (seenHosts.has(normalizedHost)) {
        duplicates.push({
          host,
          line: index + 1,
          firstLine: seenHosts.get(normalizedHost).line,
          destinations: [seenHosts.get(normalizedHost).ip, ip]
        });
      } else {
        seenHosts.set(normalizedHost, { line: index + 1, ip });
      }
      entries.push({ line: index + 1, ip, host, ...severityFor(ip, host) });
    }
  });
  return { entries, malformed, duplicates, lineCount: lines.length };
}

function parseHostsFile(content) {
  return analyzeHostsContent(content).entries;
}

function readableDiff(before, after) {
  if (typeof before !== 'string') return [];
  const oldLines = new Set(before.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const newLines = new Set(after.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return [
    ...[...oldLines].filter((line) => !newLines.has(line)).map((line) => ({ type: 'removed', line })),
    ...[...newLines].filter((line) => !oldLines.has(line)).map((line) => ({ type: 'added', line }))
  ].slice(0, 500);
}

function getAclSafety(filePath) {
  if (process.platform !== 'win32') {
    const mode = fs.statSync(filePath).mode & 0o777;
    return Promise.resolve({ safe: (mode & 0o022) === 0, summary: `Mode ${mode.toString(8)}`, raw: '' });
  }
  return new Promise((resolve) => {
    execFile('icacls.exe', [filePath], { windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error) return resolve({ safe: null, summary: 'ACL could not be read.', raw: '' });
      const raw = String(stdout || '');
      const unsafe = /(?:Everyone|BUILTIN\\Users|Authenticated Users):[^\r\n]*(?:\(F\)|\(M\)|\(W\))/i.test(raw);
      resolve({
        safe: !unsafe,
        summary: unsafe ? 'Standard users appear to have write access.' : 'No broad write permission detected.',
        raw: raw.trim()
      });
    });
  });
}

module.exports = async function hostsFileCheck(args = {}, onProgress) {
  if (typeof args === 'string') args = { hostsPath: args };
  const hostsPath = args.hostsPath || args.hostsPathOverride || getHostsPath();
  if (!fs.existsSync(hostsPath)) {
    return { supported: false, hostsPath, status: 'missing', message: `Hosts file not found at ${hostsPath}.`, entries: [] };
  }
  onProgress?.({ phase: 'reading', label: 'Reading hosts file', pct: 15, currentActivity: hostsPath, cancelable: true });
  const raw = fs.readFileSync(hostsPath, 'utf-8');
  const stat = fs.statSync(hostsPath);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const analysis = analyzeHostsContent(raw);
  onProgress?.({ phase: 'permissions', label: 'Checking hosts file permissions', pct: 65, currentActivity: hostsPath, cancelable: true });
  const acl = await getAclSafety(hostsPath);
  const baselineStatus = args.baselineHash
    ? (String(args.baselineHash).toLowerCase() === hash.toLowerCase() ? 'unchanged' : 'changed')
    : 'not-set';
  const riskyEntries = analysis.entries.filter((entry) => entry.severity === 'high');
  const warnings = [];
  if (analysis.malformed.length) warnings.push(`${analysis.malformed.length} malformed line(s).`);
  if (analysis.duplicates.length) warnings.push(`${analysis.duplicates.length} duplicate host mapping(s).`);
  if (acl.safe === false) warnings.push('Hosts file permissions allow broad write access.');
  if (baselineStatus === 'changed') warnings.push('Content differs from the approved baseline.');
  const status = riskyEntries.length || acl.safe === false ? 'risky'
    : (warnings.length ? 'review' : 'clean');
  onProgress?.({ phase: 'complete', label: 'Hosts file verified', pct: 100, cancelable: false });
  return {
    supported: true,
    platform: os.platform(),
    status,
    verdict: status === 'clean'
      ? (analysis.entries.length ? 'Verified — custom entries found' : 'Verified clean — no custom entries')
      : (status === 'risky' ? 'Attention required' : 'Review recommended'),
    hostsPath,
    hash,
    sizeBytes: stat.size,
    lineCount: analysis.lineCount,
    modifiedAt: stat.mtime.toISOString(),
    acl,
    baselineStatus,
    baselineCandidate: { hash, content: raw },
    diff: readableDiff(args.baselineContent, raw),
    entryCount: analysis.entries.length,
    flaggedCount: riskyEntries.length,
    flagged: riskyEntries,
    entries: analysis.entries.slice(0, 500),
    malformed: analysis.malformed,
    duplicates: analysis.duplicates,
    warnings
  };
};

module.exports.getHostsPath = getHostsPath;
module.exports.parseHostsFile = parseHostsFile;
module.exports.analyzeHostsContent = analyzeHostsContent;
module.exports.severityFor = severityFor;
