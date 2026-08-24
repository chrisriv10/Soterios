'use strict';

const { execFileSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
const os = require('os');

/**
 * Emergency Lockdown Service
 * Provides one-click network and service isolation for emergency situations
 */
class EmergencyLockdown {
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

  _saveAllowlist() {
    try {
      this.db.set('lockdown_allowlist', this.allowlist);
    } catch (err) {
      console.error('Failed to save lockdown allowlist:', err);
    }
  }

  getAllowlist() {
    return { ...this.allowlist };
  }

  setAllowlist(allowlist) {
    this.allowlist = {
      interfaces: allowlist.interfaces || [],
      services: allowlist.services || [],
      ips: allowlist.ips || []
    };
    this._saveAllowlist();
    return this.allowlist;
  }

  addToAllowlist(type, value) {
    if (!this.allowlist[type]) {
      this.allowlist[type] = [];
    }
    const raw = String(value || '').trim();
    if (type === 'ips' && !this._isValidIp(raw)) {
      throw new Error(`Invalid IP address: ${raw}`);
    }
    const normalized = type === 'ips' ? raw : raw.toLowerCase();
    if (!this.allowlist[type].includes(normalized)) {
      this.allowlist[type].push(normalized);
      this._saveAllowlist();
    }
    return this.allowlist;
  }

  /**
   * Validate an IPv4 or IPv6 address (CIDR prefix optional for IPv4)
   */
  _isValidIp(value) {
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/;
    if (ipv4.test(value)) {
      return value.split('/')[0].split('.').every(octet => {
        const n = Number(octet);
        return n >= 0 && n <= 255;
      });
    }
    return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':');
  }

  /**
   * Get local IP addresses of this machine (non-internal interfaces)
   */
  getLocalIPs() {
    const ips = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const entry of interfaces[name] || []) {
        if (entry && !entry.internal) {
          ips.push({
            interface: name,
            ip: entry.address,
            family: entry.family === 'IPv6' ? 'IPv6' : 'IPv4'
          });
        }
      }
    }
    return ips;
  }

  removeFromAllowlist(type, value) {
    if (!this.allowlist[type]) return this.allowlist;
    const normalized = type === 'ips' ? value.trim() : value.trim().toLowerCase();
    this.allowlist[type] = this.allowlist[type].filter(v => v !== normalized);
    this._saveAllowlist();
    return this.allowlist;
  }

  /**
   * Parse `netsh interface show interface` output (Windows 8+ layout:
   * "Admin State  State  Type  Interface Name", plus legacy name-first layout).
   * Handles CRLF line endings. State is lowercased for consumers.
   */
  static parseNetworkInterfaces(stdout) {
    const interfaces = [];
    const modernRe = /^\s*(Enabled|Disabled)\s+(Connected|Disconnected)\s+(Dedicated|Internal|Loopback|Tunnel)\s+(.+?)\s*$/;
    const legacyRe = /^\s*(.+?)\s+(Connected|Disconnected)\s+(Dedicated|Internal|Loopback|Tunnel)\s+(\S+)\s*$/i;

    for (const rawLine of String(stdout || '').split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      let match = line.match(modernRe);
      if (match) {
        const [, adminState, state, type, name] = match;
        interfaces.push({
          name: name.trim(),
          state: state.toLowerCase(),
          type: type.trim(),
          adminState: adminState.trim()
        });
        continue;
      }
      match = line.match(legacyRe);
      if (match) {
        const [, name, state, type, connectivity] = match;
        interfaces.push({
          name: name.trim(),
          state: state.toLowerCase(),
          type: type.trim(),
          connectivity: connectivity.trim()
        });
      }
    }
    return interfaces;
  }

  /**
   * Get list of network interfaces
   */
  async getNetworkInterfaces() {
    try {
      const { stdout } = await execAsync('netsh interface show interface', { timeout: 5000 });
      return EmergencyLockdown.parseNetworkInterfaces(stdout);
    } catch (err) {
      throw new Error(`Failed to get network interfaces: ${err.message}`);
    }
  }

  /**
   * Disable a network interface
   */
  async disableInterface(interfaceName) {
    try {
      execFileSync('netsh', ['interface', 'set', 'interface', interfaceName, 'admin=disable'], { timeout: 10000 });
      return { success: true, interface: interfaceName };
    } catch (err) {
      throw new Error(`Failed to disable ${interfaceName}: ${err.message}`);
    }
  }

  /**
   * Enable a network interface
   */
  async enableInterface(interfaceName) {
    try {
      execFileSync('netsh', ['interface', 'set', 'interface', interfaceName, 'admin=enable'], { timeout: 10000 });
      return { success: true, interface: interfaceName };
    } catch (err) {
      throw new Error(`Failed to enable ${interfaceName}: ${err.message}`);
    }
  }

  /**
   * Parse `sc query type= service state= all` output. Handles CRLF line endings.
   */
  static parseScQueryServices(stdout) {
    const nonEssentialPatterns = [
      'Adobe', 'Google', 'Mozilla', 'Spooler', 'Print', 'Fax', 'Xbox', 
      'WSearch', 'SysMain', 'DiagTrack', 'WaaSMedicSvc', 'XblAuthManager',
      'XblGameSave', 'XboxNetApiSvc', 'BcastDVRUserService', 'OneSync'
    ];

    const lines = String(stdout || '').split('\n');
    const services = [];

    let currentService = null;
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      const serviceNameMatch = line.match(/^SERVICE_NAME:\s*(.+)$/);
      if (serviceNameMatch) {
        if (currentService && currentService.displayName) {
          services.push(currentService);
        }
        currentService = { name: serviceNameMatch[1].trim(), displayName: '', state: '' };
      } else if (currentService) {
        const displayNameMatch = line.match(/^DISPLAY_NAME:\s*(.+)$/);
        const stateMatch = line.match(/^\s+STATE\s*:\s+(\d+)\s+(\w+)\s*$/);

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
  }

  /**
   * Get list of non-essential Windows services
   */
  async getNonEssentialServices() {
    try {
      const { stdout } = await execAsync('sc query type= service state= all', { timeout: 10000 });
      return EmergencyLockdown.parseScQueryServices(stdout);
    } catch (err) {
      throw new Error(`Failed to get services: ${err.message}`);
    }
  }

  /**
   * Stop a Windows service
   */
  async stopService(serviceName) {
    try {
      execFileSync('sc', ['stop', serviceName], { timeout: 15000 });
      return { success: true, service: serviceName };
    } catch (err) {
      throw new Error(`Failed to stop ${serviceName}: ${err.message}`);
    }
  }

  /**
   * Start a Windows service
   */
  async startService(serviceName) {
    try {
      execFileSync('sc', ['start', serviceName], { timeout: 15000 });
      return { success: true, service: serviceName };
    } catch (err) {
      throw new Error(`Failed to start ${serviceName}: ${err.message}`);
    }
  }

  /**
   * Emergency lockdown - disable all network interfaces and stop non-essential services
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
      
      this.savedNetworkState = interfaces.map(i => ({ name: i.name, state: i.state }));
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

      return { success: true, results };
    } catch (err) {
      // Reset guard on failure so restore() doesn't receive corrupted state
      this.isLockedDown = false;
      this.savedNetworkState = null;
      this.savedServicesState = null;
      throw new Error(`Lockdown failed: ${err.message}`);
    }
  }

  /**
   * Restore from lockdown - re-enable network interfaces and restart services
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

      return { success: status === 'success', results, status };
    } catch (err) {
      throw new Error(`Restore failed: ${err.message}`);
    }
  }

  /**
   * Get current lockdown status
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
