const SystemAudit = require('./SystemAudit');

class RealTimeWatcher {
  constructor(db, eventBus, scanEngine) {
    this.db = db;
    this.eventBus = eventBus;
    this.scanEngine = scanEngine;
    this.audit = new SystemAudit();
  }

  async isDefenderAvailable() {
    try {
      const result = await this.audit.runPowerShell('Get-MpComputerStatus | Select-Object -ExpandProperty RealTimeProtectionEnabled');
      return result.ok;
    } catch (err) {
      console.error('Windows Defender availability check failed:', err);
      return false;
    }
  }

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
