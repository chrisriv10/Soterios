'use strict';

const path = require('path');
const ClamAVEngine = require('../security/ClamAVEngine');
const HeuristicEngine = require('../security/HeuristicEngine');
const ReputationEngine = require('../security/ReputationEngine');
const QuarantineManager = require('../security/QuarantineManager');
const ScanEngine = require('../security/ScanEngine');
const RealTimeWatcher = require('../security/RealTimeWatcher');
const { ProcessService } = require('./processService');
const SystemAudit = require('../security/SystemAudit');
const FirewallManager = require('../security/FirewallManager');
const NetworkMonitor = require('../security/NetworkMonitor');
const FolderWatcher = require('../security/FolderWatcher');
const NetworkAlertMonitor = require('../security/NetworkAlertMonitor');
const EmergencyLockdown = require('../security/EmergencyLockdown');
const { ProcessResolver } = require('../security/ProcessResolver');
const { BlocklistService } = require('../security/BlocklistService');
const { NetworkEnricher } = require('../security/NetworkEnricher');
const { GeoLocationService } = require('../security/GeoLocationService');
const { VpnManager } = require('./vpnManager');
const toolRegistry = require('../core/toolRegistry');

class ServiceRegistry {
  constructor() {
    this._services = {};
  }

  /**
   * Construct and wire security/main-process services.
   * @param {import('../core/database')} db
   * @param {{ emit: Function }} eventBus
   * @param {{ userDataPath: string, notify?: Function }} options
   */
  create(db, eventBus, options = {}) {
    const notify = options.notify || (() => {});
    const userDataPath = options.userDataPath;
    const locale = options.locale || 'en';

    const clamEngine = new ClamAVEngine({
      dbDir: path.join(userDataPath, 'clamav-db')
    });
    const heuristicEngine = new HeuristicEngine();
    const reputationEngine = new ReputationEngine(db);
    const quarantineManager = new QuarantineManager(db);
    const scanEngine = new ScanEngine(
      db,
      eventBus,
      clamEngine,
      heuristicEngine,
      reputationEngine,
      quarantineManager
    );
    const realtimeWatcher = new RealTimeWatcher(db, eventBus, scanEngine);
    const processService = new ProcessService({
      db,
      userDataPath,
      resourcesPath: options.resourcesPath || null,
      requireIntegrityManifest: !!options.requireProcessCollectorIntegrity
    });
    // Compatibility alias for NetworkAlertMonitor, ProcessResolver, AI
    // context, and older IPC consumers while they migrate to ProcessService.
    const processInspector = processService;
    const systemAudit = new SystemAudit();
    systemAudit.setLocale(locale);
    const firewallManager = new FirewallManager();
    const networkMonitor = new NetworkMonitor();
    const processResolver = new ProcessResolver(processInspector);
    const blocklistService = new BlocklistService(db);
    const networkEnricher = new NetworkEnricher(processResolver, blocklistService);
    const geoLocationService = new GeoLocationService(db);
    const folderWatcher = new FolderWatcher({
      db,
      eventBus,
      scanEngine,
      clamEngine,
      notify
    });
    const networkAlertMonitor = new NetworkAlertMonitor({
      networkMonitor,
      blocklistService,
      processInspector,
      processService,
      db,
      notify
    });
    const emergencyLockdown = new EmergencyLockdown(db, eventBus, notify);
    const vpnManager = new VpnManager();

    this._services = {
      db,
      eventBus,
      clamEngine,
      heuristicEngine,
      reputationEngine,
      quarantineManager,
      scanEngine,
      realtimeWatcher,
      processInspector,
      processService,
      systemAudit,
      firewallManager,
      networkMonitor,
      processResolver,
      blocklistService,
      networkEnricher,
      geoLocationService,
      folderWatcher,
      networkAlertMonitor,
      emergencyLockdown,
      vpnManager,
      toolRegistry
    };
    return this._services;
  }

  get(name) {
    return this._services[name];
  }

  getAll() {
    return this._services;
  }
}

module.exports = new ServiceRegistry();
