'use strict';

const featureFlags = require('../core/featureFlags');

const MAX_SNAPSHOT_CHARS = 12000;

const FEATURES = [
  ['realtimeProtection', 'Real-time protection'],
  ['folderWatch', 'Folder watch'],
  ['networkAlerts', 'Network alerts'],
  ['networkTrafficHistory', 'Network traffic history'],
  ['autoReports', 'Auto reports'],
  ['scanHistory', 'Scan history'],
  ['externalLookups', 'External lookups'],
  ['geoLookup', 'Geo lookup'],
  ['autoUpdates', 'Auto updates'],
];

function formatScans(scans) {
  return scans.map((s) => {
    const type = String(s.scan_type || 'scan');
    const files = Number.isFinite(s.files_scanned) ? s.files_scanned : '?';
    const threats = Number.isFinite(s.threats_found) ? s.threats_found : '?';
    const duration = Number.isFinite(s.duration_ms) && s.duration_ms > 0 ? `, ${Math.round(s.duration_ms / 1000)}s` : '';
    return `- ${type} scan on ${s.timestamp || '?'}: ${files} files, ${threats} threat(s)${duration}`;
  }).join('\n');
}

function formatQuarantine(items) {
  return items.map((it) => {
    const name = String(it.threat_name || it.original_path || 'item');
    const reason = String(it.reason || '').trim();
    return `- ${name} (${String(it.original_path || 'unknown path')})${reason ? `, reason: ${reason}` : ''}, quarantined ${it.date_quarantined || '?'}`;
  }).join('\n');
}

function formatAlerts(alerts) {
  return alerts.map((a) => `- [${String(a.severity || 'info')}] ${String(a.message || '')}`).join('\n');
}

async function fetchHealthLines(services) {
  const toolRegistry = services && services.toolRegistry;
  if (!toolRegistry) return [];
  try {
    const result = await toolRegistry.run('health-score', {}, { db: services.db });
    if (!result || !result.ok || !result.data) return [];
    const data = result.data;
    const breakdown = data.breakdown || {};
    const lines = [`Health score: ${Number.isFinite(data.score) ? data.score : '?'}/100.`];
    for (const key of ['disk', 'memory', 'load', 'malware', 'rtp', 'firewall']) {
      const item = breakdown[key];
      if (item && typeof item.reason === 'string') {
        lines.push(`- ${String(item.label || key)}: ${item.reason}`);
      }
    }
    return lines;
  } catch (_) {
    return [];
  }
}

async function fetchFirewallLines(services) {
  const firewallManager = services && services.firewallManager;
  if (!firewallManager) return [];
  try {
    const status = await firewallManager.getStatus();
    if (Array.isArray(status) && status.length) {
      return [`Firewall profiles: ${status.map((p) => `${String(p.Name || 'profile')}: ${p.Enabled ? 'enabled' : 'disabled'}`).join(', ')}.`];
    }
    return ['Firewall: no profile status available.'];
  } catch (_) {
    return [];
  }
}

async function fetchProcessLines(services) {
  const processInspector = services && services.processInspector;
  if (!processInspector) return [];
  try {
    const processes = await processInspector.getProcesses();
    if (Array.isArray(processes)) {
      const suspicious = processes.filter((p) => p.suspicious).length;
      return [`Processes: ${processes.length} running, ${suspicious} flagged suspicious.`];
    }
    return [];
  } catch (_) {
    return [];
  }
}

/**
 * Builds a compact plain-text snapshot of the user's system from local
 * services. Every source is independently guarded: a failure in one source
 * (e.g. ClamAV unavailable) must not fail the whole snapshot. The three
 * async sources (health score, firewall, processes) run in parallel so the
 * snapshot adds only as much latency as its slowest source.
 */
async function buildContextSnapshot(services) {
  const db = services && services.db;
  const [healthLines, firewallLines, processLines] = await Promise.all([
    fetchHealthLines(services),
    fetchFirewallLines(services),
    fetchProcessLines(services)
  ]);

  const lines = [];

  if (db) {
    const enabled = [];
    const disabled = [];
    for (const [key, label] of FEATURES) {
      try {
        if (featureFlags.getFlag(db, key)) enabled.push(label);
        else disabled.push(label);
      } catch (_) {}
    }
    lines.push(`Features on: ${enabled.length ? enabled.join(', ') : 'none'}.`);
    if (disabled.length) lines.push(`Features off: ${disabled.join(', ')}.`);
  }

  if (db) {
    try {
      const scans = db.getScanHistory(3);
      if (scans && scans.length) {
        lines.push('Recent scans:');
        lines.push(formatScans(scans));
      } else {
        lines.push('Recent scans: none on record.');
      }
    } catch (_) {}
  }

  if (db) {
    try {
      const quarantined = db.getQuarantineList() || [];
      if (quarantined.length) {
        lines.push(`Quarantine (${quarantined.length} item(s)):`);
        lines.push(formatQuarantine(quarantined.slice(0, 5)));
      } else {
        lines.push('Quarantine: empty.');
      }
    } catch (_) {}
  }

  if (db) {
    try {
      const alerts = db.getUnreadAlerts() || [];
      if (alerts.length) {
        lines.push(`Unread alerts (${alerts.length}):`);
        lines.push(formatAlerts(alerts.slice(0, 5)));
      } else {
        lines.push('Unread alerts: none.');
      }
    } catch (_) {}
  }

  lines.push(...healthLines, ...firewallLines, ...processLines);

  const text = lines.join('\n');
  return text.length > MAX_SNAPSHOT_CHARS ? text.slice(0, MAX_SNAPSHOT_CHARS) : text;
}

module.exports = { buildContextSnapshot, MAX_SNAPSHOT_CHARS };
