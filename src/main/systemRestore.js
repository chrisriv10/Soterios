'use strict';

/**
 * Windows System Restore point management (issue #125).
 *
 * Read-only listing plus explicit, user-confirmed creation of a single
 * `MODIFY_SETTINGS` restore point. This module deliberately does NOT:
 * restore/rollback, delete points, enable/disable System Protection, touch
 * VSS (`vssadmin`/`diskshadow`), schedule automatic points, persist anything,
 * or report to maintenance scheduler / health / audit surfaces.
 *
 * Transport rules (see spec):
 * - `powershell.exe` via `execFile` with an argv array (`shell` is never used).
 * - The PowerShell source is a module-level FIXED constant. User input never
 *   reaches the command line; the requested description travels in the child
 *   environment (`SOTERIOS_RESTORE_DESC`) and is read via `$env:` inside the
 *   fixed script. The fixed script is passed as `-EncodedCommand` (base64 of
 *   UTF-16LE), matching `processService.powershellEncoded`.
 * - Creation is verified by re-listing: success is only reported when a new
 *   point (higher sequence number, same description, fresh timestamp) is
 *   observed. Otherwise the result is `not_confirmed`, never `created`.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_DESCRIPTION = 'Soterios maintenance';
// Conservative cap, far below any platform limit: long input is rejected with
// a clear error rather than silently truncated.
const MAX_DESCRIPTION_LENGTH = 100;
const DESCRIPTION_ENV_VAR = 'SOTERIOS_RESTORE_DESC';
const CREATE_SUCCESS_MARKER = 'SOTERIOS_RESTORE_COMMAND_OK';
const RESTORE_POINT_TYPE_MODIFY_SETTINGS = 'MODIFY_SETTINGS';

const LIST_TIMEOUT_MS = 30000;
const CREATE_TIMEOUT_MS = 180000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_ERROR_TEXT = 500;
// Clock skew allowance (ms) when matching a freshly created point.
const VERIFY_SKEW_MS = 60000;

function powershellEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// Fixed list script. Emits exactly one JSON document: { points: [...] }.
// Per-row try/catch keeps one malformed WMI row from failing the whole query.
const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$items = @(Get-ComputerRestorePoint | Select-Object SequenceNumber, CreationTime, Description, RestorePointType, EventType)',
  '$points = @($items | ForEach-Object {',
  '  $row = $_',
  '  try { $when = ([System.Management.ManagementDateTimeConverter]::ToDateTime($row.CreationTime)).ToString("o") } catch { $when = $null }',
  '  @{ sequenceNumber = [int]$row.SequenceNumber; creationTime = $when; description = [string]$row.Description; restorePointType = [int]$row.RestorePointType; eventType = [int]$row.EventType }',
  '})',
  '@{ points = $points } | ConvertTo-Json -Depth 3 -Compress',
].join('\n');

// Fixed create script. The description arrives via the child environment, so
// no caller-controlled text ever appears in this source or on argv.
// Checkpoint-Computer reports the one-point-per-day limit as a *warning*
// (exit code stays 0), which -ErrorAction Stop does not intercept — so
// warnings are captured and converted into a terminating error carrying the
// warning text. The classifier then reports the honest frequency_limited
// state instead of a misleading not_confirmed.
const CREATE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$description = $env:${DESCRIPTION_ENV_VAR}`,
  "if ([string]::IsNullOrWhiteSpace($description)) { throw 'SOTERIOS_RESTORE_MISSING_DESCRIPTION' }",
  `Checkpoint-Computer -Description $description -RestorePointType ${RESTORE_POINT_TYPE_MODIFY_SETTINGS} -ErrorAction Stop -WarningAction SilentlyContinue -WarningVariable srWarnings`,
  "if ($srWarnings) { throw ('SOTERIOS_RESTORE_WARNING: ' + (($srWarnings | ForEach-Object { $_.Message }) -join ' ')) }",
  `Write-Output '${CREATE_SUCCESS_MARKER}'`,
].join('\n');

/**
 * Build the argv launch for a fixed script. Pure helper so tests can prove
 * the launch shape (no shell, fixed script only) without spawning anything.
 */
