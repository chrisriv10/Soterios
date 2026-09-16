'use strict';

// Windows Defender threat-history reader (read-only v1).
//
// Presents Microsoft Defender detections (Get-MpThreatDetection) enriched with
// threat metadata (Get-MpThreat) as stable Soterios-facing records. This
// module never modifies the system: it runs two fixed read-only PowerShell
// queries, performs no remediation, writes nothing to disk or the registry,
// and persists no history (a short in-memory cache avoids respawning
// PowerShell on every page render).
//
// Numeric mappings below come from Microsoft's documented Defender WMI
// enumerations (MSFT_MpThreatDetection / MSFT_MpThreat) and were verified
// against the live CIM schema on Windows (property names) plus the
// published value tables. Values not present in these tables normalize to
// 'unknown' rather than a guess.

const { execFile } = require('child_process');

const QUERY_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 45000;
const MAX_DETECTIONS = 5000;
// The query asks for one record more than the backend keeps so truncation
// is detectable instead of silently implied.
const QUERY_LIMIT = MAX_DETECTIONS + 1;
const JSON_MAX_BUFFER = 1024 * 1024 * 8;

// ThreatStatusID -> Defender label. Source: Microsoft Learn,
// "MSFT_MpThreatDetection class" (Threat Status ID enumeration).
const THREAT_STATUS_LABELS = {
  0: 'Unknown',
  1: 'Detected',
  2: 'Cleaned',
  3: 'Quarantined',
  4: 'Removed',
  5: 'Allowed',
  6: 'Blocked',
  102: 'Quarantine failed',
  103: 'Remove failed',
  104: 'Allow failed',
  105: 'Abandoned',
  107: 'Block failed',
};

// ThreatStatusID values that mean Defender neutralized or contained the
// threat without further action required from the detection itself.
const REMEDIATED_STATUS_IDS = new Set([2, 3, 4, 6]);

// ThreatStatusID values that mean Defender explicitly failed to remediate.
const FAILED_STATUS_IDS = new Set([102, 103, 104, 107]);

// CleaningActionID -> Soterios action. Best-effort display labels only: no
// authoritative value table ships in the runtime CIM schema, so these meanings
// are corroborated from community/Microsoft-support references for
// Get-MpThreatDetection output (0 Unknown, 1 Clean, 2 Quarantine, 3 Remove,
// 4 Allow, 5 UserDefined, 6 NoAction, 7 Block, 8 ManualStepsRequired).
// Anything else — and any case where the documented ThreatStatusID already
// states the outcome — falls back to the status-derived action or 'unknown'.
// The raw numeric value is always preserved for forward compatibility.
const CLEANING_ACTIONS = {
  0: 'unknown',
  1: 'cleaned',
  2: 'quarantined',
  3: 'removed',
  4: 'allowed',
  5: 'unknown',
  6: 'no action',
  7: 'blocked',
  8: 'unknown',
};

// DetectionSourceTypeID -> label. Source: Microsoft Learn,
// "MSFT_MpThreatDetection class" (Detection Source Type ID enumeration).
const DETECTION_SOURCE_LABELS = {
  0: 'Unknown',
  1: 'User',
  2: 'System',
  3: 'Real-time',
  4: 'IOAV',
  5: 'NRI',
  7: 'ELAM',
  8: 'Local attestation',
  9: 'Remote attestation',
};

// CurrentThreatExecutionStatusID -> label. Source: Microsoft Learn,
// "MSFT_MpThreatDetection class" (Execution Status ID enumeration).
const EXECUTION_STATUS_LABELS = {
  0: 'Unknown',
  1: 'Blocked',
  2: 'Allowed',
  3: 'Executing',
  4: 'Not executing',
};

// SeverityID -> Soterios severity. Source: Microsoft Learn,
// "MSFT_MpThreat class" (Severity ID enumeration).
const SEVERITIES = {
  0: 'unknown',
  1: 'low',
  2: 'moderate',
  3: 'high',
  4: 'severe',
};

