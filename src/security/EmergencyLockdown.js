'use strict';

const { execFileSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);

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
  }

  /**
   * Get list of network interfaces
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
   * Get list of non-essential Windows services
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

    try {
      // Save current state
      const interfaces = await this.getNetworkInterfaces();
      const services = await this.getNonEssentialServices();
      
      this.savedNetworkState = interfaces.map(i => ({ name: i.name, state: i.state }));
      this.savedServicesState = services.map(s => ({ name: s.name, state: s.state }));

      const results = {
        disabledInterfaces: [],
        stoppedServices: [],
        errors: []
      };

      // Disable all connected network interfaces
      for (const iface of interfaces) {
        if (iface.state === 'connected') {
          try {
            await this.disableInterface(iface.name);
            results.disabledInterfaces.push(iface.name);
          } catch (err) {
            results.errors.push(`Network: ${err.message}`);
          }
        }
      }

      // Stop non-essential services
      for (const svc of services) {
        try {
          await this.stopService(svc.name);
          results.stoppedServices.push(svc.name);
        } catch (err) {
          results.errors.push(`Service: ${err.message}`);
        }
      }

      this.isLockedDown = true;
      this.eventBus.emit('lockdown:changed', { locked: true, results });
      
      this.notify(
        'Emergency Lockdown Activated',
        `Disabled ${results.disabledInterfaces.length} network interfaces and stopped ${results.stoppedServices.length} services.`,
        'warn'
      );

      return { success: true, results };
    } catch (err) {
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