function createLaunch(script) {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)],
  };
}

function noopLogger() {
  return { info() {}, warn() {}, error() {} };
}

function truncateErrorText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Unknown error';
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;
}

/**
 * Classify a PowerShell/transport failure into a stable machine code.
 * Matching order matters: timeout first, then privilege, then cancel, then
 * platform support, then documented create-side failures.
 */
function classifyRestoreError(errorInfo = {}) {
  const { timedOut = false, exitCode = null, stderr = '', message = '' } = errorInfo;
  if (timedOut) return 'timeout';
  const haystack = `${stderr}\n${message}`;
  if (/access (is )?denied|0x80070005|requires?\s+(elevation|administrator)|requested operation requires/i.test(haystack)) {
    return 'requires_elevation';
  }
  if (/0x800704C7|cancell?ed by the user|operation was cancel/i.test(haystack)) {
    return 'cancelled';
  }
  if (/not recognized as the name of a cmdlet|0x8004100E|invalid namespace|not supported on|no (such|instances?) /i.test(haystack)) {
    return 'unsupported';
  }
  if (/SOTERIOS_RESTORE_MISSING_DESCRIPTION/i.test(haystack)) {
    return 'description_empty';
  }
  if (/cannot create|already been created|within the past 24|frequency|once per day|0x80042316|0x80042318/i.test(haystack)) {
    return 'frequency_limited';
  }
  return 'failed';
}