// CategoryID -> display name. Source: Microsoft Learn, "MSFT_MpThreat class"
// (Category ID enumeration). Display names use Defender's own threat-name
// vocabulary (e.g. "Trojan:Win32/..." -> "Trojan"), which is what users see
// in Windows Security.
const CATEGORY_NAMES = {
  0: null,
  1: 'Adware',
  2: 'Spyware',
  3: 'Password stealer',
  4: 'Trojan downloader',
  5: 'Worm',
  6: 'Backdoor',
  7: 'Remote access trojan',
  8: 'Trojan',
  9: 'Email flooder',
  10: 'Keylogger',
  11: 'Dialer',
  12: 'Monitoring software',
  13: 'Browser modifier',
  14: 'Cookie',
  15: 'Browser plugin',
  16: 'AOL exploit',
  17: 'Nuker',
  18: 'Security disabler',
  19: 'Joke program',
  20: 'Hostile ActiveX control',
  21: 'Software bundler',
  22: 'Stealth notifier',
  23: 'Settings modifier',
  24: 'Toolbar',
  25: 'Remote control software',
  26: 'Trojan FTP',
  27: 'Potentially unwanted software',
  28: 'ICQ exploit',
  29: 'Trojan Telnet',
  30: 'File sharing program',
  31: 'Malware creation tool',
  32: 'Remote control software',
  33: 'Tool',
  34: 'Trojan denial of service',
  36: 'Trojan dropper',
  37: 'Trojan mass mailer',
  38: 'Trojan monitoring software',
  39: 'Trojan proxy server',
  40: 'Virus',
  42: 'Known',
  43: null,
  44: 'SPP',
  45: 'Behavior',
  46: 'Vulnerability',
  47: 'Policy',
};

