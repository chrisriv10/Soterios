const { register: registerScan } = require('./ipc/scan');
const { register: registerQuarantine } = require('./ipc/quarantine');
const { register: registerProcess } = require('./ipc/process');
const { register: registerFirewall } = require('./ipc/firewall');
const { register: registerNetwork } = require('./ipc/network');
const { register: registerSystem } = require('./ipc/system');
const { register: registerAi } = require('./ipc/ai');

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
    db: services.db,
  };

  const servicesForProcess = {
    processInspector: services.processInspector,
    processService: services.processService,
    processReputation: services.processReputation,
    db: services.db,
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
    vpnManager: services.vpnManager,
    startNetworkStatsTimer: services.startNetworkStatsTimer,
    stopNetworkStatsTimer: services.stopNetworkStatsTimer,
  };

  const servicesForSystem = {
    db: services.db,
    eventBus: services.eventBus,
    toolRegistry: services.toolRegistry,
    toolRunManager: services.toolRunManager,
    maintenanceSafetyVault: services.maintenanceSafetyVault,
    persistenceMonitor: services.persistenceMonitor,
    extensionBridge: services.extensionBridge,
    processService: services.processService,
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
    vpnManager: services.vpnManager,
  };

  const servicesForAi = {
    db: services.db,
    toolRegistry: services.toolRegistry,
    firewallManager: services.firewallManager,
    processInspector: services.processInspector,
    scanEngine: services.scanEngine,
  };

  registerScan(mainWindow, servicesForScan);
  registerQuarantine(mainWindow, servicesForQuarantine);
  registerProcess(mainWindow, servicesForProcess);
  registerFirewall(mainWindow, servicesForFirewall);
  registerNetwork(mainWindow, servicesForNetwork);
  registerSystem(mainWindow, servicesForSystem);
  registerAi(mainWindow, servicesForAi);
}

module.exports = { registerIpcHandlers };
