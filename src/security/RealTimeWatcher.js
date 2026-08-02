const logger = require('../utils/logger');
const SystemAudit = require('./SystemAudit');

/**
 * Monitors Windows Defender real-time protection state and verifies
 * that it remains enabled after tamper-protection bypass attempts.
 */
class RealTimeWatcher {
  /**
   * @param {object} db
   * @param {object} eventBus
   * @param {object} scanEngine
   */
  constructor(db, eventBus, scanEngine) {
    this.db = db;
    this.eventBus = eventBus;
    this.scanEngine = scanEngine;
    this.audit = new SystemAudit();
  }

  /**
   * Check whether Windows Defender is available on this system.
   * @returns {Promise<boolean>}
   */
  async isDefenderAvailable() {
    try {
      const result = await this.audit.runPowerShell('Get-MpComputerStatus | Select-Object -ExpandProperty RealTimeProtectionEnabled');
      return result.ok;
    } catch (err) {
      logger.error('Windows Defender availability check failed:', err);
      return false;
    }
  }

  /**
   * Verify that Defender real-time protection matches the expected state.
   * @param {boolean} expected
   * @returns {Promise<{ok:boolean, enabled:boolean|null, error?:string}>}
   */
  async verifyRealtimeState(expected) {
    const isAvailable = await this.isDefenderAvailable();
    if (!isAvailable) {
      return {
        ok: false,
        enabled: null,
        error: 'Windows Defender is not available or not installed on this system.'
      };
    }

    const result = await this.audit.runPowerShell('Get-MpComputerStatus | Select-Object -ExpandProperty RealTimeProtectionEnabled');
    if (!result.ok) {
      return {
        ok: false,
        enabled: null,
        error: result.error || 'Unable to query real-time protection state.'
      };
    }

    const value = (result.stdout || '').toString().trim().toLowerCase();
    const enabled = value === 'true';

    const tamperError = 'Windows Defender Tamper Protection is preventing this app from changing real-time protection. Disable Tamper Protection in Windows Security > Virus & threat protection settings, then try again.';
    if (enabled !== expected) {
      return {
        ok: false,
        enabled,
        error: tamperError
      };
    }

    return { ok: true, enabled, error: null };
  }

  /**
   * Enable Windows Defender real-time protection.
   * @returns {Promise<{ok:boolean, enabled:boolean|null, error?:string}>}
   */
  async start() {
    const isAvailable = await this.isDefenderAvailable();
    if (!isAvailable) {
      return {
        ok: false,
        enabled: null,
        error: 'Windows Defender is not available or not installed on this system.'
      };
    }

    const result = await this.audit.runPowerShell('Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop');
    if (!result.ok) {
      return {
        ok: false,
        enabled: null,
        error: result.error || 'Unable to enable real-time protection.'
      };
    }

    return this.verifyRealtimeState(true);
  }

  /**
   * Disable Windows Defender real-time protection.
   * @returns {Promise<{ok:boolean, enabled:boolean|null, error?:string}>}
   */
  async stop() {
    const isAvailable = await this.isDefenderAvailable();
    if (!isAvailable) {
      return {
        ok: false,
        enabled: null,
        error: 'Windows Defender is not available or not installed on this system.'
      };
    }

    const result = await this.audit.runPowerShell('Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction Stop');
    if (!result.ok) {
      return {
        ok: false,
        enabled: null,
        error: result.error || 'Unable to disable real-time protection.'
      };
    }

    return this.verifyRealtimeState(false);
  }

  /**
   * Get the current real-time protection status.
   * @returns {Promise<{ok:boolean, enabled:boolean|null, error?:string}>}
   */
  async getStatus() {
    const isAvailable = await this.isDefenderAvailable();
    if (!isAvailable) {
      return {
        ok: false,
        enabled: null,
        error: 'Windows Defender is not available or not installed on this system.'
      };
    }

    const result = await this.audit.runPowerShell('Get-MpComputerStatus | Select-Object -ExpandProperty RealTimeProtectionEnabled');
    if (!result.ok) {
      return {
        ok: false,
        enabled: null,
        error: result.error || 'Unable to query real-time protection state.'
      };
    }

    const value = (result.stdout || '').toString().trim().toLowerCase();
    const enabled = value === 'true';
    return {
      ok: true,
      enabled,
      error: null
    };
  }
}

module.exports = RealTimeWatcher;