// Local JSON PowerShell runner with the hardened invocation this feature
// requires: -NoProfile, -NonInteractive, no -ExecutionPolicy Bypass (a fixed
// -Command string needs none), execFile argument array (no shell
// interpolation), bounded output buffer, and a timeout. The shared
// windowsChecks.runJsonPowerShell helper is deliberately NOT reused here:
// it passes -ExecutionPolicy Bypass and omits -NonInteractive, which does
// not satisfy this feature's requirements, and changing it would be a
// project-wide PowerShell refactor affecting many unrelated callers.
function runDefenderJson(script, timeoutMs = QUERY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    // As in windowsChecks.runJsonPowerShell: trim first so the serializer
    // attaches to the final expression instead of parsing as a new pipeline.
    const wrapped = `${String(script || '').trim()} | ConvertTo-Json -Depth 6`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', wrapped],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: JSON_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error) {
          // A real child-process timeout kills the process (killed + SIGTERM)
          // with no timeout wording in the message, so preserve it as
          // structured metadata instead of relying on message-text matching.
          const timedOut = Boolean(error.killed) || error.signal === 'SIGTERM';
          resolve({
            ok: false,
            error: (stderr && String(stderr).trim()) || error.message,
            timedOut,
          });
          return;
        }
        try {
          const trimmed = String(stdout || '').trim();
          if (!trimmed) {
            resolve({ ok: true, data: null });
            return;
          }
          resolve({ ok: true, data: JSON.parse(trimmed) });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      }
    );
  });
}
// Fixed read-only query. Two cmdlets, no parameters, no user input, no
// remediation or configuration cmdlets. Detections are ordered newest-first
// by Defender's own initial-detection timestamp and capped before JSON
// serialization so very large histories cannot blow the output buffer or
// force unbounded normalization work. Only fields v1 displays or normalizes
// are collected (no DomainUser: v1 has no use for it).
const HISTORY_SCRIPT = [
  `$detections = @(Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First ${QUERY_LIMIT} | Select-Object DetectionID, ThreatID, ProcessName, DetectionSourceTypeID, Resources, InitialDetectionTime, LastThreatStatusChangeTime, RemediationTime, CurrentThreatExecutionStatusID, ThreatStatusID, ThreatStatusErrorCode, CleaningActionID, ActionSuccess)`,
  '$threats = @(Get-MpThreat -ErrorAction Stop | Select-Object ThreatID, ThreatName, SeverityID, CategoryID)',
  '[PSCustomObject]@{ detections = $detections; threats = $threats }',
].join('\n');

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBooleanOrNull(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function toNonEmptyString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// PowerShell ConvertTo-Json serializes DateTime as "/Date(ms)/" (and may
// emit ISO strings for some values). Defender also reports unset times as
// DateTime.Min (year 1/1601). Returns an ISO string or null.
function parseDefenderDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) || value.getFullYear() < 2000
      ? null
      : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || date.getFullYear() < 2000 ? null : date.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  const msMatch = text.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
  if (msMatch) {
    const date = new Date(Number(msMatch[1]));
    return Number.isNaN(date.getTime()) || date.getFullYear() < 2000 ? null : date.toISOString();
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return null;
  return date.toISOString();
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Replaces the user-profile segment of a Windows path so usernames never
// reach the UI: C:\Users\Christopher\... -> C:\Users\<user>\...
function sanitizeDisplayPath(value) {
  let out = String(value || '');
  out = out.replace(/([A-Za-z]:)?\\Users\\[^\\/:*?"<>|]+/gi, '$1\\Users\\<user>');
  out = out.replace(/\/home\/[^/\s:]+/g, '/home/<user>');
  return out;
}

function abbreviateDisplay(text, maxLength = 160) {
  const value = String(text || '');
  if (value.length <= maxLength) return value;
  const keep = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, keep)}\u2026${value.slice(value.length - keep)}`;
}

// Defender resource kinds observed in Get-MpThreatDetection output. Only
// these prefixes are interpreted; anything else keeps type 'other' with no
// invented semantics.
const KNOWN_RESOURCE_PREFIXES = 'file|dir|process|regkey|registry|boot|service|startup|task|wmi|lnk|container|amsi';

function inferResourceType(prefix, resource) {
  const kind = String(prefix || '').trim().toLowerCase();
  if (kind === 'file' || kind === 'dir' || kind === 'process' || kind === 'regkey' || kind === 'registry') {
    return kind === 'regkey' ? 'registry' : kind;
  }
  if (/^[A-Za-z]:[\\/]/.test(resource) || resource.startsWith('\\\\')) return 'file';
  if (/^HK(CU|LM|CR|CC|U)\\/i.test(resource)) return 'registry';
  return 'other';
}

function normalizeResource(entry) {
  const raw = toNonEmptyString(entry);
  if (!raw) return null;
  const prefixed = raw.match(new RegExp(`^(${KNOWN_RESOURCE_PREFIXES})\\s*:(.*)$`, 'i'));
  let body = toNonEmptyString(prefixed ? prefixed[2] : raw);
  if (!body) return null;
  if (prefixed) {
    // Defender commonly separates kind and payload as `kind:_payload`
    // (e.g. `file:_C:\...`, `amsi:_...`, `process:_...`, `regkey:_...`).
    // The underscore is a separator artifact, never part of the payload, so
    // strip exactly one leading underscore for recognized prefixes only.
    body = body.replace(/^_/, '');
    if (!body) return null;
  }
  return {
    type: inferResourceType(prefixed ? prefixed[1] : null, body),
    display: abbreviateDisplay(sanitizeDisplayPath(body)),
  };
}

function normalizeResources(value) {
  const seen = new Set();
  const resources = [];
  for (const entry of asArray(value)) {
    const normalized = normalizeResource(entry);
    if (!normalized) continue;
    const key = `${normalized.type}|${normalized.display}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push(normalized);
  }
  return resources;
}

