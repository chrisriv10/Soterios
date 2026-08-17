'use strict';

const { execFileSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
const { InvalidInputError, AppError } = require('../utils/errors');
const { log, ACTIONS } = require('../core/auditLog');

const SAFE_INTERFACE_NAME = /^[^\s'"\\|&;<>]+$/;

/**
 * Emergency Lockdown Service
 * Provides one-click network and service isolation for emergency situations
 */
class EmergencyLockdown {
  /**
   * @param {import('../core/database')} db - Database instance.
   * @param {import('../core/eventBus')} eventBus - Event bus for lockdown state changes.
   * @param {(title: string, body: string, level?: string) => void} notify - Desktop notification callback.
   */
  constructor(db, eventBus, notify) {
    this.db = db;
    this.eventBus = eventBus;
    this.notify = notify;
    this.isLockedDown = false;
    this.savedNetworkState = null;
    this.savedServicesState = null;
    this.allowlist = {
      interfaces: [],
      services: [],
      ips: []
    };
    this._loadAllowlist();
  }

  /**
   * Load the lockdown allowlist from the database.
   */
  _loadAllowlist() {
    try {
      const stored = this.db.get('lockdown_allowlist');
      if (stored) {
        this.allowlist = { ...this.allowlist, ...stored };
      }
    } catch (err) {
      // Ignore, use defaults
    }
  }

  /**
   * Persist the current allowlist to the database.
   */
  _saveAllowlist() {
    try {
      this.db.set('lockdown_allowlist', this.allowlist);
    } catch (err) {
      console.error('Failed to save lockdown allowlist:', err);
    }
  }

  /**
   * Return a copy of the current allowlist.
   * @returns {Object}
   */
  getAllowlist() {
    return { ...this.allowlist };
  }

  /**
   * Replace the entire allowlist and persist it.
   * @param {Object} allowlist
   * @param {Array} [allowlist.interfaces]
   * @param {Array} [allowlist.services]
   * @param {Array} [allowlist.ips]
   * @returns {Object}
   */
  setAllowlist(allowlist) {
    this.allowlist = {
      interfaces: allowlist.interfaces || [],
      services: allowlist.services || [],
      ips: allowlist.ips || []
    };
    this._saveAllowlist();
    return this.allowlist;
  }

  /**
   * Add an entry to the allowlist.
   * @param {'interfaces'|'services'|'ips'} type
   * @param {string} value
   * @returns {Object}
   */
  addToAllowlist(type, value) {
    if (!this.allowlist[type]) {
      this.allowlist[type] = [];
    }
    const normalized = type === 'ips' ? value.trim() : value.trim().toLowerCase();
    if (!this.allowlist[type].includes(normalized)) {
      this.allowlist[type].push(normalized);
      this._saveAllowlist();
    }
    return this.allowlist;
  }

  /**
   * Remove an entry from the allowlist.
   * @param {'interfaces'|'services'|'ips'} type
   * @param {string} value
   * @returns {Object}
   */
  removeFromAllowlist(type, value) {
    if (!this.allowlist[type]) return this.allowlist;
    const normalized = type === 'ips' ? value.trim() : value.trim().toLowerCase();
    this.allowlist[type] = this.allowlist[type].filter(v => v !== normalized);
    this._saveAllowlist();
    return this.allowlist;
  }

  /**
   * Get list of network interfaces.
   * @returns {Promise<Array<{name:string, state:string, type:string, connectivity:string}>>}
   */
  async getNetworkInterfaces() {
    try {
      const { stdout } = await execAsync('netsh interface show interface', { timeout: 5000 });
      const lines = stdout.split('\n');
      const interfaces = [];
      
      for (const line of lines) {
        const match = line.match(/^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
        if (match) {
          const [, name, state, type, connectivity, comment] = match;
          if (type === 'Ethernet' || type === 'Wi-Fi' || type === 'Wireless') {
            interfaces.push({
              name: name.trim(),
              state: state.trim(),
              type: type.trim(),
              connectivity: connectivity.trim()
            });
          }
        }
      }
      return interfaces;
    } catch (err) {
      throw new AppError(`Failed to get network interfaces: ${err.message}`);
    }
  }

  /**
   * Disable a network interface by name.
   * @param {string} interfaceName
   * @returns {Promise<{success:boolean, interface:string}>}
   */
  async disableInterface(interfaceName) {
    if (!interfaceName || !SAFE_INTERFACE_NAME.test(interfaceName)) {
      throw new InvalidInputError('Invalid interface name.');
    }
    try {
      execFileSync('netsh', ['interface', 'set', 'interface', interfaceName, 'admin=disable'], { timeout: 10000 });
      return { success: true, interface: interfaceName };
    } catch (err) {
      throw new AppError(`Failed to disable ${interfaceName}: ${err.message}`);
    }
  }

  /**
   * Enable a network interface by name.
   * @param {string} interfaceName
   * @returns {Promise<{success:boolean, interface:string}>}
   */
  async enableInterface(interfaceName) {
    if (!interfaceName || !SAFE_INTERFACE_NAME.test(interfaceName)) {
      throw new InvalidInputError('Invalid interface name.');
    }
    try {
      execFileSync('netsh', ['interface', 'set', 'interface', interfaceName, 'admin=enable'], { timeout: 10000 });
      return { success: true, interface: interfaceName };
    } catch (err) {
      throw new AppError(`Failed to enable ${interfaceName}: ${err.message}`);
    }
  }

  /**
   * Get list of non-essential Windows services.
   * @returns {Promise<Array<{name:string, displayName:string, state:string}>>}
   */
  async getNonEssentialServices() {
    const nonEssentialPatterns = [
      'Adobe', 'Google', 'Mozilla', 'Spooler', 'Print', 'Fax', 'Xbox', 
      'WSearch', 'SysMain', 'DiagTrack', 'WaaSMedicSvc', 'XblAuthManager',
      'XblGameSave', 'XboxNetApiSvc', 'BcastDVRUserService', 'OneSync'
    ];

    try {
      const { stdout } = await execAsync('sc query type= service state= all', { timeout: 10000 });
      const lines = stdout.split('\n');
      const services = [];

      let currentService = null;
      for (const line of lines) {
        const serviceNameMatch = line.match(/^SERVICE_NAME:\s*(.+)$/);
        if (serviceNameMatch) {
          if (currentService && currentService.displayName) {
            services.push(currentService);
          }
          currentService = { name: serviceNameMatch[1].trim(), displayName: '', state: '' };
        } else if (currentService) {
          const displayNameMatch = line.match(/^DISPLAY_NAME:\s*(.+)$/);
          const stateMatch = line.match(/^\s+STATE:\s+(\d+)\s+(\w+)$/);
          
          if (displayNameMatch) {
            currentService.displayName = displayNameMatch[1].trim();
          } else if (stateMatch) {
            currentService.state = stateMatch[2].trim();
          }
        }
      }
      if (currentService && currentService.displayName) {
        services.push(currentService);
      }

      // Filter for non-essential services that are currently running
      return services.filter(svc => {
        const isNonEssential = nonEssentialPatterns.some(pattern => 
          svc.name.toLowerCase().includes(pattern.toLowerCase()) ||
          svc.displayName.toLowerCase().includes(pattern.toLowerCase())
        );
        const isRunning = svc.state === 'RUNNING';
        return isNonEssential && isRunning;
      });
    } catch (err) {
      throw new AppError(`Failed to get services: ${err.message}`);
    }
  }

  /**
   * Stop a Windows service.
   * @param {string} serviceName
   * @returns {Promise<{success:boolean, service:string}>}
   */
  async stopService(serviceName) {
    try {
      execFileSync('sc', ['stop', serviceName], { timeout: 15000 });
      return { success: true, service: serviceName };
    } catch (err) {
      throw new AppError(`Failed to stop ${serviceName}: ${err.message}`);
    }
  }

  /**
   * Start a Windows service.
   * @param {string} serviceName
   * @returns {Promise<{success:boolean, service:string}>}
   */
  async startService(serviceName) {
    try {
      execFileSync('sc', ['start', serviceName], { timeout: 15000 });
      return { success: true, service: serviceName };
    } catch (err) {
      throw new AppError(`Failed to start ${serviceName}: ${err.message}`);
    }
  }

  /**
   * Activate emergency lockdown: disable interfaces, stop non-essential services.
   * @returns {Promise<{success:boolean, message?:string}>}
   */
  async lockdown() {
    if (this.isLockedDown) {
      return { success: false, message: 'Already in lockdown mode' };
    }

    // Claim lockdown state immediately to prevent concurrent invocations
    this.isLockedDown = true;

    try {
      // Save current state
      const interfaces = await this.getNetworkInterfaces();
      const services = await this.getNonEssentialServices();
      
      this.savedNetworkState = interfaces.map(i => ({ name: i.name.trim(), state: i.state }));
      this.savedServicesState = services.map(s => ({ name: s.name, state: s.state }));

      const results = {
        disabledInterfaces: [],
        stoppedServices: [],
        skippedInterfaces: [],
        skippedServices: [],
        errors: []
      };

      // Disable all connected network interfaces (respecting allowlist)
      const allowedInterfaces = new Set(this.allowlist.interfaces?.map(i => i.toLowerCase()) || []);
      const allowedIPs = new Set(this.allowlist.ips || []);
      
      for (const iface of interfaces) {
        if (iface.state === 'connected') {
          // Check if interface is allowlisted
          if (allowedInterfaces.has(iface.name.toLowerCase())) {
            results.skippedInterfaces.push(`${iface.name} (allowlisted)`);
            continue;
          }
          
          // Check if any IP on this interface is allowlisted
          // For simplicity, we'll skip the interface if user explicitly allowlisted it
          try {
            await this.disableInterface(iface.name);
            results.disabledInterfaces.push(iface.name);
          } catch (err) {
            results.errors.push(`Network: ${err.message}`);
          }
        }
      }

      // Stop non-essential services (respecting allowlist)
      const allowedServices = new Set(this.allowlist.services?.map(s => s.toLowerCase()) || []);
      
      for (const svc of services) {
        // Check if service is allowlisted
        if (allowedServices.has(svc.name.toLowerCase())) {
          results.skippedServices.push(`${svc.name} (allowlisted)`);
          continue;
        }
        
        try {
          await this.stopService(svc.name);
          results.stoppedServices.push(svc.name);
        } catch (err) {
          results.errors.push(`Service: ${err.message}`);
        }
      }

      this.eventBus.emit('lockdown:changed', { locked: true, results });
      
      this.notify(
        'Emergency Lockdown Activated',
        `Disabled ${results.disabledInterfaces.length} network interfaces and stopped ${results.stoppedServices.length} services. ${results.skippedInterfaces.length} interfaces and ${results.skippedServices.length} services skipped (allowlisted).`,
        'warn'
      );

      log(this.db, ACTIONS.LOCKDOWN_ACTIVATE, results, { success: true }, true);
      return { success: true, results };
    } catch (err) {
      // Reset guard on failure so restore() doesn't receive corrupted state
      this.isLockedDown = false;
      this.savedNetworkState = null;
      this.savedServicesState = null;
      log(this.db, ACTIONS.LOCKDOWN_ACTIVATE, null, { success: false, error: err.message }, true);
      throw new AppError(`Lockdown failed: ${err.message}`);
    }
  }

  /**
   * Restore from lockdown - re-enable network interfaces and restart services.
   * @returns {Promise<{success:boolean, message?:string, results?:Object}>}
   */
  async restore() {
    if (!this.isLockedDown) {
      return { success: false, message: 'Not in lockdown mode' };
    }

    try {
      const results = {
        enabledInterfaces: [],
        startedServices: [],
        errors: []
      };

      const totalInterfacesToRestore = this.savedNetworkState ? this.savedNetworkState.filter(i => i.state === 'connected').length : 0;
      const totalServicesToRestore = this.savedServicesState ? this.savedServicesState.filter(s => s.state === 'RUNNING').length : 0;

      // Restore network interfaces
      if (this.savedNetworkState) {
        for (const iface of this.savedNetworkState) {
          if (iface.state === 'connected') {
            try {
              await this.enableInterface(iface.name);
              results.enabledInterfaces.push(iface.name);
            } catch (err) {
              results.errors.push(`Network: ${err.message}`);
            }
          }
        }
      }

      // Restore services
      if (this.savedServicesState) {
        for (const svc of this.savedServicesState) {
          if (svc.state === 'RUNNING') {
            try {
              await this.startService(svc.name);
              results.startedServices.push(svc.name);
            } catch (err) {
              results.errors.push(`Service: ${err.message}`);
            }
          }
        }
      }

      // Determine overall restore status
      const allInterfacesRestored = results.enabledInterfaces.length === totalInterfacesToRestore;
      const allServicesRestored = results.startedServices.length === totalServicesToRestore;
      const hasErrors = results.errors.length > 0;

      let status = 'success';
      if (hasErrors && (allInterfacesRestored || allServicesRestored)) {
        status = 'partial';
      } else if (hasErrors || (!allInterfacesRestored && totalInterfacesToRestore > 0) || (!allServicesRestored && totalServicesToRestore > 0)) {
        status = 'failed';
      }

      // Only clear state if restore was fully successful
      if (status === 'success') {
        this.isLockedDown = false;
        this.savedNetworkState = null;
        this.savedServicesState = null;
        
        this.eventBus.emit('lockdown:changed', { locked: false, results, status });
        
        this.notify(
          'Emergency Lockdown Released',
          `Restored ${results.enabledInterfaces.length} network interfaces and restarted ${results.startedServices.length} services.`,
          'success'
        );
      } else {
        // Keep lockdown state active if restore failed/partial
        this.eventBus.emit('lockdown:changed', { locked: true, results, status });
        
        this.notify(
          'Emergency Lockdown Restore Incomplete',
          `Partial restore: ${results.enabledInterfaces.length}/${totalInterfacesToRestore} interfaces, ${results.startedServices.length}/${totalServicesToRestore} services. ${results.errors.length} errors occurred.`,
          'warn'
        );
      }

      log(this.db, ACTIONS.LOCKDOWN_RESTORE, results, { success: status === 'success', status }, true);
      return { success: status === 'success', results, status };
    } catch (err) {
      log(this.db, ACTIONS.LOCKDOWN_RESTORE, null, { success: false, error: err.message }, true);
      throw new AppError(`Restore failed: ${err.message}`);
    }
  }

  /**
   * Get current lockdown status.
   * @returns {Object}
   */
  getStatus() {
    return {
      isLockedDown: this.isLockedDown,
      savedNetworkState: this.savedNetworkState,
      savedServicesState: this.savedServicesState
    };
  }
}

module.exports = EmergencyLockdown;