function errorMessageFor(code, detail) {
  switch (code) {
    case 'requires_elevation':
      return 'System Restore information requires administrator privileges. Reopen Soterios with elevation (the installed app runs elevated by default).';
    case 'cancelled':
      return 'The operation was cancelled.';
    case 'unsupported':
      return 'System Restore points are not available on this system (client Windows with System Protection is required).';
    case 'frequency_limited':
      return 'Windows declined the checkpoint: only one restore point can be created per day, or the drive is too full. Try again later.';
    case 'timeout':
      return 'The operation timed out before Windows confirmed the result.';
    case 'busy':
      return 'A restore-point creation is already in progress. Wait for it to finish.';
    case 'description_empty':
      return 'A non-empty description is required.';
    case 'description_too_long':
      return `The description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    case 'description_invalid':
      return 'The description contains characters Windows does not accept (newlines or control characters).';
    case 'not_confirmed':
      return 'Windows ran the checkpoint command but no new restore point was found on verification. Check System Protection settings; no point was claimed.';
    default:
      return detail ? `System Restore operation failed: ${detail}` : 'System Restore operation failed.';
  }
}

/**
 * Validate a caller-supplied description. Returns the trimmed safe value.
 * Newlines and control characters are rejected (never silently stripped).
 */
function validateDescription(input) {
  if (typeof input !== 'string') {
    return { ok: false, code: 'description_empty', message: errorMessageFor('description_empty') };
  }
  const description = input.trim();
  if (!description) {
    return { ok: false, code: 'description_empty', message: errorMessageFor('description_empty') };
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, code: 'description_too_long', message: errorMessageFor('description_too_long') };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(description)) {
    return { ok: false, code: 'description_invalid', message: errorMessageFor('description_invalid') };
  }
  return { ok: true, description };
}

/**
 * Normalize one raw row into the public point shape. Returns null when the
 * row lacks a usable sequence number or creation time (never throws).
 */
function normalizeRestorePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sequenceNumber = Number(raw.sequenceNumber);
  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) return null;
  const parsed = Date.parse(raw.creationTime);
  if (Number.isNaN(parsed)) return null;
  const restorePointType = Number(raw.restorePointType);
  const eventType = Number(raw.eventType);
  return {
    sequenceNumber,
    createdAt: new Date(parsed).toISOString(),
    createdAtMs: parsed,
    description: typeof raw.description === 'string' ? raw.description : '',
    restorePointType: Number.isInteger(restorePointType) ? restorePointType : null,
    eventType: Number.isInteger(eventType) ? eventType : null,
  };
}

function maxSequenceNumber(points) {
  let max = 0;
  for (const point of points || []) {
    if (point && Number.isInteger(point.sequenceNumber) && point.sequenceNumber > max) {
      max = point.sequenceNumber;
    }
  }
  return max;
}

function parseListOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return { ok: false, code: 'failed', message: errorMessageFor('failed', 'empty response from System Restore query') };
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    return { ok: false, code: 'failed', message: errorMessageFor('failed', 'response too large') };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { ok: false, code: 'failed', message: errorMessageFor('failed', 'unparsable response from System Restore query') };
  }
  const rows = parsed && Array.isArray(parsed.points) ? parsed.points : null;
  if (!rows) {
    return { ok: false, code: 'failed', message: errorMessageFor('failed', 'unexpected response shape from System Restore query') };
  }
  const points = [];
  for (const row of rows) {
    const normalized = normalizeRestorePoint(row);
    if (normalized) points.push(normalized);
  }
  points.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  return { ok: true, points };
}

async function defaultRunCommand({ file, args, env, timeoutMs }) {
  return execFileAsync(file, args, {
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env,
  }).then(({ stdout, stderr }) => ({ stdout: String(stdout || ''), stderr: String(stderr || '') }));
}

class SystemRestoreManager {
  constructor(options = {}) {
    this._platform = options.platform || process.platform;
    // Runner contract (mutation-safety critical): the injected runCommand
    // MUST NOT settle until the child lifecycle is resolved. In particular
    // it must kill the child on timeout before rejecting — the default
    // runner below relies on execFile's timeout kill, and the in-flight
    // guard is cleared only after the full attempt (invoke + verification)
    // settles. A runner that settles while its child is still alive would
    // allow a second Checkpoint-Computer to overlap the first.
    this._runCommand = options.runCommand || defaultRunCommand;
    this._now = options.now || (() => Date.now());
    this._logger = options.logger || noopLogger();
    this._listTimeoutMs = options.listTimeoutMs || LIST_TIMEOUT_MS;
    this._createTimeoutMs = options.createTimeoutMs || CREATE_TIMEOUT_MS;
    this._createInFlight = false;
  }

  get createInFlight() {
    return this._createInFlight;
  }

  async _invoke(script, { env = {}, timeoutMs }) {
    const launch = createLaunch(script);
    const startedAt = this._now();
    try {
      const result = await this._runCommand({
        file: launch.file,
        args: launch.args,
        env: { ...process.env, ...env },
        timeoutMs,
      });
      return {
        ok: true,
        stdout: String((result && result.stdout) || ''),
        stderr: String((result && result.stderr) || ''),
        durationMs: this._now() - startedAt,
      };
    } catch (error) {
      const err = error || {};
      return {
        ok: false,
        timedOut: !!err.killed || err.code === 'ETIMEDOUT' || /timed out/i.test(String(err.message || '')),
        exitCode: typeof err.code === 'number' ? err.code : null,
        stderr: String(err.stderr || ''),
        message: String(err.message || 'Command failed'),
        durationMs: this._now() - startedAt,
      };
    }
  }

  _failure(code, invocation, detail) {
    const message = errorMessageFor(code, detail || truncateErrorText(`${invocation.stderr}\n${invocation.message || ''}`));
    this._logger.warn('systemRestore operation failed', { code, durationMs: invocation.durationMs });
    return { ok: false, code, message };
  }

  async listRestorePoints() {
    if (this._platform !== 'win32') {
      return { ok: false, code: 'unsupported', message: errorMessageFor('unsupported') };
    }
    const startedAt = this._now();
    const invocation = await this._invoke(LIST_SCRIPT, { timeoutMs: this._listTimeoutMs });
    if (!invocation.ok) {
      const code = classifyRestoreError(invocation);
      return this._failure(code, invocation);
    }
    const parsed = parseListOutput(invocation.stdout);
    if (!parsed.ok) {
      this._logger.warn('systemRestore list parse failed', { durationMs: this._now() - startedAt });
      return parsed;
    }
    // No documented read distinguishes "protection disabled" from "no points
    // yet", so an empty store is reported honestly as unconfirmed — never as
    // proof of disabled protection.
    const status = parsed.points.length > 0 ? 'available' : 'unconfirmed';
    this._logger.info('systemRestore list ok', { count: parsed.points.length, status, durationMs: this._now() - startedAt });
    return {
      ok: true,
      status,
      points: parsed.points,
      count: parsed.points.length,
      message: status === 'available'
        ? undefined
        : 'No restore points were found. This can mean none have been created yet, or that System Protection is turned off — Soterios cannot tell the difference from the documented read path.',
    };
  }

  async createRestorePoint(input) {
    if (this._platform !== 'win32') {
      return { ok: false, code: 'unsupported', message: errorMessageFor('unsupported') };
    }
    const validated = validateDescription(typeof input === 'string' ? input : (input && input.description));
    if (!validated.ok) return validated;
    if (this._createInFlight) {
      return { ok: false, code: 'busy', message: errorMessageFor('busy') };
    }
    this._createInFlight = true;
    try {
      return await this._createOnce(validated.description);
    } finally {
      this._createInFlight = false;
    }
  }

  async _createOnce(description) {
    const operationStartedAt = this._now();
    const before = await this.listRestorePoints();
    if (!before.ok) {
      // Without a baseline list the result could never be verified honestly.
      return { ok: false, code: before.code, message: before.message, stage: 'pre_list' };
    }
    const beforeMax = maxSequenceNumber(before.points);

    const invocation = await this._invoke(CREATE_SCRIPT, {
      env: { [DESCRIPTION_ENV_VAR]: description },
      timeoutMs: this._createTimeoutMs,
    });

    if (!invocation.ok) {
      const code = classifyRestoreError(invocation);
      if (code === 'timeout') {
        // The checkpoint may still have committed after the client was
        // killed; reconcile with one verification pass before reporting.
        const reconciled = await this._verifyNewPoint(beforeMax, description, operationStartedAt);
        if (reconciled) {
          return { ok: true, status: 'created', point: reconciled, verifiedAfterTimeout: true };
        }
        return this._failure('timeout', invocation);
      }
      return this._failure(code, invocation);
    }

    const markerPresent = invocation.stdout.includes(CREATE_SUCCESS_MARKER);
    const verified = await this._verifyNewPoint(beforeMax, description, operationStartedAt);
    if (verified) {
      this._logger.info('systemRestore create ok', { durationMs: this._now() - operationStartedAt });
      return { ok: true, status: 'created', point: verified };
    }
    if (!markerPresent) {
      return this._failure('failed', invocation, 'checkpoint command did not report completion');
    }
    return { ok: false, code: 'not_confirmed', message: errorMessageFor('not_confirmed') };
  }

  async _verifyNewPoint(beforeMax, description, operationStartedAt) {
    const after = await this.listRestorePoints();
    if (!after.ok) return null;
    const now = this._now();
    const earliestMs = operationStartedAt - VERIFY_SKEW_MS;
    // Upper bound too: a point dated beyond plausible clock skew is not
    // evidence for this attempt, even if sequence and description match.
    const latestMs = now + VERIFY_SKEW_MS;
    const candidates = (after.points || []).filter((point) => (
      point.sequenceNumber > beforeMax
      && point.description === description
      && point.createdAtMs >= earliestMs
      && point.createdAtMs <= latestMs
    ));
    candidates.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
    return candidates[0] || null;
  }
}

module.exports = {
  SystemRestoreManager,
  validateDescription,
  normalizeRestorePoint,
  classifyRestoreError,
  parseListOutput,
  createLaunch,
  maxSequenceNumber,
  errorMessageFor,
  LIST_SCRIPT,
  CREATE_SCRIPT,
  DEFAULT_DESCRIPTION,
  MAX_DESCRIPTION_LENGTH,
  DESCRIPTION_ENV_VAR,
  CREATE_SUCCESS_MARKER,
  LIST_TIMEOUT_MS,
  CREATE_TIMEOUT_MS,
};