// Maps a Defender threat status to a Soterios coarse status using ONLY the
// individual detection's own fields (ThreatStatusID, CurrentThreatExecution-
// StatusID, ActionSuccess, ThreatStatusErrorCode). Threat-level rollup values
// from Get-MpThreat must NOT feed this decision: several historical
// detections share one ThreatID, so a threat-level flag would mislabel older
// remediated occurrences as active.
// ActionSuccess reports the outcome of an attempted cleaning action; on its
// own it does not establish the final detection status, so a successful
// action with a missing/unknown status normalizes to 'unknown', never to a
// guessed 'remediated'.
// Precedence: explicit failure signals first, then active signals, then
// documented remediated statuses. Anything unfamiliar is 'unknown'.
function normalizeStatus(rawStatusId, actionSuccess, errorCode, execStatusId) {
  const statusId = toFiniteNumber(rawStatusId);
  const code = toFiniteNumber(errorCode);
  const execId = toFiniteNumber(execStatusId);
  if (actionSuccess === false) return 'failed';
  if (statusId !== null && FAILED_STATUS_IDS.has(statusId)) return 'failed';
  if (code !== null && code !== 0) return 'failed';
  if (statusId === 1) return 'active';
  // Defender explicitly reports the threat as currently executing.
  if (execId === 3) return 'active';
  if (statusId !== null && REMEDIATED_STATUS_IDS.has(statusId)) return 'remediated';
  return 'unknown';
}

function statusLabelFor(statusId) {
  const id = toFiniteNumber(statusId);
  if (id !== null && Object.prototype.hasOwnProperty.call(THREAT_STATUS_LABELS, id)) {
    return THREAT_STATUS_LABELS[id];
  }
  return 'Unknown';
}

function actionFor(cleaningActionId) {
  const id = toFiniteNumber(cleaningActionId);
  if (id !== null && Object.prototype.hasOwnProperty.call(CLEANING_ACTIONS, id)) {
    return CLEANING_ACTIONS[id];
  }
  return 'unknown';
}

function severityFor(severityId) {
  const id = toFiniteNumber(severityId);
  if (id !== null && Object.prototype.hasOwnProperty.call(SEVERITIES, id)) {
    return SEVERITIES[id];
  }
  return 'unknown';
}

function categoryFor(threatName, categoryId) {
  const name = toNonEmptyString(threatName);
  if (name) {
    const prefix = name.match(/^([^:;\/]+)\s*:/);
    if (prefix && prefix[1].trim()) return prefix[1].trim();
  }
  const id = toFiniteNumber(categoryId);
  if (id !== null && Object.prototype.hasOwnProperty.call(CATEGORY_NAMES, id)) {
    return CATEGORY_NAMES[id];
  }
  return null;
}

function sourceLabelFor(detectionSourceTypeId) {
  const id = toFiniteNumber(detectionSourceTypeId);
  if (id !== null && Object.prototype.hasOwnProperty.call(DETECTION_SOURCE_LABELS, id)) {
    return DETECTION_SOURCE_LABELS[id];
  }
  return null;
}

function executionLabelFor(currentThreatExecutionStatusId) {
  const id = toFiniteNumber(currentThreatExecutionStatusId);
  if (id !== null && Object.prototype.hasOwnProperty.call(EXECUTION_STATUS_LABELS, id)) {
    return EXECUTION_STATUS_LABELS[id];
  }
  return null;
}

function buildThreatIndex(threats) {
  const index = new Map();
  for (const entry of asArray(threats)) {
    if (!entry || typeof entry !== 'object') continue;
    const threatId = toNonEmptyString(entry.ThreatID ?? entry.threatId);
    if (!threatId || index.has(threatId)) continue;
    index.set(threatId, entry);
  }
  return index;
}

function stableDetectionId(raw, normalizedCore) {
  const detectionId = toNonEmptyString(raw.DetectionID ?? raw.detectionId);
  if (detectionId) return `detection:${detectionId}`;
  const parts = [
    normalizedCore.threatId || 'nothreat',
    normalizedCore.detectedAt || 'nodate',
    (normalizedCore.resources[0] && normalizedCore.resources[0].display) || 'noresource',
    normalizedCore.processName || 'noprocess',
    normalizedCore.rawStatus === null || normalizedCore.rawStatus === undefined
      ? 'nostatus'
      : String(normalizedCore.rawStatus),
  ];
  return `compound:${parts.join('|')}`;
}

