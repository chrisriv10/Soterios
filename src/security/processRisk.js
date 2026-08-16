'use strict';

const { suspiciousPathSignals } = require('./windowsChecks');

const RULE_VERSION = 2;

const SYSTEM_PROCESS_PATHS = new Map([
  ['svchost.exe', ['\\windows\\system32\\svchost.exe']],
  ['lsass.exe', ['\\windows\\system32\\lsass.exe']],
  ['csrss.exe', ['\\windows\\system32\\csrss.exe']],
  ['services.exe', ['\\windows\\system32\\services.exe']],
  ['winlogon.exe', ['\\windows\\system32\\winlogon.exe']],
  ['wininit.exe', ['\\windows\\system32\\wininit.exe']],
  ['smss.exe', ['\\windows\\system32\\smss.exe']],
  ['explorer.exe', ['\\windows\\explorer.exe']],
]);

const DOCUMENT_PARENTS = new Set([
  'winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'mspub.exe',
  'visio.exe', 'acrord32.exe', 'acrobat.exe', 'foxitreader.exe',
]);

const SCRIPT_HOSTS = new Set([
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe',
  'mshta.exe', 'regsvr32.exe', 'rundll32.exe', 'certutil.exe', 'bitsadmin.exe',
]);

function normalizePath(value) {
  return String(value || '').toLowerCase().replace(/\//g, '\\');
}

function evidence(id, points, title, detail, options = {}) {
  return {
    id,
    points,
    title,
    detail,
    category: options.category || 'behavior',
    confidence: options.confidence || 'medium',
    critical: !!options.critical,
    suppressibleByTrust: options.suppressibleByTrust !== false,
  };
}

function collectEvidence(proc, context = {}) {
  const findings = [];
  const name = String(proc.name || '').toLowerCase();
  const executablePath = normalizePath(proc.path);
  const commandLine = String(proc.commandLine || proc.cmd || '').toLowerCase();
  const parentName = String(context.parentName || '').toLowerCase();

  for (const signal of suspiciousPathSignals(proc.path)) {
    findings.push(evidence(
      `path:${findings.length}`,
      signal.points || 0,
      'Unusual executable location',
      signal.message,
      { category: 'location', confidence: 'medium' },
    ));
  }

  const expectedPaths = SYSTEM_PROCESS_PATHS.get(name);
  if (expectedPaths && executablePath && !expectedPaths.some((suffix) => executablePath.endsWith(suffix))) {
    findings.push(evidence(
      'system-process-path-mismatch',
      65,
      'System process name from an unexpected path',
      `${proc.name} is not running from its expected Windows location.`,
      { category: 'identity', confidence: 'high', critical: true, suppressibleByTrust: false },
    ));
  }

  if (name === 'svchost.exe' && parentName && parentName !== 'services.exe') {
    findings.push(evidence(
      'svchost-parent-mismatch',
      55,
      'Unexpected service-host parent',
      `svchost.exe was launched by ${context.parentName} instead of services.exe.`,
      { category: 'lineage', confidence: 'high', critical: true, suppressibleByTrust: false },
    ));
  }

  if (DOCUMENT_PARENTS.has(parentName) && SCRIPT_HOSTS.has(name)) {
    findings.push(evidence(
      'document-script-chain',
      55,
      'Document application launched a script host',
      `${context.parentName} launched ${proc.name}, a chain commonly used by malicious documents.`,
      { category: 'lineage', confidence: 'high', suppressibleByTrust: false },
    ));
  }

  if ((name === 'powershell.exe' || name === 'pwsh.exe') &&
      /(?:-enc(?:odedcommand)?\b|frombase64string|downloadstring)/i.test(commandLine)) {
    findings.push(evidence(
      'powershell-obfuscation',
      45,
      'Encoded or download-capable PowerShell',
      'The command line contains encoded or download-and-execute indicators.',
      { category: 'command', confidence: 'high', suppressibleByTrust: false },
    ));
  }

  const remoteLolbin =
    (name === 'mshta.exe' && /https?:\/\//.test(commandLine)) ||
    (name === 'regsvr32.exe' && commandLine.includes('/i:') && /https?:\/\//.test(commandLine)) ||
    (name === 'rundll32.exe' && /https?:\/\//.test(commandLine)) ||
    (name === 'certutil.exe' && /-(?:urlcache|decode)\b/.test(commandLine)) ||
    (name === 'bitsadmin.exe' && commandLine.includes('/transfer'));
  if (remoteLolbin) {
    findings.push(evidence(
      'lolbin-network-execution',
      45,
      'Windows utility used for transfer or execution',
      `${proc.name} has command-line arguments associated with payload transfer or execution.`,
      { category: 'command', confidence: 'high', suppressibleByTrust: false },
    ));
  }

  const signature = proc.signature || {};
  if (signature.status && ['HashMismatch', 'NotTrusted'].includes(signature.status)) {
    findings.push(evidence(
      'invalid-signature',
      70,
      'Executable signature is invalid',
      `Windows reported signature status ${signature.status}.`,
      { category: 'signature', confidence: 'high', critical: true, suppressibleByTrust: false },
    ));
  } else if (signature.status === 'NotSigned' && executablePath.includes('\\windows\\')) {
    findings.push(evidence(
      'unsigned-windows-binary',
      45,
      'Unsigned executable in a Windows directory',
      'A binary under the Windows directory does not have a valid signature.',
      { category: 'signature', confidence: 'high', suppressibleByTrust: false },
    ));
  }

  if (proc.reputation && proc.reputation.verdict === 'malicious') {
    findings.push(evidence(
      'known-malicious-hash',
      90,
      'Hash has a malicious reputation',
      `The executable hash is marked malicious by ${proc.reputation.source || 'the configured source'}.`,
      { category: 'reputation', confidence: 'high', critical: true, suppressibleByTrust: false },
    ));
  }

  return findings;
}

function severityFor(score) {
  if (score >= 70) return 'high-concern';
  if (score >= 35) return 'review-recommended';
  if (score > 0) return 'unverified';
  return 'no-concerns';
}

function legacyLevel(severity) {
  if (severity === 'high-concern') return 'high';
  if (severity === 'review-recommended') return 'medium';
  if (severity === 'unverified') return 'low';
  return 'none';
}

function assessProcess(proc, context = {}) {
  const rawEvidence = collectEvidence(proc, context);
  const isTrusted = !!context.trusted;
  const scoredEvidence = rawEvidence.map((item) => ({
    ...item,
    effectivePoints: isTrusted && item.suppressibleByTrust
      ? Math.ceil(item.points * 0.35)
      : item.points,
    trustReduced: isTrusted && item.suppressibleByTrust,
  }));
  const score = Math.max(0, Math.min(100,
    scoredEvidence.reduce((total, item) => total + item.effectivePoints, 0),
  ));
  const severity = severityFor(score);
  const highConfidenceCount = scoredEvidence.filter((item) => item.confidence === 'high').length;
  const confidence = highConfidenceCount >= 2 ? 'high'
    : highConfidenceCount === 1 ? 'medium'
      : scoredEvidence.length ? 'low' : 'medium';

  return {
    score,
    severity,
    level: legacyLevel(severity),
    confidence,
    evidence: scoredEvidence,
    signals: scoredEvidence.map((item) => ({ points: item.effectivePoints, message: item.detail })),
    ruleVersion: RULE_VERSION,
    evaluatedAt: new Date().toISOString(),
    statusLabel: {
      'no-concerns': 'No concerns detected',
      unverified: 'Unverified',
      'review-recommended': 'Review recommended',
      'high-concern': 'High concern',
    }[severity],
  };
}

module.exports = {
  RULE_VERSION,
  assessProcess,
  collectEvidence,
  severityFor,
};
