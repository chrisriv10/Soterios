'use strict';

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { suspiciousPathSignals, getSignatureInfo } = require('./windowsChecks');
const logger = require('../utils/logger');
const { log, ACTIONS } = require('../core/auditLog');

// PIDs that should never be terminated regardless of what they resolve to.
const PROTECTED_PIDS = new Set([0, 4]);

// Process names that are critical to Windows staying up, or to the OS being
// able to log the user back in. Killing these can bluescreen or lock out the
// session, so they're blocked outright rather than just warned about.
const PROTECTED_NAMES = new Set([
  'system',
  'system idle process',
  'registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'lsm.exe',
  'svchost.exe',
  'explorer.exe',
  'dwm.exe',
  'fontdrvhost.exe'
]);

const SYSTEM_DIR_MARKERS = ['\\windows\\system32\\', '\\windows\\syswow64\\'];

/**
 * Derive a human-readable recommendation from an array of suspicion reasons.
 *
 * @param {Array<string>} reasons
 * @returns {string}
 */
function recommendationForReasons(reasons) {
  if (!reasons.length) return 'No action needed.';
  if (reasons.some((r) => /recycle bin/i.test(r))) {
    return 'Review this process immediately — executables from the Recycle Bin are almost never legitimate.';
  }
  if (reasons.some((r) => /unsigned|untrusted|encoded|appdata|temporary|unusual/i.test(r))) {
    return 'Verify the executable source and path before allowing it to keep running.';
  }
  return 'Review the process location and confirm it is expected on this system.';
}

/**
 * Check whether a path resolves into a Windows system directory.
 *
 * @param {string} [filePath]
 * @returns {boolean}
 */
function isSystemDirectoryPath(filePath) {
  const lower = String(filePath || '').toLowerCase().replace(/\//g, '\\');
  return SYSTEM_DIR_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Inspects running processes, assesses suspicious characteristics, and
 * can terminate non-critical processes on request.
 *
 * Critical system PIDs/names and the Soterios process itself are protected.
 */
class ProcessInspector {
  /**
   * @param {Object} [options]
   * @param {object} [options.db] - DatabaseService for audit logging.
   * @param {Function} [options.getSignatureInfo] - Signature lookup override.
   */
  constructor(options = {}) {
    this._db = options.db || null;
    this._getSignatureInfo = options.getSignatureInfo || getSignatureInfo;
  }

  /**
   * Extract the executable path from a command line string.
   * Handles quoted paths; unquoted paths with spaces are approximate.
   * @param {string} cmd
   * @returns {string|null}
   */
  _extractPathFromCmd(cmd) {
    if (!cmd) return null;
    const trimmed = cmd.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('"')) {
      const end = trimmed.indexOf('"', 1);
      if (end > 0) return trimmed.slice(1, end);
    }
    const spaceIdx = trimmed.indexOf(' ');
    return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  }

  /**
   * Assess whether a process looks suspicious based on path, name, and signature.
   * @param {Object} proc
   * @param {number} proc.pid
   * @param {string} proc.name
   * @param {string} proc.cmd
   * @param {string} [proc.path]
   * @returns {Promise<Object>}
   */
  async _assessSuspicious(proc) {
    const reasons = [];
    const locationReasons = [];
    const exePath = proc.path || this._extractPathFromCmd(proc.cmd);
    for (const signal of suspiciousPathSignals(exePath)) {
      reasons.push(signal.message);
      locationReasons.push(signal.message);
    }

    const name = String(proc.name || '').toLowerCase();
    const cmd = String(proc.cmd || '').toLowerCase();
    if (name === 'powershell.exe' && (cmd.includes('-enc') || cmd.includes('-encodedcommand') || cmd.includes('frombase64string'))) {
      reasons.push('PowerShell invoked with encoded/obfuscated command arguments.');
    }

    if (exePath && isSystemDirectoryPath(exePath)) {
      try {
        const sig = await this._getSignatureInfo(exePath);
        const status = sig && sig.status ? String(sig.status) : 'Unknown';
        if (status === 'NotSigned' || status === 'HashMismatch' || status === 'NotTrusted') {
          const msg = `Unsigned or untrusted executable in a system directory (signature status: ${status}).`;
          reasons.push(msg);
        }
      } catch (_) {
        /* signature lookup is best-effort */
      }
    }

    return {
      suspicious: locationReasons.length > 0,
      locationReasons,
      suspiciousReasons: reasons,
      recommendedAction: recommendationForReasons(reasons)
    };
  }

  /**
   * Get all running processes with suspicion assessment.
   * @returns {Promise<Array<Object>>}
   */
  async getProcesses() {
    try {
      const { default: psList } = await import('ps-list');
      const processes = await psList();
      return Promise.all(processes.map(async (p) => {
        const path = this._extractPathFromCmd(p.cmd);
        const base = {
          pid: p.pid,
          name: p.name,
          cmd: p.cmd || '',
          path,
          ppid: p.ppid,
          cpu: p.cpu,
          memory: p.memory
        };
        return { ...base, ...(await this._assessSuspicious(base)) };
      }));
    } catch (err) {
      logger.error('Failed to get processes', { error: err.message || String(err) });
      return [];
    }
  }

  /**
   * Terminate a process after safety checks.
   * @param {number} pid
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async killProcess(pid) {
    const numericPid = Number(pid);

    if (!Number.isInteger(numericPid) || numericPid <= 0) {
      return { success: false, error: 'Invalid process ID.' };
    }

    if (PROTECTED_PIDS.has(numericPid)) {
      return { success: false, error: 'Refusing to end a protected system process.' };
    }

    if (numericPid === process.pid) {
      return { success: false, error: 'Refusing to end Soterios itself.' };
    }

    // Look the process up by PID right before killing it, so the name check
    // reflects reality rather than trusting whatever the renderer last sent.
    let target = null;
    try {
      const { default: psList } = await import('ps-list');
      const list = await psList();
      target = list.find((p) => p.pid === numericPid) || null;
    } catch (err) {
      return { success: false, error: 'Unable to verify process before ending it: ' + (err.message || String(err)) };
    }

    if (!target) {
      return { success: false, error: 'Process not found. It may have already exited.' };
    }

    const nameLower = String(target.name || '').toLowerCase();
    if (PROTECTED_NAMES.has(nameLower)) {
      return { success: false, error: `"${target.name}" is a critical system process and cannot be ended from here.` };
    }

    try {
      // taskkill /F is more reliable than process.kill() on Windows for
      // terminating arbitrary third-party processes, including ones that
      // don't respond to a plain terminate signal.
      await execPromise(`taskkill /PID ${numericPid} /F`, { timeout: 10000 });
      log(this._db, ACTIONS.PROCESS_KILL, { pid: numericPid, name: target.name }, { success: true });
      return { success: true };
    } catch (err) {
      const message = (err.stderr && err.stderr.trim()) || err.message || 'Unknown error ending process.';
      log(this._db, ACTIONS.PROCESS_KILL, { pid: numericPid, name: target.name }, { success: false, error: message });
      return { success: false, error: message };
    }
  }
}

module.exports = ProcessInspector;