// Documented detection statuses that already state the remediation outcome,
// preferred over the best-effort CleaningActionID when the action is unknown.
const STATUS_DERIVED_ACTIONS = {
  2: 'cleaned',
  3: 'quarantined',
  4: 'removed',
  6: 'blocked',
};

function normalizeDetection(raw, threatIndex) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const threatId = toNonEmptyString(raw.ThreatID ?? raw.threatId);
  const threat = (threatId && threatIndex.get(threatId)) || null;
  const threatName = toNonEmptyString(threat && (threat.ThreatName ?? threat.threatName));
  const actionSuccess = toBooleanOrNull(raw.ActionSuccess ?? raw.actionSuccess);
  const rawStatus = toFiniteNumber(raw.ThreatStatusID ?? raw.threatStatusId);
  const errorCode = toFiniteNumber(raw.ThreatStatusErrorCode ?? raw.threatStatusErrorCode);
  const rawAction = toFiniteNumber(raw.CleaningActionID ?? raw.cleaningActionId);
  const rawExecStatus = toFiniteNumber(raw.CurrentThreatExecutionStatusID ?? raw.currentThreatExecutionStatusId);

  const detectedAt = parseDefenderDate(raw.InitialDetectionTime ?? raw.initialDetectionTime);
  const lastUpdatedAt = parseDefenderDate(raw.LastThreatStatusChangeTime ?? raw.lastThreatStatusChangeTime);
  const remediatedAt = parseDefenderDate(raw.RemediationTime ?? raw.remediationTime);
  const resources = normalizeResources(raw.Resources ?? raw.resources);
  // ProcessName may be a bare name or a full path; same privacy treatment as
  // resource paths so user-profile segments never reach the UI.
  const processName = sanitizeDisplayPath(toNonEmptyString(raw.ProcessName ?? raw.processName) || '');
  const status = normalizeStatus(rawStatus, actionSuccess, errorCode, rawExecStatus);
  let action = actionFor(rawAction);
  if (action === 'unknown' && rawStatus !== null && STATUS_DERIVED_ACTIONS[rawStatus]) {
    action = STATUS_DERIVED_ACTIONS[rawStatus];
  }

  const core = {
    threatId,
    detectedAt,
    resources,
    processName: processName || null,
    rawStatus,
  };
  return {
    id: stableDetectionId(raw, core),
    threatId,
    threatName,
    detectedAt,
    lastUpdatedAt,
    remediatedAt,
    status,
    statusLabel: statusLabelFor(rawStatus),
    action,
    actionSuccess,
    severity: severityFor(threat && (threat.SeverityID ?? threat.severityId)),
    category: categoryFor(threatName, threat && (threat.CategoryID ?? threat.categoryId)),
    resources,
    processName: processName || null,
    executionStatus: executionLabelFor(rawExecStatus),
    detectionSource: sourceLabelFor(raw.DetectionSourceTypeID ?? raw.detectionSourceTypeId),
    active: status === 'active',
    source: 'Microsoft Defender',
    rawStatus,
    rawAction,
  };
}

