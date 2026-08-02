const { register: registerScan } = require('./ipc/scan');
const { register: registerQuarantine } = require('./ipc/quarantine');
const { register: registerProcess } = require('./ipc/process');
const { register: registerFirewall } = require('./ipc/firewall');
const { register: registerNetwork } = require('./ipc/network');
const { register: registerSystem } = require('./ipc/system');

function registerIpcHandlers(mainWindow, services) {
  const servicesForScan = {
    db: services.db,
    eventBus: services.eventBus,
    clamEngine: services.clamEngine,
    scanEngine: services.scanEngine,
    reputationEngine: services.reputationEngine,
  };

  const servicesForQuarantine = {
    quarantineManager: services.quarantineManager,
  };

  const servicesForProcess = {
    processInspector: services.processInspector,
  };

  const servicesForFirewall = {
    db: services.db,
    firewallManager: services.firewallManager,
  };

  const servicesForNetwork = {
    db: services.db,
    eventBus: services.eventBus,
    networkMonitor: services.networkMonitor,
    networkEnricher: services.networkEnricher,
    networkAlertMonitor: services.networkAlertMonitor,
    geoLocationService: services.geoLocationService,
    startNetworkStatsTimer: services.startNetworkStatsTimer,
    stopNetworkStatsTimer: services.stopNetworkStatsTimer,
  };

  const servicesForSystem = {
    db: services.db,
    eventBus: services.eventBus,
    toolRegistry: services.toolRegistry,
    maintenanceScheduler: services.maintenanceScheduler,
    firewallManager: services.firewallManager,
    networkMonitor: services.networkMonitor,
    geoLocationService: services.geoLocationService,
    systemAudit: services.systemAudit,
    realtimeWatcher: services.realtimeWatcher,
    folderWatcher: services.folderWatcher,
    startNetworkStatsTimer: services.startNetworkStatsTimer,
    stopNetworkStatsTimer: services.stopNetworkStatsTimer,
    emergencyLockdown: services.emergencyLockdown,
    isActuallyAdmin: services.isActuallyAdmin,
  };

  registerScan(mainWindow, servicesForScan);
  registerQuarantine(mainWindow, servicesForQuarantine);
  registerProcess(mainWindow, servicesForProcess);
  registerFirewall(mainWindow, servicesForFirewall);
  registerNetwork(mainWindow, servicesForNetwork);
  registerSystem(mainWindow, servicesForSystem);
}

module.exports = { registerIpcHandlers };