function sortDetections(detections) {
  return [...detections].sort((a, b) => {
    const aTime = a.detectedAt ? Date.parse(a.detectedAt) : NaN;
    const bTime = b.detectedAt ? Date.parse(b.detectedAt) : NaN;
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid && aTime !== bTime) return bTime - aTime;
    if (aValid !== bValid) return aValid ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function classifyQueryError(message) {
  const text = String(message || '');
  if (/not recognized|No such|was not found|command was not found|Cannot find|not available|ENOENT/i.test(text)) {
    return { code: 'unavailable', error: 'Microsoft Defender cmdlets are not available on this system.' };
  }
  if (/timed out|timeout|operation has timed out/i.test(text)) {
    return { code: 'timeout', error: 'Reading Defender threat history timed out.' };
  }
  if (/access is denied|unauthorized|privilege|elevation/i.test(text)) {
    return { code: 'unavailable', error: 'Soterios could not read Defender threat history (access was denied).' };
  }
  if (/only available on Windows|only supported on Windows/i.test(text)) {
    return { code: 'unavailable', error: 'Defender threat history is only available on Windows.' };
  }
  return { code: 'failed', error: 'Soterios could not read Defender threat history.' };
}

class DefenderThreatHistory {
  constructor(options = {}) {
    // Seam shape is (script, fallback, timeout) so injected fakes written
    // against the previous default keep working; the fallback is unused.
    this.runJson =
      options.runJson || ((script, _fallback, timeout) => runDefenderJson(script, timeout));
    this.platform = options.platform || process.platform;
    this.now = options.now || (() => Date.now());
    this.cacheTtlMs = options.cacheTtlMs === undefined ? CACHE_TTL_MS : options.cacheTtlMs;
    this.cachedAt = 0;
    this.cached = null;
  }

  async getHistory(options = {}) {
    if (this.platform !== 'win32') {
      return { ok: false, code: 'unavailable', error: 'Defender threat history is only available on Windows.' };
    }
    const refresh = options && options.refresh === true;
    if (!refresh && this.cached && this.now() - this.cachedAt < this.cacheTtlMs) {
      return { ok: true, data: this.cached };
    }
    let result = null;
    try {
      result = await this.runJson(HISTORY_SCRIPT, null, QUERY_TIMEOUT_MS);
    } catch (err) {
      const classified = classifyQueryError(err && err.message);
      return { ok: false, code: classified.code, error: classified.error };
    }
    if (!result || result.ok !== true) {
      // Structured timeout metadata from the real runner wins over message
      // text, which carries no timeout wording for killed processes.
      if (result && result.timedOut === true) {
        return { ok: false, code: 'timeout', error: 'Reading Defender threat history timed out.' };
      }
      const classified = classifyQueryError(result && result.error);
      return { ok: false, code: classified.code, error: classified.error };
    }
    const payload = result.data || {};
    // Truncation is decided from the raw bounded source array BEFORE
    // normalization, malformed-row skipping, and deduplication: a source that
    // exceeded MAX_DETECTIONS must report truncated even when those steps
    // leave fewer than MAX_DETECTIONS normalized rows behind.
    const rawDetections = asArray(payload.detections);
    const truncated = rawDetections.length > MAX_DETECTIONS;
    const threatIndex = buildThreatIndex(payload.threats);
    const seen = new Set();
    const normalized = [];
    let skipped = 0;
    for (const raw of rawDetections) {
      let item = null;
      try {
        item = normalizeDetection(raw, threatIndex);
      } catch (_) {
        item = null;
      }
      if (!item) {
        skipped += 1;
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      normalized.push(item);
    }
    // Newest first, then cap: output order never depends on source order,
    // and at most MAX_DETECTIONS normalized rows are returned.
    const ordered = sortDetections(normalized);
    const data = {
      detections: ordered.slice(0, MAX_DETECTIONS),
      truncated,
      skipped,
      fetchedAt: new Date(this.now()).toISOString(),
      source: 'Microsoft Defender',
    };
    this.cached = data;
    this.cachedAt = this.now();
    return { ok: true, data };
  }
}

module.exports = {
  DefenderThreatHistory,
  HISTORY_SCRIPT,
  QUERY_TIMEOUT_MS,
  CACHE_TTL_MS,
  MAX_DETECTIONS,
  QUERY_LIMIT,
  THREAT_STATUS_LABELS,
  REMEDIATED_STATUS_IDS,
  FAILED_STATUS_IDS,
  CLEANING_ACTIONS,
  DETECTION_SOURCE_LABELS,
  EXECUTION_STATUS_LABELS,
  SEVERITIES,
  CATEGORY_NAMES,
  parseDefenderDate,
  sanitizeDisplayPath,
  runDefenderJson,
  normalizeResource,
  normalizeResources,
  normalizeStatus,
  statusLabelFor,
  actionFor,
  severityFor,
  categoryFor,
  sourceLabelFor,
  executionLabelFor,
  buildThreatIndex,
  normalizeDetection,
  sortDetections,
  classifyQueryError,
  asArray,
};
